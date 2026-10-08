mod commands;
mod engine;
mod error;
mod export;
mod library;
mod settings;

use std::fs;

use tauri::{Manager, RunEvent};

use crate::engine::{EngineState, SeparationState, TranscriptionState};
use crate::export::ExportState;
use crate::library::Library;
use crate::settings::Settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SeparationState::default())
        .manage(TranscriptionState::default())
        .manage(EngineState::default())
        .manage(ExportState::default())
        .setup(|app| {
            engine::init_app_dirs(app.path().resource_dir().ok(), app.path().app_local_data_dir().ok());
            let settings = Settings::load(app.handle())?;
            let library = Library::new(settings.library_dir());
            fs::create_dir_all(library.root())?;
            library.clean_staging();
            // El webview lee las pistas de la biblioteca a través del protocolo `asset:`.
            app.asset_protocol_scope().allow_directory(library.root(), true)?;
            app.manage(settings);

            // `--check` tarda unos segundos (arrancar el contenedor, inicializar CUDA):
            // se lanza ya para que el estado del motor esté listo al abrir la ventana.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                handle.state::<EngineState>().refresh(false);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::engine_status,
            commands::separate,
            commands::cancel_separation,
            commands::generate_bass_tab,
            commands::library_list,
            commands::library_rename,
            commands::library_delete,
            commands::library_save_mix,
            commands::library_choose_dir,
            commands::library_reset_dir,
            commands::library_open,
            commands::export_choose_folder,
            commands::export_choose_file,
            commands::export_write,
            commands::app_info,
        ])
        .build(tauri::generate_context!())
        .expect("error al inicializar AudioExtract");

    app.run(|handle, event| {
        // Si se cierra la app a mitad de una separación o transcripción, no dejamos el motor huérfano.
        if let RunEvent::Exit = event {
            handle.state::<SeparationState>().cancel();
            handle.state::<TranscriptionState>().cancel();
        }
    });
}
