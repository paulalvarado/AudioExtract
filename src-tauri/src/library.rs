//! Biblioteca de extracciones.
//!
//! Es una carpeta normal (por defecto `Música/AudioExtract`) con una subcarpeta
//! por extracción:
//!
//! ```text
//! AudioExtract/
//! ├── Mi canción/
//! │   ├── entry.json        metadatos y mezcla guardada
//! │   ├── vocals.wav        una pista por instrumento, WAV 16 bits
//! │   ├── bass.notes.json   notas del bajo (modo práctica), si ya se transcribió
//! │   └── …
//! ├── Mi canción (2)/
//! └── .staging/             separaciones en curso (se vacía al arrancar)
//! ```
//!
//! Cada carpeta es autocontenida: se puede mover, copiar o compartir, y la app
//! la reconoce en cualquier biblioteca. El nombre de la carpeta es el `id`.

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use crate::engine::{unix_millis, NoteEvent, Quality};
use crate::error::AppError;

pub const ENTRY_FILE: &str = "entry.json";
const STAGING_DIR: &str = ".staging";
pub const ENTRY_VERSION: u32 = 1;
const MAX_NAME_CHARS: usize = 60;
/// Notas del bajo ya transcritas, junto a `bass.wav`: el modo práctica se abre al instante.
pub const BASS_NOTES_FILE: &str = "bass.notes.json";
/// Subirlo invalida las transcripciones guardadas (p. ej., al cambiar de modelo o de limpieza).
const BASS_NOTES_VERSION: u32 = 1;

/// Contenido de `bass.notes.json` (se escribe con `write_bass_notes`).
#[derive(Debug, Deserialize)]
struct BassNotes {
    version: u32,
    notes: Vec<NoteEvent>,
}

/// Contenido de `entry.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub version: u32,
    pub title: String,
    /// Nombre del archivo original (solo informativo).
    pub source_name: String,
    /// Milisegundos desde 1970.
    pub created_at: u64,
    pub duration_sec: f64,
    /// Pistas en orden de presentación; cada una es `<id>.wav`.
    pub stems: Vec<String>,
    pub quality: Quality,
    pub models: Vec<String>,
    pub device: Option<String>,
    pub device_name: Option<String>,
    pub elapsed_ms: u64,
    /// Estado del mezclador que guarda el frontend (volúmenes, mute, solo, semitonos).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mix: Option<serde_json::Value>,
}

/// Una extracción tal como la ve el frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    pub dir: String,
    #[serde(flatten)]
    pub entry: Entry,
    /// Ruta absoluta de cada pista, en el orden de `entry.stems`.
    pub files: Vec<StemFile>,
    pub size_bytes: u64,
    /// Pistas cuyo archivo ya no existe (borradas o movidas a mano).
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StemFile {
    pub id: String,
    pub path: String,
}

pub struct Library {
    root: PathBuf,
}

