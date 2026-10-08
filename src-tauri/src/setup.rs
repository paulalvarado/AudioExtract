//! Motor integrado: la app instala y mantiene por sí misma el entorno de Python del motor.
//!
//! Sin Docker ni Python previos. Con `uv` (viaja con el instalador, ver scripts/vendor-uv.mjs) se
//! descarga un CPython 3.12 propio, se crea un entorno virtual y se instala exactamente lo que dice
//! `python/locks/<variante>.txt` (versiones y SHA-256 fijos). La variante depende del equipo: PyTorch
//! con CUDA si hay una GPU NVIDIA que lo admita, con Metal en Apple Silicon y solo CPU en el resto.
//! Después se enlaza ffmpeg (de la rueda imageio-ffmpeg) y se descargan los pesos de los modelos con
//! `catalog.py --prefetch`. Al separar, el motor ya no usa la red.
//!
//! Todo vive en `<datos locales de la app>/engine`:
//!
//! ```text
//! engine/
//!   python/      CPython de uv
//!   venv/        PyTorch, Demucs, audio-separator, Basic Pitch…
//!   bin/         ffmpeg
//!   models/      torch/ (Demucs, TORCH_HOME) y separator/ (audio-separator)
//!   cache/       caché de uv mientras se instala (se borra al terminar)
//!   lock.txt     copia del bloqueo instalado
//!   engine.json  variante, modelos y fecha (sin este archivo, el motor no está instalado)
//! ```
//!
//! Una versión de la app con otro bloqueo u otros modelos deja el motor «sin poner al día»: la
//! interfaz lo actualiza sola, y uv solo descarga lo que cambió.

use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::engine::{self, lock};
use crate::error::AppError;

const MB: u64 = 1_000_000;
const GIB: u64 = 1 << 30;

/// Modelos que se descargan al instalar: los mismos que lleva la imagen Docker (ver python/catalog.py).
pub const MODELS: [&str; 4] = ["htdemucs", "htdemucs_6s", "bs_roformer_sw", "uvr_wind"];
/// Sus pesos: BS-RoFormer SW 699 MB, UVR Wind 224 MB y Demucs 84 + 55 MB.
const MODELS_BYTES: u64 = 1_063 * MB;
const PYTHON_VERSION: &str = "3.12";
/// CPython de uv (python-build-standalone): descarga y espacio en disco.
const PYTHON_DOWNLOAD: u64 = 22 * MB;
const PYTHON_DISK: u64 = 72 * MB;
/// Driver mínimo de NVIDIA para CUDA 12 en Windows (compatibilidad de versión menor).
const MIN_DRIVER: (u32, u32) = (527, 41);
const MIN_VRAM: u64 = 2 * GIB;
/// Por debajo, la calidad máxima puede quedarse sin memoria (un equipo de 8 GB declara algo menos).
const LOW_MEMORY: u64 = 7 * GIB;
/// Espacio libre que se deja además del que ocupa la instalación en su punto más alto.
const DISK_MARGIN: u64 = GIB;
const METER_INTERVAL: Duration = Duration::from_millis(800);

/// Qué PyTorch se instala: un bloqueo de `python/locks` por variante.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Variant {
    /// GPU NVIDIA con capacidad de cómputo 7.0 o más (Turing y posteriores): CUDA 12.8.
    WindowsCuda,
    /// GPU NVIDIA más antigua (Maxwell, Pascal), que las ruedas de CUDA 12.8 ya no incluyen: CUDA 12.6.
    WindowsCudaLegacy,
    WindowsCpu,
    /// Apple Silicon: Metal (MPS) viene en las ruedas de PyPI.
    MacosArm64,
}

/// Tamaños de los paquetes de una variante, medidos con su bloqueo.
struct Footprint {
    download: u64,
    /// Lo que llega a ocupar mientras se instala (paquetes descomprimidos en la caché de uv; el
    /// entorno los enlaza, no los copia).
    peak: u64,
    /// Lo que queda al limpiar la caché y las bibliotecas estáticas de torch.
    installed: u64,
}

impl Variant {
    pub fn lock_name(self) -> &'static str {
        match self {
            Self::WindowsCuda => "windows-cuda",
            Self::WindowsCudaLegacy => "windows-cuda-legacy",
            Self::WindowsCpu => "windows-cpu",
            Self::MacosArm64 => "macos-arm64",
        }
    }

    pub fn accelerator(self) -> &'static str {
        match self {
            Self::WindowsCuda | Self::WindowsCudaLegacy => "cuda",
            Self::WindowsCpu => "cpu",
            Self::MacosArm64 => "mps",
        }
    }

    fn footprint(self) -> Footprint {
        // En Windows, torch trae ~2,8 GB de bibliotecas estáticas (`*.lib`) que se borran al terminar.
        let (download, peak, installed) = match self {
            Self::WindowsCuda => (3_671, 7_999, 5_184),
            Self::WindowsCudaLegacy => (3_123, 7_194, 4_379),
            Self::WindowsCpu => (821, 3_731, 959),
            Self::MacosArm64 => (327, 1_153, 1_153),
        };
        Footprint {
            download: download * MB,
            peak: peak * MB,
            installed: installed * MB,
        }
    }
}

// --- Equipo ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    /// `windows`, `macos`, `linux`…
    pub os: &'static str,
    pub arch: &'static str,
    pub cpu_threads: usize,
    pub memory_bytes: Option<u64>,
    /// GPU NVIDIA que ve `nvidia-smi` (de otros fabricantes no se usan).
    pub gpus: Vec<Gpu>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    pub memory_bytes: Option<u64>,
    pub driver: Option<String>,
    /// «8.6»; los drivers antiguos no la informan.
    pub compute_capability: Option<String>,
}

pub fn detect_hardware() -> Hardware {
    Hardware {
        os: env::consts::OS,
        arch: env::consts::ARCH,
        cpu_threads: thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        memory_bytes: total_memory(),
        gpus: if cfg!(target_os = "macos") { Vec::new() } else { nvidia_gpus() },
    }
}

