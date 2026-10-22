use std::path::{Path, PathBuf};

/// Rutas que usa la app. En producción se derivan del entorno; los tests crean una instancia
/// sobre un HOME temporal y pasan [`AppPaths::child_env`] a cada proceso Git.
#[derive(Clone, Debug)]
pub struct AppPaths {
    pub home: PathBuf,
    pub app_data_dir: PathBuf,
    /// Variables de entorno extra para procesos hijos (HOME, GIT_CONFIG_GLOBAL...). `None` elimina la variable.
    pub child_env: Vec<(String, Option<String>)>,
}

/// Valor de `include.path` que se añade a `~/.gitconfig`.
pub const RULES_INCLUDE_VALUE: &str = "~/.gitprofiles/rules.gitconfig";
pub const SSH_INCLUDE_LINE: &str = "Include gitprofile.conf";

fn s(p: PathBuf) -> String {
    p.to_string_lossy().into_owned()
}

impl AppPaths {
    pub fn new(home: impl Into<PathBuf>, app_data_dir: impl Into<PathBuf>) -> Self {
        AppPaths { home: home.into(), app_data_dir: app_data_dir.into(), child_env: Vec::new() }
    }

    pub fn from_environment() -> Self {
        // Git para Windows usa HOME si está definido y, si no, USERPROFILE.
        let home = std::env::var("HOME")
            .ok()
            .filter(|h| !h.trim().is_empty() && Path::new(h).is_dir())
            .map(PathBuf::from)
            .unwrap_or_else(user_profile);
        // Override para desarrollo y pruebas manuales con un HOME aislado.
        let app_data = std::env::var("GITPROFILEMANAGER_APPDATA")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| roaming_app_data().join("GitProfileManager"));
        AppPaths::new(home, app_data)
    }

    pub fn profiles_json(&self) -> String {
        s(self.app_data_dir.join("profiles.json"))
    }
    pub fn backups_dir(&self) -> String {
        s(self.app_data_dir.join("backups"))
    }
    /// Último resultado de las pruebas SSH/HTTPS de cada perfil (ver `connection_status`).
    pub fn status_json(&self) -> String {
        s(self.app_data_dir.join("status.json"))
    }
    /// Instaladores descargados de Git for Windows. En `%LOCALAPPDATA%`: no deben viajar con el perfil móvil.
    pub fn updates_dir(&self) -> PathBuf {
        local_app_data().join("GitProfileManager").join("updates")
    }
    pub fn error_log(&self) -> String {
        s(self.app_data_dir.join("error.log"))
    }
    pub fn git_profiles_dir(&self) -> String {
        s(self.home.join(".gitprofiles"))
    }
    pub fn rules_file(&self) -> String {
        s(self.home.join(".gitprofiles").join("rules.gitconfig"))
    }
    /// Envoltorio de `ssh-keygen` para la firma SSH con OpenSSH de Windows (ver `generator::signing_wrapper`).
    pub fn signing_wrapper_file(&self) -> String {
        s(self.home.join(".gitprofiles").join("ssh-keygen.cmd"))
    }
    pub fn allowed_signers_file(&self) -> String {
        s(self.home.join(".gitprofiles").join("allowed_signers"))
    }
    pub fn ssh_dir(&self) -> String {
        s(self.home.join(".ssh"))
    }
    pub fn ssh_config(&self) -> String {
        s(self.home.join(".ssh").join("config"))
    }
    pub fn ssh_aliases_file(&self) -> String {
        s(self.home.join(".ssh").join("gitprofile.conf"))
    }
    pub fn profile_file(&self, slug: &str) -> String {
        s(self.home.join(".gitprofiles").join(format!("{slug}.gitconfig")))
    }

    /// Convierte una ruta absoluta a la forma `~/...` con barras `/` si está bajo HOME.
    pub fn to_tilde_path(&self, path: &str) -> String {
        let full = full_path(&self.expand_tilde(path));
        let home = full_path(&self.home.to_string_lossy());
        let home = home.trim_end_matches(['\\', '/']);
        let prefix = format!("{home}\\");
        if full.len() > prefix.len() && full[..prefix.len()].eq_ignore_ascii_case(&prefix) {
            return format!("~/{}", full[prefix.len()..].replace('\\', "/"));
        }
        full.replace('\\', "/")
    }

    /// Expande `~/` a HOME y devuelve una ruta nativa de Windows.
    pub fn expand_tilde(&self, path: &str) -> String {
        if path == "~" {
            return self.home.to_string_lossy().into_owned();
        }
        if path.starts_with("~/") || path.starts_with("~\\") {
            return s(self.home.join(path[2..].replace('/', "\\")));
        }
        path.replace('/', "\\")
    }
}

/// Equivalente a `Path.GetFullPath`: ruta absoluta normalizada (sin resolver enlaces).
pub fn full_path(p: &str) -> String {
    std::path::absolute(p).map(s).unwrap_or_else(|_| p.to_string())
}

fn user_profile() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\"))
}

fn roaming_app_data() -> PathBuf {
    std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| user_profile().join("AppData").join("Roaming"))
}

pub fn local_app_data() -> PathBuf {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| user_profile().join("AppData").join("Local"))
}
