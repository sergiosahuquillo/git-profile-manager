//! Credenciales HTTPS vía Git Credential Manager. La app nunca guarda tokens: los pasa por stdin a
//! `git credential approve` y los borra de memoria.

use std::time::Duration;

use serde::Serialize;
use ts_rs::TS;
use zeroize::Zeroizing;

use crate::credentials::windows_store;
use crate::git::runner::GitRun;
use crate::git::text::{contains_ci, eq_ci};
use crate::git::{GitRunner, GitUrl};
use crate::models::{GitProvider, Profile, blank, is_azure_host};
use crate::process::describe;
use crate::{Error, Result};
use crate::tr;

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CredentialCheckResult {
    pub valid: bool,
    pub message: String,
    /// Falló por la red (sin conexión, DNS, tiempo agotado), no por la credencial.
    pub network_error: bool,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StoredAccount {
    pub host: String,
    pub username: String,
    /// `GCM` o `Windows`.
    pub source: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GcmStatus {
    pub version: Option<String>,
    pub configured_as_helper: bool,
    pub helpers: Vec<String>,
    pub installed: bool,
}

fn non_interactive() -> Vec<(String, Option<String>)> {
    vec![("GCM_INTERACTIVE".into(), Some("never".into())), ("GIT_TERMINAL_PROMPT".into(), Some("0".into()))]
}

fn no_prompt() -> Vec<(String, Option<String>)> {
    vec![("GIT_TERMINAL_PROMPT".into(), Some("0".into()))]
}

fn ok(valid: bool, message: impl Into<String>) -> CredentialCheckResult {
    CredentialCheckResult { valid, message: message.into(), network_error: false }
}

pub struct CredentialService<'a> {
    pub git: &'a GitRunner,
}

impl<'a> CredentialService<'a> {
    pub fn new(git: &'a GitRunner) -> Self {
        CredentialService { git }
    }

    pub fn gcm_status(&self) -> GcmStatus {
        let version = self.git.credential_manager_version();
        let helpers = self.git.credential_helpers();
        let configured = helpers.iter().any(|h| contains_ci(h, "manager"));
        GcmStatus { installed: version.is_some(), version, configured_as_helper: configured, helpers }
    }

    /// Opción 2 del alta: token pegado. El buffer `token` se borra siempre.
    pub fn approve(&self, host: &str, username: &str, token: Zeroizing<String>) -> Result<()> {
        validate_field(host)?;
        validate_field(username)?;
        if token.contains('\n') || token.contains('\r') {
            return Err(Error::msg(tr!("El token no puede contener saltos de línea.", "The token can't contain line breaks.")));
        }
        let mut payload = Zeroizing::new(Vec::<u8>::new());
        payload.extend_from_slice(format!("protocol=https\nhost={host}\nusername={username}\npassword=").as_bytes());
        payload.extend_from_slice(token.as_bytes());
        payload.extend_from_slice(b"\n\n");
        drop(token);
        let r = self.git.run_with(
            vec!["credential".into(), "approve".into()],
            GitRun { env: non_interactive(), stdin: Some(payload), ..Default::default() },
        );
        if !r.success() {
            return Err(Error::msg(tr!("git credential approve falló: {}", "git credential approve failed: {}", r.stderr.trim())));
        }
        Ok(())
    }

    pub fn reject(&self, host: &str, username: &str) -> Result<()> {
        validate_field(host)?;
        validate_field(username)?;
        let payload = Zeroizing::new(format!("protocol=https\nhost={host}\nusername={username}\n\n").into_bytes());
        let r = self.git.run_with(
            vec!["credential".into(), "reject".into()],
            GitRun { env: non_interactive(), stdin: Some(payload), ..Default::default() },
        );
        if !r.success() {
            return Err(Error::msg(tr!("git credential reject falló: {}", "git credential reject failed: {}", r.stderr.trim())));
        }
        Ok(())
    }

    /// Cuentas que GCM ya tiene guardadas para un host, para sugerir el usuario HTTPS.
    /// Combina `git credential-manager github list` (GitHub) y los destinos `git:` del
    /// Administrador de credenciales de Windows. No lee ningún secreto.
    pub fn list_stored_accounts(&self, host: &str) -> Vec<StoredAccount> {
        let mut accounts = Vec::new();
        if eq_ci(host, "github.com") {
            let r = self.git.run_with(
                vec!["credential-manager".into(), "github".into(), "list".into()],
                GitRun { env: non_interactive(), timeout: Some(Duration::from_secs(20)), ..Default::default() },
            );
            if r.success() {
                accounts.extend(parse_account_list(&r.stdout).into_iter().map(|u| StoredAccount {
                    host: host.into(),
                    username: u,
                    source: "GCM".into(),
                }));
            }
        }
        // Azure DevOps: GCM guarda los tokens en la caché de Microsoft, no en el Administrador de credenciales;
        // las cuentas conocidas son las vinculadas a cada organización.
        if is_azure_host(host) {
            let r = self.git.run_with(
                vec!["credential-manager".into(), "azure-repos".into(), "list".into()],
                GitRun { env: non_interactive(), timeout: Some(Duration::from_secs(20)), ..Default::default() },
            );
            if r.success() {
                accounts.extend(parse_azure_bindings(&r.stdout).into_iter().map(|u| StoredAccount {
                    host: host.into(),
                    username: u,
                    source: "GCM".into(),
                }));
            }
        }
        for entry in windows_store::enumerate_git_targets() {
            let Some((h, user)) = windows_store::parse_target(&entry.target) else { continue };
            if !eq_ci(&h, host) {
                continue;
            }
            let user = entry.user_name.or(user);
            if let Some(u) = user.filter(|u| !u.trim().is_empty() && u != "PersonalAccessToken") {
                accounts.push(StoredAccount { host: host.into(), username: u, source: "Windows".into() });
            }
        }
        let mut unique: Vec<StoredAccount> = Vec::new();
        for a in accounts {
            if !unique.iter().any(|u| eq_ci(&u.username, &a.username)) {
                unique.push(a);
            }
        }
        unique.sort_by_key(|a| a.username.to_lowercase());
        unique
    }

    /// Comprobación sin interacción: `git ls-remote` con GCM_INTERACTIVE=never.
    pub fn check(&self, p: &Profile) -> CredentialCheckResult {
        let url = match repo_url(p) {
            Ok(u) => u,
            Err(e) => return ok(false, e),
        };
        let mut args = profile_config_args(p);
        args.extend(["ls-remote".into(), "--heads".into(), url]);
        let r = self.git.run_with(
            args,
            GitRun { env: non_interactive(), timeout: Some(Duration::from_secs(45)), ..Default::default() },
        );
        if r.success() {
            ok(true, tr!("Credencial válida.", "Valid credential."))
        } else if r.exit_code == -2 || crate::connection_status::is_network_error(&r.combined()) {
            CredentialCheckResult {
                valid: false,
                message: tr!("No se pudo conectar con {}: {}", "Couldn't connect to {}: {}", p.host, first_line(&r.combined())),
                network_error: true,
            }
        } else {
            ok(false, tr!("Credencial no válida: {}", "Invalid credential: {}", first_line(&r.stderr)))
        }
    }

    /// Opción 1 del alta: GCM abre su flujo habitual (OAuth en navegador) y guarda la credencial.
    pub fn run_provider_flow(&self, p: &Profile) -> CredentialCheckResult {
        let url = match repo_url(p) {
            Ok(u) => u,
            Err(e) => return ok(false, e),
        };
        let mut args = profile_config_args(p);
        args.extend(["ls-remote".into(), "--heads".into(), url]);
        let r = self
            .git
            .run_with(args, GitRun { env: no_prompt(), timeout: Some(Duration::from_secs(300)), ..Default::default() });
        if r.success() {
            ok(true, tr!("Credencial guardada por Git Credential Manager.", "Credential saved by Git Credential Manager."))
        } else {
            ok(false, tr!("No se completó el alta: {}", "Sign-in didn't complete: {}", first_line(&r.stderr)))
        }
    }

    /// Comandos que ejecutará [`Self::relogin`], para la vista previa.
    pub fn describe_relogin(&self, p: &Profile, username: &str) -> String {
        if is_github(p) {
            return describe("git", &github_login_args(p, username));
        }
        let flow = flow_profile(p, username);
        let repo = repo_url(&flow).unwrap_or_else(|_| tr!("<repo de prueba del perfil>", "<profile test repo>"));
        let mut args = profile_config_args(&flow);
        args.extend(["ls-remote".into(), "--heads".into(), repo]);
        format!(
            "git credential reject   (protocol=https, host={}, username={username})\n{}",
            p.host,
            describe("git", &args)
        )
    }

    /// Vuelve a autenticar una cuenta guardada en GCM cuando su credencial ya no vale.
    pub fn relogin(&self, p: &Profile, username: &str) -> Result<CredentialCheckResult> {
        validate_field(username)?;
        if is_github(p) {
            let r = self.git.run_with(
                github_login_args(p, username),
                GitRun { env: no_prompt(), timeout: Some(Duration::from_secs(300)), ..Default::default() },
            );
            return Ok(if r.success() {
                ok(true, tr!("Sesión renovada para {username} en {}.", "Session renewed for {username} on {}.", p.host))
            } else {
                ok(false, tr!("No se completó el inicio de sesión: {}", "Sign-in didn't complete: {}", first_line(&r.combined())))
            });
        }
        let flow = flow_profile(p, username);
        if let Err(e) = repo_url(&flow) {
            return Ok(ok(false, e));
        }
        self.reject(&p.host, username)?;
        let result = self.run_provider_flow(&flow);
        Ok(if result.valid {
            ok(true, tr!("Sesión renovada para {username} en {}.", "Session renewed for {username} on {}.", p.host))
        } else {
            result
        })
    }
}

fn flow_profile(p: &Profile, username: &str) -> Profile {
    Profile {
        host: p.host.clone(),
        https_username: Some(username.to_string()),
        https_check_repo_url: p.https_check_repo_url.clone(),
        ..Profile::default()
    }
}

pub fn parse_account_list(output: &str) -> Vec<String> {
    output.split('\n').map(str::trim).filter(|l| !l.is_empty() && !l.contains(' ')).map(String::from).collect()
}

/// Salida de `git credential-manager azure-repos list`:
/// ```text
/// contoso:
///   (global) -> alice@contoso.com
/// ```
pub fn parse_azure_bindings(output: &str) -> Vec<String> {
    output
        .split('\n')
        .filter_map(|l| l.split_once("->").map(|(_, user)| user.trim()))
        .filter(|u| !u.is_empty() && !u.contains(' ') && !u.starts_with('('))
        .map(String::from)
        .collect()
}

fn profile_config_args(p: &Profile) -> Vec<String> {
    if blank(&p.https_username) {
        return Vec::new();
    }
    vec!["-c".into(), format!("credential.https://{}.username={}", p.host, p.https_username.as_deref().unwrap())]
}

fn is_github(p: &Profile) -> bool {
    p.provider == GitProvider::GitHub || eq_ci(&p.host, "github.com")
}

pub fn github_login_args(p: &Profile, username: &str) -> Vec<String> {
    let mut args: Vec<String> =
        ["credential-manager", "github", "login", "--username", username, "--force"].iter().map(|s| s.to_string()).collect();
    if !eq_ci(&p.host, "github.com") {
        args.push("--url".into());
        args.push(format!("https://{}", p.host));
    }
    args
}

fn repo_url(p: &Profile) -> std::result::Result<String, String> {
    let Some(parsed) = p.https_check_repo_url.as_deref().and_then(GitUrl::parse) else {
        return Err(tr!(
            "Indica un repo HTTPS del perfil para comprobar la credencial.",
            "Enter an HTTPS repo of the profile to check the credential."
        ));
    };
    if !eq_ci(&parsed.host, &p.host) {
        return Err(tr!("El repo de prueba debe estar en {}.", "The test repo must be on {}.", p.host));
    }
    Ok(parsed.to_https())
}

fn validate_field(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.contains(['\n', '\r', '\0', '=']) {
        return Err(Error::msg(tr!("Valor no válido: {value}", "Invalid value: {value}")));
    }
    Ok(())
}

fn first_line(s: &str) -> String {
    s.split('\n')
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| tr!("error desconocido", "unknown error"))
}
