use std::sync::{Arc, Mutex, MutexGuard};

use gpm_core::models::AppState;
use gpm_core::{AppPaths, Workspace};
use gpm_core::git::GitRunner;

use crate::error::{CmdError, CmdResult};

/// Estado compartido de la app. Las operaciones largas trabajan sobre una copia
/// ([`Ctx::snapshot`]) para no bloquear el resto de comandos mientras se ejecutan.
#[derive(Clone)]
pub struct Ctx {
    ws: Arc<Mutex<Workspace>>,
    pub bootstrapped: Arc<Mutex<bool>>,
}

/// Copia de lo necesario para ejecutar Git/SSH sin mantener el bloqueo.
pub struct Snapshot {
    pub paths: AppPaths,
    pub git: GitRunner,
    pub state: AppState,
}

impl Ctx {
    pub fn new(ws: Workspace) -> Self {
        Ctx { ws: Arc::new(Mutex::new(ws)), bootstrapped: Arc::new(Mutex::new(false)) }
    }

    pub fn lock(&self) -> MutexGuard<'_, Workspace> {
        // Un pánico en otro comando no debe dejar la app inservible.
        self.ws.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn snapshot(&self) -> Snapshot {
        let w = self.lock();
        Snapshot { paths: w.paths.clone(), git: w.git.clone(), state: w.state.clone() }
    }
}

/// Ejecuta trabajo bloqueante (procesos, disco) fuera del hilo de la UI.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| CmdError::new(e.to_string()))?
}
