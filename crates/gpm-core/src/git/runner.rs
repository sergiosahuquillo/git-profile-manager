use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;

use crate::app_paths::AppPaths;
use crate::git::text::unquote_c;
use crate::process::{self, ProcessRequest, ProcessResult};

pub const MINIMUM_VERSION: (u32, u32, u32) = (2, 36, 0);

static VERSION_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\d+)\.(\d+)\.(\d+)").unwrap());

/// Opciones de una ejecución de Git.
#[derive(Default)]
pub struct GitRun<'a> {
    pub cwd: Option<&'a Path>,
    pub env: Vec<(String, Option<String>)>,
    pub stdin: Option<zeroize::Zeroizing<Vec<u8>>>,
    pub timeout: Option<Duration>,
}

/// Localiza `git.exe`, comprueba la versión y ejecuta comandos Git.
#[derive(Clone, Debug)]
pub struct GitRunner {
    pub git_path: Option<PathBuf>,
    home: PathBuf,
    child_env: Vec<(String, Option<String>)>,
}

impl GitRunner {
    pub fn new(paths: &AppPaths, git_path: Option<PathBuf>) -> Self {
        GitRunner { git_path: git_path.or_else(locate), home: paths.home.clone(), child_env: paths.child_env.clone() }
    }

    pub fn is_available(&self) -> bool {
        self.git_path.is_some()
    }

    pub fn child_env(&self) -> &[(String, Option<String>)] {
        &self.child_env
    }

    fn request(&self, args: Vec<String>, opts: GitRun<'_>) -> Option<ProcessRequest> {
        let git = self.git_path.clone()?;
        let mut env = self.child_env.clone();
        // Salida estable y en inglés para poder interpretarla.
        env.push(("LANG".into(), Some("C".into())));
        env.push(("LC_ALL".into(), Some("C".into())));
        env.extend(opts.env);
        Some(ProcessRequest {
            file_name: git,
            args,
            working_dir: opts.cwd.map(Path::to_path_buf),
            env,
            stdin: opts.stdin,
            timeout: opts.timeout.unwrap_or(Duration::from_secs(120)),
        })
    }

    pub fn run_with(&self, args: Vec<String>, opts: GitRun<'_>) -> ProcessResult {
        match self.request(args, opts) {
            Some(req) => process::run(req),
            None => missing(),
        }
    }

    pub fn run_streaming(&self, args: Vec<String>, opts: GitRun<'_>, on_stderr: impl FnMut(&str)) -> ProcessResult {
        match self.request(args, opts) {
            Some(req) => process::run_streaming(req, on_stderr),
            None => missing(),
        }
    }

    pub fn run(&self, args: &[&str]) -> ProcessResult {
        self.run_with(args.iter().map(|s| s.to_string()).collect(), GitRun::default())
    }

    pub fn run_in(&self, cwd: &Path, args: &[&str]) -> ProcessResult {
        self.run_with(args.iter().map(|s| s.to_string()).collect(), GitRun { cwd: Some(cwd), ..Default::default() })
    }

    pub fn version(&self) -> Option<(u32, u32, u32)> {
        let r = self.run(&["--version"]);
        if r.success() { parse_version(&r.stdout) } else { None }
    }

    /// Ruta del `.gitconfig` global según Git (puede estar redirigido con HOME o GIT_CONFIG_GLOBAL).
    pub fn global_config_path(&self) -> String {
        let r = self.run(&["config", "--global", "--list", "--show-origin"]);
        if r.success() {
            for line in r.stdout.split('\n') {
                if !line.starts_with("file:") {
                    continue;
                }
                if let Some(tab) = line.find('\t').filter(|&t| t > 5) {
                    return crate::app_paths::full_path(&unquote_c(&line[5..tab]).replace('/', "\\"));
                }
            }
        }
        if let Some((_, Some(v))) = self.child_env.iter().find(|(k, _)| k == "GIT_CONFIG_GLOBAL")
            && !v.is_empty()
        {
            return v.clone();
        }
        if let Ok(v) = std::env::var("GIT_CONFIG_GLOBAL")
            && !v.is_empty()
        {
            return v;
        }
        self.home.join(".gitconfig").to_string_lossy().into_owned()
    }

    pub fn get_global(&self, key: &str) -> Option<String> {
        let r = self.run(&["config", "--global", "--get", key]);
        r.success().then(|| r.stdout.trim_end_matches(['\r', '\n']).to_string())
    }

    /// Raíz de la instalación de Git for Windows (p. ej. `C:\Program Files\Git`).
    pub fn install_root(&self) -> Option<PathBuf> {
        let git = self.git_path.as_ref()?;
        let mut dir = git.parent();
        while let Some(d) = dir {
            if d.join("usr").join("bin").join("ssh.exe").is_file() {
                return Some(d.to_path_buf());
            }
            dir = d.parent();
        }
        None
    }

    pub fn credential_manager_version(&self) -> Option<String> {
        let r = self.run(&["credential-manager", "--version"]);
        r.success().then(|| r.stdout.trim().split('+').next().unwrap_or("").to_string())
    }

    /// Valores efectivos de `credential.helper` (todos los ámbitos).
    pub fn credential_helpers(&self) -> Vec<String> {
        let r = self.run(&["config", "--get-all", "credential.helper"]);
        if !r.success() {
            return Vec::new();
        }
        r.stdout.split('\n').map(str::trim).filter(|s| !s.is_empty()).map(String::from).collect()
    }
}

fn missing() -> ProcessResult {
    ProcessResult { exit_code: -1, stdout: String::new(), stderr: crate::tr!("No se encuentra git.exe.", "git.exe not found.") }
}

pub fn parse_version(output: &str) -> Option<(u32, u32, u32)> {
    let m = VERSION_RE.captures(output)?;
    Some((m[1].parse().ok()?, m[2].parse().ok()?, m[3].parse().ok()?))
}

pub fn format_version(v: (u32, u32, u32)) -> String {
    format!("{}.{}.{}", v.0, v.1, v.2)
}

pub fn locate() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let dir = PathBuf::from(dir.to_string_lossy().trim_matches('"'));
            let candidate = dir.join("git.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(var) {
            let candidate = PathBuf::from(root).join("Git").join("cmd").join("git.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let local = crate::app_paths::local_app_data().join("Programs").join("Git").join("cmd").join("git.exe");
    local.is_file().then_some(local)
}