fn nvidia_gpus() -> Vec<Gpu> {
    let mut programs = vec![PathBuf::from("nvidia-smi")];
    if let Some(program_files) = env::var_os("ProgramFiles") {
        programs.push(Path::new(&program_files).join(r"NVIDIA Corporation\NVSMI\nvidia-smi.exe"));
    }
    for program in programs {
        // `compute_cap` solo existe en drivers recientes: sin él, se pregunta lo demás.
        for fields in ["name,memory.total,driver_version,compute_cap", "name,memory.total,driver_version"] {
            let mut command = Command::new(&program);
            command
                .arg(format!("--query-gpu={fields}"))
                .arg("--format=csv,noheader,nounits")
                .stdin(Stdio::null())
                .stderr(Stdio::null());
            engine::hide_console(&mut command);
            match command.output() {
                Ok(output) if output.status.success() => {
                    return parse_nvidia_smi(&String::from_utf8_lossy(&output.stdout));
                }
                Ok(_) => continue,
                // No existe ese programa: el siguiente candidato.
                Err(_) => break,
            }
        }
    }
    Vec::new()
}

/// Una GPU por línea: `nombre, memoria (MiB), driver[, capacidad]`.
fn parse_nvidia_smi(text: &str) -> Vec<Gpu> {
    let known = |value: &str| {
        let value = value.trim();
        (!value.is_empty() && !value.starts_with('[') && value != "N/A").then(|| value.to_owned())
    };
    text.lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split(',').collect();
            let name = known(fields.first()?)?;
            Some(Gpu {
                name,
                memory_bytes: fields
                    .get(1)
                    .and_then(|mib| mib.trim().parse::<u64>().ok())
                    .map(|mib| mib << 20),
                driver: fields.get(2).and_then(|value| known(value)),
                compute_capability: fields.get(3).and_then(|value| known(value)),
            })
        })
        .collect()
}

/// «581.29» → (581, 29). Un número que no se entiende cuenta como reciente.
fn version_pair(text: &str) -> Option<(u32, u32)> {
    let mut parts = text.trim().split('.').map(|part| part.parse::<u32>().ok());
    Some((parts.next()??, parts.next().flatten().unwrap_or(0)))
}

#[cfg(windows)]
fn total_memory() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    // SAFETY: estructura de datos simple; `dwLength` es lo único que la API exige rellenar.
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    // SAFETY: puntero válido a una estructura con `dwLength` correcto.
    (unsafe { GlobalMemoryStatusEx(&mut status) } != 0).then_some(status.ullTotalPhys)
}

