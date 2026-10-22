use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::config::SshClientInfo;
use crate::credentials::{CredentialService, GcmStatus};
use crate::git::GitRunner;
use crate::git::runner::{MINIMUM_VERSION, format_version};
use crate::git::text::contains_ci;
use crate::ssh::{AgentState, SshManager};
use crate::workspace::Workspace;
use crate::tr;

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EnvironmentReport {
    pub git_path: Option<String>,
    pub git_version: Option<String>,
    pub git_ok: bool,
    pub gcm: GcmStatus,
    /// GCM es el que trae Git for Windows: se actualiza con él.
    pub gcm_bundled: bool,
    /// Instalar una versión nueva de Git va a mostrar el diálogo de UAC.
    pub git_update_prompts_uac: bool,
    pub windows_open_ssh_available: bool,
    pub git_bundled_ssh_available: bool,
    pub agent_state: AgentState,
    pub global_config_path: String,
    pub global_user_name: Option<String>,
    pub global_user_email: Option<String>,
    pub blocking_error: Option<String>,
    pub app_data_dir: String,
}

pub fn check(ws: &Workspace) -> EnvironmentReport {
    let git: &GitRunner = &ws.git;
    let available = git.is_available();
    let version = if available { git.version() } else { None };
    let gcm = if available {
        CredentialService::new(git).gcm_status()
    } else {
        GcmStatus { version: None, configured_as_helper: false, helpers: Vec::new(), installed: false }
    };
    let root = git.install_root();
    let blocking_error = if !available {
        Some(tr!(
            "No se encuentra Git. Instala Git for Windows 2.36 o posterior.",
            "Git not found. Install Git for Windows 2.36 or later."
        ))
    } else {
        match version {
            None => Some(tr!("No se pudo obtener la versión de Git.", "Couldn't get the Git version.")),
            Some(v) if v < MINIMUM_VERSION => Some(tr!(
                "Git {} es anterior a 2.36: no soporta includeIf hasconfig. Actualiza Git for Windows.",
                "Git {} is older than 2.36: it doesn't support includeIf hasconfig. Update Git for Windows.",
                format_version(v)
            )),
            _ => None,
        }
    };
    EnvironmentReport {
        git_path: git.git_path.as_ref().map(|p| p.to_string_lossy().into_owned()),
        git_version: version.map(format_version),
        git_ok: version.is_some_and(|v| v >= MINIMUM_VERSION),
        gcm_bundled: root.as_ref().is_some_and(|r| gcm_in(r).is_file()),
        git_update_prompts_uac: available && crate::updates::git::install_target(git).prompts_uac,
        gcm,
        windows_open_ssh_available: Path::new(&SshClientInfo::windows_openssh().native_ssh_path()).is_file(),
        git_bundled_ssh_available: root.as_ref().is_some_and(|r| r.join("usr").join("bin").join("ssh.exe").is_file()),
        agent_state: SshManager::new(&ws.paths).agent_state(),
        global_config_path: if available {
            git.global_config_path()
        } else {
            ws.paths.home.join(".gitconfig").to_string_lossy().into_owned()
        },
        global_user_name: if available { git.get_global("user.name") } else { None },
        global_user_email: if available { git.get_global("user.email") } else { None },
        blocking_error,
        app_data_dir: ws.paths.app_data_dir.to_string_lossy().into_owned(),
    }
}

/// `git-credential-manager.exe` dentro de una instalación de Git for Windows.
pub fn gcm_in(git_root: &Path) -> std::path::PathBuf {
    git_root.join("mingw64").join("bin").join("git-credential-manager.exe")
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SourceTreeFinding {
    pub setting: String,
    pub value: String,
    pub warning: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SourceTreeReport {
    pub found: bool,
    pub config_path: Option<String>,
    pub findings: Vec<SourceTreeFinding>,
    /// Ruta de `SourceTree.exe`, si está instalado.
    pub exe_path: Option<String>,
}

pub fn sourcetree_exe() -> Option<String> {
    let local = crate::app_paths::local_app_data().join("SourceTree").join("SourceTree.exe");
    if local.is_file() {
        return Some(local.to_string_lossy().into_owned());
    }
    let pf86 = std::env::var_os("ProgramFiles(x86)")?;
    let p = Path::new(&pf86).join("Atlassian").join("SourceTree").join("SourceTree.exe");
    p.is_file().then(|| p.to_string_lossy().into_owned())
}

fn find_user_configs(dir: &Path, out: &mut Vec<std::path::PathBuf>, depth: u32) {
    if depth > 6 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            find_user_configs(&p, out, depth + 1);
        } else if p.file_name().is_some_and(|n| n == "user.config") && contains_ci(&p.to_string_lossy(), "SourceTree") {
            out.push(p);
        }
    }
}