impl Library {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Todas las extracciones, de la más reciente a la más antigua. Las carpetas
    /// sin `entry.json` válido se ignoran (no son de AudioExtract).
    pub fn list(&self) -> Result<Vec<LibraryItem>, AppError> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err.into()),
        };

        let mut items: Vec<LibraryItem> = entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .filter_map(|entry| {
                let id = entry.file_name().to_str()?.to_owned();
                if id.starts_with('.') {
                    return None;
                }
                self.load(&id).ok()
            })
            .collect();
        items.sort_by_key(|item| std::cmp::Reverse(item.entry.created_at));
        Ok(items)
    }

    /// Carpeta temporal para una separación nueva (en el mismo disco que la
    /// biblioteca, así `commit` es un simple renombrado).
    pub fn create_staging(&self) -> Result<PathBuf, AppError> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let job = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir = self.root.join(STAGING_DIR).join(format!("job-{}-{job}", unix_millis()));
        fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    /// Borra restos de separaciones interrumpidas (la app se cerró a la fuerza, por ejemplo).
    pub fn clean_staging(&self) {
        let _ = fs::remove_dir_all(self.root.join(STAGING_DIR));
    }

    /// Mueve una separación terminada a la biblioteca con un nombre legible y único.
    pub fn commit(&self, staging: &Path, entry: &Entry) -> Result<LibraryItem, AppError> {
        let base = folder_name(&entry.title);
        let id = (1..)
            .map(|n| if n == 1 { base.clone() } else { format!("{base} ({n})") })
            .find(|candidate| !self.root.join(candidate).exists())
            .expect("siempre hay un nombre libre");
        let dir = self.root.join(&id);

        write_entry(staging, entry)?;
        fs::rename(staging, &dir)?;
        self.load(&id)
    }

    pub fn rename(&self, id: &str, title: &str) -> Result<LibraryItem, AppError> {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::Library("El título no puede estar vacío.".to_owned()));
        }
        let dir = self.dir_of(id)?;
        let mut entry = read_entry(&dir)?;
        entry.title = title.chars().take(200).collect();
        write_entry(&dir, &entry)?;
        self.load(id)
    }

    pub fn save_mix(&self, id: &str, mix: serde_json::Value) -> Result<(), AppError> {
        let dir = self.dir_of(id)?;
        let mut entry = read_entry(&dir)?;
        entry.mix = Some(mix);
        write_entry(&dir, &entry)
    }

    /// Envía la carpeta a la papelera; con `permanent`, la borra del disco.
    pub fn delete(&self, id: &str, permanent: bool) -> Result<(), AppError> {
        let dir = self.dir_of(id)?;
        if permanent {
            fs::remove_dir_all(&dir)?;
            return Ok(());
        }
        trash::delete(&dir).map_err(|err| {
            AppError::Library(format!("No se pudo mover «{id}» a la papelera: {err}"))
        })
    }

    fn load(&self, id: &str) -> Result<LibraryItem, AppError> {
        let dir = self.dir_of(id)?;
        let entry = read_entry(&dir)?;

        let files: Vec<StemFile> = entry
            .stems
            .iter()
            .map(|stem| StemFile {
                id: stem.clone(),
                path: dir.join(format!("{stem}.wav")).to_string_lossy().into_owned(),
            })
            .collect();
        let missing = files
            .iter()
            .filter(|file| !Path::new(&file.path).is_file())
            .map(|file| file.id.clone())
            .collect();
        let size_bytes = fs::read_dir(&dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter_map(|entry| entry.metadata().ok())
                    .filter(|meta| meta.is_file())
                    .map(|meta| meta.len())
                    .sum()
            })
            .unwrap_or(0);

        Ok(LibraryItem {
            id: id.to_owned(),
            dir: dir.to_string_lossy().into_owned(),
            entry,
            files,
            size_bytes,
            missing,
        })
    }

    /// `bass.wav` de una extracción, para transcribirlo. Falla si el `id` no es válido o
    /// si la extracción no tiene pista de bajo (o ya no está en el disco).
    pub fn bass_file(&self, id: &str) -> Result<PathBuf, AppError> {
        let dir = self.dir_of(id)?;
        let entry = read_entry(&dir)?;
        let path = dir.join("bass.wav");
        if !entry.stems.iter().any(|stem| stem == "bass") || !path.is_file() {
            return Err(AppError::Library(format!(
                "«{}» no tiene pista de bajo en el disco: no se puede abrir el modo práctica.",
                entry.title
            )));
        }
        Ok(path)
    }

    /// Carpeta de una extracción, rechazando cualquier `id` que no sea un nombre simple.
    fn dir_of(&self, id: &str) -> Result<PathBuf, AppError> {
        let mut components = Path::new(id).components();
        let valid = matches!(components.next(), Some(Component::Normal(_)))
            && components.next().is_none()
            && !id.starts_with('.');
        let dir = self.root.join(id);
        if !valid || !dir.join(ENTRY_FILE).is_file() {
            return Err(AppError::Library(format!("No existe la extracción «{id}» en la biblioteca.")));
        }
        Ok(dir)
    }
}

fn read_entry(dir: &Path) -> Result<Entry, AppError> {
    let text = fs::read_to_string(dir.join(ENTRY_FILE))?;
    Ok(serde_json::from_str(&text)?)
}

fn write_entry(dir: &Path, entry: &Entry) -> Result<(), AppError> {
    write_atomic(&dir.join(ENTRY_FILE), &serde_json::to_vec_pretty(entry)?)
}

/// Escritura atómica: primero un archivo temporal y luego un renombrado, para
/// que un corte a mitad nunca deje un JSON roto.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let mut temp = path.as_os_str().to_owned();
    temp.push(".tmp");
    fs::write(&temp, bytes)?;
    fs::rename(&temp, path)?;
    Ok(())
}