#[cfg(target_os = "macos")]
fn total_memory() -> Option<u64> {
    let mut value: u64 = 0;
    let mut size = std::mem::size_of::<u64>();
    // SAFETY: `hw.memsize` es un entero de 64 bits y el búfer tiene ese tamaño.
    let result = unsafe {
        libc::sysctlbyname(
            c"hw.memsize".as_ptr(),
            (&mut value as *mut u64).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    (result == 0).then_some(value)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn total_memory() -> Option<u64> {
    let meminfo = fs::read_to_string("/proc/meminfo").ok()?;
    let line = meminfo.lines().find(|line| line.starts_with("MemTotal:"))?;
    let kib: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kib * 1024)
}

/// Espacio libre (para el usuario) en el disco de `path`, aunque la carpeta aún no exista.
fn free_space(path: &Path) -> Option<u64> {
    let dir = path.ancestors().find(|dir| dir.is_dir())?;
    free_space_at(dir)
}

#[cfg(windows)]
fn free_space_at(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain([0]).collect();
    let mut available = 0u64;
    // SAFETY: cadena terminada en cero y punteros válidos o nulos (los que se pueden omitir).
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(available)
}

#[cfg(unix)]
fn free_space_at(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;

    let path = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    // SAFETY: estructura de datos simple que rellena `statvfs`.
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: cadena terminada en cero y puntero válido.
    (unsafe { libc::statvfs(path.as_ptr(), &mut stat) } == 0)
        .then(|| stat.f_bavail as u64 * stat.f_frsize as u64)
}

// --- Variante según el equipo -------------------------------------------------

/// La variante para este equipo y por qué.
pub struct Choice {
    /// `None`: este sistema no admite el motor integrado.
    pub variant: Option<Variant>,
    pub reason: String,
    pub notes: Vec<String>,
}

pub fn choose(os: &str, arch: &str, hardware: &Hardware) -> Choice {
    let mut notes = Vec::new();
    if hardware.memory_bytes.is_some_and(|memory| memory < LOW_MEMORY) {
        notes.push("Con menos de 8 GB de memoria, la calidad máxima puede quedarse sin memoria: usa la rápida.".to_owned());
    }
    let choice = |variant, reason: String, notes| Choice {
        variant: Some(variant),
        reason,
        notes,
    };

    match (os, arch) {
        ("macos", "aarch64") => choice(
            Variant::MacosArm64,
            "Apple Silicon: separará con la GPU a través de Metal.".to_owned(),
            notes,
        ),
        ("windows", "x86_64") => {
            let Some(gpu) = hardware.gpus.iter().max_by_key(|gpu| gpu.memory_bytes.unwrap_or(0)) else {
                return choice(
                    Variant::WindowsCpu,
                    "No hay una GPU NVIDIA: separará con el procesador, más despacio.".to_owned(),
                    notes,
                );
            };
            let name = &gpu.name;
            let driver = gpu.driver.as_deref().and_then(version_pair);
            if driver.is_some_and(|driver| driver < MIN_DRIVER) {
                notes.push(format!(
                    "El driver de NVIDIA ({}) es demasiado antiguo para usar la GPU. Actualízalo y reinstala el motor desde Ajustes.",
                    gpu.driver.as_deref().unwrap_or_default()
                ));
                return choice(
                    Variant::WindowsCpu,
                    format!("{name}: separará con el procesador hasta que actualices el driver."),
                    notes,
                );
            }
            if gpu.memory_bytes.is_some_and(|memory| memory < MIN_VRAM) {
                return choice(
                    Variant::WindowsCpu,
                    format!("{name} tiene menos de 2 GB de memoria: separará con el procesador."),
                    notes,
                );
            }
            match gpu.compute_capability.as_deref().and_then(version_pair) {
                Some(capability) if capability < (5, 0) => choice(
                    Variant::WindowsCpu,
                    format!("{name} es demasiado antigua para PyTorch: separará con el procesador."),
                    notes,
                ),
                Some(capability) if capability < (7, 0) => choice(
                    Variant::WindowsCudaLegacy,
                    "Separará con la GPU (CUDA 12.6).".to_owned(),
                    notes,
                ),
                // Sin capacidad informada, el driver es reciente y la GPU casi seguro también.
                _ => choice(Variant::WindowsCuda, "Separará con la GPU (CUDA 12.8).".to_owned(), notes),
            }
        }
        _ => Choice {
            variant: None,
            reason: "El motor integrado solo se instala en Windows x64 y en macOS con Apple Silicon. \
                     En otros sistemas, define AUDIOEXTRACT_PYTHON o usa AUDIOEXTRACT_ENGINE=docker."
                .to_owned(),
            notes,
        },
    }
}

// --- Carpetas y estado --------------------------------------------------------

/// Carpetas del motor integrado.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnginePaths {
    root: PathBuf,
}

impl EnginePaths {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// `<datos locales de la app>/engine`.
    pub fn default_location() -> Option<Self> {
        engine::app_data_dir().map(|data| Self::new(data.join("engine")))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn python_installs(&self) -> PathBuf {
        self.root.join("python")
    }

    fn venv(&self) -> PathBuf {
        self.root.join("venv")
    }

    pub fn interpreter(&self) -> PathBuf {
        engine::venv_python(&self.venv())
    }

    fn cache(&self) -> PathBuf {
        self.root.join("cache")
    }

    fn bin(&self) -> PathBuf {
        self.root.join("bin")
    }

    fn ffmpeg(&self) -> PathBuf {
        self.bin().join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" })
    }

    fn models(&self) -> PathBuf {
        self.root.join("models")
    }

    fn marker(&self) -> PathBuf {
        self.root.join("engine.json")
    }

    fn installed_lock(&self) -> PathBuf {
        self.root.join("lock.txt")
    }

    /// Prepara `command` (Python del motor) para usar este entorno: modelos, ffmpeg y, con
    /// `offline`, solo lo ya descargado.
    pub fn configure(&self, command: &mut Command, offline: bool) {
        let path = env::var_os("PATH").unwrap_or_default();
        let search = env::join_paths([self.bin()].into_iter().chain(env::split_paths(&path)))
            .unwrap_or_else(|_| self.bin().into_os_string());
        command
            .env("TORCH_HOME", self.models().join("torch"))
            .env("AUDIOEXTRACT_MODELS_DIR", self.models().join("separator"))
            .env("AUDIOEXTRACT_MANAGED", "1")
            .env("PATH", search)
            // Que nada del Python del usuario se cuele en el entorno del motor.
            .env_remove("PYTHONHOME")
            .env_remove("PYTHONPATH")
            .env_remove("VIRTUAL_ENV");
        if offline {
            command.env("AUDIOEXTRACT_OFFLINE", "1");
        }
    }
}

/// `engine.json`: qué se instaló.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledEngine {
    pub variant: Variant,
    pub models: Vec<String>,
    pub installed_at: u64,
    pub app_version: String,
}

fn read_installed(paths: &EnginePaths) -> Option<InstalledEngine> {
    serde_json::from_slice(&fs::read(paths.marker()).ok()?).ok()
}

/// Bloqueo que trae esta versión de la app para `variant` (va junto a los scripts del motor).
fn bundled_lock(variant: Variant) -> Result<PathBuf, AppError> {
    let script = engine::resolve_script()?;
    let lock = script
        .with_file_name("locks")
        .join(format!("{}.txt", variant.lock_name()));
    if lock.is_file() {
        Ok(lock)
    } else {
        Err(AppError::Setup(format!(
            "Falta {} entre los archivos de la app. Reinstala AudioExtract.",
            lock.display()
        )))
    }
}

/// Estado del motor integrado.
pub enum Managed {
    Ready(EnginePaths),
    /// Instalado, pero no con lo que necesita esta versión de la app.
    Outdated,
    Missing,
}

pub fn managed() -> Managed {
    let Some(paths) = EnginePaths::default_location() else {
        return Managed::Missing;
    };
    match read_installed(&paths) {
        None => Managed::Missing,
        Some(installed) if is_current(&paths, &installed, bundled_lock(installed.variant).ok().as_deref()) => {
            Managed::Ready(paths)
        }
        Some(_) => Managed::Outdated,
    }
}

/// Al día: el intérprete existe, están todos los modelos y el bloqueo instalado es el que trae la app
/// (sin `bundled`, en desarrollo sin recursos, no se puede comparar y vale lo instalado).
fn is_current(paths: &EnginePaths, installed: &InstalledEngine, bundled: Option<&Path>) -> bool {
    paths.interpreter().is_file()
        && MODELS.iter().all(|model| installed.models.iter().any(|have| have == model))
        && bundled.map_or(true, |lock| same_text(lock, &paths.installed_lock()))
}

/// Mismo contenido sin contar los finales de línea (git puede convertirlos al descargar el repo).
fn same_text(a: &Path, b: &Path) -> bool {
    let read = |path: &Path| fs::read(path).map(|bytes| bytes.into_iter().filter(|byte| *byte != b'\r').collect::<Vec<_>>());
    matches!((read(a), read(b)), (Ok(a), Ok(b)) if a == b)
}

// --- Plan ---------------------------------------------------------------------

/// Lo que la interfaz enseña antes de instalar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupPlan {
    pub hardware: Hardware,
    /// Variante recomendada para este equipo; `None` si el sistema no admite el motor integrado.
    pub variant: Option<Variant>,
    /// `cuda`, `mps` o `cpu`.
    pub accelerator: Option<&'static str>,
    pub reason: String,
    pub notes: Vec<String>,
    /// Lo que falta por descargar con la variante recomendada.
    pub download_bytes: u64,
    /// Lo que ocupará el motor una vez instalado.
    pub installed_bytes: u64,
    /// Espacio libre necesario: mientras se instala se ocupa más que al final.
    pub required_bytes: u64,
    pub free_bytes: Option<u64>,
    pub installed: Option<InstalledEngine>,
    pub up_to_date: bool,
    pub dir: String,
}

