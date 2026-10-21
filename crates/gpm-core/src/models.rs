//! Contenido de `profiles.json`: propiedades en PascalCase y enums como texto.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::i18n::Lang;

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[ts(export)]
pub enum GitProvider {
    #[default]
    GitHub,
    GitLab,
    Bitbucket,
    AzureDevOps,
    Other,
}

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[ts(export)]
pub enum SigningMode {
    #[default]
    None,
    Ssh,
    Gpg,
}

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[ts(export)]
pub enum CloneMethod {
    #[default]
    Ssh,
    Https,
}

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
#[ts(export)]
pub enum RuleType {
    #[default]
    Folder,
    Remote,
}

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[ts(export)]
pub enum SshClientKind {
    #[default]
    WindowsOpenSsh,
    GitBundled,
}

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[ts(export)]
pub enum NoProfileMode {
    #[default]
    DefaultProfile,
    Strict,
}

/// Identidad Git. Solo metadatos: nunca contiene secretos.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "PascalCase", default)]
#[ts(export)]
pub struct Profile {
    pub id: Uuid,
    pub display_name: String,
    pub slug: String,
    pub provider: GitProvider,
    pub host: String,
    pub git_user_name: String,
    pub git_user_email: String,
    /// Ruta a la clave privada, con `~/` y barras `/`.
    pub ssh_key_path: Option<String>,
    pub https_username: Option<String>,
    /// Repo del perfil con el que se da de alta y se comprueba la credencial HTTPS (`git ls-remote`).
    pub https_check_repo_url: Option<String>,
    pub signing: SigningMode,
    /// Ruta a la clave pública SSH (`.pub`) o ID de clave GPG.
    pub signing_key: Option<String>,
    pub rules: Vec<Rule>,
    pub is_default: bool,
    pub preferred_clone_method: CloneMethod,
}

impl Default for Profile {
    fn default() -> Self {
        Profile {
            id: Uuid::new_v4(),
            display_name: String::new(),
            slug: String::new(),
            provider: GitProvider::GitHub,
            host: "github.com".into(),
            git_user_name: String::new(),
            git_user_email: String::new(),
            ssh_key_path: None,
            https_username: None,
            https_check_repo_url: None,
            signing: SigningMode::None,
            signing_key: None,
            rules: Vec::new(),
            is_default: false,
            preferred_clone_method: CloneMethod::Ssh,
        }
    }
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "PascalCase", default)]
#[ts(export)]
pub struct Rule {
    pub id: Uuid,
    #[serde(rename = "Type")]
    pub kind: RuleType,
    /// Carpeta (regla de carpeta) u organización/grupo, p. ej. `empresa-a` o `grupo/sub` (regla de remoto).
    pub value: String,
    /// Host para reglas de remoto. Vacío = host del perfil.
    pub host: Option<String>,
    /// Orden global dentro de su tipo. Las carpetas se escriben siempre antes que los remotos.
    pub order: i32,
}

impl Default for Rule {
    fn default() -> Self {
        Rule { id: Uuid::new_v4(), kind: RuleType::Folder, value: String::new(), host: None, order: 0 }
    }
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "PascalCase", default)]
#[ts(export)]
pub struct AppSettings {
    pub ssh_client: SshClientKind,
    pub no_profile_mode: NoProfileMode,
    pub generate_ssh_aliases: bool,
    /// Idioma de la interfaz elegido en Ajustes. `None`: el del sistema.
    pub language: Option<Lang>,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            ssh_client: SshClientKind::WindowsOpenSsh,
            no_profile_mode: NoProfileMode::DefaultProfile,
            generate_ssh_aliases: true,
            language: None,
        }
    }
}

#[derive(Serialize, Deserialize, TS, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "PascalCase", default)]
#[ts(export)]
pub struct SavedIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// Contenido de `profiles.json`: fuente de verdad de la app.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "PascalCase", default)]
#[ts(export)]
pub struct AppState {
    pub schema_version: i32,
    pub profiles: Vec<Profile>,
    pub settings: AppSettings,
    /// SHA-256 de cada fichero generado, por ruta absoluta, para detectar deriva.
    /// Las rutas se comparan sin distinguir mayúsculas (ver [`AppState::hash_for`]).
    pub file_hashes: BTreeMap<String, String>,
    pub integration_enabled: bool,
    pub first_run_completed: bool,
    /// Identidad global retirada de `~/.gitconfig` al activar la integración, para restaurarla.
    pub saved_global_identity: Option<SavedIdentity>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            schema_version: 1,
            profiles: Vec::new(),
            settings: AppSettings::default(),
            file_hashes: BTreeMap::new(),
            integration_enabled: false,
            first_run_completed: false,
            saved_global_identity: None,
        }
    }
}