/// Notas de una transcripción anterior de `bass`, si siguen valiendo: misma versión
/// de formato y guardadas después de la última modificación de `bass.wav`.
pub fn read_bass_notes(bass: &Path) -> Option<Vec<NoteEvent>> {
    let cache = bass.with_file_name(BASS_NOTES_FILE);
    let saved_at = fs::metadata(&cache).and_then(|meta| meta.modified()).ok()?;
    let audio_at = fs::metadata(bass).and_then(|meta| meta.modified()).ok()?;
    if saved_at < audio_at {
        return None;
    }
    let saved: BassNotes = serde_json::from_slice(&fs::read(&cache).ok()?).ok()?;
    (saved.version == BASS_NOTES_VERSION).then_some(saved.notes)
}

/// Guarda las notas junto a `bass` para no volver a transcribirlo.
pub fn write_bass_notes(bass: &Path, notes: &[NoteEvent]) -> Result<(), AppError> {
    let saved = serde_json::json!({ "version": BASS_NOTES_VERSION, "notes": notes });
    write_atomic(&bass.with_file_name(BASS_NOTES_FILE), &serde_json::to_vec(&saved)?)
}

/// Nombre de carpeta válido en Windows, macOS y Linux a partir de un título.
pub fn folder_name(title: &str) -> String {
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];

    let cleaned: String = title
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .take(MAX_NAME_CHARS)
        .collect();
    // Windows no admite nombres que terminen en punto o espacio; el punto inicial los ocultaría.
    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace()).to_owned();
    if trimmed.is_empty() || RESERVED.contains(&trimmed.to_ascii_uppercase().as_str()) {
        "Canción".to_owned()
    } else {
        trimmed
    }
}

/// Título por defecto: el nombre del archivo sin extensión.
pub fn title_from_path(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().trim().to_owned())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "Canción".to_owned())
}

