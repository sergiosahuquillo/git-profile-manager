//! Git for Windows: la última release en GitHub, su instalador y la instalación sobre la existente.
//!
//! El instalador (Inno Setup) reutiliza las opciones de la instalación anterior: carpeta, componentes,
//! editor, GCM... Con `/VERYSILENT` no pregunta nada.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;

use super::{agent, dev_override, net_error};
use crate::app_paths::{AppPaths, local_app_data};
use crate::git::GitRunner;
use crate::git::runner::{GitVersion, parse_version_full};
use crate::process::{self, ProcessRequest};
use crate::{Error, Result, bail, tr};

const LATEST_URL: &str = "https://api.github.com/repos/git-for-windows/git/releases/latest";

static ASSET_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^Git-[\d.]+-(64-bit|arm64)\.exe$").unwrap());

/// Lo que ve el frontend de una actualización de Git.
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitUpdateInfo {
    /// Versión instalada (`2.53.0`), si se pudo leer.
    pub installed: Option<String>,
    /// Última release (`2.56.0.2`).
    pub latest: String,
    pub available: bool,
    /// Tamaño del instalador en bytes.
    #[ts(type = "number")]
    pub size: u64,
    /// Instalación por usuario (`%LOCALAPPDATA%\Programs\Git`): se actualiza sin permisos de administrador.
    pub per_user: bool,
    /// El instalador necesita permisos de administrador.
    pub needs_elevation: bool,
    /// Al instalar va a salir el diálogo de UAC. Falso si no hace falta elevar, si la app ya está elevada o
    /// si el UAC está apagado o configurado para no preguntar.
    pub prompts_uac: bool,
    /// El instalador de `latest` ya está descargado y verificado.
    pub downloaded: bool,
}

/// Instalador de una release.
#[derive(Clone, Debug)]
pub struct GitRelease {
    pub version: GitVersion,
    pub asset_name: String,
    pub url: String,
    pub size: u64,
    /// SHA-256 en hexadecimal, según GitHub.
    pub sha256: String,
}

#[derive(Deserialize)]
struct ReleaseJson {
    tag_name: String,
    assets: Vec<AssetJson>,
}

#[derive(Deserialize)]
struct AssetJson {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

/// Arquitectura del instalador según la de la máquina (`std::env::consts::ARCH`).
pub fn installer_arch() -> &'static str {
    if std::env::consts::ARCH == "aarch64" { "arm64" } else { "64-bit" }
}

/// Lee la respuesta de la API de releases y elige el instalador de `arch` (`64-bit` o `arm64`).
pub fn release_from_json(json: &str, arch: &str) -> Result<GitRelease> {
    let release: ReleaseJson = serde_json::from_str(json)?;
    let Some(version) = parse_version_full(&release.tag_name) else {
        bail!("{}", tr!("Etiqueta de release no reconocida: {}", "Unrecognized release tag: {}", release.tag_name));
    };
    let asset = release
        .assets
        .into_iter()
        .find(|a| ASSET_RE.captures(&a.name).is_some_and(|c| &c[1] == arch))
        .ok_or_else(|| Error::msg(tr!("La release no trae instalador para {}.", "The release has no installer for {}.", arch)))?;
    // Sin hash no se instala nada: es lo que garantiza que el fichero es el publicado.
    let sha256 = asset
        .digest
        .as_deref()
        .and_then(|d| d.strip_prefix("sha256:"))
        .filter(|h| h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()))
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| Error::msg(tr!("GitHub no publica el SHA-256 del instalador.", "GitHub doesn't publish the installer's SHA-256.")))?;
    Ok(GitRelease { version, asset_name: asset.name, url: asset.browser_download_url, size: asset.size, sha256 })
}

pub fn fetch_latest() -> Result<GitRelease> {
    let mut resp = agent(Some(Duration::from_secs(15)))
        .get(LATEST_URL)
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(net_error)?;
    let json = resp.body_mut().read_to_string().map_err(net_error)?;
    release_from_json(&json, installer_arch())
}

/// Versión instalada. En desarrollo, `GITPROFILEMANAGER_FAKE_GIT_VERSION` la sustituye para probar el flujo.
pub fn installed_version(git: &GitRunner) -> Option<GitVersion> {
    if let Some(fake) = dev_override("GITPROFILEMANAGER_FAKE_GIT_VERSION") {
        return parse_version_full(&fake);
    }
    git.version_full()
}

/// Dónde está instalado Git y qué permisos pide su instalador.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InstallTarget {
    pub per_user: bool,
    pub prompts_uac: bool,
}

impl InstallTarget {
    pub fn needs_elevation(&self) -> bool {
        !self.per_user
    }
}

/// Instalación por usuario: la desinstalación está registrada solo en HKCU o, si el registro no dice
/// nada, la carpeta cuelga de `%LOCALAPPDATA%`.
pub fn is_per_user(install_root: Option<&Path>) -> bool {
    #[cfg(windows)]
    if let Some(per_user) = super::win::git_registered_per_user() {
        return per_user;
    }
    install_root.is_some_and(|root| is_under(root, &local_app_data()))
}