impl AppState {
    pub fn default_profile(&self) -> Option<&Profile> {
        self.profiles.iter().find(|p| p.is_default)
    }

    pub fn profile(&self, id: Uuid) -> Option<&Profile> {
        self.profiles.iter().find(|p| p.id == id)
    }

    fn hash_key(&self, path: &str) -> Option<String> {
        self.file_hashes.keys().find(|k| crate::git::text::eq_ci(k, path)).cloned()
    }

    pub fn hash_for(&self, path: &str) -> Option<&str> {
        self.hash_key(path).and_then(|k| self.file_hashes.get(&k)).map(String::as_str)
    }

    pub fn set_hash(&mut self, path: &str, hash: String) {
        let key = self.hash_key(path).unwrap_or_else(|| path.to_string());
        self.file_hashes.insert(key, hash);
    }

    pub fn remove_hash(&mut self, path: &str) {
        if let Some(k) = self.hash_key(path) {
            self.file_hashes.remove(&k);
        }
    }

    /// Siguiente `Order` para una regla nueva: el máximo global más uno.
    pub fn next_rule_order(&self) -> i32 {
        self.profiles.iter().flat_map(|p| &p.rules).map(|r| r.order).max().map_or(0, |m| m + 1)
    }
}

pub fn default_host(p: GitProvider) -> &'static str {
    match p {
        GitProvider::GitHub => "github.com",
        GitProvider::GitLab => "gitlab.com",
        GitProvider::Bitbucket => "bitbucket.org",
        GitProvider::AzureDevOps => AZURE_HOST,
        GitProvider::Other => "",
    }
}

pub fn ssh_keys_page(p: GitProvider, host: &str) -> Option<String> {
    match p {
        GitProvider::GitHub => Some(format!("https://{host}/settings/keys")),
        GitProvider::GitLab => Some(format!("https://{host}/-/user_settings/ssh_keys")),
        GitProvider::Bitbucket => Some("https://bitbucket.org/account/settings/ssh-keys/".into()),
        // La página de claves cuelga de una organización; sin ella, la portada lleva a «User settings».
        GitProvider::AzureDevOps => Some(format!("https://{AZURE_HOST}/")),
        GitProvider::Other => None,
    }
}

// ─── Azure DevOps ─────────────────────────────────────────────────────────
// Azure usa hosts y rutas distintos por método:
//   HTTPS  https://[org@]dev.azure.com/org/proyecto/_git/repo   (heredado: https://org.visualstudio.com/proyecto/_git/repo)
//   SSH    git@ssh.dev.azure.com:v3/org/proyecto/repo           (heredado: org@vs-ssh.visualstudio.com:v3/org/proyecto/repo)

/// Host HTTPS de Azure DevOps; es el que se guarda en el perfil.
pub const AZURE_HOST: &str = "dev.azure.com";
pub const AZURE_SSH_HOST: &str = "ssh.dev.azure.com";
pub const AZURE_LEGACY_SSH_HOST: &str = "vs-ssh.visualstudio.com";

pub fn is_azure_host(host: &str) -> bool {
    let h = host.trim().to_ascii_lowercase();
    h == AZURE_HOST || h == AZURE_SSH_HOST || h == AZURE_LEGACY_SSH_HOST || h.ends_with(".visualstudio.com")
}

pub fn is_azure(p: &Profile) -> bool {
    p.provider == GitProvider::AzureDevOps || is_azure_host(&p.host)
}

/// Host al que se conecta SSH: en Azure no coincide con el host HTTPS del perfil.
pub fn ssh_host(p: &Profile) -> String {
    if !is_azure(p) {
        return p.host.clone();
    }
    if p.host.trim().to_ascii_lowercase().ends_with(".visualstudio.com") {
        AZURE_LEGACY_SSH_HOST.into()
    } else {
        AZURE_SSH_HOST.into()
    }
}

/// `true` si la cadena opcional es `None` o solo espacios (como `string.IsNullOrWhiteSpace`).
pub fn blank(s: &Option<String>) -> bool {
    s.as_deref().is_none_or(|v| v.trim().is_empty())
}
