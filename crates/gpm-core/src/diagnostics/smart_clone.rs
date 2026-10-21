//! Clona con la credencial del perfil y deja el repo cubierto por una regla, sin alterar la URL remota.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use ts_rs::TS;

use crate::app_paths::AppPaths;
use crate::config::SshClientInfo;
use crate::config::generator::build_ssh_command;
use crate::diagnostics::repo::{DiagnosticReport, RepoDiagnostics};
use crate::git::runner::GitRun;
use crate::git::{GitRunner, GitUrl};
use crate::models::{AppState, CloneMethod, Profile, RuleType, blank};
use crate::process::{ProcessResult, describe};
use crate::rule_matcher;

/// Fase que se notifica justo antes de diagnosticar el repo recién clonado.
pub const PHASE_DIAGNOSE: &str = "__diagnose__";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum CoverageStatus {
    Covered,
    NotCovered,
    CoveredByOtherProfile,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CoverageResult {
    pub status: CoverageStatus,
    pub winner_id: Option<uuid::Uuid>,
    pub winner_name: Option<String>,
    /// Condición de la regla que cubrirá el repo (`gitdir/i:…` o `hasconfig:…`), si la hay.
    pub rule_condition: Option<String>,
    /// El perfil gana solo por ser el perfil por defecto.
    pub by_default: bool,
}

pub struct CloneRequest<'a> {
    pub url: GitUrl,
    pub method: CloneMethod,
    pub profile: &'a Profile,
    pub destination: String,
    pub write_local_identity: bool,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloneResult {
    pub success: bool,
    pub output: String,
    pub report: Option<DiagnosticReport>,
}

pub struct SmartCloneService<'a> {
    pub paths: &'a AppPaths,
    pub git: &'a GitRunner,
}

impl<'a> SmartCloneService<'a> {
    pub fn new(paths: &'a AppPaths, git: &'a GitRunner) -> Self {
        SmartCloneService { paths, git }
    }

    pub fn check_coverage(&self, state: &AppState, profile: &Profile, destination: &str, url: &GitUrl) -> CoverageResult {
        let canonical = GitUrl::parse(&url.canonical()).unwrap_or_else(|| url.clone());
        let remotes = [canonical];
        let winner = rule_matcher::winner(self.paths, state, destination, &remotes);
        let rule = rule_matcher::winning_rule(self.paths, state, destination, &remotes);
        let condition = rule.and_then(|r| {
            let owner = state.profiles.iter().find(|p| p.rules.iter().any(|x| x.id == r.id))?;
            if r.kind == RuleType::Remote {
                rule_matcher::matching_condition(owner, r, &remotes[0])
            } else {
                crate::config::generator::conditions(owner, r).into_iter().next()
            }
        });
        let status = match winner {
            Some(w) if w.id == profile.id => CoverageStatus::Covered,
            None => CoverageStatus::NotCovered,
            Some(_) => CoverageStatus::CoveredByOtherProfile,
        };
        CoverageResult {
            status,
            winner_id: winner.map(|w| w.id),
            winner_name: winner.map(|w| w.display_name.clone()),
            by_default: winner.is_some() && rule.is_none(),
            rule_condition: condition,
        }
    }

    /// Carpeta destino propuesta: la primera carpeta de regla del perfil, si existe.
    pub fn suggest_parent_folder(&self, profile: &Profile) -> Option<String> {
        let mut folders: Vec<_> = profile.rules.iter().filter(|r| r.kind == RuleType::Folder).collect();
        folders.sort_by_key(|r| r.order);
        folders.first().map(|r| self.paths.expand_tilde(r.value.trim()))
    }

    pub fn build_clone_args(&self, req: &CloneRequest<'_>, ssh: &SshClientInfo) -> Vec<String> {
        let mut args = Vec::new();
        if req.method == CloneMethod::Ssh && !blank(&req.profile.ssh_key_path) {
            // BatchMode evita que ssh se quede esperando una passphrase sin terminal.
            let cmd = format!(
                "{} -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
                build_ssh_command(ssh, req.profile.ssh_key_path.as_deref().unwrap())
            );
            args.push("-c".into());
            args.push(format!("core.sshCommand={cmd}"));
        }
        // El usuario HTTPS del perfil es de su host: en otro host sería una cuenta que no existe allí,
        // así que se deja que GCM elija, como haría Git sin la app.
        if req.method == CloneMethod::Https
            && !blank(&req.profile.https_username)
            && crate::git::text::eq_ci(&req.url.host, &req.profile.host)
        {
            args.push("-c".into());
            args.push(format!(
                "credential.https://{}.username={}",
                req.url.host,
                req.profile.https_username.as_deref().unwrap()
            ));
        }
        args.extend(["clone".into(), "--".into(), req.url.to(req.method), req.destination.clone()]);
        args
    }

