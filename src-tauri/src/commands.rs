//! Comandos que invoca el frontend. Delegan en `gpm-core`; aquí solo se adaptan tipos y se
//! ejecuta el trabajo bloqueante fuera del hilo de la UI.

use std::path::Path;

use gpm_core::config::{ConfigGenerator, SshClientInfo};
use gpm_core::connection_status::{self, CheckKind, CheckOutcome, ProfileCheck, StatusStore};
use gpm_core::credentials::{CredentialCheckResult, CredentialService, StoredAccount};
use gpm_core::diagnostics::repo::{DiagnosticReport, FixAction, RepoDiagnostics};
use gpm_core::diagnostics::smart_clone::{CloneRequest, CloneResult, CoverageResult, SmartCloneService};
use gpm_core::environment::{self, EnvironmentReport, SourceTreeReport};
use gpm_core::files::file_guard::{BackupSet, DriftedFile, FileGuard, read_or_null};
use gpm_core::files::text_diff::{self, DiffLine};
use gpm_core::git::GitUrl;
use gpm_core::i18n::{self, Lang};
use gpm_core::tr;
use gpm_core::integration::{IntegrationPlan, IntegrationService, IntegrationStatus};
use gpm_core::models::{AppState, CloneMethod, Profile, Rule, RuleType, SshClientKind};
use gpm_core::profile_validator::{self, RuleConflict};
use gpm_core::rule_matcher;
use gpm_core::ssh::{AclFix, AgentState, ConnectionTestResult, SshKeyStatus, SshKeyType, SshManager};
use gpm_core::workspace::SavePlan;
use gpm_core::config::generator::normalize_folder;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use ts_rs::TS;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::{CmdError, CmdResult};
use crate::state::{Ctx, blocking};

