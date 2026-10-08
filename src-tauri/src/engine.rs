//! Motor de separación como proceso hijo.
//!
//! `python/separate.py` escribe en stdout una línea JSON por mensaje (progreso,
//! dispositivo, capacidades, fin o error). Puede ejecutarse dentro de un
//! contenedor Docker (`docker run …`, opción por defecto) o con un Python local;
//! en ambos casos se lee stdout línea a línea mientras el proceso corre y cada
//! mensaje se traduce a un `SeparationEvent` para el frontend. stderr se drena en
//! otro hilo (Torch es verboso y, si nadie lo lee, el pipe se llena y el hijo se
//! bloquea); se guardan sus últimas líneas para explicar un fallo.
//!
//! `python/transcribe.py` (modo práctica) sigue el mismo protocolo: recibe solo el
//! `bass.wav` de una extracción y responde con un `done` que lleva sus notas.

use std::collections::{BTreeMap, VecDeque};
use std::env;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Formatos de entrada. soundfile lee casi todos; M4A necesita ffmpeg (incluido en la imagen).
pub const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "flac", "aiff", "aif", "ogg", "m4a"];
/// Pistas que el motor entrega siempre.
pub const BASE_STEMS: [&str; 4] = ["vocals", "drums", "bass", "other"];
/// Pistas que hay que pedir; si no se piden, su contenido va a «other».
pub const OPTIONAL_STEMS: [&str; 3] = ["guitar", "piano", "wind"];

const DEFAULT_IMAGE: &str = "audioextract-engine:latest";
const SEPARATE_SCRIPT: &str = "separate.py";
/// Script de transcripción del bajo (modo práctica); va junto a `separate.py`.
const TRANSCRIBE_SCRIPT: &str = "transcribe.py";
/// Dónde ve el contenedor de transcripción el `bass.wav` (montado en solo lectura).
const TRANSCRIBE_INPUT: &str = "/input/bass.wav";
/// Dónde ve el contenedor los scripts que instala la app (en solo lectura).
const SCRIPTS_MOUNT: &str = "/opt/audioextract/python";
/// Ruedas de Python puro que la app instala junto a sus scripts (ver `catalog.use_bundled_wheels`).
const WHEELS_DIR: &str = "wheels";
const STDERR_TAIL_LINES: usize = 40;
/// Arrancar el contenedor e inicializar CUDA tarda unos segundos; Docker Desktop recién abierto, bastante más.
const CHECK_TIMEOUT: Duration = Duration::from_secs(120);
const REBUILD_HINT: &str = "Reconstruye la imagen del motor con: npm run docker:engine";

/// Carpetas de la app instalada, para el motor `python`: los scripts van como
/// recursos del instalador y el entorno virtual en la carpeta de datos de la app.
static APP_DIRS: OnceLock<AppDirs> = OnceLock::new();

struct AppDirs {
    resources: Option<PathBuf>,
    data: Option<PathBuf>,
}

/// Se llama una vez al arrancar, con las rutas que resuelve Tauri.
pub fn init_app_dirs(resources: Option<PathBuf>, data: Option<PathBuf>) {
    let _ = APP_DIRS.set(AppDirs { resources, data });
}

/// En macOS Docker no puede usar la GPU (Metal): allí el motor por defecto es Python.
fn default_engine() -> &'static str {
    if cfg!(target_os = "macos") {
        "python"
    } else {
        "docker"
    }
}

/// Protocolo de `separate.py`: una línea JSON por mensaje en stdout.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
enum ScriptMessage {
    Device {
        device: String,
        name: Option<String>,
    },
    Capabilities {
        protocol: u32,
        engine: Option<String>,
        #[serde(default)]
        qualities: BTreeMap<String, Vec<String>>,
        #[serde(default)]
        wind: bool,
        /// Ausente en motores anteriores a la 2.1, que no traen `transcribe.py`.
        #[serde(default)]
        transcription: bool,
    },
    Progress {
        percent: f32,
        stage: String,
    },
    Log {
        message: String,
    },
    Done {
        /// Ausente en motores de la versión 1, que siempre entregan las 4 pistas base.
        #[serde(default)]
        stems: Option<Vec<String>>,
        #[serde(default)]
        models: Option<Vec<String>>,
    },
    Error {
        message: String,
    },
}

/// Eventos que llegan al frontend por el `Channel` de Tauri.
#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "event",
    content = "data"
)]
pub enum SeparationEvent {
    Device { device: String, name: Option<String> },
    Progress { percent: f32, stage: String },
    Log { message: String },
}

/// Una nota del bajo transcrita por `transcribe.py`, tal como la recibe el frontend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteEvent {
    /// Notación científica: «C#2» (MIDI 37), «A4» = 440 Hz.
    pub note: String,
    /// Hz de la nota temperada.
    pub frequency: f64,
    pub start_time_ms: u64,
    pub end_time_ms: u64,
}

/// Protocolo de `transcribe.py`. Cualquier otro mensaje se ignora.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum TranscriptionMessage {
    Done { notes: Vec<NoteEvent> },
    Error { message: String },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    /// Demucs v4.
    Fast,
    /// BS-RoFormer SW.
    Best,
}

impl Quality {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Best => "best",
        }
    }
}

/// Lo que pide el frontend: instrumentos opcionales y calidad.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeparationRequest {
    #[serde(default)]
    pub instruments: Vec<String>,
    pub quality: Quality,
}

/// Archivo de entrada validado y carpeta donde el motor dejará las pistas.
pub struct SeparationJob {
    pub input: PathBuf,
    /// Extensión en minúsculas (`mp3`, `wav`…).
    pub extension: String,
    pub output_dir: PathBuf,
    /// Subconjunto ordenado de `OPTIONAL_STEMS`.
    pub instruments: Vec<String>,
    pub quality: Quality,
}

impl SeparationJob {
    pub fn new(input_path: &str, output_dir: PathBuf, request: &SeparationRequest) -> Result<Self, AppError> {
        let input = PathBuf::from(input_path);
        if !input.is_absolute() || !input.is_file() {
            return Err(AppError::InputNotFound(input_path.to_owned()));
        }
        let extension = supported_extension(&input).ok_or(AppError::UnsupportedFormat)?;
        let instruments = OPTIONAL_STEMS
            .iter()
            .filter(|stem| request.instruments.iter().any(|wanted| wanted == *stem))
            .map(|stem| (*stem).to_owned())
            .collect();

        Ok(Self {
            input,
            extension,
            output_dir,
            instruments,
            quality: request.quality,
        })
    }

    /// Si la petición necesita un motor de la versión 2 (instrumentos extra o calidad máxima).
    fn needs_extended_engine(&self) -> bool {
        !self.instruments.is_empty() || self.quality != Quality::Fast
    }
}

pub fn supported_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|ext| AUDIO_EXTENSIONS.contains(&ext.as_str()))
}

/// Qué sabe hacer el motor instalado, según `separate.py --check`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub ready: bool,
    /// `docker` o `python`.
    pub kind: &'static str,
    pub device: Option<String>,
    pub device_name: Option<String>,
    /// 1: motor antiguo (solo 4 pistas, Demucs). 2: instrumentos y calidades.
    pub protocol: u32,
    pub version: Option<String>,
    /// Calidad → instrumentos opcionales que puede separar.
    pub qualities: BTreeMap<String, Vec<String>>,
    pub wind: bool,
    /// Si el motor transcribe el bajo para el modo práctica (`transcribe.py`, motor 2.1+).
    pub transcription: bool,
    /// Qué impide separar y cómo arreglarlo.
    pub problem: Option<String>,
    pub notes: Vec<String>,
    pub checked_at: u64,
}