    pub fn preview(&self, req: &CloneRequest<'_>, ssh: &SshClientInfo) -> String {
        describe("git", &self.build_clone_args(req, ssh))
    }

    /// Clona informando del progreso (`0..=100`) que va escribiendo Git en stderr.
    pub fn clone(
        &self,
        req: &CloneRequest<'_>,
        ssh: &SshClientInfo,
        state: &AppState,
        mut on_progress: impl FnMut(u8, &str),
    ) -> CloneResult {
        let dest = Path::new(&req.destination);
        if dest.is_dir() && std::fs::read_dir(dest).map(|mut d| d.next().is_some()).unwrap_or(false) {
            return CloneResult {
                success: false,
                output: crate::tr!(
                    "La carpeta {} ya existe y no está vacía.",
                    "Folder {} already exists and isn't empty.",
                    req.destination
                ),
                report: None,
            };
        }
        let mut args = self.build_clone_args(req, ssh);
        // --progress fuerza el progreso aunque stderr no sea una terminal; no cambia el resultado.
        if let Some(i) = args.iter().position(|a| a == "clone") {
            args.insert(i + 1, "--progress".into());
        }
        let r: ProcessResult = self.git.run_streaming(
            args,
            GitRun {
                env: vec![("GIT_TERMINAL_PROMPT".into(), Some("0".into()))],
                timeout: Some(Duration::from_secs(30 * 60)),
                ..Default::default()
            },
            |chunk| {
                if let Some((pct, phase)) = parse_progress(chunk) {
                    on_progress(pct, &phase);
                }
            },
        );
        if !r.success() {
            return CloneResult { success: false, output: r.combined(), report: None };
        }

        if req.write_local_identity {
            let p = req.profile;
            let mut commands: Vec<Vec<String>> = vec![
                vec!["config".into(), "--local".into(), "user.name".into(), p.git_user_name.clone()],
                vec!["config".into(), "--local".into(), "user.email".into(), p.git_user_email.clone()],
            ];
            if let Some(key) = p.ssh_key_path.as_deref().filter(|k| !k.trim().is_empty()) {
                commands.push(vec!["config".into(), "--local".into(), "core.sshCommand".into(), build_ssh_command(ssh, key)]);
            }
            if let Some(user) = p.https_username.as_deref().filter(|u| !u.trim().is_empty()) {
                commands.push(vec![
                    "config".into(),
                    "--local".into(),
                    format!("credential.https://{}.username", p.host),
                    user.into(),
                ]);
            }
            for c in commands {
                self.git.run_with(c, GitRun { cwd: Some(dest), ..Default::default() });
            }
        }

        on_progress(100, PHASE_DIAGNOSE);
        let report = RepoDiagnostics::new(self.paths, self.git).analyze(&req.destination, state).ok();
        CloneResult { success: true, output: r.combined(), report }
    }
}

/// Último `Fase: NN%` de un fragmento de stderr de `git clone --progress`, ponderado por fase.
fn parse_progress(chunk: &str) -> Option<(u8, String)> {
    let mut last = None;
    for part in chunk.split(['\r', '\n']) {
        let part = part.trim().trim_start_matches("remote: ");
        let Some((phase, rest)) = part.split_once(':') else { continue };
        let Some(pct) = rest.trim().split('%').next().and_then(|n| n.trim().parse::<u32>().ok()) else { continue };
        let (base, span) = match phase.trim() {
            "Enumerating objects" | "Counting objects" | "Compressing objects" => (0, 10),
            "Receiving objects" => (10, 70),
            "Resolving deltas" => (80, 15),
            "Updating files" => (95, 5),
            _ => continue,
        };
        last = Some(((base + span * pct.min(100) / 100) as u8, phase.trim().to_string()));
    }
    last
}