pub fn plan() -> Result<SetupPlan, AppError> {
    let paths = default_paths()?;
    let hardware = detect_hardware();
    let choice = choose(env::consts::OS, env::consts::ARCH, &hardware);
    let installed = read_installed(&paths);
    let up_to_date = installed
        .as_ref()
        .is_some_and(|installed| is_current(&paths, installed, bundled_lock(installed.variant).ok().as_deref()));
    let estimate = choice
        .variant
        .map(|variant| estimate(&paths, variant, installed.as_ref()))
        .unwrap_or_default();

    Ok(SetupPlan {
        variant: choice.variant,
        accelerator: choice.variant.map(Variant::accelerator),
        reason: choice.reason,
        notes: choice.notes,
        download_bytes: estimate.download,
        installed_bytes: estimate.installed,
        required_bytes: estimate.required,
        free_bytes: free_space(paths.root()),
        installed,
        up_to_date,
        dir: paths.root().display().to_string(),
        hardware,
    })
}

fn default_paths() -> Result<EnginePaths, AppError> {
    EnginePaths::default_location()
        .ok_or_else(|| AppError::Setup("No se encontró la carpeta de datos de la app.".to_owned()))
}

#[derive(Debug, Default, PartialEq)]
struct Estimate {
    download: u64,
    installed: u64,
    required: u64,
}

/// Cuánto falta por descargar y cuánto espacio hace falta, según lo que ya hay.
fn estimate(paths: &EnginePaths, variant: Variant, installed: Option<&InstalledEngine>) -> Estimate {
    let footprint = variant.footprint();
    let has_python = paths.interpreter().is_file();
    // Con la misma variante, uv solo descarga lo que haya cambiado en el bloqueo.
    let same_packages = has_python && installed.is_some_and(|installed| installed.variant == variant);
    let has_models = dir_size(&paths.models()) >= MODELS_BYTES * 95 / 100;
    let missing = |present: bool, bytes: u64| if present { 0 } else { bytes };

    Estimate {
        download: missing(has_python, PYTHON_DOWNLOAD)
            + missing(same_packages, footprint.download)
            + missing(has_models, MODELS_BYTES),
        installed: PYTHON_DISK + footprint.installed + MODELS_BYTES,
        required: missing(has_python, PYTHON_DISK)
            + missing(same_packages, footprint.peak)
            + missing(has_models, MODELS_BYTES)
            + DISK_MARGIN,
    }
}

// --- Instalación --------------------------------------------------------------

/// Pasos de la instalación, en orden.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SetupStep {
    Python,
    Packages,
    Ffmpeg,
    Models,
    Check,
}

/// Mensajes del `Channel` de la instalación.
#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "event",
    content = "data"
)]
pub enum SetupEvent {
    Step {
        step: SetupStep,
    },
    /// `percent`: avance de toda la instalación (0–100); `bytes`/`total`: lo medido del paso en curso.
    Progress {
        percent: f32,
        bytes: Option<u64>,
        total: Option<u64>,
    },
    Log {
        message: String,
    },
}

pub type Emit = Arc<dyn Fn(SetupEvent) + Send + Sync>;

/// Instalación en curso: como mucho una, cancelable.
#[derive(Default)]
pub struct SetupState {
    child: Mutex<Option<Child>>,
    running: AtomicBool,
    cancelled: AtomicBool,
}

impl SetupState {
    /// Detiene la instalación en curso; lo descargado se aprovecha al volver a intentarlo.
    pub fn cancel(&self) -> bool {
        if !self.running.load(Ordering::SeqCst) {
            return false;
        }
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(child) = lock(&self.child).as_mut() {
            let _ = child.kill();
        }
        true
    }

    /// Ejecuta un paso y espera a que termine. Con `meter`, informa del avance según lo que
    /// ocupa una carpeta. Las líneas `{"type": "log"}` de stdout llegan a la interfaz.
    fn run(&self, mut command: Command, progress: &Progress, meter: Option<Meter>) -> Result<(), AppError> {
        if self.cancelled.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled);
        }
        command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        engine::hide_console(&mut command);
        let mut child = command.spawn().map_err(|source| AppError::Spawn {
            program: command.get_program().to_string_lossy().into_owned(),
            hint: "Reinstala AudioExtract.",
            source,
        })?;
        let stdout = child.stdout.take().expect("stdout configurado como pipe");
        let stderr_tail = engine::drain_stderr(child.stderr.take().expect("stderr configurado como pipe"));
        *lock(&self.child) = Some(child);

        let finished = AtomicBool::new(false);
        thread::scope(|scope| {
            if let Some(meter) = &meter {
                scope.spawn(|| {
                    while !finished.load(Ordering::SeqCst) {
                        let bytes = dir_size(&meter.dir);
                        progress.report(bytes as f64 / meter.total as f64, Some(bytes), Some(meter.total));
                        for _ in 0..(METER_INTERVAL.as_millis() / 100) {
                            if finished.load(Ordering::SeqCst) {
                                break;
                            }
                            thread::sleep(Duration::from_millis(100));
                        }
                    }
                });
            }
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(message) = log_message(&line) {
                    (progress.emit)(SetupEvent::Log { message });
                }
            }
            finished.store(true, Ordering::SeqCst);
        });

        let status = lock(&self.child).take().map(|mut child| child.wait()).transpose()?;
        let tail = stderr_tail.join().unwrap_or_default();
        if self.cancelled.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled);
        }
        if status.is_some_and(|status| status.success()) {
            Ok(())
        } else {
            Err(AppError::Setup(explain_failure(status, &tail)))
        }
    }
}

/// Mide el avance de un paso por lo que ocupa `dir` frente a lo que ocupará (`total`).
struct Meter {
    dir: PathBuf,
    total: u64,
}

/// Reparte la barra entre los pasos según lo que descarga cada uno.
struct Progress {
    emit: Emit,
    weights: [u64; 5],
    step: AtomicUsize,
    last: Mutex<f32>,
}

