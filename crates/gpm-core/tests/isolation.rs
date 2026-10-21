//! Un perfil aplicado por regla no debe heredar la clave SSH ni la firma del perfil por defecto.

mod common;

use common::{TempHome, join};
use gpm_core::config::SshClientInfo;
use gpm_core::credentials::service::{CredentialService, github_login_args, parse_account_list};
use gpm_core::credentials::windows_store::parse_target;
use gpm_core::diagnostics::repo::RepoDiagnostics;
use gpm_core::diagnostics::{ProblemKind, ProblemSeverity};
use gpm_core::files::file_guard::hash;
use gpm_core::integration::IntegrationService;
use gpm_core::models::{AppState, GitProvider, Profile, Rule, RuleType, SigningMode, SshClientKind};
use gpm_core::process::{self, ProcessRequest};
use gpm_core::profile_validator::validate;
use gpm_core::ssh::{SshKeyType, SshManager};

fn state(work_folder: &str) -> AppState {
    AppState {
        profiles: vec![
            Profile {
                display_name: "Personal".into(),
                slug: "personal".into(),
                git_user_name: "Alex".into(),
                git_user_email: "s@personal.dev".into(),
                ssh_key_path: Some("~/.ssh/id_ed25519_personal".into()),
                https_username: Some("alex-personal".into()),
                signing: SigningMode::Ssh,
                signing_key: Some("~/.ssh/id_ed25519_personal.pub".into()),
                is_default: true,
                ..Profile::default()
            },
            Profile {
                display_name: "Curso".into(),
                slug: "curso".into(),
                git_user_name: "alexr-curso".into(),
                git_user_email: "s@curso.dev".into(),
                https_username: Some("alexr-curso".into()),
                rules: vec![Rule { kind: RuleType::Folder, value: work_folder.into(), ..Rule::default() }],
                ..Profile::default()
            },
        ],
        ..AppState::default()
    }
}

fn setup(h: &mut TempHome) -> String {
    let work = h.dir(&["dev", "curso"]);
    h.ws.save(&state(&work), false).unwrap();
    let integration = IntegrationService::new(&h.ws.paths, &h.ws.git);
    let plan = integration.plan_enable(&h.ws.state, false).unwrap();
    integration.apply(&plan, &mut h.ws.state.clone()).unwrap();
    work
}

#[test]
fn rule_profile_resets_ssh_and_signing_from_default() {
    let mut h = TempHome::new();
    let work = setup(&mut h);
    let repo = h.init_repo(&join(&work, "repo"), None);
    assert_eq!(
        h.get(&repo, "core.sshCommand").as_deref(),
        Some(r"SSH_AUTH_SOCK='\\.\pipe\openssh-ssh-agent' C:/Windows/System32/OpenSSH/ssh.exe")
    );
    assert_eq!(h.get(&repo, "commit.gpgsign").as_deref(), Some("false"));
    assert_eq!(h.get(&repo, "gpg.format").as_deref(), Some("openpgp"));
    assert_eq!(h.get(&repo, "credential.https://github.com.username").as_deref(), Some("alexr-curso"));

    let report = RepoDiagnostics::new(&h.ws.paths, &h.ws.git).analyze(&repo, &h.ws.state).unwrap();
    assert_eq!(report.applied_profile_slug.as_deref(), Some("curso"));
    assert!(!report.problems.iter().any(|p| p.kind == ProblemKind::MixedProfiles));
}

#[test]
fn default_profile_does_not_reset_global_settings() {
    let mut h = TempHome::new();
    setup(&mut h);
    let text = h.read(&h.paths.profile_file("personal"));
    assert!(!text.contains("gpgsign = false"));
    let outside = h.init_repo(&join(&h.dir(&["otros"]), "r"), None);
    assert_eq!(h.get(&outside, "commit.gpgsign").as_deref(), Some("true"));
    assert!(h.get(&outside, "core.sshCommand").unwrap().contains("id_ed25519_personal"));
}

