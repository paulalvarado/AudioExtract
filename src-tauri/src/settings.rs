//! Preferencias que necesita el backend: dónde está la biblioteca. Las de la
//! interfaz (instrumentos elegidos, formato de exportación…) viven en el frontend.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::engine::lock;
use crate::error::AppError;

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    library_dir: Option<PathBuf>,
}

pub struct Settings {
    file: PathBuf,
    default_library: PathBuf,
    stored: Mutex<Stored>,
}

impl Settings {
    /// Lee `settings.json` de la carpeta de configuración de la app; si no existe
    /// o está dañado, se usan los valores por defecto.
    pub fn load(app: &AppHandle) -> Result<Self, AppError> {
        let file = app.path().app_config_dir()?.join(SETTINGS_FILE);
        let stored = fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Ok(Self {
            file,
            default_library: default_library(app)?,
            stored: Mutex::new(stored),
        })
    }

    pub fn library_dir(&self) -> PathBuf {
        lock(&self.stored)
            .library_dir
            .clone()
            .unwrap_or_else(|| self.default_library.clone())
    }

    pub fn is_default_library(&self) -> bool {
        lock(&self.stored).library_dir.is_none()
    }

    /// `None` vuelve a la carpeta por defecto.
    pub fn set_library_dir(&self, dir: Option<PathBuf>) -> Result<(), AppError> {
        let mut stored = lock(&self.stored);
        stored.library_dir = dir.filter(|dir| *dir != self.default_library);
        if let Some(parent) = self.file.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.file, serde_json::to_vec_pretty(&*stored)?)?;
        Ok(())
    }
}

/// `Música/AudioExtract`: visible para el usuario y pensada para audio. Si el
/// sistema no tiene carpeta de música, Documentos; en último caso, los datos de la app.
fn default_library(app: &AppHandle) -> Result<PathBuf, AppError> {
    let paths = app.path();
    let base = paths
        .audio_dir()
        .or_else(|_| paths.document_dir())
        .or_else(|_| paths.app_local_data_dir())?;
    Ok(base.join("AudioExtract"))
}
