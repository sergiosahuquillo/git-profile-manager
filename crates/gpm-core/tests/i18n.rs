//! Mensajes del núcleo en inglés. Binario aparte: el idioma es global y no debe afectar al resto de tests.

use gpm_core::environment::findings_from_settings;
use gpm_core::files::file_guard::BackupReason;
use gpm_core::git::GitUrl;
use gpm_core::i18n::{Lang, lang, set_lang};
use gpm_core::models::{AppSettings, AppState, Profile};
use gpm_core::profile_validator::validate;

#[test]
fn messages_follow_the_selected_language() {
    assert_eq!(lang(), Lang::Es);
    let err = GitUrl::parse_or_err("no-es-una-url").unwrap_err().to_string();
    assert_eq!(err, "URL Git no válida: no-es-una-url");

    set_lang(Lang::En);
    let err = GitUrl::parse_or_err("not-a-url").unwrap_err().to_string();
    assert_eq!(err, "Invalid Git URL: not-a-url");

    let state = AppState {
        profiles: vec![Profile {
            display_name: "Work".into(),
            slug: "work".into(),
            git_user_name: "Jane".into(),
            git_user_email: "not-an-email".into(),
            is_default: true,
            ..Profile::default()
        }],
        ..AppState::default()
    };
    assert_eq!(validate(&state), vec!["Work: invalid email.".to_string()]);

    let findings = findings_from_settings(&[("SshClient".into(), "PuTTY".into())]);
    assert!(findings[0].warning.as_deref().unwrap().starts_with("SourceTree uses PuTTY/Plink"));

    // Los motivos de backup se guardan como código y se traducen al mostrarlos.
    assert_eq!(BackupReason::parse("enable-integration").unwrap().text(), "Turn on integration");
    assert_eq!(BackupReason::parse("disable-integration").unwrap().text(), "Turn off integration");
    let restore = BackupReason::BeforeRestore("20261017-094100-123".into());
    assert_eq!(BackupReason::parse(&restore.code()), Some(restore.clone()));
    assert_eq!(restore.text(), "Before restoring 20261017-094100-123");

    set_lang(Lang::Es);
    assert_eq!(validate(&state), vec!["Work: email no válido.".to_string()]);
}

#[test]
fn language_is_stored_in_profiles_json() {
    let old: AppSettings = serde_json::from_str(r#"{"SshClient":"WindowsOpenSsh"}"#).unwrap();
    assert_eq!(old.language, None);
    let chosen = AppSettings { language: Some(Lang::En), ..AppSettings::default() };
    let json = serde_json::to_string(&chosen).unwrap();
    assert!(json.contains(r#""Language":"en""#));
    assert_eq!(serde_json::from_str::<AppSettings>(&json).unwrap(), chosen);
}
