use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;
use ts_rs::TS;

use crate::models::{AZURE_HOST, AZURE_LEGACY_SSH_HOST, AZURE_SSH_HOST, CloneMethod};

/// URL remota normalizada: host, ruta (organización/.../repo), usuario y método.
///
/// Las URLs de Azure DevOps se guardan en forma lógica: `host` es siempre `dev.azure.com` y `path` es
/// `org/proyecto/repo` (sin `v3/` ni `_git`), sea cual sea el método o la variante heredada de origen.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitUrl {
    pub method: CloneMethod,
    pub host: String,
    pub path: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    /// URL de Azure DevOps (`path` es `org/proyecto/repo`).
    pub azure: bool,
}

// git@github.com:org/repo.git  (el usuario puede ser distinto de git)
static SCP_LIKE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?<user>[A-Za-z0-9._-]+)@(?<host>[A-Za-z0-9.-]+):(?<path>[^:]+)$").unwrap());
static SSH_SCHEME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^ssh://(?:(?<user>[A-Za-z0-9._-]+)@)?(?<host>[A-Za-z0-9.-]+)(?::(?<port>\d+))?/(?<path>.+)$").unwrap()
});
static HTTP_SCHEME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^https?://(?:(?<user>[^@/:]+)(?::[^@/]*)?@)?(?<host>[A-Za-z0-9.-]+)(?::(?<port>\d+))?/(?<path>.+)$")
        .unwrap()
});
// `%` para nombres codificados (Azure: proyectos con espacios como `Mi%20Proyecto`).
static SAFE_PATH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._~/%-]+$").unwrap());

impl GitUrl {
    /// Organización o grupo (todo menos el último segmento). En Azure, solo la organización.
    pub fn org(&self) -> &str {
        if self.azure {
            return self.path.split('/').next().unwrap_or("");
        }
        self.path.rfind('/').map_or("", |i| &self.path[..i])
    }

    /// Nombre del repo, decodificado (`Mi%20Repo` → `Mi Repo`), para la carpeta de destino.
    pub fn repo(&self) -> String {
        let raw = self.path.rfind('/').map_or(self.path.as_str(), |i| &self.path[i + 1..]);
        percent_decode(raw)
    }

    pub fn to_ssh(&self) -> String {
        if self.azure {
            return format!("git@{AZURE_SSH_HOST}:v3/{}", self.path);
        }
        match self.port {
            None => format!("git@{}:{}.git", self.host, self.path),
            Some(p) => format!("ssh://git@{}:{}/{}.git", self.host, p, self.path),
        }
    }

    /// HTTPS canónica: sin usuario incrustado (GCM toma el usuario de la configuración).
    pub fn to_https(&self) -> String {
        if self.azure {
            return format!("https://{AZURE_HOST}/{}", azure_https_path(&self.path));
        }
        match self.port {
            Some(p) if self.method == CloneMethod::Https => format!("https://{}:{}/{}.git", self.host, p, self.path),
            _ => format!("https://{}/{}.git", self.host, self.path),
        }
    }

    pub fn to(&self, method: CloneMethod) -> String {
        match method {
            CloneMethod::Ssh => self.to_ssh(),
            CloneMethod::Https => self.to_https(),
        }
    }

    pub fn canonical(&self) -> String {
        self.to(self.method)
    }

    /// La URL tal como la vería Git en `remote.*.url` (con usuario y puerto), para evaluar `hasconfig`.
    pub fn literal(&self) -> String {
        match (self.method, self.azure) {
            (CloneMethod::Ssh, true) => {
                format!("{}@{AZURE_SSH_HOST}:v3/{}", self.user.as_deref().unwrap_or("git"), self.path)
            }
            (CloneMethod::Https, true) => {
                let user = self.user.as_deref().map(|u| format!("{u}@")).unwrap_or_default();
                format!("https://{user}{AZURE_HOST}/{}", azure_https_path(&self.path))
            }
            (CloneMethod::Ssh, false) => {
                let user = self.user.as_deref().unwrap_or("git");
                match self.port {
                    None => format!("{user}@{}:{}.git", self.host, self.path),
                    Some(p) => format!("ssh://{user}@{}:{}/{}.git", self.host, p, self.path),
                }
            }
            (CloneMethod::Https, false) => {
                let user = self.user.as_deref().map(|u| format!("{u}@")).unwrap_or_default();
                let port = self.port.map(|p| format!(":{p}")).unwrap_or_default();
                format!("https://{user}{}{port}/{}.git", self.host, self.path)
            }
        }
    }

