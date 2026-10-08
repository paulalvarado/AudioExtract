use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::engine::{
    self, EngineState, EngineStatus, NoteEvent, SeparationEvent, SeparationJob, SeparationRequest, SeparationState,
    TranscriptionState,
};
use crate::error::AppError;
use crate::export::{self, ExportState};
use crate::library::{self, Entry, Library, LibraryItem};
use crate::settings::Settings;

/// Ejecuta trabajo bloqueante (procesos, disco, diálogos) fuera del hilo principal.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, AppError> + Send + 'static) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| AppError::Internal(err.to_string()))?
}

fn current_library(app: &AppHandle) -> Library {
    Library::new(app.state::<Settings>().library_dir())
}

// --- Motor -------------------------------------------------------------------

/// Estado del motor (acelerador, modelos disponibles o qué impide separar).
/// Sin `refresh` devuelve el último resultado; la primera comprobación se lanza al arrancar.
#[tauri::command]
pub async fn engine_status(app: AppHandle, refresh: bool) -> Result<EngineStatus, AppError> {
    blocking(move || Ok(app.state::<EngineState>().refresh(refresh))).await
}

/// Separa `input_path` con los instrumentos y la calidad pedidos y guarda el
/// resultado en la biblioteca. El progreso llega por `on_event` mientras el motor trabaja.
#[tauri::command]
pub async fn separate(
    app: AppHandle,
    input_path: String,
    request: SeparationRequest,
    on_event: Channel<SeparationEvent>,
) -> Result<LibraryItem, AppError> {
    let started = Instant::now();
    let library = current_library(&app);
    let staging = library.create_staging()?;

    let handle = app.clone();
    let output_dir = staging.clone();
    let result = blocking(move || {
        let job = SeparationJob::new(&input_path, output_dir, &request)?;
        let output = engine::run(
            &handle.state::<SeparationState>(),
            &handle.state::<EngineState>(),
            &job,
            // Si la ventana ya no escucha, no hay nada que hacer con el evento.
            |event| {
                let _ = on_event.send(event);
            },
        )?;
        Ok((job, output))
    })
    .await;

    let committed = result.and_then(|(job, output)| {
        let duration_sec = output
            .stems
            .first()
            .and_then(|stem| library::wav_duration(&staging.join(format!("{stem}.wav"))))
            .unwrap_or(0.0);
        let entry = Entry {
            version: library::ENTRY_VERSION,
            title: library::title_from_path(&job.input),
            source_name: job
                .input
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            created_at: engine::unix_millis() as u64,
            duration_sec,
            stems: output.stems,
            quality: job.quality,
            models: output.models,
            device: output.device,
            device_name: output.device_name,
            elapsed_ms: started.elapsed().as_millis() as u64,
            mix: None,
        };
        library.commit(&staging, &entry)
    });

    if committed.is_err() {
        // No dejamos pistas a medias en la biblioteca.
        let _ = fs::remove_dir_all(&staging);
    }
    committed
}

/// Detiene la separación en curso. Devuelve `false` si no había ninguna.
#[tauri::command]
pub async fn cancel_separation(app: AppHandle) -> bool {
    // `docker kill` tarda un momento: fuera del hilo principal para no congelar la ventana.
    tauri::async_runtime::spawn_blocking(move || app.state::<SeparationState>().cancel())
        .await
        .unwrap_or(false)
}

/// Notas de la pista de bajo de la extracción `id`, para el modo práctica.
/// La primera vez las transcribe el motor a partir de su `bass.wav` (unos segundos);
/// después se leen de `bass.notes.json`, junto a la pista.
#[tauri::command]
pub async fn generate_bass_tab(app: AppHandle, id: String) -> Result<Vec<NoteEvent>, AppError> {
    blocking(move || {
        let bass = current_library(&app).bass_file(&id)?;
        if let Some(notes) = library::read_bass_notes(&bass) {
            return Ok(notes);
        }
        let notes = engine::transcribe(&app.state::<TranscriptionState>(), &bass)?;
        // Sin caché solo se pierde la rapidez de la próxima vez: no es motivo para fallar.
        let _ = library::write_bass_notes(&bass, &notes);
        Ok(notes)
    })
    .await
}

// --- Biblioteca --------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryListing {
    pub dir: String,
    pub is_default: bool,
    pub items: Vec<LibraryItem>,
}

fn listing(app: &AppHandle) -> Result<LibraryListing, AppError> {
    let settings = app.state::<Settings>();
    let library = Library::new(settings.library_dir());
    Ok(LibraryListing {
        dir: library.root().to_string_lossy().into_owned(),
        is_default: settings.is_default_library(),
        items: library.list()?,
    })
}

#[tauri::command]
pub async fn library_list(app: AppHandle) -> Result<LibraryListing, AppError> {
    blocking(move || listing(&app)).await
}

#[tauri::command]
pub async fn library_rename(app: AppHandle, id: String, title: String) -> Result<LibraryItem, AppError> {
    blocking(move || current_library(&app).rename(&id, &title)).await
}

/// Envía la extracción a la papelera; con `permanent`, la borra del disco.
#[tauri::command]
pub async fn library_delete(app: AppHandle, id: String, permanent: bool) -> Result<(), AppError> {
    blocking(move || current_library(&app).delete(&id, permanent)).await
}