impl Progress {
    fn new(emit: Emit, weights: [u64; 5]) -> Self {
        Self {
            emit,
            weights,
            step: AtomicUsize::new(0),
            last: Mutex::new(0.0),
        }
    }

    fn start(&self, step: SetupStep) {
        self.step.store(step as usize, Ordering::SeqCst);
        (self.emit)(SetupEvent::Step { step });
        self.report(0.0, None, None);
    }

    /// `fraction` del paso en curso. Nunca retrocede y no llega al final hasta que el paso acaba.
    fn report(&self, fraction: f64, bytes: Option<u64>, total: Option<u64>) {
        let index = self.step.load(Ordering::SeqCst);
        let all: u64 = self.weights.iter().sum();
        let before: u64 = self.weights[..index].iter().sum();
        let current = before as f64 + self.weights[index] as f64 * fraction.clamp(0.0, 0.97);
        let mut last = lock(&self.last);
        let percent = ((current / all as f64 * 100.0) as f32).max(*last);
        *last = percent;
        (self.emit)(SetupEvent::Progress { percent, bytes, total });
    }

    fn finish(&self) {
        *lock(&self.last) = 100.0;
        (self.emit)(SetupEvent::Progress {
            percent: 100.0,
            bytes: None,
            total: None,
        });
    }
}

/// Instala (o pone al día) el motor integrado con `variant`. Tarda de uno a varios minutos según la
/// conexión: llamar desde un hilo bloqueante. `check` comprueba al final que el motor arranca.
pub fn install(
    state: &SetupState,
    variant: Variant,
    emit: Emit,
    check: impl FnOnce() -> Result<(), String>,
) -> Result<InstalledEngine, AppError> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err(AppError::SetupBusy);
    }
    let _running = RunningGuard(state);
    state.cancelled.store(false, Ordering::SeqCst);

    let paths = default_paths()?;
    let lock_file = engine::plain_path(&bundled_lock(variant)?);
    let script = engine::resolve_script()?;
    let scripts = engine::plain_path(script.parent().unwrap_or(Path::new(".")));
    let uv = uv_program()?;
    let previous = read_installed(&paths);
    let estimate = estimate(&paths, variant, previous.as_ref());
    if let Some(free) = free_space(paths.root()) {
        if free < estimate.required {
            return Err(AppError::Setup(format!(
                "Hacen falta {} libres en el disco de {} y hay {}. Libera espacio y vuelve a intentarlo.",
                gigabytes(estimate.required),
                paths.root().display(),
                gigabytes(free)
            )));
        }
    }
    fs::create_dir_all(paths.root())?;
    // Sin la marca nadie usa el motor a medio instalar; se escribe al terminar.
    let _ = fs::remove_file(paths.marker());

    let same_packages = paths.interpreter().is_file() && previous.is_some_and(|previous| previous.variant == variant);
    let footprint = variant.footprint();
    let progress = Progress::new(
        emit,
        [
            PYTHON_DOWNLOAD,
            if same_packages { 100 * MB } else { footprint.download },
            10 * MB,
            MODELS_BYTES,
            80 * MB,
        ],
    );

    // 1. CPython de uv y el entorno virtual (si ya están, no se tocan).
    progress.start(SetupStep::Python);
    let mut command = uv_command(&uv, &paths);
    command
        .arg("venv")
        .arg(paths.venv())
        .args(["--python", PYTHON_VERSION, "--managed-python", "--allow-existing", "--no-project"]);
    state.run(
        command,
        &progress,
        Some(Meter {
            dir: paths.python_installs(),
            total: PYTHON_DISK,
        }),
    )?;

    // 2. Exactamente lo del bloqueo: instala, actualiza y quita lo que sobre. Con la misma variante
    //    solo cambia lo que cambió en el bloqueo y no se puede medir de antemano.
    progress.start(SetupStep::Packages);
    let mut command = uv_command(&uv, &paths);
    command
        .args(["pip", "sync"])
        .arg(&lock_file)
        .arg("--python")
        .arg(paths.interpreter())
        // Las ruedas de PyTorch están en su índice y el resto en PyPI; los SHA-256 del bloqueo
        // garantizan que cada archivo es el esperado venga de donde venga.
        .args(["--index-strategy", "unsafe-best-match", "--require-hashes", "--compile-bytecode"]);
    let meter = (!same_packages).then(|| Meter {
        dir: paths.cache(),
        total: footprint.peak,
    });
    state.run(command, &progress, meter)?;

    // 3. ffmpeg (audio-separator lo exige; además lee M4A y AAC).
    progress.start(SetupStep::Ffmpeg);
    install_ffmpeg(&paths)?;

    // 4. Pesos de los modelos. Los que ya están se cargan sin descargarlos.
    progress.start(SetupStep::Models);
    let mut command = Command::new(paths.interpreter());
    command
        .arg("-u")
        .arg(scripts.join("catalog.py"))
        .arg("--prefetch")
        .args(MODELS)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8");
    paths.configure(&mut command, false);
    state.run(
        command,
        &progress,
        Some(Meter {
            dir: paths.models(),
            total: MODELS_BYTES,
        }),
    )?;

    // 5. Limpiar, marcar como instalado y comprobar que arranca.
    progress.start(SetupStep::Check);
    free_installation_space(&paths);
    fs::copy(&lock_file, paths.installed_lock())?;
    let installed = InstalledEngine {
        variant,
        models: MODELS.iter().map(|model| (*model).to_owned()).collect(),
        installed_at: engine::unix_millis() as u64,
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
    };
    fs::write(paths.marker(), serde_json::to_vec_pretty(&installed)?)?;
    if let Err(problem) = check() {
        let _ = fs::remove_file(paths.marker());
        return Err(AppError::Setup(format!("El motor se instaló, pero no arranca: {problem}")));
    }
    progress.finish();
    Ok(installed)
}

struct RunningGuard<'a>(&'a SetupState);

impl Drop for RunningGuard<'_> {
    fn drop(&mut self) {
        self.0.running.store(false, Ordering::SeqCst);
    }
}