pub fn is_under(path: &Path, dir: &Path) -> bool {
    let p = path.to_string_lossy().replace('/', "\\").to_lowercase();
    let d = dir.to_string_lossy().replace('/', "\\").to_lowercase();
    let d = d.trim_end_matches('\\');
    p.len() > d.len() && p.starts_with(d) && p[d.len()..].starts_with('\\')
}

pub fn install_target(git: &GitRunner) -> InstallTarget {
    let per_user = is_per_user(git.install_root().as_deref());
    let forced = dev_override("GITPROFILEMANAGER_FORCE_UAC_PROMPT").is_some();
    #[cfg(windows)]
    let prompts = !per_user && super::win::elevation_prompts();
    #[cfg(not(windows))]
    let prompts = false;
    InstallTarget { per_user, prompts_uac: forced || prompts }
}

fn installer_path(paths: &AppPaths, release: &GitRelease) -> PathBuf {
    paths.updates_dir().join(&release.asset_name)
}

fn sha256_of(path: &Path) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut f, &mut hasher).ok()?;
    Some(hex::encode(hasher.finalize()))
}

/// El instalador ya está descargado y su hash es el publicado.
pub fn is_downloaded(paths: &AppPaths, release: &GitRelease) -> bool {
    sha256_of(&installer_path(paths, release)).is_some_and(|h| h == release.sha256)
}

pub fn info(git: &GitRunner, paths: &AppPaths, release: &GitRelease) -> GitUpdateInfo {
    let installed = installed_version(git);
    let target = install_target(git);
    let available = installed.is_some_and(|v| release.version > v);
    GitUpdateInfo {
        installed: installed.map(|v| v.to_string()),
        latest: release.version.to_string(),
        available,
        size: release.size,
        per_user: target.per_user,
        needs_elevation: target.needs_elevation(),
        prompts_uac: target.prompts_uac,
        downloaded: available && is_downloaded(paths, release),
    }
}

/// Descarga el instalador a [`AppPaths::updates_dir`] y lo verifica (SHA-256 y firma Authenticode).
/// Si ya estaba descargado, no vuelve a bajarlo. Borra los de otras versiones.
/// `on_progress` recibe el porcentaje cada vez que cambia.
pub fn download(paths: &AppPaths, release: &GitRelease, mut on_progress: impl FnMut(u8)) -> Result<PathBuf> {
    let dir = paths.updates_dir();
    std::fs::create_dir_all(&dir)?;
    let dest = installer_path(paths, release);
    if is_downloaded(paths, release) {
        on_progress(100);
        return Ok(dest);
    }
    clean_except(&dir, None);

    let part = dir.join(format!("{}.part", release.asset_name));
    let mut resp = agent(None).get(&release.url).call().map_err(net_error)?;
    let total = resp.body().content_length().unwrap_or(release.size).max(1);
    let mut reader = resp.body_mut().as_reader();
    let mut file = std::fs::File::create(&part)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let (mut done, mut last) = (0u64, u8::MAX);
    loop {
        let n = reader.read(&mut buf).map_err(|e| {
            Error::msg(tr!("La descarga se interrumpió: {}", "The download was interrupted: {}", e))
        })?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        hasher.update(&buf[..n]);
        done += n as u64;
        let pct = (done * 100 / total).min(100) as u8;
        if pct != last {
            last = pct;
            on_progress(pct);
        }
    }
    file.flush()?;
    drop(file);

    if hex::encode(hasher.finalize()) != release.sha256 {
        let _ = std::fs::remove_file(&part);
        bail!(
            "{}",
            tr!(
                "El instalador descargado no coincide con el publicado (SHA-256). Se ha descartado.",
                "The downloaded installer doesn't match the published one (SHA-256). It was discarded."
            )
        );
    }
    std::fs::rename(&part, &dest)?;
    if let Err(e) = verify_signature(&dest) {
        let _ = std::fs::remove_file(&dest);
        return Err(e);
    }
    Ok(dest)
}

