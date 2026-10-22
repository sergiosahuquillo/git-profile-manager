//! Versiones nuevas de Git for Windows: consulta, descarga verificada e instalación silenciosa.
//!
//! La app se actualiza a sí misma con el plugin de Tauri; aquí solo está lo que Tauri no cubre.

pub mod git;
#[cfg(windows)]
mod win;

use std::time::Duration;

use crate::{Error, tr};

fn user_agent() -> String {
    format!("GitProfileManager/{}", env!("CARGO_PKG_VERSION"))
}

/// Cliente HTTP. `total`: tope para la petición entera (la API); las descargas no lo llevan.
fn agent(total: Option<Duration>) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_global(total)
        .user_agent(user_agent())
        .build()
        .into()
}

fn net_error(e: ureq::Error) -> Error {
    Error::msg(tr!("No se pudo consultar GitHub: {}", "Couldn't reach GitHub: {}", e))
}

/// Overrides para probar a mano (solo en compilaciones de desarrollo).
fn dev_override(var: &str) -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var(var).ok().filter(|v| !v.trim().is_empty())
}
