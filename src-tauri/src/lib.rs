mod commands;
mod error;
mod state;

use std::io::Write;

use gpm_core::{AppPaths, Workspace};
use tauri::Manager;

use crate::state::Ctx;

/// Añade una entrada a `error.log` con fecha ISO 8601.
pub fn append_error_log(path: &str, message: &str) {
    if let Some(dir) = std::path::Path::new(path).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[{}] {message}\n", chrono::Local::now().to_rfc3339());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = AppPaths::from_environment();
    let log_path = paths.error_log();
    std::panic::set_hook(Box::new(move |info| append_error_log(&log_path, &info.to_string())));

    let ctx = Ctx::new(Workspace::new(paths, None));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ctx)
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::set_language,
            commands::get_overview,
            commands::get_environment,
            commands::profiles_health,
            commands::plan_save,
            commands::save,
            commands::set_first_run_completed,
            commands::analyze_rules,
            commands::preview_generated,
            commands::drift_changes,
            commands::regenerate_drifted,
            commands::ssh_generate_key,
            commands::ssh_import_key,
            commands::ssh_key_status,
            commands::ssh_fingerprint,
            commands::ssh_read_public_key,
            commands::ssh_plan_acl_fix,
            commands::ssh_apply_acl_fix,
            commands::ssh_agent_state,
            commands::ssh_add_to_agent,
            commands::ssh_test_connection,
            commands::ssh_client_info,
            commands::credential_approve,
            commands::credential_reject,
            commands::credential_check,
            commands::credential_provider_flow,
            commands::credential_describe_relogin,
            commands::credential_relogin,
            commands::credential_saved_accounts,
            commands::connection_status,
            commands::connection_status_refresh,
            commands::integration_plan_enable,
            commands::integration_plan_disable,
            commands::integration_enable,
            commands::integration_disable,
            commands::uninstall_plan,
            commands::uninstall,
            commands::list_backups,
            commands::backup_restore_plan,
            commands::restore_backup,
            commands::diagnose_repo,
            commands::find_repos,
            commands::apply_fix,
            commands::clone_defaults,
            commands::clone_preview,
            commands::clone_run,
            commands::set_update_mode,
            commands::check_git_update,
            commands::download_git_update,
            commands::install_git_update,
            commands::git_install_options,
            commands::install_git,
            commands::sourcetree_status,
            commands::open_in_explorer,
            commands::open_in_sourcetree,
            commands::is_directory,
            commands::log_error,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar GitProfile Manager");
}
