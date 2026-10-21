//! Explica qué identidad, clave y cuenta usará Git en un repo y de qué fichero sale cada valor;
//! después propone correcciones.

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::app_paths::{AppPaths, full_path};
use crate::config::generator::ssh_alias;
use crate::git::text::{eq_ci, lines, starts_with_ci, unquote_c};
use crate::git::{GitRunner, GitUrl};
use crate::models::{AZURE_SSH_HOST, AppState, CloneMethod, ssh_host};
use crate::process::describe;
use crate::rule_matcher;
use crate::{Error, Result};
use crate::tr;

pub const KEYS: [&str; 6] = ["user.name", "user.email", "core.sshCommand", "gpg.format", "user.signingkey", "commit.gpgsign"];
const LOCAL_OVERRIDE_KEYS: [&str; 3] = ["user.name", "user.email", "core.sshcommand"];

static ALIAS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(github|gitlab|bitbucket|azure)[-_][A-Za-z0-9_-]+$").unwrap());

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConfigOrigin {
    pub value: String,
    pub scope: String,
    pub origin: String,
}

impl ConfigOrigin {
    /// Ruta del fichero de origen, si el origen es un fichero.
    pub fn file_path(&self) -> Option<String> {
        self.origin.strip_prefix("file:").map(unquote_c)
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EffectiveValue {
    pub key: String,
    pub value: Option<String>,
    pub scope: Option<String>,
    pub origin: Option<String>,
    /// Origen para mostrar: `~/.gitprofiles/x.gitconfig`, `.git/config`…
    pub origin_display: Option<String>,
    pub profile_slug: Option<String>,
    pub all_origins: Vec<ConfigOrigin>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum ProblemSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum ProblemKind {
    NoProfile,
    NoSpecificRule,
    LocalOverride,
    NonCanonicalRemote,
    MultipleProfiles,
    MixedProfiles,
    ForeignEmailCommits,
    Submodule,
}

/// Corrección propuesta. Se muestra el comando exacto y se aplica solo tras confirmación.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FixAction {
    pub description: String,
    pub git_commands: Vec<Vec<String>>,
}

impl FixAction {
    pub fn preview(&self) -> Vec<String> {
        self.git_commands.iter().map(|a| describe("git", a)).collect()
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Problem {
    pub kind: ProblemKind,
    pub severity: ProblemSeverity,
    pub message: String,
    pub fix: Option<FixAction>,
    /// Comandos de la corrección tal como se muestran en la vista previa.
    pub fix_preview: Vec<String>,
    /// Ruta asociada (submódulo) para abrir su propio informe.
    pub target: Option<String>,
}

impl Problem {
    fn new(kind: ProblemKind, severity: ProblemSeverity, message: String) -> Self {
        Problem { kind, severity, message, fix: None, fix_preview: Vec::new(), target: None }
    }
    fn with_fix(mut self, fix: FixAction) -> Self {
        self.fix_preview = fix.preview();
        self.fix = Some(fix);
        self
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiagnosticReport {
    pub repo_path: String,
    pub values: Vec<EffectiveValue>,
    pub problems: Vec<Problem>,
    pub applied_profile_slug: Option<String>,
    pub submodules: Vec<DiagnosticReport>,
    pub is_healthy: bool,
}

struct RemoteUrl {
    key: String,
    name: String,
    url: String,
}

pub struct RepoDiagnostics<'a> {
    pub paths: &'a AppPaths,
    pub git: &'a GitRunner,
}

fn normalize_dir(dir: &str) -> String {
    full_path(dir).trim_end_matches(['\\', '/']).to_string()
}

/// Formato de `--show-scope --show-origin`: `scope\torigin\tvalue`.
pub fn parse_origins(output: &str) -> Vec<ConfigOrigin> {
    lines(output)
        .filter_map(|l| {
            let p: Vec<&str> = l.splitn(3, '\t').collect();
            (p.len() == 3).then(|| ConfigOrigin { value: p[2].into(), scope: p[0].into(), origin: p[1].into() })
        })
        .collect()
}

impl<'a> RepoDiagnostics<'a> {
    pub fn new(paths: &'a AppPaths, git: &'a GitRunner) -> Self {
        RepoDiagnostics { paths, git }
    }

    pub fn is_repo(&self, path: &str) -> bool {
        if !Path::new(path).is_dir() {
            return false;
        }
        let r = self.git.run_in(Path::new(path), &["rev-parse", "--is-inside-work-tree"]);
        r.success() && r.stdout.trim() == "true"
    }

    pub fn analyze(&self, repo_path: &str, state: &AppState) -> Result<DiagnosticReport> {
        self.analyze_depth(repo_path, state, true, 0)
    }

    fn slug_from_origin(&self, o: &ConfigOrigin, profile_dir: &str) -> Option<String> {
        let file = o.file_path()?;
        let expanded = full_path(&file.replace('/', "\\"));
        let dir = Path::new(&expanded).parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
        if !eq_ci(&normalize_dir(&dir), profile_dir) {
            return None;
        }
        let name = Path::new(&file).file_stem()?.to_string_lossy().into_owned();
        (name != "rules").then_some(name)
    }

    fn origin_display(&self, origin: &ConfigOrigin, repo_path: &str) -> String {
        let Some(file) = origin.file_path() else { return origin.origin.clone() };
        let full = full_path(&file.replace('/', "\\"));
        let repo = normalize_dir(repo_path);
        let prefix = format!("{repo}\\");
        if starts_with_ci(&full, &prefix) {
            return full[prefix.len()..].replace('\\', "/");
        }
        self.paths.to_tilde_path(&full)
    }

    fn make_value(&self, key: &str, origins: Vec<ConfigOrigin>, repo_path: &str) -> EffectiveValue {
        let profile_dir = normalize_dir(&self.paths.git_profiles_dir());
        let last = origins.last().cloned();
        EffectiveValue {
            key: key.to_string(),
            value: last.as_ref().map(|o| o.value.clone()),
            scope: last.as_ref().map(|o| o.scope.clone()),
            origin: last.as_ref().map(|o| o.origin.clone()),
            origin_display: last.as_ref().map(|o| self.origin_display(o, repo_path)),
            profile_slug: last.as_ref().and_then(|o| self.slug_from_origin(o, &profile_dir)),
            all_origins: origins,
        }
    }

    fn analyze_depth(&self, repo_path: &str, state: &AppState, recurse: bool, depth: u32) -> Result<DiagnosticReport> {
        if !self.is_repo(repo_path) {
            return Err(Error::msg(tr!("{repo_path} no es un repositorio Git.", "{repo_path} isn't a Git repository.")));
        }
        let repo = Path::new(repo_path);
        let mut values: Vec<EffectiveValue> = KEYS
            .iter()
            .map(|key| {
                // --get-all con orígenes: el último valor es el efectivo.
                let r = self.git.run_in(repo, &["config", "--show-origin", "--show-scope", "--get-all", key]);
                let origins = if r.success() { parse_origins(&r.stdout) } else { Vec::new() };
                self.make_value(key, origins, repo_path)
            })
            .collect();
        values.extend(self.credential_usernames(repo_path));

        let mut problems = Vec::new();
        let profile_dir = normalize_dir(&self.paths.git_profiles_dir());

        // Perfil aplicado: el último fichero de ~/.gitprofiles/ que aporta user.email
        // (aunque una clave local lo pise después; eso se informa aparte).
        let email = values.iter().find(|v| v.key == "user.email").cloned().expect("user.email");
        let applied: Option<String> =
            email.all_origins.iter().filter_map(|o| self.slug_from_origin(o, &profile_dir)).next_back();

        // 1. Ningún perfil aplicable.
        if values.iter().all(|v| v.all_origins.iter().all(|o| self.slug_from_origin(o, &profile_dir).is_none())) {
            problems.push(Problem::new(
                ProblemKind::NoProfile,
                ProblemSeverity::Error,
                tr!(
                    "Ningún valor procede de ~/.gitprofiles/: no se aplica ningún perfil. Crea una regla de carpeta u organización.",
                    "No value comes from ~/.gitprofiles/: no profile applies. Create a folder or organization rule."
                ),
            ));
        }

        let remotes = self.remote_urls(repo_path);

        // 1b. Solo se aplica el perfil por defecto: ninguna regla específica cubre el repo.
        if let (Some(applied_slug), Some(def)) = (&applied, state.default_profile())
            && applied_slug == &def.slug
        {
            let urls: Vec<GitUrl> = remotes.iter().filter_map(|r| GitUrl::parse(&r.url)).collect();
            if rule_matcher::winning_rule(self.paths, state, repo_path, &urls).is_none() {
                problems.push(Problem::new(
                    ProblemKind::NoSpecificRule,
                    ProblemSeverity::Info,
                    tr!(
                        "Ninguna regla específica cubre este repo: se aplica el perfil por defecto («{}»). Si es de otra identidad, commitearás con {}.",
                        "No specific rule covers this repo: the default profile (“{}”) applies. If it belongs to another identity, you'll commit as {}.",
                        def.display_name,
                        def.git_user_email
                    ),
                ));
            }
        }

        // 2. Configuración local que pisa el perfil.
        let local_keys: Vec<String> = values
            .iter()
            .filter(|v| {
                v.all_origins.iter().any(|o| o.scope == "local")
                    && (LOCAL_OVERRIDE_KEYS.iter().any(|k| eq_ci(k, &v.key)) || starts_with_ci(&v.key, "credential."))
            })
            .map(|v| v.key.clone())
            .collect();
        if !local_keys.is_empty() {
            problems.push(
                Problem::new(
                    ProblemKind::LocalOverride,
                    ProblemSeverity::Warning,
                    tr!(
                        "Configuración local que pisa el perfil: {}. SourceTree la escribe si se desactiva «Usar ajustes de usuario globales».",
                        "Local configuration overrides the profile: {}. SourceTree writes it when “Use global user settings” is turned off.",
                        local_keys.join(", ")
                    ),
                )
                .with_fix(FixAction {
                    description: tr!("Eliminar las claves locales", "Remove the local keys"),
                    git_commands: local_keys
                        .iter()
                        .map(|k| vec!["config".into(), "--local".into(), "--unset-all".into(), k.clone()])
                        .collect(),
                }),
            );
        }

        // 3. Remotos con alias SSH o usuario incrustado.
        for remote in &remotes {
            let Some((canonical, reason)) = canonicalize_remote(&remote.url, state) else { continue };
            let command = if remote.key.ends_with(".pushurl") {
                vec!["config".into(), "--local".into(), remote.key.clone(), canonical.clone()]
            } else {
                vec!["remote".into(), "set-url".into(), remote.name.clone(), canonical.clone()]
            };
            problems.push(
                Problem::new(
                    ProblemKind::NonCanonicalRemote,
                    ProblemSeverity::Warning,
                    tr!(
                        "{} = {} no es canónica ({reason}). Las reglas por remoto no coincidirán.",
                        "{} = {} isn't canonical ({reason}). Remote rules won't match.",
                        remote.key,
                        remote.url
                    ),
                )
                .with_fix(FixAction { description: tr!("Normalizar a {canonical}", "Normalize to {canonical}"), git_commands: vec![command] }),
            );
        }

        // 4. Varios perfiles coinciden.
        let mut profile_files: Vec<String> = Vec::new();
        for s in email.all_origins.iter().filter_map(|o| self.slug_from_origin(o, &profile_dir)) {
            if !profile_files.contains(&s) {
                profile_files.push(s);
            }
        }
        // El perfil por defecto se incluye sin condición en todos los repos: que coincida junto a una
        // regla es el funcionamiento normal, así que solo se avisa si coinciden reglas de varios perfiles.
        let default_slug = state.default_profile().map(|p| p.slug.as_str());
        let by_rules = profile_files.iter().filter(|s| Some(s.as_str()) != default_slug).count();
        if by_rules > 1 {
            problems.push(Problem::new(
                ProblemKind::MultipleProfiles,
                ProblemSeverity::Info,
                tr!(
                    "Coinciden varios perfiles ({}). Gana «{}» por ser la última regla aplicada.",
                    "Several profiles match ({}). “{}” wins because it's the last rule applied.",
                    profile_files.join(", "),
                    applied.clone().unwrap_or_default()
                ),
            ));
        }

        // 4b. Valores heredados de otro perfil: la identidad es de uno y la clave o la firma de otro.
        if let Some(applied) = &applied {
            // user.signingkey no se puede anular; solo importa si la firma está activa.
            let signing = values.iter().find(|v| v.key == "commit.gpgsign").and_then(|v| v.value.as_deref()) == Some("true");
            let mixed: Vec<&EffectiveValue> = values
                .iter()
                .filter(|v| v.profile_slug.as_ref().is_some_and(|s| s != applied))
                .filter(|v| signing || !eq_ci(&v.key, "user.signingkey"))
                .collect();
            if !mixed.is_empty() {
                problems.push(Problem::new(
                    ProblemKind::MixedProfiles,
                    ProblemSeverity::Warning,
                    tr!(
                        "La identidad es de «{applied}», pero {}. Guarda los perfiles de nuevo para regenerarlos (ahora cada perfil anula la clave SSH y la firma que no usa) o configura esos valores en «{applied}».",
                        "The identity is from “{applied}”, but {}. Save the profiles again to regenerate them (each profile now clears the SSH key and signing it doesn't use) or set those values in “{applied}”.",
                        mixed
                            .iter()
                            .map(|v| tr!(
                                "{} viene de «{}»",
                                "{} comes from “{}”",
                                v.key,
                                v.profile_slug.as_deref().unwrap_or("")
                            ))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                ));
            }
        }

        // 5. Commits locales sin publicar con email distinto del efectivo.
        if let Some(expected) = &email.value {
            for (branch, foreign) in self.foreign_email_commits(repo_path, expected) {
                problems.push(Problem::new(
                    ProblemKind::ForeignEmailCommits,
                    ProblemSeverity::Warning,
                    tr!(
                        "La rama {branch} tiene commits sin publicar con otro email: {}. Reescribir la historia queda fuera del alcance de la app.",
                        "Branch {branch} has unpublished commits with another email: {}. Rewriting history is outside the app's scope.",
                        foreign.join(", ")
                    ),
                ));
            }
        }

        // 6. Submódulos.
        let mut sub_reports = Vec::new();
        if recurse && depth < 3 {
            for sub in self.submodules(repo_path) {
                let sub_path = repo.join(sub.replace('/', "\\")).to_string_lossy().into_owned();
                if !Path::new(&sub_path).is_dir() || !self.is_repo(&sub_path) {
                    problems.push(Problem::new(
                        ProblemKind::Submodule,
                        ProblemSeverity::Info,
                        tr!("Submódulo {sub} sin inicializar.", "Submodule {sub} not initialized."),
                    ));
                    continue;
                }
                let report = self.analyze_depth(&sub_path, state, true, depth + 1)?;
                let mut p = if report.is_healthy {
                    Problem::new(ProblemKind::Submodule, ProblemSeverity::Info, tr!("Submódulo {sub} sin problemas.", "Submodule {sub} has no problems."))
                } else {
                    Problem::new(
                        ProblemKind::Submodule,
                        ProblemSeverity::Warning,
                        tr!("El submódulo {sub} tiene problemas.", "Submodule {sub} has problems."),
                    )
                };
                p.target = Some(sub_path.clone());
                problems.push(p);
                sub_reports.push(report);
            }
        }

        let is_healthy = problems.iter().all(|p| p.severity == ProblemSeverity::Info);
        Ok(DiagnosticReport {
            repo_path: repo_path.to_string(),
            values,
            problems,
            applied_profile_slug: applied,
            submodules: sub_reports,
            is_healthy,
        })
    }

    pub fn apply_fix(&self, repo_path: &str, fix: &FixAction) -> Result<()> {
        for args in &fix.git_commands {
            let r = self.git.run_with(
                args.clone(),
                crate::git::runner::GitRun { cwd: Some(Path::new(repo_path)), ..Default::default() },
            );
            // --unset-all devuelve 5 si la clave ya no existe: no es un error.
            if !r.success() && !(args.iter().any(|a| a == "--unset-all") && r.exit_code == 5) {
                return Err(Error::msg(tr!("{} falló: {}", "{} failed: {}", describe("git", args), r.stderr.trim())));
            }
        }
        Ok(())
    }

    fn credential_usernames(&self, repo_path: &str) -> Vec<EffectiveValue> {
        let r = self.git.run_in(
            Path::new(repo_path),
            &["config", "--show-origin", "--show-scope", "--get-regexp", r"^credential\..*\.username$"],
        );
        if !r.success() {
            return Vec::new();
        }
        let mut by_key: Vec<(String, Vec<ConfigOrigin>)> = Vec::new();
        for line in lines(&r.stdout) {
            let parts: Vec<&str> = line.splitn(3, '\t').collect();
            if parts.len() < 3 {
                continue;
            }
            let (k, v) = match parts[2].find(' ') {
                Some(i) => (&parts[2][..i], &parts[2][i + 1..]),
                None => (parts[2], ""),
            };
            let origin = ConfigOrigin { value: v.into(), scope: parts[0].into(), origin: parts[1].into() };
            match by_key.iter_mut().find(|(key, _)| eq_ci(key, k)) {
                Some((_, list)) => list.push(origin),
                None => by_key.push((k.to_string(), vec![origin])),
            }
        }
        by_key.into_iter().map(|(k, o)| self.make_value(&k, o, repo_path)).collect()
    }

    fn remote_urls(&self, repo_path: &str) -> Vec<RemoteUrl> {
        let r =
            self.git.run_in(Path::new(repo_path), &["config", "--local", "--get-regexp", r"^remote\..*\.(url|pushurl)$"]);
        if !r.success() {
            return Vec::new();
        }
        lines(&r.stdout)
            .filter_map(|line| {
                let (key, url) = line.split_once(' ')?;
                let name = key.strip_prefix("remote.")?.rsplit_once('.')?.0.to_string();
                Some(RemoteUrl { key: key.into(), name, url: url.into() })
            })
            .collect()
    }

    fn foreign_email_commits(&self, repo_path: &str, expected: &str) -> Vec<(String, Vec<String>)> {
        let repo = Path::new(repo_path);
        let refs = self.git.run_in(repo, &["for-each-ref", "--format=%(refname:short)\t%(upstream:short)", "refs/heads"]);
        if !refs.success() {
            return Vec::new();
        }
        let mut result = Vec::new();
        for line in lines(&refs.stdout) {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 2 || parts[1].is_empty() {
                continue;
            }
            let range = format!("{}..{}", parts[1], parts[0]);
            let log = self.git.run_in(repo, &["log", &range, "--format=%ae"]);
            if !log.success() {
                continue;
            }
            let mut foreign: Vec<String> = Vec::new();
            for e in log.stdout.split('\n').map(str::trim).filter(|e| !e.is_empty()) {
                if !eq_ci(e, expected) && !foreign.iter().any(|f| eq_ci(f, e)) {
                    foreign.push(e.to_string());
                }
            }
            if !foreign.is_empty() {
                result.push((parts[0].to_string(), foreign));
            }
        }
        result
    }

    fn submodules(&self, repo_path: &str) -> Vec<String> {
        if !Path::new(repo_path).join(".gitmodules").is_file() {
            return Vec::new();
        }
        let r = self.git.run_in(Path::new(repo_path), &["submodule", "status"]);
        if !r.success() {
            return Vec::new();
        }
        // " <sha> <ruta> (<desc>)" con prefijo -, + o U
        lines(&r.stdout)
            .filter_map(|l| {
                let rest: String = l.chars().skip(1).collect();
                let parts: Vec<&str> = rest.splitn(3, ' ').collect();
                (parts.len() >= 2).then(|| parts[1].to_string())
            })
            .collect()
    }

    /// Repos bajo las carpetas con regla (profundidad limitada).
    pub fn find_repos(&self, state: &AppState, max_depth: u32) -> Vec<String> {
        let mut roots: Vec<String> = Vec::new();
        for r in state.profiles.iter().flat_map(|p| &p.rules).filter(|r| r.kind == crate::models::RuleType::Folder) {
            let dir = self.paths.expand_tilde(r.value.trim());
            if Path::new(&dir).is_dir() && !roots.iter().any(|x| eq_ci(x, &dir)) {
                roots.push(dir);
            }
        }
        let mut found = Vec::new();
        for root in roots {
            walk(Path::new(&root), 0, max_depth, &mut found);
        }
        let mut unique: Vec<String> = Vec::new();
        for f in found {
            if !unique.iter().any(|u| eq_ci(u, &f)) {
                unique.push(f);
            }
        }
        unique.sort_by_key(|s| s.to_lowercase());
        unique
    }
}

fn walk(dir: &Path, depth: u32, max_depth: u32, found: &mut Vec<String>) {
    if found.len() > 500 {
        return;
    }
    if dir.join(".git").exists() {
        found.push(dir.to_string_lossy().into_owned());
        return;
    }
    if depth >= max_depth {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut subs: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
    subs.sort_by_key(|e| e.file_name());
    for e in subs {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || matches!(name.as_str(), "node_modules" | "bin" | "obj") {
            continue;
        }
        walk(&e.path(), depth + 1, max_depth, found);
    }
}

/// Devuelve la URL canónica si la actual usa un alias SSH o lleva el usuario incrustado.
pub fn canonicalize_remote(url: &str, state: &AppState) -> Option<(String, String)> {
    let parsed = GitUrl::parse(url)?;
    if parsed.method == CloneMethod::Https && parsed.user.is_some() {
        // Azure copia las URLs como https://org@dev.azure.com/org/...: las reglas generan esa variante
        // y GCM la entiende, así que no es un problema.
        if parsed.azure && parsed.user.as_deref().is_some_and(|u| eq_ci(u, parsed.org())) {
            return None;
        }
        return Some((parsed.to_https(), tr!("usuario incrustado en la URL", "username embedded in the URL")));
    }
    if parsed.method == CloneMethod::Ssh {
        // Alias tipo github-trabajo o cualquier host que no sea un nombre real con punto.
        let alias_profile = state.profiles.iter().find(|p| eq_ci(&parsed.host, &ssh_alias(p)));
        let real_host = alias_profile.map(ssh_host).or_else(|| guess_host_from_alias(&parsed.host));
        if let Some(real) = real_host {
            // Se reconstruye y se vuelve a parsear para que una URL de Azure quede en su forma lógica.
            let fixed = GitUrl::parse(&format!("git@{real}:{}", parsed.path))
                .unwrap_or_else(|| GitUrl { host: real.clone(), ..parsed.clone() });
            return Some((fixed.to_ssh(), tr!("alias SSH {}", "SSH alias {}", parsed.host)));
        }
        if let Some(user) = &parsed.user
            && user != "git"
            && parsed.port.is_none()
        {
            let fixed = GitUrl { user: Some("git".into()), ..parsed.clone() };
            return Some((fixed.to_ssh(), tr!("usuario SSH {user}", "SSH user {user}")));
        }
    }
    None
}

fn guess_host_from_alias(host: &str) -> Option<String> {
    let m = ALIAS_RE.captures(host)?;
    match m[1].to_lowercase().as_str() {
        "github" => Some("github.com".into()),
        "gitlab" => Some("gitlab.com".into()),
        "bitbucket" => Some("bitbucket.org".into()),
        "azure" => Some(AZURE_SSH_HOST.into()),
        _ => None,
    }
}