impl EngineStatus {
    fn not_ready(kind: &'static str, problem: String) -> Self {
        Self {
            ready: false,
            kind,
            device: None,
            device_name: None,
            protocol: 0,
            version: None,
            qualities: BTreeMap::new(),
            wind: false,
            transcription: false,
            problem: Some(problem),
            notes: Vec::new(),
            checked_at: unix_millis() as u64,
        }
    }
}

/// Estado compartido del motor: último `--check` y si Docker puede usar la GPU.
#[derive(Default)]
pub struct EngineState {
    status: Mutex<Option<EngineStatus>>,
    /// Docker no tiene acceso a una GPU NVIDIA: las separaciones van sin `--gpus`.
    cpu_only: AtomicBool,
    checking: Mutex<()>,
}

impl EngineState {
    pub fn cached(&self) -> Option<EngineStatus> {
        lock(&self.status).clone()
    }

    /// Ejecuta `--check` (tarda unos segundos: llamar fuera del hilo principal).
    /// Dos llamadas simultáneas no lanzan dos contenedores: la segunda espera y reutiliza el resultado.
    pub fn refresh(&self, force: bool) -> EngineStatus {
        let _checking = lock(&self.checking);
        if !force {
            if let Some(status) = self.cached() {
                return status;
            }
        }
        let status = self.check();
        *lock(&self.status) = Some(status.clone());
        status
    }

    fn check(&self) -> EngineStatus {
        let engine = match Engine::from_env(false) {
            Ok(engine) => engine,
            Err(err) => return EngineStatus::not_ready("docker", err.to_string()),
        };
        match run_check(&engine) {
            Ok(status) => {
                self.cpu_only.store(false, Ordering::SeqCst);
                status
            }
            Err(failure) if failure.gpu_unavailable && engine.uses_gpu() => {
                // Sin GPU NVIDIA accesible desde Docker: se comprueba sin ella y se separa con la CPU.
                let cpu_engine = Engine::from_env(true).expect("la configuración ya se validó");
                match run_check(&cpu_engine) {
                    Ok(mut status) => {
                        self.cpu_only.store(true, Ordering::SeqCst);
                        status.notes.insert(
                            0,
                            "Docker no puede usar una GPU NVIDIA en este equipo: se separará con la CPU.".to_owned(),
                        );
                        status
                    }
                    Err(failure) => EngineStatus::not_ready(engine.kind(), failure.problem),
                }
            }
            Err(failure) => EngineStatus::not_ready(engine.kind(), failure.problem),
        }
    }
}

/// Qué script del motor se lanza.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Script {
    /// `separate.py`, el punto de entrada de la imagen.
    Separate,
    /// `transcribe.py`, junto a `separate.py`.
    Transcribe,
}

/// Dónde se ejecuta `separate.py`.
enum Engine {
    /// Imagen Docker con PyTorch, Demucs, audio-separator y los pesos de los modelos.
    Docker {
        cli: PathBuf,
        image: String,
        /// Valor de `--gpus`; `None` para ejecutar solo con CPU.
        gpus: Option<String>,
        /// Carpeta `python/` que instala la app (scripts y ruedas). Se monta en el contenedor y se
        /// ejecuta en lugar de los scripts de la imagen: así cada versión de la app trae su motor al
        /// día sin reconstruir la imagen. `None` (no debería pasar): los de la imagen.
        scripts: Option<PathBuf>,
    },
    /// Intérprete de Python local con las dependencias instaladas.
    Python { interpreter: PathBuf, script: PathBuf },
}

