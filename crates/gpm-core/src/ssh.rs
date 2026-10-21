//! Claves SSH, ACL, agente y prueba de conexión.

use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::Serialize;
use ts_rs::TS;

use crate::app_paths::AppPaths;
use crate::config::SshClientInfo;
use crate::git::text::{contains_ci, eq_ci};
use crate::models::{Profile, SshClientKind, blank, is_azure, ssh_host};
use crate::process::{self, ProcessRequest};
use crate::{Error, Result};
use crate::tr;

// SIDs aceptados por OpenSSH para Windows además del usuario: SYSTEM y Administradores.
const TRUSTED_SIDS: [&str; 2] = ["S-1-5-18", "S-1-5-32-544"];

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshKeyStatus {
    pub private_exists: bool,
    pub public_exists: bool,
    pub fingerprint: Option<String>,
    pub acl_ok: bool,
    pub acl_offenders: Vec<String>,
    /// Nombres legibles (`DOMINIO\usuario`) de los SIDs con acceso.
    pub acl_offender_names: Vec<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub account: Option<String>,
    pub output: String,
    /// Causa probable y cómo arreglarla cuando la prueba falla.
    pub hint: Option<String>,
    /// Falló por la red (sin conexión, DNS, tiempo agotado), no por la clave.
    pub network_error: bool,
}

impl ConnectionTestResult {
    pub fn account_matches(&self, expected: Option<&str>) -> bool {
        match (&self.account, expected) {
            (None, _) => true,
            (_, None) => true,
            (_, Some(e)) if e.trim().is_empty() => true,
            (Some(a), Some(e)) => eq_ci(a, e),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum AgentState {
    Running,
    Stopped,
    Disabled,
    NotInstalled,
    Unknown,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AclFix {
    pub path: String,
    pub icacls_commands: Vec<Vec<String>>,
    pub preview: Vec<String>,
}

static GITHUB_HELLO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Hi (?<u>[^!\s]+)! You've successfully authenticated").unwrap());
static GITLAB_WELCOME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Welcome to GitLab, @(?<u>[^!\s]+)!").unwrap());
static BITBUCKET_LOGGED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"logged in as (?<u>[^\s.]+)").unwrap());
static SHA256_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"SHA256:\S+").unwrap());
static RUNNING_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r":\s*4\s+RUNNING").unwrap());
static DISABLED_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r":\s*4\s+DISABLED").unwrap());

pub struct SshManager<'a> {
    pub paths: &'a AppPaths,
}

/// Tipo de clave nueva. Azure DevOps solo garantiza RSA; el resto de proveedores, ed25519.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, serde::Deserialize, TS)]
#[ts(export)]
pub enum SshKeyType {
    #[default]
    Ed25519,
    Rsa,
}

impl SshKeyType {
    /// Tipo recomendado para el perfil.
    pub fn recommended_for(profile: &Profile) -> Self {
        if is_azure(profile) { SshKeyType::Rsa } else { SshKeyType::Ed25519 }
    }

    fn keygen_args(self) -> &'static [&'static str] {
        match self {
            SshKeyType::Ed25519 => &["-t", "ed25519"],
            SshKeyType::Rsa => &["-t", "rsa", "-b", "4096"],
        }
    }
}

pub fn default_key_path(slug: &str) -> String {
    key_path_for(slug, SshKeyType::Ed25519)
}

pub fn key_path_for(slug: &str, key_type: SshKeyType) -> String {
    match key_type {
        SshKeyType::Ed25519 => format!("~/.ssh/id_ed25519_{slug}"),
        SshKeyType::Rsa => format!("~/.ssh/id_rsa_{slug}"),
    }
}

/// `ssh-keygen` que se ejecutará para crear la clave, para la vista previa.
pub fn keygen_args(slug: &str, email: &str, key_type: SshKeyType) -> Vec<String> {
    let mut args: Vec<String> = key_type.keygen_args().iter().map(|s| s.to_string()).collect();
    args.extend(["-C".into(), email.to_string(), "-f".into(), key_path_for(slug, key_type)]);
    args
}