/// Lectura de mejor esfuerzo, solo lectura, del `user.config` de SourceTree. No modifica nada.
pub fn detect_sourcetree() -> SourceTreeReport {
    let exe_path = sourcetree_exe();
    let root = crate::app_paths::local_app_data().join("Atlassian");
    let not_found = |exe_path| SourceTreeReport { found: false, config_path: None, findings: Vec::new(), exe_path };
    if !root.is_dir() {
        return not_found(exe_path);
    }
    let mut configs = Vec::new();
    find_user_configs(&root, &mut configs, 0);
    configs.sort_by_key(|p| std::cmp::Reverse(std::fs::metadata(p).and_then(|m| m.modified()).ok()));
    let Some(config) = configs.into_iter().next() else { return not_found(exe_path) };

    let findings = crate::files::file_guard::read_or_null(&config.to_string_lossy())
        .map(|xml| findings_from_settings(&parse_settings(&xml)))
        .unwrap_or_default();
    SourceTreeReport { found: true, config_path: Some(config.to_string_lossy().into_owned()), findings, exe_path }
}


/// Avisos a partir de los ajustes de SourceTree (`nombre`, `valor`).
pub fn findings_from_settings(settings: &[(String, String)]) -> Vec<SourceTreeFinding> {
    let mut findings = Vec::new();
    for (name, value) in settings {
        let lower = name.to_lowercase();
        if lower.contains("ssh") && lower.contains("client") {
            let warn = contains_ci(value, "putty") || contains_ci(value, "plink");
            findings.push(SourceTreeFinding {
                setting: name.clone(),
                value: value.clone(),
                warning: warn.then(|| {
                    tr!(
                        "SourceTree usa PuTTY/Plink: cambia a OpenSSH en Herramientas › Opciones › General › Cliente SSH.",
                        "SourceTree uses PuTTY/Plink: switch to OpenSSH in Tools › Options › General › SSH Client."
                    )
                }),
            });
        } else if lower == "autostartsshagent" {
            // Con OpenSSH, SourceTree arranca siempre el ssh-agent de Git Bash y lo pasa en SSH_AUTH_SOCK (la
            // casilla no se puede desmarcar). No es un problema: con OpenSSH de Windows, core.sshCommand y el
            // envoltorio de la firma fijan el agente de Windows. Se muestra solo como información.
            findings.push(SourceTreeFinding { setting: name.clone(), value: value.clone(), warning: None });
        } else if lower.contains("git")
            && (lower.contains("embedded") || lower.contains("system") || lower.contains("gitpath"))
        {
            let embedded = (lower.contains("embedded") && value.eq_ignore_ascii_case("true"))
                || (lower.contains("system") && value.eq_ignore_ascii_case("false"));
            findings.push(SourceTreeFinding {
                setting: name.clone(),
                value: value.clone(),
                warning: embedded.then(|| {
                    tr!(
                        "SourceTree usa Git embebido: elige «Git del sistema» en Herramientas › Opciones › Git.",
                        "SourceTree uses embedded Git: choose “System Git” in Tools › Options › Git."
                    )
                }),
            });
        }
    }
    findings
}

/// Pares `<setting name="…"><value>…</value></setting>` de un `user.config` de .NET.
fn parse_settings(xml: &str) -> Vec<(String, String)> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut out = Vec::new();
    let mut current: Option<String> = None;
    let mut in_value = false;
    let mut value = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.name().as_ref() == b"setting" => {
                current = e
                    .attributes()
                    .flatten()
                    .find(|a| a.key.as_ref() == b"name")
                    .map(|a| String::from_utf8_lossy(&a.value).into_owned());
            }
            Ok(Event::Start(e)) if e.name().as_ref() == b"value" && current.is_some() => {
                in_value = true;
                value.clear();
            }
            Ok(Event::Empty(e)) if e.name().as_ref() == b"value" => {
                if let Some(name) = current.clone() {
                    out.push((name, String::new()));
                }
            }
            Ok(Event::Text(t)) if in_value => {
                value.push_str(&t.unescape().map(|c| c.into_owned()).unwrap_or_default());
            }
            Ok(Event::End(e)) if e.name().as_ref() == b"value" && in_value => {
                in_value = false;
                if let Some(name) = current.clone() {
                    out.push((name, value.trim().to_string()));
                }
            }
            Ok(Event::End(e)) if e.name().as_ref() == b"setting" => current = None,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}