// ─── Tipos de intercambio ─────────────────────────────────────────────────

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PathsInfo {
    pub home: String,
    pub git_profiles_dir: String,
    pub app_data_dir: String,
    pub backups_dir: String,
    pub profiles_json: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Overview {
    pub state: AppState,
    pub integration: IntegrationStatus,
    pub drift: Vec<DriftedFile>,
    pub conflicts: Vec<RuleConflict>,
    pub ssh_client: SshClientInfo,
    pub profiles_health: Vec<ProfileHealth>,
    pub paths: PathsInfo,
    /// Hora de la última modificación de `profiles.json` (ISO local), para la barra de estado.
    pub last_saved: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Bootstrap {
    pub overview: Overview,
    pub environment: EnvironmentReport,
    pub load_error: Option<String>,
    /// Errores que impidieron regenerar ficheros desfasados al arrancar.
    pub regenerate_errors: Vec<String>,
    /// La app se acaba de abrir (no es una recarga del frontend).
    pub first_launch: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProfileHealth {
    pub id: Uuid,
    pub ssh: Option<SshKeyStatus>,
    pub signing_key_exists: bool,
    /// Firma SSH con el cliente de Git y clave con passphrase: hay que cargarla en el agente de la sesión.
    pub signing_needs_session_agent: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RulesAnalysis {
    pub conflicts: Vec<RuleConflict>,
    pub rules_file: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GeneratedPreview {
    pub path: String,
    pub display_path: String,
    pub content: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileChange {
    pub path: String,
    pub display_path: String,
    pub diff: Vec<DiffLine>,
    pub has_changes: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DetectedRepo {
    pub path: String,
    pub profile_name: Option<String>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloneInput {
    pub url: String,
    pub profile_id: Uuid,
    pub method: CloneMethod,
    pub parent: String,
    pub name: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClonePreview {
    pub parsed: Option<GitUrl>,
    pub org: String,
    pub repo: String,
    pub command: String,
    pub destination: String,
    pub coverage: Option<CoverageResult>,
    /// Regla de carpeta que se crearía (`gitdir/i:…`).
    pub folder_rule: String,
    /// Regla de organización que se crearía (`host/org`), si la URL tiene organización.
    pub org_rule: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloneDefaults {
    pub profile_id: Option<Uuid>,
    pub matched_by_rule: bool,
    pub method: CloneMethod,
    pub parent: Option<String>,
    pub name: String,
}

#[derive(Deserialize, TS)]
#[ts(export)]
pub enum CloneRemedy {
    None,
    FolderRule,
    OrgRule,
    LocalIdentity,
}

#[derive(Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloneProgress {
    /// 0..=3: normalizar, cobertura, clonar, diagnosticar.
    pub step: u8,
    pub percent: u8,
    pub phase: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CloneOutcome {
    pub result: CloneResult,
    pub destination: String,
    pub state: AppState,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UninstallPlan {
    pub integration: Option<IntegrationPlan>,
    pub files: Vec<String>,
}

// ─── Auxiliares ───────────────────────────────────────────────────────────

fn paths_info(p: &gpm_core::AppPaths) -> PathsInfo {
    PathsInfo {
        home: p.home.to_string_lossy().into_owned(),
        git_profiles_dir: p.git_profiles_dir(),
        app_data_dir: p.app_data_dir.to_string_lossy().into_owned(),
        backups_dir: p.backups_dir(),
        profiles_json: p.profiles_json(),
    }
}

fn health(paths: &gpm_core::AppPaths, client: &SshClientInfo, state: &AppState) -> Vec<ProfileHealth> {
    let ssh = SshManager::new(paths);
    state
        .profiles
        .iter()
        .map(|p| ProfileHealth {
            id: p.id,
            ssh: p.ssh_key_path.as_deref().filter(|k| !k.trim().is_empty()).map(|k| ssh.status(k)),
            signing_key_exists: p
                .signing_key
                .as_deref()
                .filter(|k| !k.trim().is_empty())
                .is_some_and(|k| Path::new(&paths.expand_tilde(k)).is_file()),
            signing_needs_session_agent: ssh.signing_needs_session_agent(client, p),
        })
        .collect()
}

fn overview_of(ws: &gpm_core::Workspace) -> Overview {
    let integration = IntegrationService::new(&ws.paths, &ws.git).status();
    let last_saved = std::fs::metadata(ws.paths.profiles_json())
        .and_then(|m| m.modified())
        .ok()
        .map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339());
    Overview {
        integration,
        drift: FileGuard::detect_drift(&ws.state),
        conflicts: profile_validator::detect_conflicts(&ws.state),
        ssh_client: ws.ssh_client(),
        profiles_health: health(&ws.paths, &ws.ssh_client(), &ws.state),
        paths: paths_info(&ws.paths),
        last_saved,
        state: ws.state.clone(),
    }
}

fn find_profile(state: &AppState, id: Uuid) -> CmdResult<Profile> {
    state.profile(id).cloned().ok_or_else(|| CmdError::new(tr!("El perfil ya no existe.", "The profile no longer exists.")))
}

// ─── Arranque y estado ────────────────────────────────────────────────────

#[tauri::command]
/// `fallback`: idioma del sistema, para cuando el usuario aún no ha elegido uno en Ajustes.
pub async fn bootstrap(ctx: State<'_, Ctx>, fallback: Lang) -> CmdResult<Bootstrap> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let first_launch = {
            let mut b = ctx.bootstrapped.lock().unwrap_or_else(|e| e.into_inner());
            let first = !*b;
            *b = true;
            first
        };
        let mut ws = ctx.lock();
        i18n::set_lang(ws.state.settings.language.unwrap_or(fallback));
        let environment = environment::check(&ws);
        let mut regenerate_errors = Vec::new();
        if first_launch && environment.blocking_error.is_none() {
            match ws.regenerate_if_outdated() {
                Ok(errors) => regenerate_errors = errors,
                Err(e) => regenerate_errors.push(e.to_string()),
            }
        }
        Ok(Bootstrap {
            overview: overview_of(&ws),
            environment,
            load_error: if first_launch { ws.load_error.as_ref().map(|e| e.message()) } else { None },
            regenerate_errors,
            first_launch,
        })
    })
    .await
}

/// Idioma elegido en Ajustes: se guarda en `profiles.json` y se aplica a los mensajes del núcleo.
#[tauri::command]
pub async fn set_language(ctx: State<'_, Ctx>, lang: Lang) -> CmdResult<Overview> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        i18n::set_lang(lang);
        let mut ws = ctx.lock();
        ws.save_state_only(|s| s.settings.language = Some(lang))?;
        Ok(overview_of(&ws))
    })
    .await
}

#[tauri::command]
pub async fn get_overview(ctx: State<'_, Ctx>) -> CmdResult<Overview> {
    let ctx = ctx.inner().clone();
    blocking(move || Ok(overview_of(&ctx.lock()))).await
}

#[tauri::command]
pub async fn get_environment(ctx: State<'_, Ctx>) -> CmdResult<EnvironmentReport> {
    let ctx = ctx.inner().clone();
    blocking(move || Ok(environment::check(&ctx.lock()))).await
}

#[tauri::command]
pub async fn profiles_health(ctx: State<'_, Ctx>, draft: AppState) -> CmdResult<Vec<ProfileHealth>> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let (paths, client) = {
            let ws = ctx.lock();
            (ws.paths.clone(), ws.ssh_client_for(&draft))
        };
        Ok(health(&paths, &client, &draft))
    })
    .await
}

// ─── Guardado con vista previa ────────────────────────────────────────────

#[tauri::command]
pub async fn plan_save(ctx: State<'_, Ctx>, draft: AppState) -> CmdResult<SavePlan> {
    let ctx = ctx.inner().clone();
    blocking(move || Ok(ctx.lock().plan_save(&draft))).await
}

#[tauri::command]
pub async fn save(ctx: State<'_, Ctx>, draft: AppState, overwrite_drifted: bool) -> CmdResult<Overview> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let mut ws = ctx.lock();
        ws.save(&draft, overwrite_drifted)?;
        Ok(overview_of(&ws))
    })
    .await
}

