use std::sync::atomic::{AtomicBool, Ordering};
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
    /// Hay una descarga o instalación de Git en curso.
    git_update_busy: Arc<AtomicBool>,
}

/// Copia de lo necesario para ejecutar Git/SSH sin mantener el bloqueo.
pub struct Snapshot {
    pub paths: AppPaths,
    pub git: GitRunner,
    pub state: AppState,
}

impl Ctx {
    pub fn new(ws: Workspace) -> Self {
        Ctx {
            ws: Arc::new(Mutex::new(ws)),
            bootstrapped: Arc::new(Mutex::new(false)),
            git_update_busy: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn lock(&self) -> MutexGuard<'_, Workspace> {
        // Un pánico en otro comando no debe dejar la app inservible.
        self.ws.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Reserva la actualización de Git; `None` si ya hay otra en curso. Se libera al soltar el guard.
    pub fn git_update_guard(&self) -> Option<BusyGuard> {
        let flag = self.git_update_busy.clone();
        (!flag.swap(true, Ordering::AcqRel)).then_some(BusyGuard(flag))
    }

    pub fn snapshot(&self) -> Snapshot {
        let w = self.lock();
        Snapshot { paths: w.paths.clone(), git: w.git.clone(), state: w.state.clone() }
    }
}

pub struct BusyGuard(Arc<AtomicBool>);

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Ejecuta trabajo bloqueante (procesos, disco) fuera del hilo de la UI.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| CmdError::new(e.to_string()))?
}