#[test]
fn diagnostics_warns_when_values_come_from_another_profile() {
    let mut h = TempHome::new();
    let work = setup(&mut h);
    // Simula un fichero generado por la versión anterior, que no anulaba nada.
    std::fs::write(h.paths.profile_file("curso"), "[user]\n\tname = alexr-curso\n\temail = s@curso.dev\n").unwrap();
    let repo = h.init_repo(&join(&work, "old"), None);

    let report = RepoDiagnostics::new(&h.ws.paths, &h.ws.git).analyze(&repo, &h.ws.state).unwrap();
    let mixed: Vec<_> = report.problems.iter().filter(|p| p.kind == ProblemKind::MixedProfiles).collect();
    assert_eq!(mixed.len(), 1);
    assert_eq!(mixed[0].severity, ProblemSeverity::Warning);
    assert!(mixed[0].message.contains("core.sshCommand viene de «personal»"));
    assert!(mixed[0].message.contains("commit.gpgsign"));
}

#[test]
fn outdated_files_are_regenerated_unless_edited_by_hand() {
    let mut h = TempHome::new();
    setup(&mut h);
    // Fichero generado por una versión anterior: se registra su hash como si lo hubiera escrito la app.
    let old = "[user]\n\tname = alexr-curso\n\temail = s@curso.dev\n";
    let curso = h.paths.profile_file("curso");
    std::fs::write(&curso, old).unwrap();
    h.ws.save_state_only(|s| s.set_hash(&curso, hash(old))).unwrap();

    assert!(h.ws.regenerate_if_outdated().unwrap().is_empty());
    assert!(h.read(&curso).contains("gpgsign = false"));

    // Con una edición manual no se toca.
    let mut text = h.read(&curso);
    text.push_str("# mío\n");
    std::fs::write(&curso, text).unwrap();
    assert!(h.ws.regenerate_if_outdated().unwrap().is_empty());
    assert!(h.read(&curso).ends_with("# mío\n"));
}

#[test]
fn rule_profile_without_https_user_on_same_host_is_rejected() {
    let mut s = state(r"C:\dev\curso");
    s.profiles[1].https_username = None;
    assert!(validate(&s).iter().any(|e| e.contains("usuario HTTPS")));
    s.profiles[1].host = "gitlab.com".into();
    assert!(!validate(&s).iter().any(|e| e.contains("usuario HTTPS")));
}

fn keygen(path: &str, passphrase: &str) {
    let r = process::run(ProcessRequest::new(
        SshClientInfo::windows_openssh().native_ssh_keygen_path(),
        ["-q", "-t", "ed25519", "-C", "test", "-f", path, "-N", passphrase],
    ));
    assert!(r.success(), "{}", r.combined());
}

#[test]
fn detects_passphrase_protected_keys() {
    let client = SshClientInfo::windows_openssh();
    if !std::path::Path::new(&client.native_ssh_keygen_path()).is_file() {
        eprintln!("OpenSSH de Windows no está instalado: se omite.");
        return;
    }
    let h = TempHome::new();
    let ssh = SshManager::new(&h.paths);
    let dir = h.dir(&["home", ".ssh"]);
    keygen(&join(&dir, "plain"), "");
    keygen(&join(&dir, "locked"), "secreto-de-prueba");

    assert_eq!(ssh.has_passphrase(&client, "~/.ssh/plain"), Some(false));
    assert_eq!(ssh.has_passphrase(&client, "~/.ssh/locked"), Some(true));
    assert_eq!(ssh.has_passphrase(&client, "~/.ssh/missing"), None);
    assert!(ssh.fingerprint(&client, "~/.ssh/plain").unwrap().starts_with("SHA256:"));

    let status = ssh.status("~/.ssh/plain");
    assert!(status.private_exists && status.public_exists);
    assert!(ssh.import_key(&join(&dir, "plain.pub")).unwrap() == "~/.ssh/plain");
}