impl<'a> SshManager<'a> {
    pub fn new(paths: &'a AppPaths) -> Self {
        SshManager { paths }
    }

    pub fn status(&self, key_path: &str) -> SshKeyStatus {
        let private = self.paths.expand_tilde(key_path);
        let public = format!("{private}.pub");
        let private_exists = Path::new(&private).is_file();
        let public_exists = Path::new(&public).is_file();
        let offenders = if private_exists { acl_offenders(&private) } else { Vec::new() };
        SshKeyStatus {
            private_exists,
            public_exists,
            fingerprint: if public_exists { fingerprint_hint(&public) } else { None },
            acl_ok: offenders.is_empty(),
            acl_offender_names: offenders.iter().map(|s| describe_sid(s)).collect(),
            acl_offenders: offenders,
        }
    }

    pub fn read_public_key(&self, key_path: &str) -> Option<String> {
        let public = format!("{}.pub", self.paths.expand_tilde(key_path));
        crate::files::file_guard::read_or_null(&public).map(|s| s.trim().to_string())
    }

    /// Valida una clave existente: debe existir el par `.pub`. Devuelve la ruta con `~/`.
    pub fn import_key(&self, private_key_path: &str) -> Result<String> {
        let mut p = private_key_path.to_string();
        if p.len() >= 4 && p[p.len() - 4..].eq_ignore_ascii_case(".pub") {
            p.truncate(p.len() - 4);
        }
        let full = self.paths.expand_tilde(&p);
        if !Path::new(&full).is_file() {
            return Err(Error::msg(tr!("No existe la clave privada.", "The private key doesn't exist.")));
        }
        if !Path::new(&format!("{full}.pub")).is_file() {
            return Err(Error::msg(tr!(
                "Falta la clave pública (.pub) junto a la privada.",
                "The public key (.pub) is missing next to the private key."
            )));
        }
        Ok(self.paths.to_tilde_path(&full))
    }

    /// Crea una clave ed25519 (o RSA 4096). Sin passphrase se ejecuta en segundo plano; con passphrase se abre
    /// una consola para que el usuario la escriba en `ssh-keygen` (la app nunca la ve). Nunca sobrescribe.
    pub fn generate_key(
        &self,
        client: &SshClientInfo,
        slug: &str,
        email: &str,
        with_passphrase: bool,
        key_type: SshKeyType,
    ) -> Result<String> {
        let tilde = key_path_for(slug, key_type);
        let full = self.paths.expand_tilde(&tilde);
        if Path::new(&full).exists() || Path::new(&format!("{full}.pub")).exists() {
            return Err(Error::msg(tr!(
                "Ya existe {tilde}. La app nunca sobrescribe una clave.",
                "{tilde} already exists. The app never overwrites a key."
            )));
        }
        if let Some(dir) = Path::new(&full).parent() {
            std::fs::create_dir_all(dir)?;
        }
        let keygen = client.native_ssh_keygen_path();
        if with_passphrase {
            let mut args: Vec<String> = key_type.keygen_args().iter().map(|s| s.to_string()).collect();
            args.extend(["-C".into(), email.to_string(), "-f".into(), full.clone()]);
            process::run_in_console(Path::new(&keygen), &args)
                .map_err(|e| Error::msg(tr!("No se pudo abrir ssh-keygen: {e}", "Couldn't open ssh-keygen: {e}")))?;
        } else {
            let mut args: Vec<&str> = vec!["-q"];
            args.extend(key_type.keygen_args());
            args.extend(["-C", email, "-f", full.as_str(), "-N", ""]);
            let r = process::run(ProcessRequest::new(&keygen, args));
            if !r.success() {
                return Err(Error::msg(tr!("ssh-keygen falló: {}", "ssh-keygen failed: {}", r.combined())));
            }
        }
        if !Path::new(&full).is_file() {
            return Err(Error::msg(tr!("No se creó la clave.", "The key wasn't created.")));
        }
        Ok(tilde)
    }