/// Cambios en `profiles.json` que no tocan ficheros generados (p. ej. primer arranque completado).
#[tauri::command]
pub async fn set_first_run_completed(ctx: State<'_, Ctx>, completed: bool) -> CmdResult<Overview> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let mut ws = ctx.lock();
        ws.save_state_only(|s| s.first_run_completed = completed)?;
        Ok(overview_of(&ws))
    })
    .await
}

#[tauri::command]
pub async fn analyze_rules(ctx: State<'_, Ctx>, draft: AppState) -> CmdResult<RulesAnalysis> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let paths = ctx.lock().paths.clone();
        Ok(RulesAnalysis {
            conflicts: profile_validator::detect_conflicts(&draft),
            rules_file: ConfigGenerator::new(&paths).generate_rules(&draft),
        })
    })
    .await
}

/// Contenido que generaría la app para un estado (vistas previas de ficheros).
#[tauri::command]
pub async fn preview_generated(ctx: State<'_, Ctx>, draft: AppState) -> CmdResult<Vec<GeneratedPreview>> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let ws = ctx.lock();
        let ssh = ws.ssh_client_for(&draft);
        Ok(ConfigGenerator::new(&ws.paths)
            .generate_all(&draft, &ssh)
            .into_iter()
            .map(|f| GeneratedPreview { display_path: ws.paths.to_tilde_path(&f.path), path: f.path, content: f.content })
            .collect())
    })
    .await
}

/// Diferencias entre lo que generaría la app (−) y el contenido actual (+) de los ficheros con deriva.
#[tauri::command]
pub async fn drift_changes(ctx: State<'_, Ctx>) -> CmdResult<Vec<FileChange>> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let ws = ctx.lock();
        let plan = ws.plan_save(&ws.state);
        Ok(plan
            .files
            .into_iter()
            .filter(|f| f.drifted)
            .map(|f| FileChange {
                diff: text_diff::lines(f.current_content.as_deref(), Some(&f.content)),
                has_changes: f.has_changes,
                path: f.path,
                display_path: f.display_path,
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn regenerate_drifted(ctx: State<'_, Ctx>) -> CmdResult<Overview> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let mut ws = ctx.lock();
        let current = ws.state.clone();
        ws.save(&current, true)?;
        Ok(overview_of(&ws))
    })
    .await
}

// ─── SSH ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ssh_generate_key(
    ctx: State<'_, Ctx>,
    slug: String,
    email: String,
    with_passphrase: bool,
    key_type: Option<SshKeyType>,
) -> CmdResult<String> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let (paths, client) = {
            let ws = ctx.lock();
            (ws.paths.clone(), ws.ssh_client())
        };
        Ok(SshManager::new(&paths).generate_key(&client, &slug, &email, with_passphrase, key_type.unwrap_or_default())?)
    })
    .await
}

#[tauri::command]
pub async fn ssh_import_key(ctx: State<'_, Ctx>, path: String) -> CmdResult<String> {
    let paths = ctx.lock().paths.clone();
    blocking(move || Ok(SshManager::new(&paths).import_key(&path)?)).await
}

#[tauri::command]
pub async fn ssh_key_status(ctx: State<'_, Ctx>, key_path: String) -> CmdResult<SshKeyStatus> {
    let paths = ctx.lock().paths.clone();
    blocking(move || Ok(SshManager::new(&paths).status(&key_path))).await
}