/// Duración de un WAV PCM leyendo solo su cabecera RIFF.
pub fn wav_duration(path: &Path) -> Option<f64> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 12];
    file.read_exact(&mut header).ok()?;
    if &header[0..4] != b"RIFF" || &header[8..12] != b"WAVE" {
        return None;
    }

    let mut byte_rate = None;
    loop {
        let mut chunk = [0u8; 8];
        file.read_exact(&mut chunk).ok()?;
        let size = u32::from_le_bytes(chunk[4..8].try_into().ok()?);
        match &chunk[0..4] {
            b"fmt " => {
                let mut fmt = vec![0u8; size as usize];
                file.read_exact(&mut fmt).ok()?;
                byte_rate = Some(u32::from_le_bytes(fmt.get(8..12)?.try_into().ok()?));
                if size % 2 == 1 {
                    file.seek(SeekFrom::Current(1)).ok()?;
                }
            }
            b"data" => {
                let rate = byte_rate.filter(|rate| *rate > 0)?;
                return Some(f64::from(size) / f64::from(rate));
            }
            // Los chunks tienen tamaño par: si es impar, hay un byte de relleno.
            _ => {
                file.seek(SeekFrom::Current(i64::from(size) + i64::from(size % 2))).ok()?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_library(name: &str) -> Library {
        let root = std::env::temp_dir().join(format!("audioextract-lib-{name}-{}", unix_millis()));
        fs::create_dir_all(&root).unwrap();
        Library::new(root)
    }

    fn sample_entry(title: &str) -> Entry {
        Entry {
            version: ENTRY_VERSION,
            title: title.to_owned(),
            source_name: format!("{title}.mp3"),
            created_at: unix_millis() as u64,
            duration_sec: 12.5,
            stems: vec!["vocals".into(), "other".into()],
            quality: Quality::Fast,
            models: vec!["htdemucs".into()],
            device: Some("cuda".into()),
            device_name: Some("RTX".into()),
            elapsed_ms: 1000,
            mix: None,
        }
    }

    fn staged(library: &Library) -> PathBuf {
        let staging = library.create_staging().unwrap();
        fs::write(staging.join("vocals.wav"), b"RIFF").unwrap();
        fs::write(staging.join("other.wav"), b"RIFF").unwrap();
        staging
    }

    #[test]
    fn commits_lists_renames_and_deletes() {
        let library = temp_library("crud");
        let first = library.commit(&staged(&library), &sample_entry("Canción: Live")).unwrap();
        let second = library.commit(&staged(&library), &sample_entry("Canción: Live")).unwrap();
        assert_eq!(first.id, "Canción_ Live");
        assert_eq!(second.id, "Canción_ Live (2)");
        assert!(first.missing.is_empty());
        assert_eq!(first.files[0].id, "vocals");
        assert!(first.size_bytes > 0);

        let items = library.list().unwrap();
        assert_eq!(items.len(), 2);

        let renamed = library.rename(&first.id, "  Otro título ").unwrap();
        assert_eq!(renamed.entry.title, "Otro título");
        assert_eq!(renamed.id, first.id);

        library.save_mix(&first.id, serde_json::json!({ "master": { "semitones": -2 } })).unwrap();
        assert_eq!(library.load(&first.id).unwrap().entry.mix.unwrap()["master"]["semitones"], -2);

        library.delete(&second.id, true).unwrap();
        assert_eq!(library.list().unwrap().len(), 1);
        let _ = fs::remove_dir_all(library.root());
    }

    #[test]
    fn finds_the_bass_track_and_caches_its_notes() {
        let library = temp_library("bass");
        let mut entry = sample_entry("Con bajo");
        entry.stems = vec!["vocals".into(), "bass".into(), "other".into()];
        let staging = staged(&library);
        fs::write(staging.join("bass.wav"), b"RIFF").unwrap();
        let item = library.commit(&staging, &entry).unwrap();
        let without = library.commit(&staged(&library), &sample_entry("Sin bajo")).unwrap();

        assert!(library.bass_file(&without.id).is_err());
        assert!(library.bass_file("../Con bajo").is_err());
        let bass = library.bass_file(&item.id).unwrap();
        assert!(read_bass_notes(&bass).is_none());

        let notes = vec![NoteEvent {
            note: "A1".into(),
            frequency: 55.0,
            start_time_ms: 0,
            end_time_ms: 250,
        }];
        write_bass_notes(&bass, &notes).unwrap();
        assert_eq!(read_bass_notes(&bass), Some(notes));
        assert_eq!(library.load(&item.id).unwrap().entry.stems.len(), 3);

        // Un bass.wav más reciente que las notas guardadas obliga a transcribir otra vez.
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(60);
        fs::File::options().write(true).open(&bass).unwrap().set_modified(later).unwrap();
        assert!(read_bass_notes(&bass).is_none());

        // Un formato de otra versión tampoco vale.
        fs::File::options()
            .write(true)
            .open(&bass)
            .unwrap()
            .set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(60))
            .unwrap();
        fs::write(bass.with_file_name(BASS_NOTES_FILE), br#"{"version":99,"notes":[]}"#).unwrap();
        assert!(read_bass_notes(&bass).is_none());
        let _ = fs::remove_dir_all(library.root());
    }

    #[test]
    fn rejects_ids_outside_the_library() {
        let library = temp_library("ids");
        for id in ["..", "../x", "a/b", ".staging", "", "C:\\Windows"] {
            assert!(library.load(id).is_err(), "{id} no debería ser válido");
        }
        let _ = fs::remove_dir_all(library.root());
    }

    #[test]
    fn makes_portable_folder_names() {
        assert_eq!(folder_name("AC/DC: Back in Black?"), "AC_DC_ Back in Black_");
        assert_eq!(folder_name("  .oculto. "), "oculto");
        assert_eq!(folder_name("con"), "Canción");
        assert_eq!(folder_name("???"), "___");
        assert_eq!(folder_name(""), "Canción");
        assert_eq!(folder_name(&"x".repeat(100)).chars().count(), MAX_NAME_CHARS);
    }

    #[test]
    fn reads_wav_duration_from_header() {
        let path = std::env::temp_dir().join(format!("audioextract-{}.wav", unix_millis()));
        let frames: u32 = 44_100 * 2;
        let data_size = frames * 4; // estéreo, 16 bits
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_size + 10).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        // Un chunk desconocido de tamaño impar (con byte de relleno) antes de «fmt ».
        bytes.extend_from_slice(b"LIST");
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&[0, 0]);
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&44_100u32.to_le_bytes());
        bytes.extend_from_slice(&(44_100u32 * 4).to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_size.to_le_bytes());
        bytes.resize(bytes.len() + data_size as usize, 0);
        fs::write(&path, bytes).unwrap();

        assert_eq!(wav_duration(&path), Some(2.0));
        let _ = fs::remove_file(path);
    }
}