    pub fn plan_acl_fix(&self, key_path: &str) -> Result<AclFix> {
        let full = self.paths.expand_tilde(key_path);
        let me = current_user_sid().ok_or_else(|| {
            Error::msg(tr!("No se pudo obtener el SID del usuario actual.", "Couldn't get the current user's SID."))
        })?;
        let mut commands = vec![
            vec![full.clone(), "/inheritance:r".into()],
            vec![full.clone(), "/grant:r".into(), format!("*{me}:F")],
        ];
        for sid in acl_offenders(&full) {
            commands.push(vec![full.clone(), "/remove:g".into(), format!("*{sid}")]);
        }
        let preview = commands.iter().map(|a| process::describe("icacls", a)).collect();
        Ok(AclFix { path: full, icacls_commands: commands, preview })
    }

    pub fn apply_acl_fix(&self, fix: &AclFix) -> Result<()> {
        for args in &fix.icacls_commands {
            let r = process::run(ProcessRequest::new("icacls.exe", args.clone()));
            if !r.success() {
                return Err(Error::msg(tr!("icacls falló: {}", "icacls failed: {}", r.combined())));
            }
        }
        Ok(())
    }

    pub fn agent_state(&self) -> AgentState {
        let query = process::run(ProcessRequest::new("sc.exe", ["query", "ssh-agent"]));
        if query.exit_code == 1060 {
            return AgentState::NotInstalled;
        }
        if !query.success() {
            return AgentState::Unknown;
        }
        // El texto está localizado; el código numérico de estado no.
        if RUNNING_RE.is_match(&query.stdout) {
            return AgentState::Running;
        }
        let config = process::run(ProcessRequest::new("sc.exe", ["qc", "ssh-agent"]));
        if DISABLED_RE.is_match(&config.stdout) {
            return AgentState::Disabled;
        }
        AgentState::Stopped
    }

    /// Abre una consola con `ssh-add` para que el usuario escriba la passphrase.
    pub fn add_to_agent(&self, client: &SshClientInfo, key_path: &str) -> Result<()> {
        let ssh_add = client.native_ssh_add_path();
        process::run_in_console(Path::new(&ssh_add), &[self.paths.expand_tilde(key_path)])
            .map_err(|e| Error::msg(tr!("No se pudo abrir ssh-add: {e}", "Couldn't open ssh-add: {e}")))?;
        Ok(())
    }

    /// `ssh -T git@host -i clave -o IdentitiesOnly=yes` y extracción de la cuenta.
    pub fn test_connection(&self, client: &SshClientInfo, profile: &Profile) -> ConnectionTestResult {
        if blank(&profile.ssh_key_path) {
            return ConnectionTestResult {
                success: false,
                account: None,
                output: tr!("El perfil no tiene clave SSH.", "The profile has no SSH key."),
                hint: None,
                network_error: false,
            };
        }
        let key = profile.ssh_key_path.as_deref().unwrap();
        let r = process::run(
            ProcessRequest::new(client.native_ssh_path(), connection_test_args(&ssh_host(profile), &self.paths.expand_tilde(key)))
                .env(&self.paths.child_env)
                .timeout(Duration::from_secs(30)),
        );
        let mut result = parse_connection_output(&r.combined());
        if !result.success && (r.exit_code == -2 || crate::connection_status::is_network_error(&r.combined())) {
            result.network_error = true;
            result.hint = Some(tr!(
                "No se pudo conectar con {}: comprueba la conexión a Internet.",
                "Couldn't connect to {}: check your Internet connection.",
                ssh_host(profile)
            ));
            return result;
        }
        if !result.success && contains_ci(&r.combined(), "Permission denied") {
            result.hint = Some(self.diagnose_permission_denied(client, profile));
        }
        result
    }