impl Engine {
    /// `AUDIOEXTRACT_ENGINE=docker` o `python` (por defecto, Docker; en macOS, Python).
    fn from_env(cpu_only: bool) -> Result<Self, AppError> {
        match env_or("AUDIOEXTRACT_ENGINE", default_engine()).to_ascii_lowercase().as_str() {
            "docker" => Ok(Self::Docker {
                cli: env::var_os("AUDIOEXTRACT_DOCKER")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| "docker".into()),
                image: env_or("AUDIOEXTRACT_IMAGE", DEFAULT_IMAGE),
                gpus: match env_or("AUDIOEXTRACT_DOCKER_GPUS", "all").as_str() {
                    _ if cpu_only => None,
                    "none" | "off" | "cpu" => None,
                    value => Some(value.to_owned()),
                },
                scripts: resolve_script()
                    .ok()
                    .and_then(|script| script.parent().map(Path::to_path_buf)),
            }),
            "python" => Ok(Self::Python {
                interpreter: resolve_python(),
                script: resolve_script()?,
            }),
            other => Err(AppError::Environment(format!(
                "AUDIOEXTRACT_ENGINE=«{other}» no es válido: usa «docker» o «python»."
            ))),
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            Self::Docker { .. } => "docker",
            Self::Python { .. } => "python",
        }
    }

    fn uses_gpu(&self) -> bool {
        matches!(self, Self::Docker { gpus: Some(_), .. })
    }

    fn program(&self) -> &Path {
        match self {
            Self::Docker { cli, .. } => cli,
            Self::Python { interpreter, .. } => interpreter,
        }
    }

    fn spawn_hint(&self) -> &'static str {
        match self {
            Self::Docker { .. } => {
                "Instala Docker Desktop o define AUDIOEXTRACT_DOCKER con la ruta de docker.exe."
            }
            Self::Python { .. } => {
                "Define AUDIOEXTRACT_PYTHON con la ruta del intérprete que tiene las dependencias instaladas."
            }
        }
    }

    /// `docker run …` (sin red ni descargas) o `python -u <script>`, hasta el script incluido.
    fn script_command(&self, script: Script, mounts: &[OsString], container: Option<&str>) -> Command {
        let name = match script {
            Script::Separate => SEPARATE_SCRIPT,
            Script::Transcribe => TRANSCRIBE_SCRIPT,
        };
        match self {
            Self::Docker {
                cli,
                image,
                gpus,
                scripts,
            } => {
                let mut command = Command::new(cli);
                command
                    .args(["run", "--rm", "--init"])
                    // Estrictamente local: nada de descargar imágenes ni acceso a red.
                    .args(["--pull", "never", "--network", "none"]);
                if let Some(name) = container {
                    command.args(["--name", name]);
                }
                if let Some(gpus) = gpus {
                    command.args(["--gpus", gpus.as_str()]);
                }
                for mount in mounts {
                    command.arg("-v").arg(mount);
                }
                match scripts {
                    // Los scripts y las ruedas de la app sustituyen a los de la imagen: la imagen
                    // aporta el entorno (PyTorch, modelos) y la app, la lógica del motor.
                    Some(dir) => {
                        command
                            .arg("-v")
                            .arg(bind_spec(dir, SCRIPTS_MOUNT, true))
                            .arg("-e")
                            .arg(format!("AUDIOEXTRACT_WHEELS={SCRIPTS_MOUNT}/{WHEELS_DIR}"))
                            .args(["--entrypoint", "python"])
                            .arg(image)
                            .arg("-u")
                            .arg(format!("{SCRIPTS_MOUNT}/{name}"));
                    }
                    None if script == Script::Separate => {
                        command.arg(image);
                    }
                    // El punto de entrada de la imagen es separate.py: se sustituye por python.
                    None => {
                        command
                            .args(["--entrypoint", "python"])
                            .arg(image)
                            .arg("-u")
                            .arg(format!("/app/{name}"));
                    }
                }
                command
            }
            Self::Python {
                interpreter,
                script: separate,
            } => {
                let path = match script {
                    Script::Separate => separate.clone(),
                    Script::Transcribe => separate.with_file_name(name),
                };
                let mut command = Command::new(interpreter);
                command
                    // -u: stdout sin búfer, el progreso llega en cuanto Python lo imprime.
                    .arg("-u")
                    .arg(path)
                    // Lo que el entorno no tenga lo completan las ruedas que instala la app.
                    .env("AUDIOEXTRACT_WHEELS", separate.with_file_name(WHEELS_DIR))
                    .env("PYTHONUNBUFFERED", "1")
                    .env("PYTHONIOENCODING", "utf-8")
                    // En Apple Silicon, lo que MPS no soporta cae a CPU en vez de fallar.
                    .env("PYTORCH_ENABLE_MPS_FALLBACK", "1");
                command
            }
        }
    }

    /// `extended`: pasar `--instruments`/`--quality`, que un motor de la versión 1 no entiende.
    fn separation_command(&self, job: &SeparationJob, container: Option<&str>, extended: bool) -> Command {
        let mut command = match self {
            Self::Docker { .. } => {
                let input = format!("/input/source.{}", job.extension);
                let mounts = [
                    bind_spec(&job.input, &input, true),
                    bind_spec(&job.output_dir, "/output", false),
                ];
                let mut command = self.script_command(Script::Separate, &mounts, container);
                command.args(["--input", input.as_str(), "--output", "/output"]);
                command
            }
            Self::Python { .. } => {
                let mut command = self.script_command(Script::Separate, &[], None);
                command
                    .arg("--input")
                    .arg(&job.input)
                    .arg("--output")
                    .arg(&job.output_dir);
                command
            }
        };

        if extended {
            if !job.instruments.is_empty() {
                command.arg("--instruments").arg(job.instruments.join(","));
            }
            command.arg("--quality").arg(job.quality.as_str());
        }
        if let Some(model) = env_nonempty("AUDIOEXTRACT_MODEL") {
            command.arg("--model").arg(model);
        }
        command.arg("--device").arg(env_or("AUDIOEXTRACT_DEVICE", "auto"));
        piped(&mut command);
        command
    }

    fn check_command(&self) -> Command {
        let mut command = self.script_command(Script::Separate, &[], None);
        command
            .arg("--check")
            .arg("--device")
            .arg(env_or("AUDIOEXTRACT_DEVICE", "auto"));
        piped(&mut command);
        command
    }

    /// `transcribe.py` sobre un único `bass.wav`: en Docker es el único archivo que ve
    /// el contenedor, en solo lectura y sin carpeta de salida (las notas llegan por stdout).
    fn transcription_command(&self, bass: &Path, container: Option<&str>) -> Command {
        let mut command = match self {
            Self::Docker { .. } => {
                let mounts = [bind_spec(bass, TRANSCRIBE_INPUT, true)];
                let mut command = self.script_command(Script::Transcribe, &mounts, container);
                command.args(["--input", TRANSCRIBE_INPUT]);
                command
            }
            Self::Python { .. } => {
                let mut command = self.script_command(Script::Transcribe, &[], None);
                command.arg("--input").arg(bass);
                command
            }
        };
        piped(&mut command);
        command
    }

    /// Traduce un fallo de Docker (daemon parado, imagen ausente, sin GPU) a un error accionable.
    fn environment_problem(&self, stderr_tail: &[String]) -> Option<String> {
        let text = stderr_tail.join("\n");
        let mentions = |needles: &[&str]| needles.iter().any(|needle| text.contains(needle));

        if mentions(&["unrecognized arguments: --instruments", "unrecognized arguments: --quality"]) {
            return Some(format!(
                "El motor instalado es de una versión anterior y solo separa voces, batería, bajo y otros. {REBUILD_HINT}"
            ));
        }
        if text.contains("can't open file") && text.contains(TRANSCRIBE_SCRIPT) {
            return Some(format!(
                "El motor instalado es de una versión anterior y no transcribe el bajo para el modo práctica. {REBUILD_HINT}"
            ));
        }
        let Self::Docker { image, .. } = self else {
            return None;
        };
        if mentions(&[
            "failed to connect to the docker API",
            "Cannot connect to the Docker daemon",
            "docker daemon is not running",
            "dockerDesktopLinuxEngine",
        ]) {
            Some("Docker Desktop no está en marcha. Ábrelo, espera a que arranque y vuelve a intentarlo.".to_owned())
        } else if mentions(&["No such image", "Unable to find image"]) {
            Some(format!("No existe la imagen «{image}». Constrúyela una vez con: npm run docker:engine"))
        } else if gpu_unavailable(&text) {
            Some(
                "Docker no puede usar la GPU. Actualiza el driver de NVIDIA y Docker Desktop, \
                 o define AUDIOEXTRACT_DOCKER_GPUS=none para separar con la CPU."
                    .to_owned(),
            )
        } else {
            None
        }
    }
}

fn gpu_unavailable(stderr: &str) -> bool {
    ["could not select device driver", "nvidia-container-cli"]
        .iter()
        .any(|needle| stderr.contains(needle))
}

struct CheckFailure {
    problem: String,
    gpu_unavailable: bool,
}

fn run_check(engine: &Engine) -> Result<EngineStatus, CheckFailure> {
    let mut child = engine.check_command().spawn().map_err(|source| CheckFailure {
        problem: AppError::Spawn {
            program: engine.program().display().to_string(),
            hint: engine.spawn_hint(),
            source,
        }
        .to_string(),
        gpu_unavailable: false,
    })?;

    let stdout = child.stdout.take().expect("stdout configurado como pipe");
    let stderr_tail = drain_stderr(child.stderr.take().expect("stderr configurado como pipe"));
    let stdout_reader = thread::spawn(move || {
        let mut text = String::new();
        let _ = BufReader::new(stdout).read_to_string(&mut text);
        text
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() > CHECK_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => break None,
        }
    };
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr_tail = stderr_tail.join().unwrap_or_default();

    let Some(status) = status else {
        return Err(CheckFailure {
            problem: "El motor no respondió a tiempo. Si Docker Desktop se está iniciando, espera y vuelve a comprobarlo."
                .to_owned(),
            gpu_unavailable: false,
        });
    };

    let parsed = parse_check_output(engine.kind(), &stdout);
    if status.success() {
        if let Some(parsed) = parsed {
            return Ok(parsed);
        }
    }
    let gpu = gpu_unavailable(&stderr_tail.join("\n"));
    let problem = engine
        .environment_problem(&stderr_tail)
        .or_else(|| script_error(&stdout))
        .unwrap_or_else(|| describe_failure(Some(status), &stderr_tail));
    Err(CheckFailure {
        problem,
        gpu_unavailable: gpu,
    })
}

