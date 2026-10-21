//! Último resultado de «Probar conexión» (SSH) y «Comprobar» (HTTPS) por perfil, para que el estado
//! sobreviva a un reinicio. Vive en `status.json`, aparte de `profiles.json`: es un estado volátil,
//! no la fuente de verdad, y no contiene secretos.
//!
//! Cada registro guarda un hash de lo que determina el resultado (host, clave, usuario…): si cambia,
//! el registro deja de valer y el perfil vuelve a «sin probar».

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::app_paths::AppPaths;
use crate::config::SshClientInfo;
use crate::credentials::CredentialCheckResult;
use crate::files::file_guard::{hash, read_or_null, write_atomic};
use crate::git::text::contains_ci;
use crate::models::{AppState, Profile, blank, ssh_host};
use crate::ssh::ConnectionTestResult;

/// Antigüedad a partir de la cual se vuelve a comprobar en segundo plano al arrancar.
pub const MAX_AGE_HOURS: i64 = 24;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum CheckKind {
    Ssh,
    Https,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CheckRecord {
    pub success: bool,
    pub account: Option<String>,
    pub message: String,
    /// RFC 3339 en UTC.
    pub checked_at: String,
    pub inputs_hash: String,
}

/// Estado de un perfil tal como lo ve la interfaz.
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProfileCheck {
    pub profile_id: Uuid,
    pub kind: CheckKind,
    pub record: CheckRecord,
    /// La última comprobación falló por la red: `record` es el último resultado válido, no el de ahora.
    pub offline: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct StatusStore {
    entries: BTreeMap<String, CheckRecord>,
}

fn key(id: Uuid, kind: CheckKind) -> String {
    format!("{id}:{}", match kind {
        CheckKind::Ssh => "ssh",
        CheckKind::Https => "https",
    })
}

/// Hash de las entradas que determinan el resultado. `None` si el perfil no tiene nada que comprobar.
pub fn inputs_hash(paths: &AppPaths, client: &SshClientInfo, p: &Profile, kind: CheckKind) -> Option<String> {
    match kind {
        CheckKind::Ssh => {
            let key_path = p.ssh_key_path.as_deref().filter(|k| !k.trim().is_empty())?;
            let public = read_or_null(&format!("{}.pub", paths.expand_tilde(key_path))).unwrap_or_default();
            Some(hash(&format!("ssh\n{}\n{key_path}\n{}\n{:?}", ssh_host(p), public.trim(), client.kind)))
        }
        CheckKind::Https => {
            if blank(&p.https_username) || blank(&p.https_check_repo_url) {
                return None;
            }
            Some(hash(&format!(
                "https\n{}\n{}\n{}",
                p.host.trim().to_lowercase(),
                p.https_username.as_deref().unwrap().trim(),
                p.https_check_repo_url.as_deref().unwrap().trim()
            )))
        }
    }
}

/// `true` si la salida indica que no hubo red (no que la credencial o la clave sean incorrectas).
pub fn is_network_error(output: &str) -> bool {
    [
        "Could not resolve host",
        "Could not resolve hostname",
        "Connection timed out",
        "Operation timed out",
        "Network is unreachable",
        "Connection refused",
        "Failed to connect",
        "No route to host",
        "Tiempo de espera agotado",
        "Timed out",
    ]
    .iter()
    .any(|needle| contains_ci(output, needle))
}

impl StatusStore {
    pub fn load(paths: &AppPaths) -> Self {
        read_or_null(&paths.status_json()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    pub fn save(&self, paths: &AppPaths) -> crate::Result<()> {
        let json = serde_json::to_string_pretty(self).map_err(|e| crate::Error::msg(e.to_string()))?;
        if let Some(dir) = std::path::Path::new(&paths.status_json()).parent() {
            std::fs::create_dir_all(dir)?;
        }
        write_atomic(&paths.status_json(), &json)
    }

    /// Registro vigente: existe y corresponde a las entradas actuales del perfil.
    pub fn valid(&self, paths: &AppPaths, client: &SshClientInfo, p: &Profile, kind: CheckKind) -> Option<&CheckRecord> {
        let current = inputs_hash(paths, client, p, kind)?;
        self.entries.get(&key(p.id, kind)).filter(|r| r.inputs_hash == current)
    }

    /// Guarda un resultado. Un fallo de red no pisa un éxito vigente: devuelve `offline = true` y conserva el OK.
    pub fn record(
        &mut self,
        paths: &AppPaths,
        client: &SshClientInfo,
        p: &Profile,
        kind: CheckKind,
        outcome: CheckOutcome,
        now: DateTime<Utc>,
    ) -> Option<ProfileCheck> {
        let inputs = inputs_hash(paths, client, p, kind)?;
        if outcome.network_error
            && let Some(prev) = self.valid(paths, client, p, kind).filter(|r| r.success)
        {
            return Some(ProfileCheck { profile_id: p.id, kind, record: prev.clone(), offline: true });
        }
        let record = CheckRecord {
            success: outcome.success,
            account: outcome.account,
            message: outcome.message,
            checked_at: now.to_rfc3339(),
            inputs_hash: inputs,
        };
        self.entries.insert(key(p.id, kind), record.clone());
        Some(ProfileCheck { profile_id: p.id, kind, record, offline: outcome.network_error })
    }

    /// Registros vigentes de los perfiles guardados.
    pub fn snapshot(&self, paths: &AppPaths, client: &SshClientInfo, state: &AppState) -> Vec<ProfileCheck> {
        let mut out = Vec::new();
        for p in &state.profiles {
            for kind in [CheckKind::Ssh, CheckKind::Https] {
                if let Some(r) = self.valid(paths, client, p, kind) {
                    out.push(ProfileCheck { profile_id: p.id, kind, record: r.clone(), offline: false });
                }
            }
        }
        out
    }

    /// Comprobaciones pendientes: perfiles con algo que comprobar cuyo registro falta, no corresponde a la
    /// configuración actual o tiene más de `max_age`.
    pub fn stale<'a>(
        &self,
        paths: &AppPaths,
        client: &SshClientInfo,
        state: &'a AppState,
        max_age: Duration,
        now: DateTime<Utc>,
    ) -> Vec<(&'a Profile, CheckKind)> {
        let mut out = Vec::new();
        for p in &state.profiles {
            for kind in [CheckKind::Ssh, CheckKind::Https] {
                if inputs_hash(paths, client, p, kind).is_none() {
                    continue;
                }
                let fresh = self.valid(paths, client, p, kind).is_some_and(|r| {
                    DateTime::parse_from_rfc3339(&r.checked_at).is_ok_and(|t| now - t.with_timezone(&Utc) < max_age)
                });
                if !fresh {
                    out.push((p, kind));
                }
            }
        }
        out
    }

    /// Olvida los registros de perfiles que ya no existen.
    pub fn prune(&mut self, state: &AppState) {
        self.entries.retain(|k, _| state.profiles.iter().any(|p| k.starts_with(&p.id.to_string())));
    }
}

/// Resultado de una comprobación, venga de SSH o de HTTPS.
#[derive(Clone, Debug)]
pub struct CheckOutcome {
    pub success: bool,
    pub account: Option<String>,
    pub message: String,
    pub network_error: bool,
}

impl From<&ConnectionTestResult> for CheckOutcome {
    fn from(r: &ConnectionTestResult) -> Self {
        CheckOutcome {
            success: r.success,
            account: r.account.clone(),
            message: r.hint.clone().unwrap_or_else(|| r.output.trim().to_string()),
            network_error: r.network_error,
        }
    }
}

impl From<&CredentialCheckResult> for CheckOutcome {
    fn from(r: &CredentialCheckResult) -> Self {
        CheckOutcome { success: r.valid, account: None, message: r.message.clone(), network_error: r.network_error }
    }
}