/// `uv` que viaja con la app (junto al ejecutable; `AUDIOEXTRACT_UV` para pruebas).
fn uv_program() -> Result<PathBuf, AppError> {
    if let Some(explicit) = env::var_os("AUDIOEXTRACT_UV") {
        return Ok(PathBuf::from(explicit));
    }
    let name = if cfg!(windows) { "uv.exe" } else { "uv" };
    env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(name)))
        .filter(|uv| uv.is_file())
        .ok_or_else(|| AppError::Setup("Falta uv, el instalador del motor que viene con la app. Reinstala AudioExtract.".to_owned()))
}

/// `uv` con todo dentro de la carpeta del motor y sin configuración del usuario.
fn uv_command(uv: &Path, paths: &EnginePaths) -> Command {
    let mut command = Command::new(uv);
    command
        .args(["--no-config", "--color", "never"])
        .env("UV_CACHE_DIR", paths.cache())
        .env("UV_PYTHON_INSTALL_DIR", paths.python_installs())
        .env("UV_NO_PROGRESS", "1")
        // Un PyTorch con CUDA son 3,5 GB: con una conexión lenta, el tiempo por defecto no basta.
        .env("UV_HTTP_TIMEOUT", "300");
    for key in [
        "VIRTUAL_ENV",
        "CONDA_PREFIX",
        "PYTHONHOME",
        "PYTHONPATH",
        "UV_INDEX",
        "UV_INDEX_URL",
        "UV_DEFAULT_INDEX",
        "UV_EXTRA_INDEX_URL",
        "UV_PYTHON",
        "UV_SYSTEM_PYTHON",
    ] {
        command.env_remove(key);
    }
    command
}

fn site_packages(venv: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![venv.join("Lib").join("site-packages")];
    if let Ok(entries) = fs::read_dir(venv.join("lib")) {
        dirs.extend(entries.flatten().map(|entry| entry.path().join("site-packages")));
    }
    dirs.retain(|dir| dir.is_dir());
    dirs
}

/// Enlaza (o copia) el ffmpeg de imageio-ffmpeg como `bin/ffmpeg`, que es como lo buscan
/// audio-separator y `separate.py`.
fn install_ffmpeg(paths: &EnginePaths) -> Result<(), AppError> {
    let source = site_packages(&paths.venv())
        .into_iter()
        .find_map(|dir| {
            fs::read_dir(dir.join("imageio_ffmpeg").join("binaries"))
                .ok()?
                .flatten()
                .map(|entry| entry.path())
                .find(|path| path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with("ffmpeg")))
        })
        .ok_or_else(|| AppError::Setup("El paquete imageio-ffmpeg no trae ffmpeg para este sistema.".to_owned()))?;
    fs::create_dir_all(paths.bin())?;
    let target = paths.ffmpeg();
    let _ = fs::remove_file(&target);
    if fs::hard_link(&source, &target).is_err() {
        fs::copy(&source, &target)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

/// Libera espacio al terminar: la caché de uv (el entorno ya tiene sus archivos) y, en Windows, las
/// bibliotecas estáticas de PyTorch (`*.lib`, ~2,8 GB), que solo sirven para compilar extensiones.
fn free_installation_space(paths: &EnginePaths) {
    let _ = fs::remove_dir_all(paths.cache());
    if cfg!(windows) {
        for dir in site_packages(&paths.venv()) {
            remove_files_with_extension(&dir.join("torch"), "lib");
        }
    }
}

fn remove_files_with_extension(dir: &Path, extension: &str) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => remove_files_with_extension(&path, extension),
            Ok(kind) if kind.is_file() && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case(extension)) => {
                let _ = fs::remove_file(&path);
            }
            _ => {}
        }
    }
}