fn script_error(stdout: &str) -> Option<String> {
    stdout.lines().find_map(|line| match serde_json::from_str::<ScriptMessage>(line.trim()) {
        Ok(ScriptMessage::Error { message }) => Some(message),
        _ => None,
    })
}

/// Interpreta la salida de `--check`. Un motor de la versión 1 no emite `capabilities`.
fn parse_check_output(kind: &'static str, stdout: &str) -> Option<EngineStatus> {
    let mut status = EngineStatus {
        ready: true,
        kind,
        device: None,
        device_name: None,
        protocol: 1,
        version: None,
        qualities: BTreeMap::from([("fast".to_owned(), Vec::new())]),
        wind: false,
        transcription: false,
        problem: None,
        notes: Vec::new(),
        checked_at: unix_millis() as u64,
    };

    for line in stdout.lines().map(str::trim).filter(|line| !line.is_empty()) {
        match serde_json::from_str::<ScriptMessage>(line) {
            Ok(ScriptMessage::Device { device, name }) => {
                status.device = Some(device);
                status.device_name = name;
            }
            Ok(ScriptMessage::Capabilities {
                protocol,
                engine,
                qualities,
                wind,
                transcription,
            }) => {
                status.protocol = protocol;
                status.version = engine;
                status.qualities = qualities;
                status.wind = wind;
                status.transcription = transcription;
            }
            Ok(ScriptMessage::Log { message }) => status.notes.push(message),
            Ok(ScriptMessage::Error { .. }) => return None,
            _ => {}
        }
    }

    status.device.as_ref()?;
    if status.protocol < 2 {
        status.notes.push(format!(
            "El motor instalado es de una versión anterior: solo separa voces, batería, bajo y otros. {REBUILD_HINT}"
        ));
    } else if status.qualities.is_empty() {
        status.ready = false;
        status.problem = Some(format!("El motor no tiene ningún modelo de separación. {REBUILD_HINT}"));
    }
    Some(status)
}

pub struct SeparationOutput {
    pub stems: Vec<String>,
    pub models: Vec<String>,
    pub device: Option<String>,
    pub device_name: Option<String>,
}

/// Hueco para un proceso del motor: como mucho uno a la vez por tipo de trabajo.
#[derive(Default)]
struct ProcessSlot {
    running: Mutex<Option<RunningJob>>,
}

struct RunningJob {
    child: Child,
    cancelled: Arc<AtomicBool>,
    /// CLI de Docker y nombre del contenedor, si el motor es Docker.
    container: Option<(PathBuf, String)>,
}

/// Lo que deja un proceso del motor al terminar.
struct Finished<T> {
    /// Lo que extrajo `read_stdout` mientras corría.
    stdout: T,
    status: Option<ExitStatus>,
    stderr_tail: Vec<String>,
    cancelled: bool,
}

impl ProcessSlot {
    /// Lanza `command` y bloquea hasta que termina; `read_stdout` consume su salida
    /// mientras corre. Si ya hay un proceso en este hueco, devuelve `busy`.
    /// Debe llamarse desde un hilo bloqueante (no desde el runtime async).
    fn run<T>(
        &self,
        engine: &Engine,
        mut command: Command,
        container: Option<(PathBuf, String)>,
        busy: AppError,
        read_stdout: impl FnOnce(ChildStdout) -> T,
    ) -> Result<Finished<T>, AppError> {
        // Se lanza con el lock tomado para que dos peticiones simultáneas no arranquen dos hijos.
        let (stdout, stderr, cancelled) = {
            let mut slot = lock(&self.running);
            if slot.is_some() {
                return Err(busy);
            }
            let mut child = command.spawn().map_err(|source| AppError::Spawn {
                program: engine.program().display().to_string(),
                hint: engine.spawn_hint(),
                source,
            })?;
            let stdout = child.stdout.take().expect("stdout configurado como pipe");
            let stderr = child.stderr.take().expect("stderr configurado como pipe");
            let cancelled = Arc::new(AtomicBool::new(false));
            *slot = Some(RunningJob {
                child,
                cancelled: Arc::clone(&cancelled),
                container,
            });
            (stdout, stderr, cancelled)
        };

        let stderr_tail = drain_stderr(stderr);
        let stdout = read_stdout(stdout);

        // stdout cerrado: el proceso está terminando. Lo sacamos del estado y recogemos su código.
        let running = lock(&self.running).take();
        let status = match running {
            Some(mut job) => Some(job.child.wait()?),
            None => None,
        };
        Ok(Finished {
            stdout,
            status,
            stderr_tail: stderr_tail.join().unwrap_or_default(),
            cancelled: cancelled.load(Ordering::SeqCst),
        })
    }

    /// Detiene el proceso en curso. Devuelve si había algo que cancelar.
    /// Puede tardar ~1 s con Docker: no llamarla desde el hilo principal.
    fn cancel(&self) -> bool {
        let mut slot = lock(&self.running);
        let Some(job) = slot.as_mut() else {
            return false;
        };
        job.cancelled.store(true, Ordering::SeqCst);
        // Primero el contenedor: matar solo el cliente `docker run` lo dejaría corriendo.
        if let Some((cli, name)) = &job.container {
            kill_container(cli, name);
        }
        let _ = job.child.kill();
        true
    }
}

/// CLI de Docker y un nombre único para el contenedor (para poder hacerle `docker kill`).
fn container_name(engine: &Engine, prefix: &str) -> Option<(PathBuf, String)> {
    match engine {
        Engine::Docker { cli, .. } => Some((cli.clone(), format!("{prefix}-{}-{}", std::process::id(), unix_millis()))),
        Engine::Python { .. } => None,
    }
}

/// Separación en curso. Solo se permite una a la vez.
#[derive(Default)]
pub struct SeparationState(ProcessSlot);

impl SeparationState {
    /// Detiene la separación en curso. Devuelve si había alguna.
    /// Puede tardar ~1 s con Docker: no llamarla desde el hilo principal.
    pub fn cancel(&self) -> bool {
        self.0.cancel()
    }
}

/// Transcripción del bajo en curso (modo práctica). Va aparte de la separación:
/// puede correr a la vez que ella, pero solo hay una transcripción a la vez.
#[derive(Default)]
pub struct TranscriptionState(ProcessSlot);

impl TranscriptionState {
    /// Detiene la transcripción en curso (al cerrar la app). Devuelve si había alguna.
    pub fn cancel(&self) -> bool {
        self.0.cancel()
    }
}