#[tauri::command]
pub async fn ssh_fingerprint(ctx: State<'_, Ctx>, key_path: String) -> CmdResult<Option<String>> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let ws = ctx.lock();
        Ok(SshManager::new(&ws.paths).fingerprint(&ws.ssh_client(), &key_path))
    })
    .await
}

#[tauri::command]
pub async fn ssh_read_public_key(ctx: State<'_, Ctx>, key_path: String) -> CmdResult<Option<String>> {
    let paths = ctx.lock().paths.clone();
    Ok(SshManager::new(&paths).read_public_key(&key_path))
}

#[tauri::command]
pub async fn ssh_plan_acl_fix(ctx: State<'_, Ctx>, key_path: String) -> CmdResult<AclFix> {
    let paths = ctx.lock().paths.clone();
    blocking(move || Ok(SshManager::new(&paths).plan_acl_fix(&key_path)?)).await
}

#[tauri::command]
pub async fn ssh_apply_acl_fix(ctx: State<'_, Ctx>, key_path: String) -> CmdResult<SshKeyStatus> {
    let paths = ctx.lock().paths.clone();
    blocking(move || {
        let ssh = SshManager::new(&paths);
        let fix = ssh.plan_acl_fix(&key_path)?;
        ssh.apply_acl_fix(&fix)?;
        Ok(ssh.status(&key_path))
    })
    .await
}

#[tauri::command]
pub async fn ssh_agent_state(ctx: State<'_, Ctx>) -> CmdResult<AgentState> {
    let paths = ctx.lock().paths.clone();
    blocking(move || Ok(SshManager::new(&paths).agent_state())).await
}

#[tauri::command]
pub async fn ssh_add_to_agent(ctx: State<'_, Ctx>, key_path: String) -> CmdResult<()> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let (paths, client) = {
            let ws = ctx.lock();
            (ws.paths.clone(), ws.ssh_client())
        };
        Ok(SshManager::new(&paths).add_to_agent(&client, &key_path)?)
    })
    .await
}

#[tauri::command]
pub async fn ssh_test_connection(ctx: State<'_, Ctx>, profile: Profile) -> CmdResult<ConnectionTestResult> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let (paths, client) = {
            let ws = ctx.lock();
            (ws.paths.clone(), ws.ssh_client())
        };
        let result = SshManager::new(&paths).test_connection(&client, &profile);
        persist_check(&paths, &client, &profile, CheckKind::Ssh, CheckOutcome::from(&result));
        Ok(result)
    })
    .await
}

/// Rutas del cliente SSH que usaría la app con un ajuste dado (para la vista previa de Ajustes).
#[tauri::command]
pub async fn ssh_client_info(ctx: State<'_, Ctx>, kind: SshClientKind) -> CmdResult<SshClientInfo> {
    let root = ctx.lock().git.install_root();
    Ok(SshClientInfo::resolve(kind, root.as_deref()))
}

// ─── HTTPS / Git Credential Manager ───────────────────────────────────────

#[tauri::command]
pub async fn credential_approve(ctx: State<'_, Ctx>, host: String, username: String, token: String) -> CmdResult<()> {
    let git = ctx.lock().git.clone();
    let token = Zeroizing::new(token);
    blocking(move || Ok(CredentialService::new(&git).approve(&host, &username, token)?)).await
}

#[tauri::command]
pub async fn credential_reject(ctx: State<'_, Ctx>, host: String, username: String) -> CmdResult<()> {
    let git = ctx.lock().git.clone();
    blocking(move || Ok(CredentialService::new(&git).reject(&host, &username)?)).await
}

