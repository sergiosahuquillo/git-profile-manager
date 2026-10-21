//! Escritura atómica, backups de ficheros del usuario y detección de deriva.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Local, NaiveDateTime};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;
use uuid::Uuid;

use crate::app_paths::AppPaths;
use crate::config::{GeneratedFile, GeneratedFileKind};
use crate::git::GitRunner;
use crate::models::AppState;
use crate::{Error, Result};
use crate::tr;

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DriftedFile {
    pub path: String,
    pub current_content: String,
    pub expected_hash: String,
}

/// Manifiesto de un backup (`manifest.json`). `Reason` guarda el código de [`BackupReason`].
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "PascalCase")]
#[ts(export)]
pub struct BackupSet {
    pub id: String,
    #[ts(type = "string")]
    pub created_at: NaiveDateTime,
    pub reason: String,
    pub entries: Vec<BackupEntry>,
    #[serde(default)]
    pub display: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "PascalCase")]
#[ts(export)]
pub struct BackupEntry {
    pub original_path: String,
    pub file_name: String,
    pub existed: bool,
}

/// Motivo de un backup. Se guarda como código estable y se traduce al mostrarlo.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BackupReason {
    EnableIntegration,
    DisableIntegration,
    /// Copia del estado actual antes de restaurar el backup indicado.
    BeforeRestore(String),
}

impl BackupReason {
    pub fn code(&self) -> String {
        match self {
            BackupReason::EnableIntegration => "enable-integration".into(),
            BackupReason::DisableIntegration => "disable-integration".into(),
            BackupReason::BeforeRestore(id) => format!("before-restore:{id}"),
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "enable-integration" => Some(BackupReason::EnableIntegration),
            "disable-integration" => Some(BackupReason::DisableIntegration),
            _ => code.strip_prefix("before-restore:").map(|id| BackupReason::BeforeRestore(id.to_string())),
        }
    }

    pub fn text(&self) -> String {
        match self {
            BackupReason::EnableIntegration => tr!("Activar integración", "Turn on integration"),
            BackupReason::DisableIntegration => tr!("Desactivar integración", "Turn off integration"),
            BackupReason::BeforeRestore(id) => tr!("Antes de restaurar {id}", "Before restoring {id}"),
        }
    }
}

fn display_of(created: &NaiveDateTime, reason: &str) -> String {
    let text = BackupReason::parse(reason).map_or_else(|| reason.to_string(), |r| r.text());
    format!("{} · {}", created.format("%Y-%m-%d %H:%M:%S"), text)
}

/// SHA-256 en hexadecimal MAYÚSCULAS del contenido con saltos de línea normalizados a LF.
pub fn hash(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n");
    hex::encode_upper(Sha256::digest(normalized.as_bytes()))
}

/// Lee un fichero como texto (sin BOM). `None` si no existe o no se puede leer.
pub fn read_or_null(path: &str) -> Option<String> {
    let p = Path::new(path);
    if !p.is_file() {
        return None;
    }
    let bytes = fs::read(p).ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    Some(text.strip_prefix('\u{feff}').map(String::from).unwrap_or(text))
}

/// Fichero temporal en el mismo directorio y reemplazo.
pub fn write_atomic(path: &str, content: &str) -> Result<()> {
    let p = Path::new(path);
    let dir = p.parent().ok_or_else(|| Error::msg(tr!("Ruta no válida: {path}", "Invalid path: {path}")))?;
    fs::create_dir_all(dir)?;
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.{}.tmp", Uuid::new_v4().simple()));
    fs::write(&tmp, content.as_bytes())?;
    if let Err(e) = replace_file(&tmp, p) {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    // fs::rename reemplaza el destino en Windows (MoveFileEx con REPLACE_EXISTING).
    fs::rename(from, to)
}

pub struct FileGuard<'a> {
    pub paths: &'a AppPaths,
    pub git: &'a GitRunner,
}

impl<'a> FileGuard<'a> {
    pub fn new(paths: &'a AppPaths, git: &'a GitRunner) -> Self {
        FileGuard { paths, git }
    }

    /// Ficheros generados cuyo contenido no coincide con el hash registrado.
    pub fn detect_drift(state: &AppState) -> Vec<DriftedFile> {
        let mut result = Vec::new();
        for (path, expected) in &state.file_hashes {
            let Some(current) = read_or_null(path) else { continue };
            if !hash(&current).eq_ignore_ascii_case(expected) {
                result.push(DriftedFile { path: path.clone(), current_content: current, expected_hash: expected.clone() });
            }
        }
        result
    }