/// Lanza `separate.py` y bloquea hasta que termina, reenviando el progreso a `emit`.
/// Debe llamarse desde un hilo bloqueante (no desde el runtime async).
pub fn run(
    state: &SeparationState,
    engine_state: &EngineState,
    job: &SeparationJob,
    mut emit: impl FnMut(SeparationEvent),
) -> Result<SeparationOutput, AppError> {
    let known_protocol = engine_state.cached().filter(|status| status.ready).map(|status| status.protocol);
    if known_protocol == Some(1) && job.needs_extended_engine() {
        return Err(AppError::Environment(format!(
            "El motor instalado es de una versión anterior: solo separa voces, batería, bajo y otros en calidad rápida. {REBUILD_HINT}"
        )));
    }
    let extended = known_protocol.map_or(job.needs_extended_engine(), |protocol| protocol >= 2);

    let engine = Engine::from_env(engine_state.cpu_only.load(Ordering::SeqCst))?;
    let container = container_name(&engine, "audioextract");
    let command = engine.separation_command(job, container.as_ref().map(|(_, name)| name.as_str()), extended);
    let Finished {
        stdout: outcome,
        status,
        stderr_tail,
        cancelled,
    } = state.0.run(&engine, command, container, AppError::Busy, |stdout| pump_stdout(stdout, &mut emit))?;

    if cancelled {
        return Err(AppError::Cancelled);
    }
    if let Some(message) = outcome.error {
        return Err(AppError::Engine(message));
    }
    if !status.is_some_and(|s| s.success()) || !outcome.done {
        return Err(match engine.environment_problem(&stderr_tail) {
            Some(message) => AppError::Environment(message),
            None => AppError::Engine(describe_failure(status, &stderr_tail)),
        });
    }

    let stems = outcome
        .stems
        .unwrap_or_else(|| BASE_STEMS.iter().map(|stem| (*stem).to_owned()).collect());
    for stem in &stems {
        if !job.output_dir.join(format!("{stem}.wav")).is_file() {
            return Err(AppError::MissingStem(stem.clone()));
        }
    }
    Ok(SeparationOutput {
        stems,
        models: outcome.models.unwrap_or_else(|| vec!["htdemucs".to_owned()]),
        device: outcome.device,
        device_name: outcome.device_name,
    })
}

#[derive(Default)]
struct StdoutOutcome {
    done: bool,
    error: Option<String>,
    device: Option<String>,
    device_name: Option<String>,
    stems: Option<Vec<String>>,
    models: Option<Vec<String>>,
}

fn pump_stdout(stdout: impl Read, emit: &mut impl FnMut(SeparationEvent)) -> StdoutOutcome {
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::with_capacity(512);
    let mut outcome = StdoutOutcome::default();

    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        // Lectura con pérdida: una ruta mal codificada no debe tumbar el bucle.
        let text = String::from_utf8_lossy(&buf);
        let line = text.trim();
        if line.is_empty() {
            continue;
        }

        match serde_json::from_str::<ScriptMessage>(line) {
            Ok(ScriptMessage::Progress { percent, stage }) => emit(SeparationEvent::Progress {
                percent: percent.clamp(0.0, 100.0),
                stage,
            }),
            Ok(ScriptMessage::Device { device, name }) => {
                outcome.device = Some(device.clone());
                outcome.device_name.clone_from(&name);
                emit(SeparationEvent::Device { device, name });
            }
            Ok(ScriptMessage::Log { message }) => emit(SeparationEvent::Log { message }),
            Ok(ScriptMessage::Done { stems, models }) => {
                outcome.done = true;
                outcome.stems = stems;
                outcome.models = models;
            }
            Ok(ScriptMessage::Error { message }) => outcome.error = Some(message),
            Ok(ScriptMessage::Capabilities { .. }) => {}
            // Cualquier otra salida en stdout se reenvía como log sin interpretar.
            Err(_) => emit(SeparationEvent::Log {
                message: line.to_owned(),
            }),
        }
    }

    outcome
}

/// Transcribe `bass` (el `bass.wav` de una extracción) a notas con `transcribe.py`.
/// Tarda unos segundos (más el arranque del contenedor): llamar desde un hilo bloqueante.
pub fn transcribe(state: &TranscriptionState, bass: &Path) -> Result<Vec<NoteEvent>, AppError> {
    // Basic Pitch es un modelo pequeño que en CPU tarda unos segundos por canción: sin
    // `--gpus`, la transcripción no depende de la GPU ni compite con una separación.
    let engine = Engine::from_env(true)?;
    if let Engine::Python { script, .. } = &engine {
        let transcriber = script.with_file_name(TRANSCRIBE_SCRIPT);
        if !transcriber.is_file() {
            return Err(AppError::ScriptNotFound(transcriber.display().to_string()));
        }
    }

    let container = container_name(&engine, "audioextract-tab");
    let command = engine.transcription_command(bass, container.as_ref().map(|(_, name)| name.as_str()));
    let Finished {
        stdout: outcome,
        status,
        stderr_tail,
        cancelled,
    } = state.0.run(&engine, command, container, AppError::TranscriptionBusy, read_transcription)?;

    if cancelled {
        return Err(AppError::Cancelled);
    }
    if let Some(message) = outcome.error {
        return Err(AppError::Engine(message));
    }
    match outcome.notes {
        Some(notes) if status.is_some_and(|s| s.success()) => Ok(playable_notes(notes)),
        _ => Err(match engine.environment_problem(&stderr_tail) {
            Some(message) => AppError::Environment(message),
            None => AppError::Engine(describe_failure(status, &stderr_tail)),
        }),
    }
}

#[derive(Debug, Default)]
struct TranscriptionOutcome {
    notes: Option<Vec<NoteEvent>>,
    error: Option<String>,
}

/// Lee la salida completa de `transcribe.py`. Las notas llegan en una sola línea
/// (unas decenas de KB por canción); lo que no es del protocolo se ignora.
fn read_transcription(stdout: impl Read) -> TranscriptionOutcome {
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::with_capacity(64 * 1024);
    let mut outcome = TranscriptionOutcome::default();

    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let text = String::from_utf8_lossy(&buf);
        match serde_json::from_str::<TranscriptionMessage>(text.trim()) {
            Ok(TranscriptionMessage::Done { notes }) => outcome.notes = Some(notes),
            Ok(TranscriptionMessage::Error { message }) => outcome.error = Some(message),
            Ok(TranscriptionMessage::Other) | Err(_) => {}
        }
    }

    outcome
}

/// Notas en orden de inicio, sin duraciones nulas ni frecuencias imposibles.
fn playable_notes(mut notes: Vec<NoteEvent>) -> Vec<NoteEvent> {
    notes.retain(|note| note.end_time_ms > note.start_time_ms && note.frequency.is_finite() && note.frequency > 0.0);
    notes.sort_by_key(|note| note.start_time_ms);
    notes
}

fn drain_stderr(stderr: impl Read + Send + 'static) -> JoinHandle<Vec<String>> {
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buf = Vec::with_capacity(512);
        let mut tail = VecDeque::with_capacity(STDERR_TAIL_LINES);

        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            // Las barras de progreso redibujan con '\r': solo interesa el último tramo.
            let text = String::from_utf8_lossy(&buf);
            let Some(last) = text.split('\r').map(str::trim).rfind(|s| !s.is_empty()) else {
                continue;
            };
            if tail.len() == STDERR_TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(last.to_owned());
        }

        Vec::from(tail)
    })
}

fn describe_failure(status: Option<ExitStatus>, stderr_tail: &[String]) -> String {
    let code = match status.and_then(|s| s.code()) {
        Some(code) => format!("código {code}"),
        None => "terminado sin código de salida".to_owned(),
    };
    let start = stderr_tail.len().saturating_sub(8);
    let detail = stderr_tail[start..].join("\n");
    if detail.is_empty() {
        format!("El motor terminó con error ({code})")
    } else {
        format!("El motor terminó con error ({code}):\n{detail}")
    }
}