#[tauri::command]
pub async fn credential_check(ctx: State<'_, Ctx>, profile: Profile) -> CmdResult<CredentialCheckResult> {
    let (git, paths, client) = check_context(&ctx);
    blocking(move || {
        let result = CredentialService::new(&git).check(&profile);
        persist_check(&paths, &client, &profile, CheckKind::Https, CheckOutcome::from(&result));
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn credential_provider_flow(ctx: State<'_, Ctx>, profile: Profile) -> CmdResult<CredentialCheckResult> {
    let (git, paths, client) = check_context(&ctx);
    blocking(move || {
        let result = CredentialService::new(&git).run_provider_flow(&profile);
        // Un alta cancelada no dice nada de la credencial: solo se guarda el éxito.
        if result.valid {
            persist_check(&paths, &client, &profile, CheckKind::Https, CheckOutcome::from(&result));
        }
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn credential_describe_relogin(ctx: State<'_, Ctx>, profile: Profile, username: String) -> CmdResult<String> {
    let git = ctx.lock().git.clone();
    Ok(CredentialService::new(&git).describe_relogin(&profile, &username))
}

#[tauri::command]
pub async fn credential_relogin(ctx: State<'_, Ctx>, profile: Profile, username: String) -> CmdResult<CredentialCheckResult> {
    let (git, paths, client) = check_context(&ctx);
    blocking(move || {
        let result = CredentialService::new(&git).relogin(&profile, &username)?;
        let same_user = profile.https_username.as_deref().is_some_and(|u| u.eq_ignore_ascii_case(&username));
        if result.valid && same_user {
            persist_check(&paths, &client, &profile, CheckKind::Https, CheckOutcome::from(&result));
        }
        Ok(result)
    })
    .await
}

// ─── Estado de conexión persistente ───────────────────────────────────────

/// `status.json` se lee y escribe entero: un único escritor a la vez.
static STATUS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn check_context(ctx: &State<'_, Ctx>) -> (gpm_core::git::GitRunner, gpm_core::AppPaths, SshClientInfo) {
    let ws = ctx.lock();
    (ws.git.clone(), ws.paths.clone(), ws.ssh_client())
}

fn persist_check(
    paths: &gpm_core::AppPaths,
    client: &SshClientInfo,
    profile: &Profile,
    kind: CheckKind,
    outcome: CheckOutcome,
) -> Option<ProfileCheck> {
    let _guard = STATUS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut store = StatusStore::load(paths);
    let check = store.record(paths, client, profile, kind, outcome, chrono::Utc::now());
    let _ = store.save(paths);
    check
}

/// Últimos resultados vigentes de los perfiles guardados.
#[tauri::command]
pub async fn connection_status(ctx: State<'_, Ctx>) -> CmdResult<Vec<ProfileCheck>> {
    let s = ctx.snapshot();
    let client = SshClientInfo::resolve(s.state.settings.ssh_client, s.git.install_root().as_deref());
    Ok(StatusStore::load(&s.paths).snapshot(&s.paths, &client, &s.state))
}

/// Recomprueba en segundo plano lo caducado o lo que cambió desde la última vez. Todas las pruebas son
/// no interactivas (SSH con BatchMode, GCM con GCM_INTERACTIVE=never). Emite `connection-status` por cada
/// resultado y devuelve cuántas comprobaciones lanzó.
#[tauri::command]
pub async fn connection_status_refresh(app: AppHandle, ctx: State<'_, Ctx>) -> CmdResult<usize> {
    let s = ctx.snapshot();
    blocking(move || {
        let client = SshClientInfo::resolve(s.state.settings.ssh_client, s.git.install_root().as_deref());
        let pending: Vec<(Profile, CheckKind)> = {
            let _guard = STATUS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let mut store = StatusStore::load(&s.paths);
            store.prune(&s.state);
            let _ = store.save(&s.paths);
            let max_age = chrono::Duration::hours(connection_status::MAX_AGE_HOURS);
            store
                .stale(&s.paths, &client, &s.state, max_age, chrono::Utc::now())
                .into_iter()
                .map(|(p, k)| (p.clone(), k))
                .collect()
        };
        let count = pending.len();
        std::thread::scope(|scope| {
            for (profile, kind) in &pending {
                let (paths, git, client, app) = (&s.paths, &s.git, &client, &app);
                scope.spawn(move || {
                    let outcome = match kind {
                        CheckKind::Ssh => CheckOutcome::from(&SshManager::new(paths).test_connection(client, profile)),
                        CheckKind::Https => CheckOutcome::from(&CredentialService::new(git).check(profile)),
                    };
                    if let Some(check) = persist_check(paths, client, profile, *kind, outcome) {
                        let _ = app.emit("connection-status", check);
                    }
                });
            }
        });
        Ok(count)
    })
    .await
}

#[tauri::command]
pub async fn credential_saved_accounts(ctx: State<'_, Ctx>, host: String) -> CmdResult<Vec<StoredAccount>> {
    let git = ctx.lock().git.clone();
    blocking(move || Ok(CredentialService::new(&git).list_stored_accounts(&host))).await
}

// ─── Integración ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn integration_plan_enable(ctx: State<'_, Ctx>, remove_global_identity: bool) -> CmdResult<IntegrationPlan> {
    let s = ctx.snapshot();
    blocking(move || Ok(IntegrationService::new(&s.paths, &s.git).plan_enable(&s.state, remove_global_identity)?)).await
}

#[tauri::command]
pub async fn integration_plan_disable(ctx: State<'_, Ctx>) -> CmdResult<IntegrationPlan> {
    let s = ctx.snapshot();
    blocking(move || Ok(IntegrationService::new(&s.paths, &s.git).plan_disable(&s.state)?)).await
}

/// Recalcula el plan (por si los ficheros cambiaron desde la vista previa) y lo aplica con backup.
#[tauri::command]
pub async fn integration_enable(ctx: State<'_, Ctx>, remove_global_identity: bool) -> CmdResult<Overview> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let mut ws = ctx.lock();
        // Sin rules.gitconfig la inclusión apuntaría a un fichero que no existe: se generan antes.
        if !Path::new(&ws.paths.rules_file()).is_file() {
            let current = ws.state.clone();
            ws.save(&current, false)?;
        }
        let integration = IntegrationService::new(&ws.paths, &ws.git);
        let plan = integration.plan_enable(&ws.state, remove_global_identity)?;
        let mut next = ws.state.clone();
        integration.apply(&plan, &mut next)?;
        ws.save_state_only(|s| {
            s.integration_enabled = next.integration_enabled;
            s.saved_global_identity = next.saved_global_identity.clone();
        })?;
        Ok(overview_of(&ws))
    })
    .await
}

#[tauri::command]
pub async fn integration_disable(ctx: State<'_, Ctx>) -> CmdResult<Overview> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let mut ws = ctx.lock();
        let integration = IntegrationService::new(&ws.paths, &ws.git);
        let plan = integration.plan_disable(&ws.state)?;
        let mut next = ws.state.clone();
        integration.apply(&plan, &mut next)?;
        ws.save_state_only(|s| {
            s.integration_enabled = next.integration_enabled;
            s.saved_global_identity = next.saved_global_identity.clone();
        })?;
        Ok(overview_of(&ws))
    })
    .await
}

#[tauri::command]
pub async fn uninstall_plan(ctx: State<'_, Ctx>) -> CmdResult<UninstallPlan> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let ws = ctx.lock();
        let integration = IntegrationService::new(&ws.paths, &ws.git);
        let status = integration.status();
        let plan = if ws.state.integration_enabled || status.git_include || status.ssh_include {
            Some(integration.plan_disable(&ws.state)?)
        } else {
            None
        };
        Ok(UninstallPlan { integration: plan, files: ws.existing_generated_files() })
    })
    .await
}