    /// Con `BatchMode=yes` ssh no puede pedir la passphrase: si la clave la tiene y no está en el agente,
    /// el proveedor responde `Permission denied (publickey)` aunque la clave esté bien subida.
    fn diagnose_permission_denied(&self, client: &SshClientInfo, profile: &Profile) -> String {
        let key_path = profile.ssh_key_path.as_deref().unwrap_or("");
        let fingerprint = self.fingerprint(client, key_path);
        if self.has_passphrase(client, key_path) == Some(true) && self.is_loaded_in_agent(client, key_path) != Some(true) {
            let agent_advice = if client.kind == SshClientKind::WindowsOpenSsh && self.agent_state() != AgentState::Running {
                tr!(
                    "activa el servicio ssh-agent (PowerShell como administrador: Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent) y después pulsa «Añadir al agente…»",
                    "turn on the ssh-agent service (PowerShell as administrator: Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent) and then click “Add to agent…”"
                )
            } else {
                tr!("pulsa «Añadir al agente…» y escribe la passphrase", "click “Add to agent…” and type the passphrase")
            };
            return tr!(
                "La clave tiene passphrase y no está cargada en el agente: ssh no puede usarla sin preguntarte, así que el proveedor la rechaza aunque esté bien subida.\nSolución: {agent_advice}. Alternativa: quita la passphrase con ssh-keygen -p -f {key_path} (la clave es la misma; no hay que volver a subirla).",
                "The key has a passphrase and isn't loaded in the agent: ssh can't use it without asking you, so the provider rejects it even though it's uploaded correctly.\nFix: {agent_advice}. Alternative: remove the passphrase with ssh-keygen -p -f {key_path} (the key stays the same; no need to upload it again)."
            );
        }
        tr!(
            "Comprueba que la clave pública está subida {} en la cuenta correcta de {}{}",
            "Check that the public key is uploaded {} to the right {} account{}",
            if is_azure(profile) {
                tr!(
                    "en «User settings › SSH public keys» (Azure DevOps solo garantiza claves RSA)",
                    "in “User settings › SSH public keys” (Azure DevOps only guarantees RSA keys)"
                )
            } else {
                tr!("como «Authentication Key»", "as an “Authentication Key”")
            },
            profile.host,
            match fingerprint {
                None => ".".to_string(),
                Some(fp) => tr!(" y que allí aparece la huella {fp}.", " and that fingerprint {fp} shows up there."),
            }
        )
    }

    /// Con el SSH de Git for Windows, la firma usa el agente de la sesión (el de Git Bash o el que arranca
    /// SourceTree), que no guarda las claves entre sesiones. Si la clave de firma tiene passphrase y no está
    /// cargada en ese agente, `ssh-keygen -Y sign` se queda esperándola y el commit no termina.
    /// `true` cuando el perfil está en ese caso (cliente de Git, firma SSH y clave con passphrase).
    pub fn signing_needs_session_agent(&self, client: &SshClientInfo, profile: &Profile) -> bool {
        if client.kind != SshClientKind::GitBundled || profile.signing != crate::models::SigningMode::Ssh {
            return false;
        }
        let Some(key) = profile.signing_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) else {
            return false;
        };
        let private = key.strip_suffix(".pub").unwrap_or(key);
        self.has_passphrase(client, private) == Some(true)
    }

    /// `Some(true)` si la clave privada está cifrada; `None` si no se pudo determinar.
    pub fn has_passphrase(&self, client: &SshClientInfo, key_path: &str) -> Option<bool> {
        let full = self.paths.expand_tilde(key_path);
        if !Path::new(&full).is_file() {
            return None;
        }
        let r = process::run(
            ProcessRequest::new(client.native_ssh_keygen_path(), ["-y", "-P", "", "-f", full.as_str()])
                .timeout(Duration::from_secs(10)),
        );
        if r.success() {
            return Some(false);
        }
        contains_ci(&r.combined(), "passphrase").then_some(true)
    }

    /// Huella SHA256 de la clave pública (`ssh-keygen -lf`).
    pub fn fingerprint(&self, client: &SshClientInfo, key_path: &str) -> Option<String> {
        let public = format!("{}.pub", self.paths.expand_tilde(key_path));
        if !Path::new(&public).is_file() {
            return None;
        }
        let r = process::run(
            ProcessRequest::new(client.native_ssh_keygen_path(), ["-lf", public.as_str()]).timeout(Duration::from_secs(10)),
        );
        SHA256_RE.find(&r.stdout).map(|m| m.as_str().to_string())
    }

    /// `Some(true)` si el agente tiene la clave cargada; `None` si no hay agente accesible.
    pub fn is_loaded_in_agent(&self, client: &SshClientInfo, key_path: &str) -> Option<bool> {
        let fingerprint = self.fingerprint(client, key_path);
        let r = process::run(
            ProcessRequest::new(client.native_ssh_add_path(), ["-l"])
                .env(&self.paths.child_env)
                .timeout(Duration::from_secs(10)),
        );
        // 0 = lista de claves, 1 = agente sin claves, 2 = no se puede conectar con el agente.
        match r.exit_code {
            0 => Some(fingerprint.is_some_and(|fp| r.stdout.contains(&fp))),
            1 => Some(false),
            _ => None,
        }
    }
}

