use serde::Serialize;
use ts_rs::TS;

/// Error que recibe el frontend: un mensaje listo para mostrar.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CmdError {
    pub message: String,
}

impl CmdError {
    pub fn new(message: impl Into<String>) -> Self {
        CmdError { message: message.into() }
    }
}

impl From<gpm_core::Error> for CmdError {
    fn from(e: gpm_core::Error) -> Self {
        CmdError::new(e.to_string())
    }
}

impl From<std::io::Error> for CmdError {
    fn from(e: std::io::Error) -> Self {
        CmdError::new(e.to_string())
    }
}

impl From<tauri::Error> for CmdError {
    fn from(e: tauri::Error) -> Self {
        CmdError::new(e.to_string())
    }
}

pub type CmdResult<T> = Result<T, CmdError>;