/// Con el SSH de Git, una clave de firma con passphrase necesita estar en el agente de la sesión.
#[test]
fn warns_when_git_ssh_signs_with_a_passphrase_key() {
    let git_ssh = SshClientInfo::resolve(SshClientKind::GitBundled, Some(std::path::Path::new(r"C:\Program Files\Git")));
    if !std::path::Path::new(&git_ssh.native_ssh_keygen_path()).is_file() {
        eprintln!("Git for Windows no está en la ruta por defecto: se omite.");
        return;
    }
    let h = TempHome::new();
    let ssh = SshManager::new(&h.paths);
    let dir = h.dir(&["home", ".ssh"]);
    keygen(&join(&dir, "plain"), "");
    keygen(&join(&dir, "locked"), "secreto-de-prueba");
    let signing = |key: &str| Profile {
        signing: SigningMode::Ssh,
        signing_key: Some(format!("~/.ssh/{key}.pub")),
        ..Profile::default()
    };

    assert!(ssh.signing_needs_session_agent(&git_ssh, &signing("locked")));
    assert!(!ssh.signing_needs_session_agent(&git_ssh, &signing("plain")));
    // Con OpenSSH de Windows la firma pasa por el envoltorio y usa el agente de Windows: no hace falta aviso.
    assert!(!ssh.signing_needs_session_agent(&SshClientInfo::windows_openssh(), &signing("locked")));
    let unsigned = Profile { signing: SigningMode::None, ..signing("locked") };
    assert!(!ssh.signing_needs_session_agent(&git_ssh, &unsigned));
}

#[test]
fn generates_keys_without_overwriting() {
    let client = SshClientInfo::windows_openssh();
    if !std::path::Path::new(&client.native_ssh_keygen_path()).is_file() {
        return;
    }
    let h = TempHome::new();
    let ssh = SshManager::new(&h.paths);
    let key = ssh.generate_key(&client, "prueba", "p@x.com", false, SshKeyType::Ed25519).unwrap();
    assert_eq!(key, "~/.ssh/id_ed25519_prueba");
    assert!(ssh.read_public_key(&key).unwrap().ends_with("p@x.com"));
    assert!(ssh.generate_key(&client, "prueba", "p@x.com", false, SshKeyType::Ed25519).is_err());
}

#[test]
fn parses_gcm_targets() {
    assert_eq!(parse_target("git:https://github.com"), Some(("github.com".into(), None)));
    assert_eq!(parse_target("git:https://alexr-curso@github.com"), Some(("github.com".into(), Some("alexr-curso".into()))));
    assert_eq!(parse_target("git:https://git.corp.local:8443/team"), Some(("git.corp.local:8443".into(), None)));
}

#[test]
fn ignores_non_git_targets() {
    assert!(parse_target("MicrosoftAccount:user=x").is_none());
}

#[test]
fn relogin_uses_github_login_with_force() {
    let github = Profile { provider: GitProvider::GitHub, host: "github.com".into(), ..Profile::default() };
    assert_eq!(github_login_args(&github, "alexr-curso"), [
        "credential-manager",
        "github",
        "login",
        "--username",
        "alexr-curso",
        "--force"
    ]);
    let enterprise = Profile { provider: GitProvider::GitHub, host: "github.corp.local".into(), ..Profile::default() };
    let args = github_login_args(&enterprise, "x");
    assert_eq!(&args[args.len() - 2..], ["--url", "https://github.corp.local"]);
}

#[test]
fn relogin_on_other_hosts_rejects_then_runs_provider_flow() {
    let h = TempHome::new();
    let service = CredentialService::new(&h.ws.git);
    let gitlab = Profile {
        provider: GitProvider::GitLab,
        host: "gitlab.com".into(),
        https_check_repo_url: Some("https://gitlab.com/g/r".into()),
        ..Profile::default()
    };
    let preview = service.describe_relogin(&gitlab, "juan");
    assert!(preview.contains("git credential reject"));
    assert!(preview.contains("credential.https://gitlab.com.username=juan"));
    assert!(preview.contains("ls-remote --heads https://gitlab.com/g/r.git"));
}

#[test]
fn parses_gcm_account_list() {
    assert_eq!(parse_account_list("alexr-curso\r\nalex-romero\r\n\r\n"), ["alexr-curso", "alex-romero"]);
}