/// Guarda el estado del mezclador (volúmenes, mute, solo, semitonos) de una extracción.
#[tauri::command]
pub async fn library_save_mix(app: AppHandle, id: String, mix: serde_json::Value) -> Result<(), AppError> {
    blocking(move || current_library(&app).save_mix(&id, mix)).await
}

/// Elige otra carpeta para la biblioteca. Las extracciones de la anterior se
/// quedan donde están (cada una es una carpeta autocontenida que se puede mover).
#[tauri::command]
pub async fn library_choose_dir(app: AppHandle) -> Result<Option<LibraryListing>, AppError> {
    blocking(move || {
        let current = app.state::<Settings>().library_dir();
        let Some(picked) = app
            .dialog()
            .file()
            .set_title("Carpeta de la biblioteca")
            .set_directory(current.parent().unwrap_or(&current))
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let dir = picked
            .into_path()
            .map_err(|err| AppError::Library(format!("Carpeta no válida: {err}")))?;
        use_library_dir(&app, Some(dir))?;
        listing(&app).map(Some)
    })
    .await
}

/// Vuelve a la carpeta por defecto (`Música/AudioExtract`).
#[tauri::command]
pub async fn library_reset_dir(app: AppHandle) -> Result<LibraryListing, AppError> {
    blocking(move || {
        use_library_dir(&app, None)?;
        listing(&app)
    })
    .await
}

/// Abre la carpeta de la biblioteca en el explorador de archivos.
#[tauri::command]
pub async fn library_open(app: AppHandle) -> Result<(), AppError> {
    let root = app.state::<Settings>().library_dir();
    fs::create_dir_all(&root)?;
    app.opener()
        .open_path(root.to_string_lossy(), None::<&str>)
        .map_err(|err| AppError::Library(format!("No se pudo abrir la carpeta: {err}")))
}

fn use_library_dir(app: &AppHandle, dir: Option<PathBuf>) -> Result<(), AppError> {
    let settings = app.state::<Settings>();
    settings.set_library_dir(dir)?;
    let root = settings.library_dir();
    fs::create_dir_all(&root)?;
    app.asset_protocol_scope().allow_directory(&root, true)?;
    Ok(())
}

// --- Exportación -------------------------------------------------------------

/// Pide una carpeta de destino. La exportación solo podrá escribir dentro de ella.
#[tauri::command]
pub async fn export_choose_folder(app: AppHandle) -> Result<Option<String>, AppError> {
    blocking(move || {
        let Some(picked) = app.dialog().file().set_title("Exportar pistas en…").blocking_pick_folder() else {
            return Ok(None);
        };
        let dir = picked
            .into_path()
            .map_err(|err| AppError::Export(format!("Carpeta no válida: {err}")))?;
        app.state::<ExportState>().allow_folder(dir.clone());
        Ok(Some(dir.to_string_lossy().into_owned()))
    })
    .await
}

/// Pide el archivo de destino de una mezcla (`extension`: `wav` o `mp3`).
#[tauri::command]
pub async fn export_choose_file(app: AppHandle, suggested_name: String, extension: String) -> Result<Option<String>, AppError> {
    if !export::EXPORT_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::Export(format!("Formato de exportación no válido: {extension}")));
    }
    blocking(move || {
        let label = if extension == "mp3" { "MP3" } else { "WAV" };
        let Some(picked) = app
            .dialog()
            .file()
            .set_title("Exportar mezcla")
            .set_file_name(format!("{suggested_name}.{extension}"))
            .add_filter(label, &[extension.as_str()])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let mut file = picked
            .into_path()
            .map_err(|err| AppError::Export(format!("Archivo no válido: {err}")))?;
        if file.extension().and_then(|ext| ext.to_str()).map(str::to_ascii_lowercase).as_deref() != Some(extension.as_str()) {
            file.set_extension(&extension);
        }
        app.state::<ExportState>().allow_file(file.clone());
        Ok(Some(file.to_string_lossy().into_owned()))
    })
    .await
}

/// Escribe un archivo exportado. Cuerpo: los bytes del audio. Cabecera
/// `x-export-path`: la ruta de destino con `encodeURIComponent`.
#[tauri::command]
pub async fn export_write(state: State<'_, ExportState>, request: Request<'_>) -> Result<(), AppError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Export("La exportación debe enviarse como datos binarios.".to_owned()));
    };
    let path = request
        .headers()
        .get("x-export-path")
        .and_then(|value| value.to_str().ok())
        .and_then(export::percent_decode)
        .ok_or_else(|| AppError::Export("Falta la ruta de destino de la exportación.".to_owned()))?;
    state.write(&PathBuf::from(path), bytes)
}

// --- Aplicación --------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    /// Si esta compilación trae clave pública y URL para buscar actualizaciones.
    pub updater: bool,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    let updater = app.config().plugins.0.get("updater").is_some_and(|config| {
        let has_key = config
            .get("pubkey")
            .and_then(|key| key.as_str())
            .is_some_and(|key| !key.trim().is_empty());
        let has_endpoint = config
            .get("endpoints")
            .and_then(|endpoints| endpoints.as_array())
            .is_some_and(|endpoints| !endpoints.is_empty());
        has_key && has_endpoint
    });
    AppInfo {
        version: app.package_info().version.to_string(),
        updater,
    }
}