fn fingerprint_hint(pub_path: &str) -> Option<String> {
    let text = crate::files::file_guard::read_or_null(pub_path)?;
    let parts: Vec<&str> = text.trim().splitn(3, ' ').collect();
    if parts.len() < 2 {
        return None;
    }
    let blob: Vec<char> = parts[1].chars().collect();
    let tail: String = blob[blob.len().saturating_sub(12)..].iter().collect();
    Some(format!("{} …{}{}", parts[0], tail, if parts.len() == 3 { format!(" {}", parts[2]) } else { String::new() }))
}

pub fn connection_test_args(host: &str, key_full_path: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut h = host.to_string();
    if let Some(colon) = host.rfind(':').filter(|&c| c > 0)
        && host[colon + 1..].parse::<i64>().is_ok()
    {
        h = host[..colon].to_string();
        args.push("-p".to_string());
        args.push(host[colon + 1..].to_string());
    }
    args.extend(
        [
            "-T",
            "-i",
            key_full_path,
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "ConnectTimeout=15",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    args.push(format!("git@{h}"));
    args
}

pub fn parse_connection_output(output: &str) -> ConnectionTestResult {
    let ok = |account: Option<String>| ConnectionTestResult {
        success: true,
        account,
        output: output.into(),
        hint: None,
        network_error: false,
    };
    for re in [&*GITHUB_HELLO, &*GITLAB_WELCOME, &*BITBUCKET_LOGGED] {
        if let Some(m) = re.captures(output) {
            return ok(Some(m["u"].to_string()));
        }
    }
    // Azure DevOps no dice la cuenta: tras autenticar responde que no da acceso a una shell.
    if contains_ci(output, "authenticated via")
        || contains_ci(output, "successfully authenticated")
        || contains_ci(output, "Shell access is not supported")
    {
        return ok(None);
    }
    ConnectionTestResult { success: false, account: None, output: output.into(), hint: None, network_error: false }
}

/// Identidades con acceso a la clave privada distintas del usuario, SYSTEM y Administradores.
pub fn acl_offenders(file: &str) -> Vec<String> {
    let Some(me) = current_user_sid() else { return Vec::new() };
    let Some(sids) = win::allow_ace_sids(file) else { return Vec::new() };
    let mut out: Vec<String> = Vec::new();
    for sid in sids {
        if sid == me || TRUSTED_SIDS.contains(&sid.as_str()) || out.contains(&sid) {
            continue;
        }
        out.push(sid);
    }
    out
}

pub fn current_user_sid() -> Option<String> {
    win::current_user_sid()
}

pub fn describe_sid(sid: &str) -> String {
    win::lookup_sid(sid).unwrap_or_else(|| sid.to_string())
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;

    use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSidToSidW, GetNamedSecurityInfoW, SE_FILE_OBJECT,
    };
    use windows::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, DACL_SECURITY_INFORMATION, GetAce, GetTokenInformation,
        LookupAccountSidW, PSECURITY_DESCRIPTOR, PSID, SID_NAME_USE, TOKEN_QUERY, TOKEN_USER, TokenUser,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    use windows::core::{HSTRING, PCWSTR, PWSTR};

    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

    unsafe fn sid_to_string(sid: PSID) -> Option<String> {
        let mut s = PWSTR::null();
        unsafe { ConvertSidToStringSidW(sid, &mut s) }.ok()?;
        let r = unsafe { s.to_string() }.ok();
        unsafe {
            let _ = LocalFree(Some(HLOCAL(s.0 as *mut c_void)));
        }
        r
    }

    pub fn current_user_sid() -> Option<String> {
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).ok()?;
            let mut len = 0u32;
            let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
            let mut buf = vec![0u8; len as usize];
            let ok = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut c_void), len, &mut len);
            let _ = CloseHandle(token);
            ok.ok()?;
            let user = &*(buf.as_ptr() as *const TOKEN_USER);
            sid_to_string(user.User.Sid)
        }
    }

    pub fn allow_ace_sids(file: &str) -> Option<Vec<String>> {
        unsafe {
            let mut dacl: *mut ACL = std::ptr::null_mut();
            let mut sd = PSECURITY_DESCRIPTOR::default();
            let err = GetNamedSecurityInfoW(
                &HSTRING::from(file),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                None,
                None,
                Some(&mut dacl),
                None,
                &mut sd,
            );
            if err != ERROR_SUCCESS {
                return None;
            }
            let mut out = Vec::new();
            if !dacl.is_null() {
                for i in 0..(*dacl).AceCount as u32 {
                    let mut ace: *mut c_void = std::ptr::null_mut();
                    if GetAce(dacl, i, &mut ace).is_err() {
                        continue;
                    }
                    let header = &*(ace as *const ACE_HEADER);
                    if header.AceType != ACCESS_ALLOWED_ACE_TYPE {
                        continue;
                    }
                    let allowed = &*(ace as *const ACCESS_ALLOWED_ACE);
                    let sid = PSID(&allowed.SidStart as *const u32 as *mut c_void);
                    if let Some(s) = sid_to_string(sid) {
                        out.push(s);
                    }
                }
            }
            let _ = LocalFree(Some(HLOCAL(sd.0)));
            Some(out)
        }
    }

    pub fn lookup_sid(sid: &str) -> Option<String> {
        unsafe {
            let mut psid = PSID::default();
            ConvertStringSidToSidW(&HSTRING::from(sid), &mut psid).ok()?;
            let mut name = vec![0u16; 256];
            let mut domain = vec![0u16; 256];
            let (mut nlen, mut dlen) = (name.len() as u32, domain.len() as u32);
            let mut use_ = SID_NAME_USE::default();
            let ok = LookupAccountSidW(
                PCWSTR::null(),
                psid,
                Some(PWSTR(name.as_mut_ptr())),
                &mut nlen,
                Some(PWSTR(domain.as_mut_ptr())),
                &mut dlen,
                &mut use_,
            );
            let _ = LocalFree(Some(HLOCAL(psid.0)));
            ok.ok()?;
            let n = String::from_utf16_lossy(&name[..nlen as usize]);
            let d = String::from_utf16_lossy(&domain[..dlen as usize]);
            Some(if d.is_empty() { n } else { format!("{d}\\{n}") })
        }
    }
}

#[cfg(not(windows))]
mod win {
    pub fn current_user_sid() -> Option<String> {
        None
    }
    pub fn allow_ace_sids(_: &str) -> Option<Vec<String>> {
        None
    }
    pub fn lookup_sid(_: &str) -> Option<String> {
        None
    }
}
