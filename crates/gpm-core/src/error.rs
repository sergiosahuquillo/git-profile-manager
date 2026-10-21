use std::fmt;

/// Error del núcleo. El mensaje está pensado para mostrarse tal cual al usuario.
#[derive(Debug)]
pub enum Error {
    Msg(String),
    Io(std::io::Error),
    Json(serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn msg(s: impl Into<String>) -> Self {
        Error::Msg(s.into())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Msg(s) => f.write_str(s),
            Error::Io(e) => write!(f, "{e}"),
            Error::Json(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Json(e)
    }
}

/// `bail!("...")` devuelve un `Error::Msg` formateado.
#[macro_export]
macro_rules! bail {
    ($($arg:tt)*) => { return Err($crate::Error::Msg(format!($($arg)*))) };
}