/// Desactiva la integración (si está activa) y borra los ficheros generados. Las claves SSH no se tocan.
#[tauri::command]
pub async fn uninstall(ctx: State<'_, Ctx>) -> CmdResult<Overview> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let mut ws = ctx.lock();
        let integration = IntegrationService::new(&ws.paths, &ws.git);
        let status = integration.status();
        if ws.state.integration_enabled || status.git_include || status.ssh_include {
            let plan = integration.plan_disable(&ws.state)?;
            let mut next = ws.state.clone();
            integration.apply(&plan, &mut next)?;
            ws.save_state_only(|s| {
                s.integration_enabled = false;
                s.saved_global_identity = next.saved_global_identity.clone();
            })?;
        }
        ws.delete_generated_files()?;
        Ok(overview_of(&ws))
    })
    .await
}

// ─── Backups ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_backups(ctx: State<'_, Ctx>) -> CmdResult<Vec<BackupSet>> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let ws = ctx.lock();
        Ok(ws.guard().list_backups())
    })
    .await
}

/// Diferencias entre el contenido actual (−) y el del backup (+) de cada fichero.
#[tauri::command]
pub async fn backup_restore_plan(ctx: State<'_, Ctx>, id: String) -> CmdResult<Vec<FileChange>> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let ws = ctx.lock();
        let guard = ws.guard();
        let set = guard.find_backup(&id)?;
        Ok(set
            .entries
            .iter()
            .map(|e| {
                let current = read_or_null(&e.original_path);
                let restored = guard.backup_content(&set, e);
                FileChange {
                    path: e.original_path.clone(),
                    display_path: ws.paths.to_tilde_path(&e.original_path),
                    diff: text_diff::lines(current.as_deref(), restored.as_deref()),
                    has_changes: text_diff::has_changes(current.as_deref(), restored.as_deref()),
                }
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn restore_backup(ctx: State<'_, Ctx>, id: String) -> CmdResult<Overview> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let ws = ctx.lock();
        let guard = ws.guard();
        let set = guard.find_backup(&id)?;
        guard.restore(&set)?;
        Ok(overview_of(&ws))
    })
    .await
}

// ─── Diagnóstico ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn diagnose_repo(ctx: State<'_, Ctx>, path: String) -> CmdResult<DiagnosticReport> {
    let s = ctx.snapshot();
    blocking(move || {
        if !Path::new(&path).is_dir() {
            return Err(CmdError::new(tr!("No existe la carpeta {path}.", "Folder {path} doesn't exist.")));
        }
        Ok(RepoDiagnostics::new(&s.paths, &s.git).analyze(&path, &s.state)?)
    })
    .await
}

#[tauri::command]
pub async fn find_repos(ctx: State<'_, Ctx>) -> CmdResult<Vec<DetectedRepo>> {
    let s = ctx.snapshot();
    blocking(move || {
        let diag = RepoDiagnostics::new(&s.paths, &s.git);
        Ok(diag
            .find_repos(&s.state, 3)
            .into_iter()
            .map(|path| DetectedRepo {
                profile_name: rule_matcher::winner(&s.paths, &s.state, &path, &[]).map(|p| p.display_name.clone()),
                path,
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn apply_fix(ctx: State<'_, Ctx>, repo: String, fix: FixAction) -> CmdResult<DiagnosticReport> {
    let s = ctx.snapshot();
    blocking(move || {
        let diag = RepoDiagnostics::new(&s.paths, &s.git);
        diag.apply_fix(&repo, &fix)?;
        Ok(diag.analyze(&repo, &s.state)?)
    })
    .await
}

// ─── Smart Clone ──────────────────────────────────────────────────────────

fn destination_of(parent: &str, name: &str) -> String {
    Path::new(&parent.replace('/', "\\")).join(name.trim()).to_string_lossy().into_owned()
}

#[tauri::command]
pub async fn clone_defaults(ctx: State<'_, Ctx>, url: String, profile_id: Option<Uuid>) -> CmdResult<CloneDefaults> {
    let s = ctx.snapshot();
    let parsed = GitUrl::parse(&url);
    let by_rule = parsed.as_ref().and_then(|u| rule_matcher::profile_for_url(&s.state, u)).map(|p| p.id);
    let id = profile_id.or(by_rule).or_else(|| s.state.default_profile().map(|p| p.id)).or_else(|| s.state.profiles.first().map(|p| p.id));
    let profile = id.and_then(|i| s.state.profile(i));
    let clone = SmartCloneService::new(&s.paths, &s.git);
    Ok(CloneDefaults {
        matched_by_rule: by_rule.is_some() && by_rule == id,
        profile_id: id,
        method: profile.map(|p| p.preferred_clone_method).unwrap_or_default(),
        parent: profile.and_then(|p| clone.suggest_parent_folder(p)),
        name: parsed.map(|u| u.repo().to_string()).unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn clone_preview(ctx: State<'_, Ctx>, input: CloneInput) -> CmdResult<ClonePreview> {
    let s = ctx.snapshot();
    let ssh = SshClientInfo::resolve(s.state.settings.ssh_client, s.git.install_root().as_deref());
    let parsed = GitUrl::parse(&input.url);
    let destination = destination_of(&input.parent, &input.name);
    let folder_rule = format!("gitdir/i:{}", normalize_folder(&input.parent));
    let Some(url) = parsed.clone() else {
        return Ok(ClonePreview {
            parsed: None,
            org: String::new(),
            repo: String::new(),
            command: String::new(),
            destination,
            coverage: None,
            folder_rule,
            org_rule: None,
        });
    };
    let profile = find_profile(&s.state, input.profile_id)?;
    let clone = SmartCloneService::new(&s.paths, &s.git);
    let req = CloneRequest {
        url: url.clone(),
        method: input.method,
        profile: &profile,
        destination: destination.clone(),
        write_local_identity: false,
    };
    Ok(ClonePreview {
        org: url.org().to_string(),
        repo: url.repo().to_string(),
        command: clone.preview(&req, &ssh),
        coverage: (!input.parent.trim().is_empty() && !input.name.trim().is_empty())
            .then(|| clone.check_coverage(&s.state, &profile, &destination, &url)),
        folder_rule,
        org_rule: (!url.org().is_empty()).then(|| format!("{}/{}", url.host, url.org())),
        parsed,
        destination,
    })
}

#[tauri::command]
pub async fn clone_run(app: AppHandle, ctx: State<'_, Ctx>, input: CloneInput, remedy: CloneRemedy) -> CmdResult<CloneOutcome> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        let emit = |step: u8, percent: u8, phase: &str| {
            let _ = app.emit("clone-progress", CloneProgress { step, percent, phase: phase.to_string() });
        };
        emit(0, 0, "");
        let url = GitUrl::parse_or_err(&input.url)?;
        let destination = destination_of(&input.parent, &input.name);

        emit(1, 0, "");
        // Las reglas nuevas se añaden sobre el estado guardado, no sobre borradores de la UI.
        if matches!(remedy, CloneRemedy::FolderRule | CloneRemedy::OrgRule) {
            let mut ws = ctx.lock();
            let mut draft = ws.state.clone();
            let order = draft.next_rule_order();
            let profile = draft
                .profiles
                .iter_mut()
                .find(|p| p.id == input.profile_id)
                .ok_or_else(|| CmdError::new(tr!("El perfil ya no existe.", "The profile no longer exists.")))?;
            let rule = match remedy {
                CloneRemedy::FolderRule => {
                    Rule { kind: RuleType::Folder, value: input.parent.replace('\\', "/"), order, ..Rule::default() }
                }
                _ => {
                    if url.org().is_empty() {
                        return Err(CmdError::new(tr!("La URL no tiene organización.", "The URL has no organization.")));
                    }
                    let host = (!url.host.eq_ignore_ascii_case(&profile.host)).then(|| url.host.clone());
                    Rule { kind: RuleType::Remote, value: url.org().to_string(), host, order, ..Rule::default() }
                }
            };
            profile.rules.push(rule);
            let plan = ws.plan_save(&draft);
            if !plan.can_save {
                return Err(CmdError::new(tr!(
                    "No se pudo crear la regla:\n{}",
                    "Couldn't create the rule:\n{}",
                    plan.errors.join("\n")
                )));
            }
            if plan.has_drift {
                return Err(CmdError::new(tr!(
                    "Hay ficheros generados editados fuera de la app. Revísalos desde el aviso de la ventana principal.",
                    "Some generated files were edited outside the app. Review them from the warning in the main window."
                )));
            }
            ws.save(&draft, false)?;
        }

        let s = ctx.snapshot();
        let profile = find_profile(&s.state, input.profile_id)?;
        let ssh = SshClientInfo::resolve(s.state.settings.ssh_client, s.git.install_root().as_deref());
        let clone = SmartCloneService::new(&s.paths, &s.git);
        let req = CloneRequest {
            url,
            method: input.method,
            profile: &profile,
            destination: destination.clone(),
            write_local_identity: matches!(remedy, CloneRemedy::LocalIdentity),
        };
        emit(2, 0, "");
        let result = clone.clone(&req, &ssh, &s.state, |pct, phase| {
            if phase == gpm_core::diagnostics::smart_clone::PHASE_DIAGNOSE { emit(3, 100, "") } else { emit(2, pct, phase) }
        });
        Ok(CloneOutcome { result, destination, state: s.state })
    })
    .await
}

// ─── Shell y varios ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn sourcetree_status() -> CmdResult<SourceTreeReport> {
    blocking(|| Ok(environment::detect_sourcetree())).await
}

#[tauri::command]
pub async fn open_in_explorer(path: String) -> CmdResult<()> {
    if !Path::new(&path).exists() {
        std::fs::create_dir_all(&path)?;
    }
    gpm_core::process::spawn_detached(Path::new("explorer.exe"), &[path])?;
    Ok(())
}

#[tauri::command]
pub async fn open_in_sourcetree(repo: String) -> CmdResult<()> {
    let exe = environment::sourcetree_exe()
        .ok_or_else(|| CmdError::new(tr!("SourceTree no está instalado.", "SourceTree isn't installed.")))?;
    gpm_core::process::spawn_detached(Path::new(&exe), &["-f".into(), repo])?;
    Ok(())
}

#[tauri::command]
pub async fn is_directory(path: String) -> CmdResult<bool> {
    Ok(Path::new(&path).is_dir())
}

/// Errores no controlados del frontend → `%APPDATA%\GitProfileManager\error.log`.
#[tauri::command]
pub async fn log_error(ctx: State<'_, Ctx>, message: String) -> CmdResult<()> {
    let path = ctx.lock().paths.error_log();
    crate::append_error_log(&path, &message);
    Ok(())
}
