//! Ficheros generados, comparados byte a byte con la salida esperada de `fixtures/generated`.
//!
//! Si un cambio en el generador es intencionado, regenera los ficheros esperados y revisa el diff:
//! `$env:GPM_BLESS = "1"; cargo test -p gpm-core --test generated`

use std::path::{Path, PathBuf};

use gpm_core::AppPaths;
use gpm_core::config::{ConfigGenerator, SshClientInfo};
use gpm_core::models::{AppState, NoProfileMode, SshClientKind};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("generated")
}

fn paths() -> AppPaths {
    AppPaths::new(r"C:\Users\juan", r"C:\tmp")
}

fn load_state() -> AppState {
    let json = std::fs::read_to_string(fixtures().join("profiles.json")).unwrap();
    serde_json::from_str(&json).unwrap()
}

fn git_bundled() -> SshClientInfo {
    SshClientInfo::resolve(SshClientKind::GitBundled, Some(Path::new(r"C:\Program Files\Git")))
}

/// Compara `actual` con el fichero esperado, o lo reescribe con `GPM_BLESS=1`.
fn check(relative: &str, actual: &str) {
    let path = fixtures().join(relative);
    if std::env::var_os("GPM_BLESS").is_some() {
        std::fs::write(&path, actual).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("falta {relative}"));
    assert_eq!(actual, expected, "{relative} no coincide con la salida esperada");
}

fn compare(client: SshClientInfo, dir: &str, count: usize) {
    let files = ConfigGenerator::new(&paths()).generate_all(&load_state(), &client);
    assert_eq!(files.len(), count);
    for f in files {
        let name = Path::new(&f.path).file_name().unwrap().to_string_lossy().into_owned();
        check(&format!("{dir}/{name}"), &f.content);
    }
}

#[test]
fn generated_files_with_windows_openssh() {
    // Con OpenSSH de Windows se añade ssh-keygen.cmd, el envoltorio de la firma.
    compare(SshClientInfo::windows_openssh(), "openssh", 7);
}

#[test]
fn generated_files_with_git_bundled_ssh() {
    compare(git_bundled(), "git-bundled", 6);
    assert!(!ConfigGenerator::new(&paths()).generate_all(&load_state(), &git_bundled()).iter().any(|f| f.path.ends_with(".cmd")));
}

#[test]
fn strict_rules() {
    let mut state = load_state();
    state.settings.no_profile_mode = NoProfileMode::Strict;
    check("rules.strict.gitconfig", &ConfigGenerator::new(&paths()).generate_rules(&state));
}

#[test]
fn profiles_json_round_trips_without_losing_fields() {
    let state = load_state();
    let again: AppState = serde_json::from_str(&serde_json::to_string_pretty(&state).unwrap()).unwrap();
    assert_eq!(state, again);
    assert_eq!(state.profiles.len(), 3);
    assert_eq!(state.profiles[1].rules[2].host.as_deref(), Some("gitlab.corp.local"));
}
