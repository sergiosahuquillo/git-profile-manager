//! Estado persistente de las pruebas SSH/HTTPS (`status.json`).

mod common;

use chrono::{Duration, TimeZone, Utc};
use common::TempHome;
use gpm_core::config::SshClientInfo;
use gpm_core::connection_status::{CheckKind, CheckOutcome, StatusStore, is_network_error};
use gpm_core::models::{AppState, Profile};

fn profile(h: &TempHome) -> Profile {
    let ssh = h.home.join(".ssh");
    std::fs::create_dir_all(&ssh).unwrap();
    std::fs::write(ssh.join("id_ed25519_p"), "privada").unwrap();
    std::fs::write(ssh.join("id_ed25519_p.pub"), "ssh-ed25519 AAAAuno p@x.com\n").unwrap();
    Profile {
        display_name: "P".into(),
        slug: "p".into(),
        git_user_name: "P".into(),
        git_user_email: "p@x.com".into(),
        ssh_key_path: Some("~/.ssh/id_ed25519_p".into()),
        https_username: Some("pepe".into()),
        https_check_repo_url: Some("https://github.com/pepe/repo".into()),
        is_default: true,
        ..Profile::default()
    }
}

fn ok(account: &str) -> CheckOutcome {
    CheckOutcome { success: true, account: Some(account.into()), message: "OK".into(), network_error: false }
}

fn offline() -> CheckOutcome {
    CheckOutcome { success: false, account: None, message: "Could not resolve host".into(), network_error: true }
}

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 19, 12, 0, 0).unwrap()
}

#[test]
fn records_survive_a_reload() {
    let h = TempHome::new();
    let client = SshClientInfo::windows_openssh();
    let p = profile(&h);
    let state = AppState { profiles: vec![p.clone()], ..AppState::default() };

    let mut store = StatusStore::load(&h.paths);
    store.record(&h.paths, &client, &p, CheckKind::Ssh, ok("pepe"), now()).unwrap();
    store.save(&h.paths).unwrap();

    let reloaded = StatusStore::load(&h.paths).snapshot(&h.paths, &client, &state);
    assert_eq!(reloaded.len(), 1);
    assert_eq!(reloaded[0].kind, CheckKind::Ssh);
    assert!(reloaded[0].record.success);
    assert_eq!(reloaded[0].record.account.as_deref(), Some("pepe"));
    assert!(!h.read(&h.paths.status_json()).contains("privada"));
}

#[test]
fn changing_what_was_tested_invalidates_the_record() {
    let h = TempHome::new();
    let client = SshClientInfo::windows_openssh();
    let p = profile(&h);
    let mut store = StatusStore::default();
    store.record(&h.paths, &client, &p, CheckKind::Ssh, ok("pepe"), now());
    store.record(&h.paths, &client, &p, CheckKind::Https, ok("pepe"), now());

    let other_key = Profile { ssh_key_path: Some("~/.ssh/otra".into()), ..p.clone() };
    assert!(store.valid(&h.paths, &client, &other_key, CheckKind::Ssh).is_none());
    let other_host = Profile { host: "gitlab.com".into(), ..p.clone() };
    assert!(store.valid(&h.paths, &client, &other_host, CheckKind::Ssh).is_none());
    assert!(store.valid(&h.paths, &client, &other_host, CheckKind::Https).is_none());
    let other_user = Profile { https_username: Some("otro".into()), ..p.clone() };
    assert!(store.valid(&h.paths, &client, &other_user, CheckKind::Https).is_none());
    assert!(store.valid(&h.paths, &client, &other_user, CheckKind::Ssh).is_some());

    // Regenerar la clave con el mismo nombre también invalida la prueba SSH.
    std::fs::write(h.home.join(".ssh").join("id_ed25519_p.pub"), "ssh-ed25519 AAAAdos p@x.com\n").unwrap();
    assert!(store.valid(&h.paths, &client, &p, CheckKind::Ssh).is_none());
}