/// Bytes de los archivos de `dir` (sin seguir enlaces simbólicos). 0 si no existe.
fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => dir_size(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map(|meta| meta.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

fn log_message(line: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct Line {
        #[serde(rename = "type")]
        kind: String,
        message: String,
    }
    serde_json::from_str::<Line>(line.trim())
        .ok()
        .filter(|line| line.kind == "log")
        .map(|line| line.message)
}

/// Mensaje para la interfaz: qué hacer y, debajo, las últimas líneas del error.
fn explain_failure(status: Option<ExitStatus>, stderr_tail: &[String]) -> String {
    let text = stderr_tail.join("\n").to_lowercase();
    let mentions = |needles: &[&str]| needles.iter().any(|needle| text.contains(needle));
    let advice = if mentions(&["no space left", "os error 112", "not enough space", "disk full"]) {
        "El disco se quedó sin espacio. Libera espacio y vuelve a intentarlo."
    } else if mentions(&[
        "failed to fetch",
        "failed to download",
        "error sending request",
        "dns error",
        "timed out",
        "connection",
        "os error 10054",
        "os error 10060",
        "network",
    ]) {
        "No se pudo descargar. Comprueba la conexión a internet y vuelve a intentarlo: lo ya descargado no se repite."
    } else {
        "No se pudo instalar el motor."
    };
    let start = stderr_tail.len().saturating_sub(6);
    let detail = stderr_tail[start..].join("\n");
    match (detail.is_empty(), status.and_then(|status| status.code())) {
        (true, Some(code)) => format!("{advice} (código {code})"),
        (true, None) => advice.to_owned(),
        (false, _) => format!("{advice}\n\n{detail}"),
    }
}

/// «4,4 GB», en GB binarios como el explorador de archivos y la interfaz (`formatBytes`).
fn gigabytes(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / GIB as f64).replace('.', ",")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hardware(gpus: Vec<Gpu>, memory_gib: u64) -> Hardware {
        Hardware {
            os: "windows",
            arch: "x86_64",
            cpu_threads: 12,
            memory_bytes: Some(memory_gib * GIB),
            gpus,
        }
    }

    fn gpu(name: &str, memory_mib: u64, driver: &str, capability: Option<&str>) -> Gpu {
        Gpu {
            name: name.to_owned(),
            memory_bytes: Some(memory_mib << 20),
            driver: Some(driver.to_owned()),
            compute_capability: capability.map(str::to_owned),
        }
    }

    #[test]
    fn parses_nvidia_smi() {
        let gpus = parse_nvidia_smi("NVIDIA GeForce RTX 3060, 12288, 581.29, 8.6\r\nQuadro K620, 2048, 472.12, [N/A]\n\n");
        assert_eq!(
            gpus,
            vec![
                gpu("NVIDIA GeForce RTX 3060", 12288, "581.29", Some("8.6")),
                gpu("Quadro K620", 2048, "472.12", None),
            ]
        );
        assert!(parse_nvidia_smi("").is_empty());
    }

    #[test]
    fn chooses_the_variant_from_the_hardware() {
        let pick = |gpus| choose("windows", "x86_64", &hardware(gpus, 32));

        let rtx = pick(vec![gpu("NVIDIA GeForce RTX 3060", 12288, "581.29", Some("8.6"))]);
        assert_eq!(rtx.variant, Some(Variant::WindowsCuda));
        assert!(rtx.reason.contains("CUDA 12.8"));
        assert!(rtx.notes.is_empty());

        let pascal = pick(vec![gpu("NVIDIA GeForce GTX 1060 6GB", 6144, "560.94", Some("6.1"))]);
        assert_eq!(pascal.variant, Some(Variant::WindowsCudaLegacy));

        let unknown = pick(vec![gpu("NVIDIA RTX A4000", 16376, "552.22", None)]);
        assert_eq!(unknown.variant, Some(Variant::WindowsCuda));

        let kepler = pick(vec![gpu("NVIDIA GeForce GTX 780", 3072, "530.10", Some("3.5"))]);
        assert_eq!(kepler.variant, Some(Variant::WindowsCpu));

        let tiny = pick(vec![gpu("NVIDIA GeForce MX150", 1024, "560.94", Some("6.1"))]);
        assert_eq!(tiny.variant, Some(Variant::WindowsCpu));

        let old_driver = pick(vec![gpu("NVIDIA GeForce RTX 2070", 8192, "471.11", Some("7.5"))]);
        assert_eq!(old_driver.variant, Some(Variant::WindowsCpu));
        assert!(old_driver.notes.iter().any(|note| note.contains("471.11")));

        // Con varias, manda la de más memoria.
        let two = pick(vec![
            gpu("NVIDIA GeForce GT 1030", 2048, "560.94", Some("6.1")),
            gpu("NVIDIA GeForce RTX 4070", 12282, "560.94", Some("8.9")),
        ]);
        assert_eq!(two.variant, Some(Variant::WindowsCuda));
        assert!(kepler.reason.contains("GTX 780"));

        assert_eq!(pick(Vec::new()).variant, Some(Variant::WindowsCpu));
    }

    #[test]
    fn handles_other_systems_and_low_memory() {
        let mac = choose("macos", "aarch64", &hardware(Vec::new(), 16));
        assert_eq!(mac.variant, Some(Variant::MacosArm64));
        assert_eq!(Variant::MacosArm64.accelerator(), "mps");

        assert!(choose("linux", "x86_64", &hardware(Vec::new(), 16)).variant.is_none());
        assert!(choose("macos", "x86_64", &hardware(Vec::new(), 16)).variant.is_none());

        let small = choose("windows", "x86_64", &hardware(Vec::new(), 4));
        assert!(small.notes.iter().any(|note| note.contains("8 GB")));
    }

    #[test]
    fn compares_versions() {
        assert_eq!(version_pair("581.29"), Some((581, 29)));
        assert_eq!(version_pair("570.86.10"), Some((570, 86)));
        assert_eq!(version_pair("8.6"), Some((8, 6)));
        assert_eq!(version_pair("12"), Some((12, 0)));
        assert_eq!(version_pair("[N/A]"), None);
        assert!((527, 41) < (528, 0) && (527, 40) < MIN_DRIVER);
    }

    fn temp_engine(name: &str) -> EnginePaths {
        let root = env::temp_dir().join(format!("audioextract-setup-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        EnginePaths::new(root)
    }

    #[test]
    fn knows_when_the_engine_is_current() {
        let paths = temp_engine("current");
        let bundled = paths.root().join("bundled.txt");
        fs::write(&bundled, "torch==2.8.0\r\nnumpy==2.5.2\r\n").unwrap();
        let installed = InstalledEngine {
            variant: Variant::WindowsCuda,
            models: MODELS.iter().map(|model| (*model).to_owned()).collect(),
            installed_at: 1,
            app_version: "1.1.0".into(),
        };

        // Sin intérprete, no.
        assert!(!is_current(&paths, &installed, Some(&bundled)));

        fs::create_dir_all(paths.interpreter().parent().unwrap()).unwrap();
        fs::write(paths.interpreter(), b"").unwrap();
        // Mismo bloqueo, aunque con otros finales de línea.
        fs::write(paths.installed_lock(), "torch==2.8.0\nnumpy==2.5.2\n").unwrap();
        assert!(is_current(&paths, &installed, Some(&bundled)));
        assert!(is_current(&paths, &installed, None));

        // La app trae otro bloqueo: hay que ponerlo al día.
        fs::write(&bundled, "torch==2.9.0\nnumpy==2.5.2\n").unwrap();
        assert!(!is_current(&paths, &installed, Some(&bundled)));

        // Falta un modelo que esta versión necesita.
        let fewer = InstalledEngine {
            models: vec!["htdemucs".into()],
            ..installed
        };
        assert!(!is_current(&paths, &fewer, None));
        let _ = fs::remove_dir_all(paths.root());
    }

    #[test]
    fn estimates_what_is_missing() {
        let paths = temp_engine("estimate");
        let fresh = estimate(&paths, Variant::WindowsCuda, None);
        assert_eq!(fresh.download, PYTHON_DOWNLOAD + 3_671 * MB + MODELS_BYTES);
        assert_eq!(fresh.installed, PYTHON_DISK + 5_184 * MB + MODELS_BYTES);
        assert!(fresh.required > fresh.installed);

        fs::create_dir_all(paths.interpreter().parent().unwrap()).unwrap();
        fs::write(paths.interpreter(), b"").unwrap();
        let installed = InstalledEngine {
            variant: Variant::WindowsCuda,
            models: Vec::new(),
            installed_at: 1,
            app_version: "1.1.0".into(),
        };
        let update = estimate(&paths, Variant::WindowsCuda, Some(&installed));
        assert_eq!(update.download, MODELS_BYTES);
        // Pasar a otra variante descarga su PyTorch.
        let switch = estimate(&paths, Variant::WindowsCpu, Some(&installed));
        assert_eq!(switch.download, 821 * MB + MODELS_BYTES);
        let _ = fs::remove_dir_all(paths.root());
    }

    #[test]
    fn prepares_the_engine_environment() {
        let paths = EnginePaths::new(PathBuf::from("/data/engine"));
        let mut command = Command::new("python");
        paths.configure(&mut command, true);
        let env: Vec<(String, Option<String>)> = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|value| value.to_string_lossy().into_owned()),
                )
            })
            .collect();
        let get = |key: &str| env.iter().find(|(name, _)| name == key).and_then(|(_, value)| value.clone());

        assert_eq!(get("TORCH_HOME").map(PathBuf::from), Some(Path::new("/data/engine").join("models").join("torch")));
        assert_eq!(get("AUDIOEXTRACT_OFFLINE").as_deref(), Some("1"));
        assert_eq!(get("AUDIOEXTRACT_MANAGED").as_deref(), Some("1"));
        let path = get("PATH").unwrap();
        assert_eq!(env::split_paths(&path).next(), Some(Path::new("/data/engine").join("bin")));
        assert!(env.iter().any(|(name, value)| name == "PYTHONPATH" && value.is_none()));

        let mut online = Command::new("python");
        paths.configure(&mut online, false);
        assert!(!online.get_envs().any(|(key, _)| key == "AUDIOEXTRACT_OFFLINE"));
    }

    #[test]
    fn frees_static_libraries_only() {
        let paths = temp_engine("cleanup");
        let torch = site_packages_for_test(&paths).join("torch");
        fs::create_dir_all(torch.join("lib")).unwrap();
        fs::write(torch.join("lib").join("dnnl.lib"), b"x").unwrap();
        fs::write(torch.join("lib").join("torch_cuda.dll"), b"x").unwrap();
        fs::create_dir_all(paths.cache()).unwrap();
        free_installation_space(&paths);
        assert!(!paths.cache().exists());
        assert!(torch.join("lib").join("torch_cuda.dll").is_file());
        assert_eq!(torch.join("lib").join("dnnl.lib").exists(), !cfg!(windows));
        let _ = fs::remove_dir_all(paths.root());
    }

    fn site_packages_for_test(paths: &EnginePaths) -> PathBuf {
        if cfg!(windows) {
            paths.venv().join("Lib").join("site-packages")
        } else {
            paths.venv().join("lib").join("python3.12").join("site-packages")
        }
    }

    #[test]
    fn explains_failures() {
        let offline = explain_failure(None, &["error: Failed to fetch: `https://download.pytorch.org/…`".to_owned()]);
        assert!(offline.starts_with("No se pudo descargar"));
        let full = explain_failure(None, &["OSError: [WinError 112] There is not enough space on the disk (os error 112)".to_owned()]);
        assert!(full.starts_with("El disco se quedó sin espacio"));
        assert_eq!(gigabytes(4_750_000_000), "4,4 GB");
        assert_eq!(log_message(r#"{"type": "log", "message": "Modelo htdemucs listo"}"#).as_deref(), Some("Modelo htdemucs listo"));
        assert!(log_message("Downloading torch").is_none());
    }

    #[test]
    fn serializes_events_for_frontend() {
        let json = serde_json::to_value(SetupEvent::Step { step: SetupStep::Packages }).unwrap();
        assert_eq!(json, serde_json::json!({ "event": "step", "data": { "step": "packages" } }));
        assert_eq!(serde_json::to_value(Variant::WindowsCudaLegacy).unwrap(), "windows-cuda-legacy");
    }

    /// De punta a punta, con red y en este equipo (no corre en la CI). Instala o pone al día el
    /// motor en `<AUDIOEXTRACT_E2E_DATA>/engine` con la variante que toque y comprueba que arranca:
    ///
    /// ```text
    /// set AUDIOEXTRACT_E2E_RESOURCES=\\?\C:\Users\<usuario>\AppData\Local\AudioExtract
    /// set AUDIOEXTRACT_E2E_DATA=C:\Users\<usuario>\AppData\Local\com.audioextract.desktop
    /// set AUDIOEXTRACT_UV=C:\Users\<usuario>\AppData\Local\AudioExtract\uv.exe
    /// audioextract-tests.exe --ignored e2e_install
    /// ```
    #[test]
    #[ignore = "descarga el motor (hasta ~5 GB) y necesita la app instalada"]
    fn e2e_install_engine() {
        let resources = env::var_os("AUDIOEXTRACT_E2E_RESOURCES").expect("define AUDIOEXTRACT_E2E_RESOURCES");
        let data = env::var_os("AUDIOEXTRACT_E2E_DATA").expect("define AUDIOEXTRACT_E2E_DATA");
        engine::init_app_dirs(Some(PathBuf::from(resources)), Some(PathBuf::from(data)));

        let plan = plan().expect("plan");
        let variant = plan.variant.expect("sistema admitido");
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let emit: Emit = Arc::new(move |event| lock(&sink).push(event));
        let engine_state = engine::EngineState::default();
        install(&SetupState::default(), variant, emit, || {
            let status = engine_state.refresh(true);
            if status.ready {
                Ok(())
            } else {
                Err(status.problem.unwrap_or_default())
            }
        })
        .expect("instalación");

        assert!(matches!(managed(), Managed::Ready(_)));
        let status = engine_state.refresh(false);
        assert_eq!(status.kind, "app");
        assert_eq!(status.device.as_deref(), Some(variant.accelerator()));
        let steps = lock(&events)
            .iter()
            .filter(|event| matches!(event, SetupEvent::Step { .. }))
            .count();
        assert_eq!(steps, 5);
    }
}
