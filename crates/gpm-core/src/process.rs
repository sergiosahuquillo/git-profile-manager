//! Lanza procesos con la lista de argumentos tal cual, sin concatenarlos ni pasar por un shell.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use zeroize::Zeroizing;

#[derive(Clone, Debug, Default)]
pub struct ProcessResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl ProcessResult {
    pub fn success(&self) -> bool {
        self.exit_code == 0
    }
    pub fn combined(&self) -> String {
        format!("{}\n{}", self.stdout, self.stderr).trim().to_string()
    }
    fn failed(code: i32, stdout: String, msg: impl Into<String>) -> Self {
        ProcessResult { exit_code: code, stdout, stderr: msg.into() }
    }
}

pub struct ProcessRequest {
    pub file_name: PathBuf,
    pub args: Vec<String>,
    pub working_dir: Option<PathBuf>,
    /// Variables de entorno; `None` elimina la variable en el proceso hijo.
    pub env: Vec<(String, Option<String>)>,
    /// Bytes que se escriben en stdin. Se usa para secretos: nunca van en los argumentos.
    pub stdin: Option<Zeroizing<Vec<u8>>>,
    pub timeout: Duration,
}

impl ProcessRequest {
    pub fn new(file_name: impl Into<PathBuf>, args: impl IntoIterator<Item = impl Into<String>>) -> Self {
        ProcessRequest {
            file_name: file_name.into(),
            args: args.into_iter().map(Into::into).collect(),
            working_dir: None,
            env: Vec::new(),
            stdin: None,
            timeout: Duration::from_secs(120),
        }
    }
    pub fn timeout(mut self, t: Duration) -> Self {
        self.timeout = t;
        self
    }
    pub fn env(mut self, env: &[(String, Option<String>)]) -> Self {
        self.env.extend_from_slice(env);
        self
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

fn base_command(file: &Path, args: &[String], cwd: Option<&Path>, env: &[(String, Option<String>)]) -> Command {
    let mut cmd = Command::new(file);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    for (k, v) in env {
        match v {
            Some(v) => cmd.env(k, v),
            None => cmd.env_remove(k),
        };
    }
    cmd
}

/// Ejecuta un proceso oculto y recoge stdout/stderr (UTF-8).
pub fn run(req: ProcessRequest) -> ProcessResult {
    run_streaming(req, |_| {})
}

/// Igual que [`run`], pero entrega los fragmentos de stderr según llegan (progreso de `git clone`).
pub fn run_streaming(req: ProcessRequest, mut on_stderr: impl FnMut(&str)) -> ProcessResult {
    let mut cmd = base_command(&req.file_name, &req.args, req.working_dir.as_deref(), &req.env);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return ProcessResult::failed(-1, String::new(), e.to_string()),
    };

    let mut stdout = child.stdout.take().expect("stdout");
    let mut stderr = child.stderr.take().expect("stderr");
    let out_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let err_thread = std::thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        loop {
            match stderr.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(chunk[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // stdin se cierra siempre al soltarlo, haya o no algo que escribir.
    let stdin = child.stdin.take();
    if let (Some(mut stdin), Some(bytes)) = (stdin, &req.stdin) {
        let _ = stdin.write_all(bytes);
        let _ = stdin.flush();
    }

    let start = Instant::now();
    let mut err_bytes: Vec<u8> = Vec::new();
    let status = loop {
        while let Ok(chunk) = rx.try_recv() {
            on_stderr(&String::from_utf8_lossy(&chunk));
            err_bytes.extend_from_slice(&chunk);
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {}
            Err(_) => break None,
        }
        if start.elapsed() > req.timeout {
            kill_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
            let out = out_thread.join().unwrap_or_default();
            return ProcessResult::failed(-2, String::from_utf8_lossy(&out).into_owned(), crate::tr!("Tiempo de espera agotado.", "Timed out."));
        }
        std::thread::sleep(Duration::from_millis(15));
    };

    let out = out_thread.join().unwrap_or_default();
    let _ = err_thread.join();
    while let Ok(chunk) = rx.try_recv() {
        on_stderr(&String::from_utf8_lossy(&chunk));
        err_bytes.extend_from_slice(&chunk);
    }
    ProcessResult {
        exit_code: status.and_then(|s| s.code()).unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out).into_owned(),
        stderr: String::from_utf8_lossy(&err_bytes).into_owned(),
    }
}

/// Abre el programa en una consola visible y espera a que el usuario la cierre
/// (passphrase de `ssh-keygen` o `ssh-add`: la app nunca la ve).
pub fn run_in_console(file: &Path, args: &[String]) -> std::io::Result<i32> {
    let mut cmd = base_command(file, args, None, &[]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    let status = cmd.spawn()?.wait()?;
    Ok(status.code().unwrap_or(-1))
}

/// Lanza un programa sin esperar (Explorador, SourceTree).
pub fn spawn_detached(file: &Path, args: &[String]) -> std::io::Result<()> {
    base_command(file, args, None, &[]).spawn().map(|_| ())
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    let _ = pid;
}

/// Muestra un comando al usuario (vistas previas). No se usa nunca para ejecutar.
pub fn describe(file_name: &str, args: &[String]) -> String {
    fn quote(s: &str) -> String {
        if !s.is_empty() && s.chars().all(|c| !c.is_whitespace() && c != '"') {
            s.to_string()
        } else {
            format!("\"{}\"", s.replace('"', "\\\""))
        }
    }
    let stem = Path::new(file_name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    std::iter::once(quote(&stem)).chain(args.iter().map(|a| quote(a))).collect::<Vec<_>>().join(" ")
}

pub fn strings<const N: usize>(a: [&str; N]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}