#[test]
fn a_network_failure_keeps_the_previous_ok() {
    let h = TempHome::new();
    let client = SshClientInfo::windows_openssh();
    let p = profile(&h);
    let mut store = StatusStore::default();
    store.record(&h.paths, &client, &p, CheckKind::Https, ok("pepe"), now());

    let check = store.record(&h.paths, &client, &p, CheckKind::Https, offline(), now() + Duration::hours(30)).unwrap();
    assert!(check.offline);
    assert!(check.record.success);
    assert!(store.valid(&h.paths, &client, &p, CheckKind::Https).unwrap().success);

    // Un fallo real (no de red) sí sustituye al OK.
    let denied = CheckOutcome { success: false, account: None, message: "denied".into(), network_error: false };
    let check = store.record(&h.paths, &client, &p, CheckKind::Https, denied, now()).unwrap();
    assert!(!check.offline && !check.record.success);
}

#[test]
fn stale_respects_age_and_skips_profiles_without_anything_to_check() {
    let h = TempHome::new();
    let client = SshClientInfo::windows_openssh();
    let p = profile(&h);
    let bare = Profile { slug: "vacio".into(), is_default: false, ..Profile::default() };
    let state = AppState { profiles: vec![p.clone(), bare], ..AppState::default() };
    let mut store = StatusStore::default();
    let max = Duration::hours(24);

    assert_eq!(store.stale(&h.paths, &client, &state, max, now()).len(), 2);
    store.record(&h.paths, &client, &p, CheckKind::Ssh, ok("pepe"), now());
    store.record(&h.paths, &client, &p, CheckKind::Https, ok("pepe"), now());
    assert!(store.stale(&h.paths, &client, &state, max, now() + Duration::hours(23)).is_empty());
    assert_eq!(store.stale(&h.paths, &client, &state, max, now() + Duration::hours(25)).len(), 2);
}

#[test]
fn prune_forgets_deleted_profiles() {
    let h = TempHome::new();
    let client = SshClientInfo::windows_openssh();
    let p = profile(&h);
    let mut store = StatusStore::default();
    store.record(&h.paths, &client, &p, CheckKind::Ssh, ok("pepe"), now());
    store.prune(&AppState::default());
    assert!(store.valid(&h.paths, &client, &p, CheckKind::Ssh).is_none());
}

#[test]
fn a_corrupt_status_file_is_ignored() {
    let h = TempHome::new();
    std::fs::create_dir_all(&h.paths.app_data_dir).unwrap();
    std::fs::write(h.paths.status_json(), "{ no es json").unwrap();
    let client = SshClientInfo::windows_openssh();
    let state = AppState { profiles: vec![profile(&h)], ..AppState::default() };
    assert!(StatusStore::load(&h.paths).snapshot(&h.paths, &client, &state).is_empty());
}

#[test]
fn classifies_network_errors() {
    for out in [
        "ssh: Could not resolve hostname github.com: No such host is known.",
        "fatal: unable to access 'https://github.com/x/y/': Could not resolve host: github.com",
        "fatal: unable to access 'https://github.com/x/y/': Failed to connect to github.com port 443",
        "ssh: connect to host github.com port 22: Connection timed out",
    ] {
        assert!(is_network_error(out), "{out}");
    }
    for out in ["git@github.com: Permission denied (publickey).", "remote: Repository not found."] {
        assert!(!is_network_error(out), "{out}");
    }
}

/// La credencial HTTPS contra un host que no resuelve se clasifica como error de red, no como inválida.
#[test]
fn https_check_against_an_unreachable_host_is_a_network_error() {
    let h = TempHome::new();
    let p = Profile {
        host: "no-existe.invalid".into(),
        https_username: Some("pepe".into()),
        https_check_repo_url: Some("https://no-existe.invalid/pepe/repo".into()),
        ..Profile::default()
    };
    let r = gpm_core::credentials::CredentialService::new(&h.ws.git).check(&p);
    assert!(!r.valid);
    assert!(r.network_error, "{}", r.message);
}
