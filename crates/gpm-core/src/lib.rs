//! Núcleo de GitProfile Manager, sin dependencias de UI.
//!
//! Lee y guarda `profiles.json`, genera la configuración estándar de Git y OpenSSH (`~/.gitprofiles`),
//! integra esa configuración en la del usuario y diagnostica qué identidad aplica Git en cada repo.

pub mod app_paths;
pub mod config;
pub mod connection_status;
pub mod credentials;
pub mod diagnostics;
pub mod environment;
pub mod error;
pub mod files;
pub mod git;
pub mod i18n;
pub mod integration;
pub mod models;
pub mod process;
pub mod profile_store;
pub mod profile_validator;
pub mod rule_matcher;
pub mod ssh;
pub mod updates;
pub mod workspace;

pub use app_paths::AppPaths;
pub use error::{Error, Result};
pub use workspace::Workspace;