    pub fn parse(input: &str) -> Option<GitUrl> {
        let s = input.trim();
        if s.is_empty() || s.chars().count() > 2048 || s.chars().any(char::is_control) || s.contains(' ') {
            return None;
        }
        let url = if let Some(m) = SCP_LIKE.captures(s).filter(|m| !m["path"].starts_with("//")) {
            GitUrl {
                method: CloneMethod::Ssh,
                host: m["host"].to_string(),
                path: clean_path(&m["path"]),
                user: Some(m["user"].to_string()),
                port: None,
                azure: false,
            }
        } else if let Some(m) = SSH_SCHEME.captures(s) {
            GitUrl {
                method: CloneMethod::Ssh,
                host: m["host"].to_string(),
                path: clean_path(&m["path"]),
                user: m.name("user").map(|u| u.as_str().to_string()).filter(|u| !u.is_empty()),
                port: m.name("port").and_then(|p| parse_port(p.as_str())),
                azure: false,
            }
        } else {
            let m = HTTP_SCHEME.captures(s)?;
            GitUrl {
                method: CloneMethod::Https,
                host: m["host"].to_string(),
                path: clean_path(&m["path"]),
                user: m.name("user").map(|u| u.as_str().to_string()).filter(|u| !u.is_empty()),
                port: m.name("port").and_then(|p| parse_port(p.as_str())),
                azure: false,
            }
        };
        let url = normalize_azure(url)?;
        if url.path.is_empty() || !SAFE_PATH.is_match(&url.path) || url.path.split('/').any(|seg| seg == "." || seg == "..")
        {
            return None;
        }
        Some(url)
    }

    pub fn parse_or_err(input: &str) -> crate::Result<GitUrl> {
        GitUrl::parse(input).ok_or_else(|| crate::Error::msg(crate::tr!("URL Git no válida: {input}", "Invalid Git URL: {input}")))
    }
}

/// Convierte cualquier variante de Azure DevOps a la forma lógica. `None` si es de Azure pero no es un repo.
fn normalize_azure(mut url: GitUrl) -> Option<GitUrl> {
    let host = url.host.to_ascii_lowercase();
    let segments: Vec<&str> = url.path.split('/').filter(|s| !s.is_empty()).collect();
    let logical = match (url.method, host.as_str()) {
        // git@ssh.dev.azure.com:v3/org/proyecto/repo  ·  org@vs-ssh.visualstudio.com:v3/org/proyecto/repo
        (CloneMethod::Ssh, h) if h == AZURE_SSH_HOST || h == AZURE_LEGACY_SSH_HOST => {
            if segments.len() != 4 || !segments[0].eq_ignore_ascii_case("v3") {
                return None;
            }
            url.user = Some("git".into());
            segments[1..].join("/")
        }
        // https://[org@]dev.azure.com/org/proyecto/_git/repo
        (CloneMethod::Https, AZURE_HOST) => {
            if segments.len() != 4 || segments[2] != "_git" {
                return None;
            }
            format!("{}/{}/{}", segments[0], segments[1], segments[3])
        }
        // https://org.visualstudio.com/[DefaultCollection/]proyecto/_git/repo
        (CloneMethod::Https, h) if h.ends_with(".visualstudio.com") => {
            let org = &url.host[..url.host.len() - ".visualstudio.com".len()];
            let rest: Vec<&str> = match segments.first() {
                Some(first) if first.eq_ignore_ascii_case("DefaultCollection") => segments[1..].to_vec(),
                _ => segments.clone(),
            };
            if rest.len() != 3 || rest[1] != "_git" || org.is_empty() {
                return None;
            }
            url.user = None;
            format!("{org}/{}/{}", rest[0], rest[2])
        }
        _ => return Some(url),
    };
    url.host = AZURE_HOST.into();
    url.path = logical;
    url.port = None;
    url.azure = true;
    Some(url)
}

/// `org/proyecto/repo` → `org/proyecto/_git/repo`.
fn azure_https_path(path: &str) -> String {
    match path.rsplit_once('/') {
        Some((org_project, repo)) => format!("{org_project}/_git/{repo}"),
        None => path.to_string(),
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() && bytes[i + 1].is_ascii_hexdigit() && bytes[i + 2].is_ascii_hexdigit()
        {
            let hex = [bytes[i + 1], bytes[i + 2]];
            out.push(u8::from_str_radix(std::str::from_utf8(&hex).unwrap_or("00"), 16).unwrap_or(b'?'));
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

/// Codifica los espacios como en las URLs que copia Azure (`Mi Proyecto` → `Mi%20Proyecto`).
pub fn encode_spaces(s: &str) -> String {
    s.replace(' ', "%20")
}

fn clean_path(p: &str) -> String {
    let mut p = p.trim_matches('/');
    if p.len() >= 4 && p[p.len() - 4..].eq_ignore_ascii_case(".git") {
        p = &p[..p.len() - 4];
    }
    p.trim_end_matches('/').to_string()
}

fn parse_port(s: &str) -> Option<u16> {
    s.parse::<u32>().ok().filter(|p| (1..65536).contains(p)).map(|p| p as u16)
}
