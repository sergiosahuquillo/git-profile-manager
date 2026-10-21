//! Activa y desactiva la integración: una línea de inclusión en `~/.gitconfig` y otra en `~/.ssh/config`.

use serde::Serialize;
use ts_rs::TS;
use uuid::Uuid;

use crate::app_paths::{AppPaths, RULES_INCLUDE_VALUE, SSH_INCLUDE_LINE};
use crate::files::file_guard::{BackupReason, FileGuard, read_or_null, write_atomic};
use crate::files::text_diff::{self, DiffLine};
use crate::git::GitRunner;
use crate::models::{AppState, SavedIdentity};
use crate::{Error, Result};
use crate::tr;

/// Cambio previsto en un fichero del usuario, con contenido final exacto para la vista previa.
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UserFileChange {
    pub path: String,
    pub display_path: String,
    pub before: Option<String>,
    pub after: String,
    pub description: String,
    pub has_changes: bool,
    pub diff: Vec<DiffLine>,
}

impl UserFileChange {
    fn new(paths: &AppPaths, path: String, before: Option<String>, after: String, description: &str) -> Self {
        UserFileChange {
            display_path: paths.to_tilde_path(&path),
            has_changes: text_diff::has_changes(before.as_deref(), Some(&after)),
            diff: text_diff::lines(before.as_deref(), Some(&after)),
            path,
            before,
            after,
            description: description.into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IntegrationPlan {
    pub changes: Vec<UserFileChange>,
    pub identity_to_save: Option<SavedIdentity>,
    pub enable: bool,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IntegrationStatus {
    pub git_include: bool,
    pub ssh_include: bool,
}

pub struct IntegrationService<'a> {
    pub paths: &'a AppPaths,
    pub git: &'a GitRunner,
}

impl<'a> IntegrationService<'a> {
    pub fn new(paths: &'a AppPaths, git: &'a GitRunner) -> Self {
        IntegrationService { paths, git }
    }

    pub fn plan_enable(&self, state: &AppState, remove_global_identity: bool) -> Result<IntegrationPlan> {
        let mut changes = Vec::new();
        let global = self.git.global_config_path();
        let before = read_or_null(&global);
        let mut identity = None;
        let after = self.transform_git_config(before.as_deref(), |tmp| {
            let existing = self.git.run(&["config", "--file", tmp, "--get-all", "include.path"]);
            let already = existing.stdout.split('\n').any(|l| l.trim() == RULES_INCLUDE_VALUE);
            if !already {
                require(self.git.run(&["config", "--file", tmp, "--add", "include.path", RULES_INCLUDE_VALUE]))?;
            }
            if remove_global_identity {
                let name = self.git.run(&["config", "--file", tmp, "--get", "user.name"]);
                let email = self.git.run(&["config", "--file", tmp, "--get", "user.email"]);
                if name.success() || email.success() {
                    identity = Some(SavedIdentity {
                        name: name.success().then(|| name.stdout.trim().to_string()),
                        email: email.success().then(|| email.stdout.trim().to_string()),
                    });
                    if name.success() {
                        self.git.run(&["config", "--file", tmp, "--unset-all", "user.name"]);
                    }
                    if email.success() {
                        self.git.run(&["config", "--file", tmp, "--unset-all", "user.email"]);
                    }
                }
            }
            Ok(())
        })?;
        changes.push(UserFileChange::new(
            self.paths,
            global,
            before,
            after,
            &if remove_global_identity {
                tr!(
                    "Añadir la inclusión de reglas y retirar user.name/user.email globales",
                    "Add the rules include and remove the global user.name/user.email"
                )
            } else {
                tr!("Añadir la inclusión de reglas", "Add the rules include")
            },
        ));
        if state.settings.generate_ssh_aliases {
            let ssh_before = read_or_null(&self.paths.ssh_config());
            let ssh_after = add_ssh_include(ssh_before.as_deref());
            changes.push(UserFileChange::new(
                self.paths,
                self.paths.ssh_config(),
                ssh_before,
                ssh_after,
                &tr!("Añadir Include gitprofile.conf en la primera línea", "Add Include gitprofile.conf on the first line"),
            ));
        }
        Ok(IntegrationPlan { changes, identity_to_save: identity, enable: true })
    }

    pub fn plan_disable(&self, state: &AppState) -> Result<IntegrationPlan> {
        let mut changes = Vec::new();
        let global = self.git.global_config_path();
        let before = read_or_null(&global);
        let saved = state.saved_global_identity.clone();
        let after = self.transform_git_config(before.as_deref(), |tmp| {
            self.git.run(&["config", "--file", tmp, "--fixed-value", "--unset-all", "include.path", RULES_INCLUDE_VALUE]);
            if let Some(name) = saved.as_ref().and_then(|s| s.name.as_deref())
                && !self.git.run(&["config", "--file", tmp, "--get", "user.name"]).success()
            {
                require(self.git.run(&["config", "--file", tmp, "user.name", name]))?;
            }
            if let Some(email) = saved.as_ref().and_then(|s| s.email.as_deref())
                && !self.git.run(&["config", "--file", tmp, "--get", "user.email"]).success()
            {
                require(self.git.run(&["config", "--file", tmp, "user.email", email]))?;
            }
            Ok(())
        })?;
        changes.push(UserFileChange::new(
            self.paths,
            global,
            before,
            after,
            &if saved.is_none() {
                tr!("Quitar la inclusión de reglas", "Remove the rules include")
            } else {
                tr!(
                    "Quitar la inclusión de reglas y restaurar la identidad global guardada",
                    "Remove the rules include and restore the saved global identity"
                )
            },
        ));
        if let Some(ssh_before) = read_or_null(&self.paths.ssh_config()) {
            let ssh_after = remove_ssh_include(&ssh_before);
            changes.push(UserFileChange::new(
                self.paths,
                self.paths.ssh_config(),
                Some(ssh_before),
                ssh_after,
                &tr!("Quitar Include gitprofile.conf", "Remove Include gitprofile.conf"),
            ));
        }
        Ok(IntegrationPlan { changes, identity_to_save: None, enable: false })
    }

    /// Aplica un plan ya revisado: backup con fecha y escritura atómica de cada fichero.
    pub fn apply(&self, plan: &IntegrationPlan, state: &mut AppState) -> Result<()> {
        let changed: Vec<&UserFileChange> = plan.changes.iter().filter(|c| c.has_changes).collect();
        if !changed.is_empty() {
            let guard = FileGuard::new(self.paths, self.git);
            let files: Vec<String> = changed.iter().map(|c| c.path.clone()).collect();
            let reason = if plan.enable { BackupReason::EnableIntegration } else { BackupReason::DisableIntegration };
            guard.backup(&reason, &files)?;
        }
        for c in changed {
            write_atomic(&c.path, &c.after)?;
        }
        if plan.enable {
            if let Some(id) = &plan.identity_to_save {
                state.saved_global_identity = Some(id.clone());
            }
            state.integration_enabled = true;
        } else {
            state.saved_global_identity = None;
            state.integration_enabled = false;
        }
        Ok(())
    }

    /// Comprueba si las líneas de inclusión siguen presentes.
    pub fn status(&self) -> IntegrationStatus {
        let r = self.git.run(&["config", "--global", "--get-all", "include.path"]);
        let git_include = r.success() && r.stdout.split('\n').any(|l| l.trim() == RULES_INCLUDE_VALUE);
        let ssh_include = read_or_null(&self.paths.ssh_config())
            .and_then(|c| first_significant_line(&c))
            .is_some_and(|l| l.eq_ignore_ascii_case(SSH_INCLUDE_LINE));
        IntegrationStatus { git_include, ssh_include }
    }

    /// Ejecuta `git config --file` sobre una copia temporal y devuelve el resultado:
    /// la vista previa es exactamente lo que se escribirá, y Git se encarga del formato.
    fn transform_git_config(&self, content: Option<&str>, f: impl FnOnce(&str) -> Result<()>) -> Result<String> {
        let tmp = std::env::temp_dir().join(format!("gpm-{}.gitconfig", Uuid::new_v4().simple()));
        std::fs::write(&tmp, content.unwrap_or("").as_bytes())?;
        let tmp_s = tmp.to_string_lossy().into_owned();
        let result = f(&tmp_s).and_then(|_| read_or_null(&tmp_s).ok_or_else(|| Error::msg(tr!("No se pudo leer la copia temporal.", "Couldn't read the temporary copy."))));
        let _ = std::fs::remove_file(&tmp);
        result
    }
}

fn require(r: crate::process::ProcessResult) -> Result<()> {
    if r.success() { Ok(()) } else { Err(Error::msg(r.stderr.trim().to_string())) }
}

pub fn add_ssh_include(content: Option<&str>) -> String {
    let Some(content) = content else { return format!("{SSH_INCLUDE_LINE}\n") };
    let newline = if content.contains("\r\n") { "\r\n" } else { "\n" };
    format!("{SSH_INCLUDE_LINE}{newline}{}", remove_ssh_include(content))
}

pub fn remove_ssh_include(content: &str) -> String {
    let newline = if content.contains("\r\n") { "\r\n" } else { "\n" };
    content
        .replace("\r\n", "\n")
        .split('\n')
        .filter(|l| !l.trim().eq_ignore_ascii_case(SSH_INCLUDE_LINE))
        .collect::<Vec<_>>()
        .join(newline)
}

fn first_significant_line(content: &str) -> Option<String> {
    content.replace("\r\n", "\n").split('\n').map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#')).map(String::from)
}
