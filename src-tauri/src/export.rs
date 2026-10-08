//! Escritura de exportaciones.
//!
//! El frontend renderiza y codifica el audio con la misma cadena que usa para
//! reproducirlo (así se exporta exactamente lo que se oye) y envía los bytes
//! aquí. Solo se escribe dentro de un destino que el usuario haya elegido en un
//! diálogo durante esta sesión, y nunca un archivo que no sea de audio.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use crate::engine::lock;
use crate::error::AppError;

pub const EXPORT_EXTENSIONS: &[&str] = &["wav", "mp3"];

#[derive(Debug, Clone, PartialEq)]
enum Target {
    /// Carpeta elegida: se puede escribir dentro (también en subcarpetas).
    Folder(PathBuf),
    /// Archivo elegido en un diálogo de guardar.
    File(PathBuf),
}

#[derive(Default)]
pub struct ExportState {
    targets: Mutex<Vec<Target>>,
}

impl ExportState {
    pub fn allow_folder(&self, dir: PathBuf) {
        self.allow(Target::Folder(dir));
    }

    pub fn allow_file(&self, file: PathBuf) {
        self.allow(Target::File(file));
    }

    fn allow(&self, target: Target) {
        let mut targets = lock(&self.targets);
        if !targets.contains(&target) {
            targets.push(target);
        }
    }

    fn is_allowed(&self, path: &Path) -> bool {
        lock(&self.targets).iter().any(|target| match target {
            Target::Folder(dir) => path.starts_with(dir) && path != dir,
            Target::File(file) => path == file,
        })
    }

    /// Escribe `bytes` en `path` a través de un archivo temporal, para que una
    /// exportación interrumpida no deje un archivo de audio a medias.
    pub fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), AppError> {
        let clean = path.is_absolute()
            && !path
                .components()
                .any(|component| matches!(component, Component::ParentDir | Component::CurDir));
        if !clean {
            return Err(AppError::Export(format!("Ruta de exportación no válida: {}", path.display())));
        }
        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        if !EXPORT_EXTENSIONS.contains(&extension.as_str()) {
            return Err(AppError::Export(format!(
                "Solo se exportan archivos {}.",
                EXPORT_EXTENSIONS.join(" o ")
            )));
        }
        if !self.is_allowed(path) {
            return Err(AppError::Export(
                "Elige de nuevo el destino: la exportación solo puede escribir donde lo hayas indicado.".to_owned(),
            ));
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let temp = path.with_extension(format!("{extension}.part"));
        fs::write(&temp, bytes)?;
        fs::rename(&temp, path).inspect_err(|_| {
            let _ = fs::remove_file(&temp);
        })?;
        Ok(())
    }
}

/// Decodifica una cabecera `encodeURIComponent` (las cabeceras HTTP solo admiten ASCII).
pub fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("audioextract-export-{name}-{}", crate::engine::unix_millis()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_only_inside_chosen_targets() {
        let dir = temp_dir("targets");
        let state = ExportState::default();
        let inside = dir.join("Canción - pistas").join("Canción - Voces.wav");

        assert!(state.write(&inside, b"RIFF").is_err(), "sin destino elegido no se escribe");

        state.allow_folder(dir.clone());
        state.write(&inside, b"RIFF").unwrap();
        assert_eq!(fs::read(&inside).unwrap(), b"RIFF");
        assert!(!inside.with_extension("wav.part").exists());

        assert!(state.write(&dir.join("nota.txt"), b"x").is_err(), "solo audio");
        assert!(state.write(&dir.join("..").join("fuera.wav"), b"x").is_err(), "sin '..'");
        assert!(state.write(&std::env::temp_dir().join("fuera.wav"), b"x").is_err());

        let single = std::env::temp_dir().join(format!("audioextract-{}.mp3", crate::engine::unix_millis()));
        state.allow_file(single.clone());
        state.write(&single, b"ID3").unwrap();
        let _ = fs::remove_file(single);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn decodes_uri_components() {
        assert_eq!(
            percent_decode("C%3A%5CM%C3%BAsica%5CCanci%C3%B3n%20-%20Voces.wav").as_deref(),
            Some("C:\\Música\\Canción - Voces.wav")
        );
        assert!(percent_decode("%ZZ").is_none());
        assert!(percent_decode("%C3").is_none());
    }
}