/// `origen:destino[:ro]` para `docker run -v`, sin pasar por UTF-8 (rutas de Windows arbitrarias).
fn bind_spec(host: &Path, target: &str, read_only: bool) -> OsString {
    let mut spec = OsString::from(docker_host_path(host));
    spec.push(":");
    spec.push(target);
    if read_only {
        spec.push(":ro");
    }
    spec
}

/// Ruta que entiende `docker -v`. En Windows, Tauri da la carpeta de recursos en forma «verbatim»
/// (`\\?\C:\…`) y Docker la rechaza («too many colons»): se pasa a la forma normal (`C:\…`,
/// `\\servidor\recurso\…`). Cualquier otra ruta queda igual.
fn docker_host_path(path: &Path) -> PathBuf {
    use std::path::Prefix;

    let mut components = path.components();
    let Some(Component::Prefix(prefix)) = components.next() else {
        return path.to_path_buf();
    };
    let mut simple = match prefix.kind() {
        Prefix::VerbatimDisk(drive) => PathBuf::from(format!("{}:\\", char::from(drive))),
        Prefix::VerbatimUNC(server, share) => {
            let mut root = OsString::from(r"\\");
            root.push(server);
            root.push(r"\");
            root.push(share);
            root.push(r"\");
            PathBuf::from(root)
        }
        _ => return path.to_path_buf(),
    };
    simple.extend(components.filter(|component| !matches!(component, Component::RootDir)));
    simple
}

fn piped(command: &mut Command) {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(command);
}

fn kill_container(cli: &Path, name: &str) {
    let mut command = Command::new(cli);
    command
        .args(["kill", name])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let _ = command.status();
}

/// Sin esto, en Windows cada proceso hijo abre una ventana de consola.
fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// Carpeta `python/` del repositorio (motor `python` en desarrollo).
fn project_python_dir() -> PathBuf {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .unwrap_or(manifest_dir)
        .join("python")
}

fn venv_python(venv: &Path) -> PathBuf {
    if cfg!(windows) {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python")
    }
}

/// Orden: `AUDIOEXTRACT_PYTHON` → entorno de la app (lo crea scripts/setup-python) →
/// `python/.venv` del repo → `python`/`python3` del PATH.
fn resolve_python() -> PathBuf {
    if let Some(explicit) = env::var_os("AUDIOEXTRACT_PYTHON") {
        return PathBuf::from(explicit);
    }

    let app_venv = APP_DIRS
        .get()
        .and_then(|dirs| dirs.data.as_ref())
        .map(|data| venv_python(&data.join("python").join(".venv")));
    let candidates = app_venv
        .into_iter()
        .chain([venv_python(&project_python_dir().join(".venv"))]);
    for candidate in candidates {
        if candidate.is_file() {
            return candidate;
        }
    }

    PathBuf::from(if cfg!(windows) { "python" } else { "python3" })
}

/// Orden: `AUDIOEXTRACT_SCRIPT` → recursos de la app instalada → `python/` del repo.
fn resolve_script() -> Result<PathBuf, AppError> {
    if let Some(explicit) = env::var_os("AUDIOEXTRACT_SCRIPT") {
        let script = PathBuf::from(explicit);
        return if script.is_file() {
            Ok(script)
        } else {
            Err(AppError::ScriptNotFound(script.display().to_string()))
        };
    }

    let bundled = APP_DIRS
        .get()
        .and_then(|dirs| dirs.resources.as_ref())
        .map(|resources| resources.join("python").join("separate.py"));
    let project = project_python_dir().join("separate.py");
    bundled
        .into_iter()
        .chain([project.clone()])
        .find(|script| script.is_file())
        .ok_or_else(|| AppError::ScriptNotFound(project.display().to_string()))
}

fn env_nonempty(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn env_or(key: &str, default: &str) -> String {
    env_nonempty(key).unwrap_or_else(|| default.to_owned())
}

pub fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // Un pánico con el lock tomado no invalida el contenido: seguimos usándolo.
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(input: &str) -> (StdoutOutcome, Vec<SeparationEvent>) {
        let mut events = Vec::new();
        let outcome = pump_stdout(input.as_bytes(), &mut |event| events.push(event));
        (outcome, events)
    }

    /// Motor Docker con solo los scripts de la imagen (sin la carpeta de la app).
    fn docker(gpus: Option<&str>) -> Engine {
        Engine::Docker {
            cli: "docker".into(),
            image: DEFAULT_IMAGE.to_owned(),
            gpus: gpus.map(str::to_owned),
            scripts: None,
        }
    }

    /// Motor Docker como en la app instalada: con su carpeta `python/`.
    fn docker_with_app_scripts() -> Engine {
        Engine::Docker {
            cli: "docker".into(),
            image: DEFAULT_IMAGE.to_owned(),
            gpus: Some("all".into()),
            scripts: Some(PathBuf::from("/opt/AudioExtract/python")),
        }
    }

    fn job(instruments: &[&str], quality: Quality) -> SeparationJob {
        SeparationJob {
            input: PathBuf::from("/music/Mi canción.mp3"),
            extension: "mp3".into(),
            output_dir: PathBuf::from("/tmp/AudioExtract/out"),
            instruments: instruments.iter().map(|s| (*s).to_owned()).collect(),
            quality,
        }
    }

    fn args_of(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn parses_protocol_lines() {
        let (outcome, events) = collect(concat!(
            "{\"type\":\"device\",\"device\":\"cuda\",\"name\":\"RTX 3060\"}\n",
            "{\"type\":\"progress\",\"percent\":42.5,\"stage\":\"separating\"}\r\n",
            "texto suelto de una librería\n",
            "{\"type\":\"progress\",\"percent\":180,\"stage\":\"saving\"}\n",
            "{\"type\":\"done\",\"stems\":[\"vocals\",\"drums\",\"bass\",\"piano\",\"wind\",\"other\"],\"sampleRate\":44100,\"frames\":10,\"models\":[\"bs_roformer_sw\",\"uvr_wind\"]}\n",
        ));

        assert!(outcome.done);
        assert!(outcome.error.is_none());
        assert_eq!(outcome.device.as_deref(), Some("cuda"));
        assert_eq!(outcome.device_name.as_deref(), Some("RTX 3060"));
        assert_eq!(outcome.stems.as_ref().map(Vec::len), Some(6));
        assert_eq!(outcome.models.as_deref(), Some(&["bs_roformer_sw".to_owned(), "uvr_wind".to_owned()][..]));
        assert_eq!(events.len(), 4);
        assert!(matches!(
            &events[1],
            SeparationEvent::Progress { percent, stage } if *percent == 42.5 && stage == "separating"
        ));
        assert!(matches!(&events[2], SeparationEvent::Log { message } if message == "texto suelto de una librería"));
        assert!(matches!(&events[3], SeparationEvent::Progress { percent, .. } if *percent == 100.0));
    }

    #[test]
    fn accepts_version_one_done_message() {
        let (outcome, _) = collect("{\"type\":\"done\"}\n");
        assert!(outcome.done);
        assert!(outcome.stems.is_none());
    }

    #[test]
    fn captures_script_error() {
        let (outcome, _) = collect("{\"type\":\"error\",\"message\":\"CUDA out of memory\"}\n");
        assert!(!outcome.done);
        assert_eq!(outcome.error.as_deref(), Some("CUDA out of memory"));
    }

    #[test]
    fn builds_offline_docker_command() {
        let args = args_of(&docker(Some("all")).separation_command(
            &job(&["piano", "wind"], Quality::Best),
            Some("audioextract-1"),
            true,
        ));
        let joined = args.join(" ");
        assert!(joined.starts_with("run --rm --init --pull never --network none --name audioextract-1 --gpus all"));
        assert!(args.contains(&"/music/Mi canción.mp3:/input/source.mp3:ro".to_owned()));
        assert!(args.contains(&"/tmp/AudioExtract/out:/output".to_owned()));
        assert!(joined.contains(&format!(
            "{DEFAULT_IMAGE} --input /input/source.mp3 --output /output --instruments piano,wind --quality best"
        )));
        assert!(joined.ends_with("--device auto"));

        let cpu_only = args_of(&docker(None).separation_command(&job(&[], Quality::Fast), None, true));
        assert!(!cpu_only.contains(&"--gpus".to_owned()));
        assert!(!cpu_only.contains(&"--instruments".to_owned()));
        assert!(cpu_only.join(" ").contains("--quality fast"));
    }

    #[test]
    fn omits_new_arguments_for_version_one_engines() {
        let args = args_of(&docker(Some("all")).separation_command(&job(&[], Quality::Fast), None, false));
        assert!(!args.contains(&"--quality".to_owned()));
        assert!(!args.contains(&"--instruments".to_owned()));
    }

    #[test]
    fn keeps_only_known_instruments_in_order() {
        let dir = std::env::temp_dir();
        let input = dir.join("audioextract-test-input.flac");
        std::fs::write(&input, b"x").unwrap();
        let request = SeparationRequest {
            instruments: vec!["wind".into(), "kazoo".into(), "guitar".into(), "wind".into()],
            quality: Quality::Best,
        };
        let job = SeparationJob::new(input.to_str().unwrap(), dir.join("out"), &request).unwrap();
        assert_eq!(job.instruments, vec!["guitar".to_owned(), "wind".to_owned()]);
        assert_eq!(job.extension, "flac");
        assert!(job.needs_extended_engine());
        let _ = std::fs::remove_file(input);
    }

    #[test]
    fn rejects_unsupported_extensions() {
        assert_eq!(supported_extension(Path::new("a/Canción.M4A")).as_deref(), Some("m4a"));
        assert!(supported_extension(Path::new("a/notas.txt")).is_none());
        assert!(supported_extension(Path::new("a/sin-extension")).is_none());
    }

    #[test]
    fn explains_docker_environment_problems() {
        let engine = docker(Some("all"));
        let tail = |line: &str| vec!["docker: Error response from daemon:".to_owned(), line.to_owned()];

        let not_running = engine.environment_problem(&tail(
            "failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine",
        ));
        assert!(not_running.unwrap().contains("no está en marcha"));

        let no_image = engine.environment_problem(&tail("No such image: audioextract-engine:latest"));
        assert!(no_image.unwrap().contains("npm run docker:engine"));

        let no_gpu = engine.environment_problem(&tail(
            "could not select device driver \"\" with capabilities: [[gpu]]",
        ));
        assert!(no_gpu.unwrap().contains("AUDIOEXTRACT_DOCKER_GPUS=none"));

        let old_engine = engine.environment_problem(&tail(
            "separate.py: error: unrecognized arguments: --instruments piano --quality best",
        ));
        assert!(old_engine.unwrap().contains("versión anterior"));

        assert!(engine.environment_problem(&tail("RuntimeError: algo de Torch")).is_none());
    }

    #[test]
    fn parses_check_output_of_both_protocols() {
        let v2 = parse_check_output(
            "docker",
            concat!(
                "{\"type\":\"device\",\"device\":\"cuda\",\"name\":\"RTX 3060\"}\n",
                "{\"type\":\"capabilities\",\"protocol\":2,\"engine\":\"2.0.0\",\"qualities\":{\"fast\":[\"guitar\",\"piano\"],\"best\":[\"guitar\",\"piano\"]},\"wind\":true}\n",
                "{\"type\":\"log\",\"message\":\"Python 3.12\"}\n",
            ),
        )
        .unwrap();
        assert!(v2.ready);
        assert_eq!(v2.protocol, 2);
        assert_eq!(v2.qualities.len(), 2);
        assert!(v2.wind);
        assert_eq!(v2.device_name.as_deref(), Some("RTX 3060"));

        let v1 = parse_check_output("docker", "{\"type\":\"device\",\"device\":\"cpu\",\"name\":\"x86_64\"}\n").unwrap();
        assert_eq!(v1.protocol, 1);
        assert_eq!(v1.qualities.keys().collect::<Vec<_>>(), vec!["fast"]);
        assert!(v1.notes.iter().any(|note| note.contains("npm run docker:engine")));

        assert!(parse_check_output("docker", "{\"type\":\"error\",\"message\":\"x\"}\n").is_none());
    }

    #[test]
    fn reads_transcription_capability() {
        let with = parse_check_output(
            "docker",
            concat!(
                "{\"type\":\"device\",\"device\":\"cuda\",\"name\":\"RTX 3060\"}\n",
                "{\"type\":\"capabilities\",\"protocol\":2,\"engine\":\"2.1.0\",\"qualities\":{\"fast\":[]},\"wind\":true,\"transcription\":true}\n",
            ),
        )
        .unwrap();
        assert!(with.transcription);

        // Un motor 2.0 no declara la transcripción.
        let without = parse_check_output(
            "docker",
            concat!(
                "{\"type\":\"device\",\"device\":\"cpu\",\"name\":\"x86_64\"}\n",
                "{\"type\":\"capabilities\",\"protocol\":2,\"engine\":\"2.0.0\",\"qualities\":{\"fast\":[]},\"wind\":false}\n",
            ),
        )
        .unwrap();
        assert!(!without.transcription);
    }

    #[test]
    fn builds_transcription_command_with_only_the_bass_track() {
        let bass = Path::new("/music/AudioExtract/Mi canción/bass.wav");
        let args = args_of(&docker(None).transcription_command(bass, Some("audioextract-tab-1")));
        let joined = args.join(" ");
        assert!(joined.starts_with("run --rm --init --pull never --network none --name audioextract-tab-1"));
        assert!(args.contains(&"/music/AudioExtract/Mi canción/bass.wav:/input/bass.wav:ro".to_owned()));
        assert_eq!(args.iter().filter(|arg| *arg == "-v").count(), 1, "solo se monta bass.wav");
        assert!(joined.ends_with(&format!(
            "--entrypoint python {DEFAULT_IMAGE} -u /app/transcribe.py --input /input/bass.wav"
        )));
        assert!(!args.contains(&"--gpus".to_owned()));
        assert!(!args.contains(&"--output".to_owned()));

        let separate = PathBuf::from("/opt/AudioExtract/python/separate.py");
        let python = Engine::Python {
            interpreter: "python".into(),
            script: separate.clone(),
        };
        let args = args_of(&python.transcription_command(bass, None));
        assert_eq!(args[0], "-u");
        assert_eq!(Path::new(&args[1]), separate.with_file_name(TRANSCRIBE_SCRIPT));
        assert_eq!(&args[2..], ["--input", "/music/AudioExtract/Mi canción/bass.wav"]);
    }

    #[test]
    fn runs_the_app_scripts_inside_the_image() {
        let app_mount = "/opt/AudioExtract/python:/opt/audioextract/python:ro".to_owned();
        let wheels = "AUDIOEXTRACT_WHEELS=/opt/audioextract/python/wheels".to_owned();
        let engine = docker_with_app_scripts();

        let separation = args_of(&engine.separation_command(&job(&["piano"], Quality::Best), None, true));
        assert!(separation.contains(&app_mount));
        assert!(separation.contains(&wheels));
        assert!(separation.join(" ").contains(&format!(
            "--entrypoint python {DEFAULT_IMAGE} -u /opt/audioextract/python/separate.py --input /input/source.mp3"
        )));
        assert!(separation.contains(&"--gpus".to_owned()));

        let check = args_of(&engine.check_command()).join(" ");
        assert!(check.contains(&format!("{DEFAULT_IMAGE} -u /opt/audioextract/python/separate.py --check")));

        let bass = Path::new("/music/AudioExtract/Mi canción/bass.wav");
        let transcription = args_of(&engine.transcription_command(bass, None));
        assert!(transcription.contains(&app_mount));
        assert!(transcription.contains(&wheels));
        assert!(transcription.join(" ").ends_with(&format!(
            "--entrypoint python {DEFAULT_IMAGE} -u /opt/audioextract/python/transcribe.py --input /input/bass.wav"
        )));
        // Solo la pista de bajo y los scripts de la app, ambos en solo lectura.
        assert_eq!(transcription.iter().filter(|arg| *arg == "-v").count(), 2);
    }

    #[cfg(windows)]
    #[test]
    fn gives_docker_plain_windows_paths() {
        // Así devuelve Tauri la carpeta de recursos de la app instalada.
        let installed = Path::new(r"\\?\C:\Users\ana\AppData\Local\AudioExtract\python");
        assert_eq!(
            docker_host_path(installed),
            PathBuf::from(r"C:\Users\ana\AppData\Local\AudioExtract\python")
        );
        assert_eq!(
            bind_spec(installed, SCRIPTS_MOUNT, true),
            OsString::from(r"C:\Users\ana\AppData\Local\AudioExtract\python:/opt/audioextract/python:ro")
        );
        assert_eq!(
            docker_host_path(Path::new(r"\\?\UNC\nas\musica\AudioExtract")),
            PathBuf::from(r"\\nas\musica\AudioExtract")
        );
        let plain = Path::new(r"D:\Música\Canción.mp3");
        assert_eq!(docker_host_path(plain), plain);
    }

    /// De punta a punta con Docker, la imagen del motor y una app instalada; no corre en la CI:
    ///
    /// ```text
    /// set AUDIOEXTRACT_E2E_RESOURCES=\\?\C:\Users\<usuario>\AppData\Local\AudioExtract
    /// set AUDIOEXTRACT_E2E_BASS=C:\Users\<usuario>\Music\AudioExtract\<canción>\bass.wav
    /// audioextract-tests.exe --ignored e2e
    /// ```
    #[test]
    #[ignore = "necesita Docker, la imagen del motor y la app instalada"]
    fn e2e_check_and_transcription_with_installed_scripts() {
        let resources = env::var_os("AUDIOEXTRACT_E2E_RESOURCES").expect("define AUDIOEXTRACT_E2E_RESOURCES");
        let bass = env::var_os("AUDIOEXTRACT_E2E_BASS").expect("define AUDIOEXTRACT_E2E_BASS");
        init_app_dirs(Some(PathBuf::from(resources)), None);

        let status = EngineState::default().refresh(true);
        assert!(status.ready, "el motor no está listo: {:?}", status.problem);
        assert!(status.transcription, "el motor no declara la transcripción");

        let notes = transcribe(&TranscriptionState::default(), Path::new(&bass)).expect("transcripción");
        assert!(notes.len() > 10, "solo {} notas", notes.len());
    }

    #[test]
    fn local_python_gets_the_bundled_wheels() {
        let separate = PathBuf::from("/opt/AudioExtract/python/separate.py");
        let python = Engine::Python {
            interpreter: "python".into(),
            script: separate.clone(),
        };
        let command = python.transcription_command(Path::new("/music/bass.wav"), None);
        let wheels = command
            .get_envs()
            .find(|(key, _)| *key == "AUDIOEXTRACT_WHEELS")
            .and_then(|(_, value)| value);
        assert_eq!(wheels.map(Path::new), Some(separate.with_file_name(WHEELS_DIR).as_path()));
    }

    #[test]
    fn reads_transcription_output() {
        let outcome = read_transcription(
            concat!(
                "Predicting MIDI for /input/bass.wav...\n",
                "{\"type\":\"log\",\"message\":\"ignorado\"}\n",
                "{\"type\":\"done\",\"model\":\"basic_pitch\",\"notes\":[",
                "{\"note\":\"C#2\",\"frequency\":69.3,\"startTimeMs\":1200,\"endTimeMs\":1500},",
                "{\"note\":\"B0\",\"frequency\":30.87,\"startTimeMs\":0,\"endTimeMs\":400}]}\n",
            )
            .as_bytes(),
        );
        assert!(outcome.error.is_none());
        let notes = outcome.notes.unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(
            notes[0],
            NoteEvent {
                note: "C#2".into(),
                frequency: 69.3,
                start_time_ms: 1200,
                end_time_ms: 1500,
            }
        );

        let failed = read_transcription("{\"type\":\"error\",\"message\":\"Falta basic_pitch\"}\n".as_bytes());
        assert!(failed.notes.is_none());
        assert_eq!(failed.error.as_deref(), Some("Falta basic_pitch"));
    }

    #[test]
    fn keeps_only_playable_notes_in_order() {
        let note = |start: u64, end: u64, frequency: f64| NoteEvent {
            note: "A1".into(),
            frequency,
            start_time_ms: start,
            end_time_ms: end,
        };
        let notes = playable_notes(vec![
            note(900, 1000, 55.0),
            note(100, 100, 55.0),
            note(200, 300, f64::NAN),
            note(0, 50, 55.0),
            note(400, 500, 0.0),
        ]);
        assert_eq!(notes.iter().map(|n| n.start_time_ms).collect::<Vec<_>>(), vec![0, 900]);
    }

    #[test]
    fn explains_engine_without_transcriber() {
        let problem = docker(None).environment_problem(&[
            "python: can't open file '/app/transcribe.py': [Errno 2] No such file or directory".to_owned(),
        ]);
        let problem = problem.unwrap();
        assert!(problem.contains("modo práctica"));
        assert!(problem.contains("npm run docker:engine"));
    }

    #[test]
    fn serializes_notes_for_frontend() {
        let json = serde_json::to_value(NoteEvent {
            note: "E1".into(),
            frequency: 41.2,
            start_time_ms: 10,
            end_time_ms: 20,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "note": "E1", "frequency": 41.2, "startTimeMs": 10, "endTimeMs": 20 })
        );
    }

    #[test]
    fn serializes_events_for_frontend() {
        let json = serde_json::to_value(SeparationEvent::Progress {
            percent: 10.0,
            stage: "loading_model".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "event": "progress", "data": { "percent": 10.0, "stage": "loading_model" } })
        );
    }
}
