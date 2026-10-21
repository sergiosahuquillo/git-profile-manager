//! Punto de entrada al núcleo: agrupa los servicios y el pipeline de guardado.

use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::app_paths::AppPaths;
use crate::config::{ConfigGenerator, GeneratedFile, GeneratedFileKind, SshClientInfo};
use crate::files::file_guard::{self, FileGuard, read_or_null};
use crate::files::text_diff::{self, DiffLine};
use crate::git::GitRunner;
use crate::models::AppState;
use crate::profile_store::ProfileStore;
use crate::profile_validator;
use crate::{Error, Result};
use crate::tr;

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PendingFile {
    pub path: String,
    /// Ruta con `~/` para mostrar.
    pub display_path: String,
    pub kind: GeneratedFileKind,
    pub content: String,
    pub current_content: Option<String>,
    pub drifted: bool,
    pub has_changes: bool,
    pub diff: Vec<DiffLine>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeletedFile {
    pub path: String,
    pub display_path: String,
    pub current_content: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SavePlan {
    pub files: Vec<PendingFile>,
    pub files_to_delete: Vec<DeletedFile>,
    pub errors: Vec<String>,
    pub can_save: bool,
    pub has_drift: bool,
    pub has_changes: bool,
}

pub struct Workspace {
    pub paths: AppPaths,
    pub git: GitRunner,
    pub state: AppState,
    /// Error al leer `profiles.json`, si lo hubo.
    pub load_error: Option<LoadError>,
}

/// `profiles.json` ilegible. El mensaje se compone al mostrarlo, ya en el idioma de la interfaz.
#[derive(Clone, Debug)]
pub struct LoadError {
    pub error: String,
    pub copy: String,
}

impl LoadError {
    pub fn message(&self) -> String {
        let LoadError { error, copy } = self;
        tr!("{error}\nSe guardó una copia en {copy}.", "{error}\nA copy was saved to {copy}.")
    }
}

impl Workspace {
    pub fn new(paths: AppPaths, git_path: Option<PathBuf>) -> Self {
        let git = GitRunner::new(&paths, git_path);
        let (state, load_error) = match ProfileStore::new(&paths).load() {
            Ok(s) => (s, None),
            Err(e) => {
                // profiles.json ilegible: se aparta una copia y se arranca vacío.
                let original = paths.profiles_json();
                let copy = format!("{original}.corrupt-{}", chrono::Local::now().format("%Y%m%d-%H%M%S"));
                let _ = std::fs::copy(&original, &copy);
                (AppState::default(), Some(LoadError { error: e.to_string(), copy }))
            }
        };
        Workspace { paths, git, state, load_error }
    }

    pub fn guard(&self) -> FileGuard<'_> {
        FileGuard::new(&self.paths, &self.git)
    }

    pub fn generator(&self) -> ConfigGenerator<'_> {
        ConfigGenerator::new(&self.paths)
    }

    pub fn ssh_client(&self) -> SshClientInfo {
        self.ssh_client_for(&self.state)
    }

    pub fn ssh_client_for(&self, state: &AppState) -> SshClientInfo {
        SshClientInfo::resolve(state.settings.ssh_client, self.git.install_root().as_deref())
    }

    pub fn plan_save(&self, draft: &AppState) -> SavePlan {
        let errors = profile_validator::validate(draft);
        let generated = self.generator().generate_all(draft, &self.ssh_client_for(draft));
        let files: Vec<PendingFile> = generated
            .iter()
            .map(|g| {
                let current = read_or_null(&g.path);
                let drifted = current.as_ref().is_some_and(|c| {
                    self.state.hash_for(&g.path).is_some_and(|h| !file_guard::hash(c).eq_ignore_ascii_case(h))
                });
                PendingFile {
                    display_path: self.paths.to_tilde_path(&g.path),
                    kind: g.kind,
                    has_changes: text_diff::has_changes(current.as_deref(), Some(&g.content)),
                    diff: text_diff::lines(current.as_deref(), Some(&g.content)),
                    path: g.path.clone(),
                    content: g.content.clone(),
                    current_content: current,
                    drifted,
                }
            })
            .collect();

        // Ficheros que generamos antes y ya no corresponden a ningún perfil (renombrados o eliminados).
        let files_to_delete: Vec<DeletedFile> = self
            .state
            .file_hashes
            .keys()
            .filter(|p| !generated.iter().any(|g| crate::git::text::eq_ci(&g.path, p)) && Path::new(p).is_file())
            .map(|p| DeletedFile {
                path: p.clone(),
                display_path: self.paths.to_tilde_path(p),
                current_content: read_or_null(p),
            })
            .collect();
        let has_drift = files.iter().any(|f| f.drifted);
        let has_changes = files.iter().any(|f| f.has_changes) || !files_to_delete.is_empty();
        SavePlan { can_save: errors.is_empty(), files, files_to_delete, errors, has_drift, has_changes }
    }

    /// Guarda el borrador: regenera los ficheros propios y actualiza `profiles.json`.
    /// Si hay deriva y no se confirma, no escribe nada.
    pub fn save(&mut self, draft: &AppState, overwrite_drifted: bool) -> Result<()> {
        let plan = self.plan_save(draft);
        if !plan.can_save {
            return Err(Error::msg(plan.errors.join("\n")));
        }
        if plan.has_drift && !overwrite_drifted {
            return Err(Error::msg(tr!(
                "Hay ficheros editados fuera de la app. Confirma antes de regenerarlos.",
                "Some files were edited outside the app. Confirm before regenerating them."
            )));
        }
        let mut next = draft.clone();
        next.file_hashes = self.state.file_hashes.clone();

        let guard = self.guard();
        // Validar todo antes de escribir nada.
        for f in plan.files.iter().filter(|f| f.kind == GeneratedFileKind::GitConfig) {
            guard.validate_git_config(&f.content)?;
        }
        for f in &plan.files {
            let file = GeneratedFile { path: f.path.clone(), content: f.content.clone(), kind: f.kind };
            guard.write_generated(&file, &mut next)?;
        }
        for d in &plan.files_to_delete {
            // Solo borramos ficheros propios sin ediciones externas (o confirmadas).
            if let Some(current) = read_or_null(&d.path) {
                let unchanged = next.hash_for(&d.path).is_some_and(|h| file_guard::hash(&current).eq_ignore_ascii_case(h));
                if overwrite_drifted || unchanged {
                    std::fs::remove_file(&d.path)?;
                }
            }
            next.remove_hash(&d.path);
        }
        ProfileStore::new(&self.paths).save(&next)?;
        self.state = next;
        Ok(())
    }

    /// Regenera los ficheros si su contenido ya no coincide con lo que genera esta versión (p. ej. tras una
    /// actualización de la app). Solo cuando no hay ediciones manuales. Devuelve los errores de validación
    /// que lo impiden, o una lista vacía.
    pub fn regenerate_if_outdated(&mut self) -> Result<Vec<String>> {
        if self.state.profiles.is_empty() {
            return Ok(Vec::new());
        }
        let plan = self.plan_save(&self.state);
        if !plan.can_save {
            return Ok(plan.errors);
        }
        if plan.has_drift || !plan.files.iter().any(|f| f.has_changes && f.current_content.is_some()) {
            return Ok(Vec::new());
        }
        let current = self.state.clone();
        self.save(&current, false)?;
        Ok(Vec::new())
    }

    /// Guarda cambios que no afectan a los ficheros generados (p. ej. hashes o banderas).
    pub fn save_state_only(&mut self, mutate: impl FnOnce(&mut AppState)) -> Result<()> {
        let mut next = self.state.clone();
        mutate(&mut next);
        ProfileStore::new(&self.paths).save(&next)?;
        self.state = next;
        Ok(())
    }

    pub fn reload(&mut self) -> Result<()> {
        self.state = ProfileStore::new(&self.paths).load()?;
        Ok(())
    }

    /// Ficheros generados que existen en disco.
    pub fn existing_generated_files(&self) -> Vec<String> {
        self.state.file_hashes.keys().filter(|p| Path::new(p).is_file()).cloned().collect()
    }

    /// Elimina los ficheros generados (desinstalación). Nunca toca claves SSH.
    pub fn delete_generated_files(&mut self) -> Result<()> {
        for path in self.state.file_hashes.keys() {
            if Path::new(path).is_file() {
                let _ = std::fs::remove_file(path);
            }
        }
        self.save_state_only(|s| s.file_hashes.clear())
    }
}