/// Firma Authenticode válida (la de Git for Windows). Fuera de Windows no hay nada que comprobar.
pub fn verify_signature(path: &Path) -> Result<()> {
    #[cfg(windows)]
    if !super::win::authenticode_valid(path) {
        bail!(
            "{}",
            tr!(
                "El instalador no tiene una firma digital válida. Se ha descartado.",
                "The installer doesn't have a valid digital signature. It was discarded."
            )
        );
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

/// Borra lo descargado salvo `keep`.
fn clean_except(dir: &Path, keep: Option<&Path>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_file() && keep != Some(p.as_path()) {
            let _ = std::fs::remove_file(p);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallOutcome {
    Installed,
    /// El usuario rechazó el diálogo de UAC.
    Cancelled,
}

/// Para quién se instala Git desde cero. El instalador de Git for Windows no tiene un parámetro para
/// esto: lo decide con qué permisos se ejecuta (elevado: Program Files y HKLM; sin elevar: HKCU).
#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export)]
pub enum InstallScope {
    /// Solo el usuario actual, en `%LOCALAPPDATA%\Programs\Git`. Nunca pide permisos.
    User,
    /// Todos los usuarios, en Program Files. Necesita permisos de administrador.
    Machine,
}

/// Lo que puede elegir el usuario al instalar Git desde cero.
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitInstallOptions {
    /// Versión que se instalará (`2.56.0.2`).
    pub latest: String,
    #[ts(type = "number")]
    pub size: u64,
    /// El usuario es administrador: puede instalar para todos.
    pub can_install_machine: bool,
    /// Puede instalar solo para él. No si la app ya se ejecuta elevada: el instalador heredaría los
    /// permisos y se registraría para todo el equipo.
    pub can_install_user: bool,
    /// Instalar para todos va a mostrar el diálogo de UAC.
    pub machine_prompts_uac: bool,
}

pub fn install_options(release: &GitRelease) -> GitInstallOptions {
    #[cfg(windows)]
    let (admin, elevated, prompts) =
        (super::win::is_admin_user(), super::win::is_elevated(), super::win::elevation_prompts());
    #[cfg(not(windows))]
    let (admin, elevated, prompts) = (false, false, false);
    let forced = dev_override("GITPROFILEMANAGER_FORCE_UAC_PROMPT").is_some();
    GitInstallOptions {
        latest: release.version.to_string(),
        size: release.size,
        can_install_machine: admin,
        can_install_user: !elevated,
        machine_prompts_uac: forced || prompts,
    }
}

/// Carpeta de una instalación solo para el usuario (la que propone el propio instalador).
pub fn user_install_dir() -> PathBuf {
    local_app_data().join("Programs").join("Git")
}

/// Argumentos de una instalación silenciosa. Sobre una existente, el instalador reutiliza sus opciones y
/// su carpeta. Desde cero (`fresh`), se usan las opciones por defecto de Git salvo las que necesita la app:
/// GCM activado y Git en el PATH; y solo para el usuario se fija la carpeta, que el instalador no cambia
/// por sí mismo en modo silencioso.
pub fn installer_args(log: &Path, fresh: Option<InstallScope>) -> Vec<String> {
    let mut args = process::strings(["/VERYSILENT", "/NORESTART", "/NOCANCEL", "/SP-", "/SUPPRESSMSGBOXES", "/CLOSEAPPLICATIONS"]);
    if let Some(scope) = fresh {
        args.push("/o:UseCredentialManager=Enabled".into());
        args.push("/o:PathOption=Cmd".into());
        if scope == InstallScope::User {
            args.push(format!("/DIR={}", user_install_dir().display()));
        }
    }
    args.push(format!("/LOG={}", log.display()));
    args
}

/// Instala la versión descargada encima de la existente, con el alcance que ya tenga. Si es de todo el
/// equipo y la app no está elevada, lo lanza con `runas` (UAC). Al terminar bien, borra el instalador.
pub fn install(git: &GitRunner, installer: &Path) -> Result<InstallOutcome> {
    let target = install_target(git);
    #[cfg(windows)]
    let elevate = target.needs_elevation() && !super::win::is_elevated();
    #[cfg(not(windows))]
    let elevate = { let _ = target; false };
    run_installer(installer, None, elevate)
}

/// Instala Git donde no lo hay.
pub fn install_fresh(installer: &Path, scope: InstallScope) -> Result<InstallOutcome> {
    #[cfg(windows)]
    let elevated = super::win::is_elevated();
    #[cfg(not(windows))]
    let elevated = false;
    if scope == InstallScope::User && elevated {
        bail!(
            "{}",
            tr!(
                "La app se está ejecutando como administrador: Git solo se puede instalar para todos los usuarios.",
                "The app is running as administrator: Git can only be installed for all users."
            )
        );
    }
    run_installer(installer, Some(scope), scope == InstallScope::Machine && !elevated)
}

fn run_installer(installer: &Path, fresh: Option<InstallScope>, elevate: bool) -> Result<InstallOutcome> {
    let log = installer.with_file_name("git-install.log");
    let args = installer_args(&log, fresh);

    #[cfg(windows)]
    let code = if elevate {
        match super::win::run_elevated(installer, &args)? {
            Some(code) => code,
            None => return Ok(InstallOutcome::Cancelled),
        }
    } else {
        run_plain(installer, args)?
    };
    #[cfg(not(windows))]
    let code = {
        let _ = elevate;
        run_plain(installer, args)?
    };

    if code != 0 {
        bail!(
            "{}",
            tr!(
                "El instalador de Git terminó con el código {}. Detalles en {}",
                "The Git installer exited with code {}. Details in {}",
                code,
                log.display()
            )
        );
    }
    clean_except(installer.parent().unwrap_or(Path::new(".")), None);
    Ok(InstallOutcome::Installed)
}

fn run_plain(installer: &Path, args: Vec<String>) -> Result<i32> {
    let r = process::run(ProcessRequest::new(installer, args).timeout(Duration::from_secs(15 * 60)));
    if r.exit_code == -1 && !r.stderr.is_empty() {
        bail!("{}", r.stderr);
    }
    Ok(r.exit_code)
}
