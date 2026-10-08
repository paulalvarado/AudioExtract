use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("No se encontró el archivo: {0}")]
    InputNotFound(String),

    #[error("Formato no soportado: se aceptan {}", crate::engine::AUDIO_EXTENSIONS.join(", "))]
    UnsupportedFormat,

    #[error("Ya hay una separación en curso")]
    Busy,

    #[error("Ya se está transcribiendo el bajo de otra canción. Espera unos segundos y vuelve a intentarlo.")]
    TranscriptionBusy,

    #[error("No se pudo ejecutar «{program}»: {source}. {hint}")]
    Spawn {
        program: String,
        hint: &'static str,
        source: std::io::Error,
    },

    #[error("No se encontró el script de separación en {0}")]
    ScriptNotFound(String),

    /// Docker parado, imagen sin construir, GPU inaccesible, configuración inválida…
    #[error("{0}")]
    Environment(String),

    /// El motor integrado no está instalado o no está al día (ver `setup.rs`).
    #[error("{0}")]
    SetupNeeded(String),

    /// Falló la instalación del motor integrado.
    #[error("{0}")]
    Setup(String),

    #[error("Ya se está instalando el motor")]
    SetupBusy,

    /// El motor arrancó pero la separación falló.
    #[error("{0}")]
    Engine(String),

    #[error("Falta la pista «{0}» en la salida del motor")]
    MissingStem(String),

    #[error("Operación cancelada")]
    Cancelled,

    #[error("{0}")]
    Library(String),

    #[error("{0}")]
    Export(String),

    #[error("{0}")]
    Internal(String),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            Self::InputNotFound(_) | Self::UnsupportedFormat => "input",
            Self::Busy | Self::TranscriptionBusy | Self::SetupBusy => "busy",
            Self::Spawn { .. } | Self::ScriptNotFound(_) | Self::Environment(_) | Self::SetupNeeded(_) => "environment",
            Self::Setup(_) => "setup",
            Self::Engine(_) | Self::MissingStem(_) => "engine",
            Self::Cancelled => "cancelled",
            Self::Library(_) => "library",
            Self::Export(_) => "export",
            Self::Internal(_) | Self::Io(_) | Self::Json(_) | Self::Tauri(_) => "internal",
        }
    }
}

/// El frontend recibe `{ kind, message }` para poder distinguir, p. ej., una cancelación.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}