    /// Escribe un fichero propio de la app de forma atómica y registra su hash.
    pub fn write_generated(&self, file: &GeneratedFile, state: &mut AppState) -> Result<()> {
        if file.kind == GeneratedFileKind::GitConfig {
            self.validate_git_config(&file.content)?;
        }
        write_atomic(&file.path, &file.content)?;
        state.set_hash(&file.path, hash(&file.content));
        Ok(())
    }

    /// Comprueba que Git puede leer el contenido antes de escribirlo.
    pub fn validate_git_config(&self, content: &str) -> Result<()> {
        let tmp = std::env::temp_dir().join(format!("gpm-{}.gitconfig", Uuid::new_v4().simple()));
        fs::write(&tmp, content.as_bytes())?;
        let tmp_s = tmp.to_string_lossy().into_owned();
        // --no-includes: las rutas relativas de include se resuelven respecto al fichero temporal.
        let r = self.git.run(&["config", "--file", &tmp_s, "--no-includes", "--list"]);
        let _ = fs::remove_file(&tmp);
        if !r.success() {
            return Err(Error::msg(tr!(
                "Git rechaza la configuración generada: {}",
                "Git rejects the generated configuration: {}",
                r.stderr.trim()
            )));
        }
        Ok(())
    }

    /// Copia con fecha de ficheros del usuario antes de modificarlos.
    pub fn backup(&self, reason: &BackupReason, files: &[String]) -> Result<BackupSet> {
        let created: DateTime<Local> = Local::now();
        let id = created.format("%Y%m%d-%H%M%S-%3f").to_string();
        let dir = Path::new(&self.paths.backups_dir()).join(&id);
        fs::create_dir_all(&dir)?;
        let mut entries = Vec::new();
        let mut seen: Vec<String> = Vec::new();
        for f in files {
            if seen.iter().any(|s| crate::git::text::eq_ci(s, f)) {
                continue;
            }
            seen.push(f.clone());
            let base = Path::new(f).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let name = format!("{:02}_{}", entries.len(), base.trim_start_matches('.'));
            let existed = Path::new(f).is_file();
            if existed {
                fs::copy(f, dir.join(&name))?;
            }
            entries.push(BackupEntry { original_path: f.clone(), file_name: name, existed });
        }
        let created_at = created.naive_local();
        let reason = reason.code();
        let display = display_of(&created_at, &reason);
        let set = BackupSet { id, created_at, reason, entries, display };
        fs::write(dir.join("manifest.json"), serde_json::to_string_pretty(&set)?)?;
        Ok(set)
    }

    pub fn list_backups(&self) -> Vec<BackupSet> {
        let dir = self.paths.backups_dir();
        let Ok(read) = fs::read_dir(&dir) else { return Vec::new() };
        let mut sets: Vec<BackupSet> = read
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| read_or_null(&e.path().join("manifest.json").to_string_lossy()))
            .filter_map(|json| serde_json::from_str::<BackupSet>(&json).ok())
            .map(|mut s| {
                s.display = display_of(&s.created_at, &s.reason);
                s
            })
            .collect();
        sets.sort_by_key(|s| std::cmp::Reverse(s.created_at));
        sets
    }

    pub fn find_backup(&self, id: &str) -> Result<BackupSet> {
        self.list_backups().into_iter().find(|s| s.id == id).ok_or_else(|| Error::msg(tr!("No existe el backup {id}.", "Backup {id} doesn't exist.")))
    }

    /// Contenido guardado de una entrada de backup.
    pub fn backup_content(&self, set: &BackupSet, entry: &BackupEntry) -> Option<String> {
        if !entry.existed {
            return None;
        }
        read_or_null(&Path::new(&self.paths.backups_dir()).join(&set.id).join(&entry.file_name).to_string_lossy())
    }

    /// Restaura un backup. Antes guarda el estado actual en otro backup.
    pub fn restore(&self, set: &BackupSet) -> Result<()> {
        let originals: Vec<String> = set.entries.iter().map(|e| e.original_path.clone()).collect();
        self.backup(&BackupReason::BeforeRestore(set.id.clone()), &originals)?;
        for e in &set.entries {
            if e.existed {
                let content = self.backup_content(set, e).unwrap_or_default();
                write_atomic(&e.original_path, &content)?;
            } else if Path::new(&e.original_path).is_file() {
                fs::remove_file(&e.original_path)?;
            }
        }
        Ok(())
    }
}
