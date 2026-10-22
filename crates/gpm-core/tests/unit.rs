mod common;

use common::sample_state;
use gpm_core::AppPaths;
use gpm_core::config::generator::{build_ssh_command, normalize_folder};
use gpm_core::config::gitconfig_doc::escape_value;
use gpm_core::config::{ConfigGenerator, SshClientInfo};
use gpm_core::diagnostics::repo::canonicalize_remote;
use gpm_core::environment::findings_from_settings;
use gpm_core::files::text_diff::{self, DiffKind};
use gpm_core::git::GitUrl;
use gpm_core::git::runner::{GitVersion, parse_version, parse_version_full};
use gpm_core::integration::{add_ssh_include, remove_ssh_include};
use gpm_core::models::{CloneMethod, Profile, Rule, RuleType, SigningMode, SshClientKind, UpdateMode};
use gpm_core::profile_validator::{ConflictSeverity, detect_conflicts, make_slug, validate};
use gpm_core::ssh::parse_connection_output;
use gpm_core::updates::git::{InstallScope, installer_args, is_under, release_from_json, user_install_dir};

fn paths() -> AppPaths {
    AppPaths::new(r"C:\Users\juan", r"C:\tmp")
}

// ─── GitUrl ───────────────────────────────────────────────────────────────

#[test]
fn parses_formats() {
    let cases = [
        ("git@github.com:empresa-a/repo.git", "github.com", "empresa-a/repo", CloneMethod::Ssh),
        ("git@github.com:empresa-a/repo", "github.com", "empresa-a/repo", CloneMethod::Ssh),
        ("https://github.com/empresa-a/repo.git", "github.com", "empresa-a/repo", CloneMethod::Https),
        ("https://juan@gitlab.com/grupo/sub/repo", "gitlab.com", "grupo/sub/repo", CloneMethod::Https),
        ("ssh://git@git.corp.local:2222/team/app.git", "git.corp.local", "team/app", CloneMethod::Ssh),
    ];
    for (input, host, path, method) in cases {
        let url = GitUrl::parse(input).unwrap_or_else(|| panic!("{input}"));
        assert_eq!(url.host, host);
        assert_eq!(url.path, path);
        assert_eq!(url.method, method);
    }
}

#[test]
fn rejects_invalid() {
    for input in ["", "not a url", r"C:\dev\repo", "https://github.com/../etc", "git@github.com:org/repo;rm -rf", "--upload-pack=evil"] {
        assert!(GitUrl::parse(input).is_none(), "{input}");
    }
}

#[test]
fn converts_between_methods_without_embedded_user() {
    let url = GitUrl::parse("https://juan@github.com/empresa-a/repo").unwrap();
    assert_eq!(url.to_https(), "https://github.com/empresa-a/repo.git");
    assert_eq!(url.to_ssh(), "git@github.com:empresa-a/repo.git");
    assert_eq!(url.org(), "empresa-a");
    assert_eq!(url.repo(), "repo");
}

// ─── Generador ────────────────────────────────────────────────────────────

#[test]
fn escapes_values_like_git() {
    let cases = [
        ("simple", "simple"),
        ("con espacio final ", "\"con espacio final \""),
        ("a;b", "\"a;b\""),
        ("C:\\ruta", "C:\\\\ruta"),
        ("comillas \"x\"", "comillas \\\"x\\\""),
    ];
    for (value, expected) in cases {
        assert_eq!(escape_value(value), expected);
    }
}

#[test]
fn normalizes_folders() {
    assert_eq!(normalize_folder(r"C:\dev\empresa-a"), "C:/dev/empresa-a/");
    assert_eq!(normalize_folder("C:/dev/empresa-a/"), "C:/dev/empresa-a/");
    assert_eq!(normalize_folder("~/code"), "~/code/");
}

#[test]
fn profile_file_contains_identity_ssh_https_and_signing() {
    let p = Profile {
        display_name: "Trabajo".into(),
        slug: "trabajo".into(),
        git_user_name: "Juan".into(),
        git_user_email: "j@a.com".into(),
        ssh_key_path: Some("~/.ssh/id_ed25519_trabajo".into()),
        https_username: Some("juan-empresa".into()),
        signing: SigningMode::Ssh,
        signing_key: Some("~/.ssh/id_ed25519_trabajo.pub".into()),
        ..Profile::default()
    };
    let p2 = paths();
    let text = ConfigGenerator::new(&p2).generate_profile(&p, &SshClientInfo::windows_openssh());
    // En el fichero las barras invertidas van escapadas, como las escribe git config.
    assert!(text.contains(
        r"sshCommand = SSH_AUTH_SOCK='\\\\.\\pipe\\openssh-ssh-agent' C:/Windows/System32/OpenSSH/ssh.exe -i ~/.ssh/id_ed25519_trabajo -o IdentitiesOnly=yes"
    ));
    assert!(text.contains("[credential \"https://github.com\"]"));
    assert!(text.contains("username = juan-empresa"));
    assert!(text.contains("format = ssh"));
    assert!(text.contains("program = C:/Users/juan/.gitprofiles/ssh-keygen.cmd"));
    assert!(text.contains("gpgsign = true"));
}

#[test]
fn git_bundled_client_paths_are_quoted() {
    let client = SshClientInfo::resolve(SshClientKind::GitBundled, Some(std::path::Path::new(r"C:\Program Files\Git")));
    assert_eq!(
        build_ssh_command(&client, "~/.ssh/k"),
        "\"C:/Program Files/Git/usr/bin/ssh.exe\" -i ~/.ssh/k -o IdentitiesOnly=yes"
    );
}

#[test]
fn ssh_aliases_file() {
    let state = sample_state(r"C:\dev\empresa-a");
    let p = paths();
    let text = ConfigGenerator::new(&p).generate_ssh_aliases(&state);
    assert!(text.contains("Host github-trabajo"));
    assert!(text.contains("    HostName github.com"));
    assert!(text.contains("    IdentitiesOnly yes"));
}

#[test]
fn tilde_paths() {
    let p = paths();
    assert_eq!(p.to_tilde_path(r"C:\Users\juan\.ssh\id"), "~/.ssh/id");
    assert_eq!(p.expand_tilde("~/.ssh/id"), r"C:\Users\juan\.ssh\id");
    assert_eq!(p.to_tilde_path(r"D:\keys\id"), "D:/keys/id");
}

// ─── Validación ───────────────────────────────────────────────────────────

#[test]
fn requires_single_default_and_valid_fields() {
    let mut state = sample_state(r"C:\dev\a");
    assert!(validate(&state).is_empty(), "{:?}", validate(&state));
    state.profiles[1].is_default = true;
    state.profiles[1].git_user_email = "sin-arroba".into();
    state.profiles[0].slug = "Mal Slug".into();
    let errors = validate(&state);
    assert!(errors.iter().any(|e| e.contains("por defecto")));
    assert!(errors.iter().any(|e| e.contains("email")));
    assert!(errors.iter().any(|e| e.contains("slug")));
}

#[test]
fn makes_slugs() {
    assert_eq!(make_slug("Trabajo - Empresa A"), "trabajo-empresa-a");
    assert_eq!(make_slug("Ñandú Cañón"), "nandu-canon");
    assert_eq!(make_slug("Straße 日本"), "stra-e");
}

#[test]
fn detects_conflicts() {
    let mut state = sample_state(r"C:\dev\empresa-a");
    state.profiles[0].rules.push(Rule { kind: RuleType::Folder, value: r"C:\dev".into(), order: 5, ..Rule::default() });
    state.profiles[0].rules.push(Rule { kind: RuleType::Remote, value: "empresa-a".into(), order: 6, ..Rule::default() });
    let conflicts = detect_conflicts(&state);
    assert!(conflicts.iter().any(|c| c.message.contains("anidadas")));
    assert!(conflicts.iter().any(|c| c.severity == ConflictSeverity::Error && c.message.contains("organización")));
}

// ─── Varios ───────────────────────────────────────────────────────────────

#[test]
fn parses_connection_test() {
    let cases = [
        ("Hi juan-empresa! You've successfully authenticated, but GitHub does not provide shell access.", "juan-empresa"),
        ("Welcome to GitLab, @juan!", "juan"),
        ("logged in as juanbb.\n\nYou can use git to connect to Bitbucket.", "juanbb"),
    ];
    for (output, account) in cases {
        let r = parse_connection_output(output);
        assert!(r.success);
        assert_eq!(r.account.as_deref(), Some(account));
    }
}

#[test]
fn connection_test_failure() {
    assert!(!parse_connection_output("git@github.com: Permission denied (publickey).").success);
}

#[test]
fn ssh_include_goes_first_and_is_removed_cleanly() {
    let original = "Host *\n    IdentityFile ~/.ssh/id_rsa\n";
    let added = add_ssh_include(Some(original));
    assert!(added.starts_with("Include gitprofile.conf\n"));
    assert_eq!(add_ssh_include(Some(&added)), added);
    assert_eq!(remove_ssh_include(&added), original);
}

#[test]
fn canonicalizes_remotes() {
    let state = sample_state(r"C:\dev\a");
    assert_eq!(
        canonicalize_remote("git@github-trabajo:empresa-a/x.git", &state).map(|c| c.0).as_deref(),
        Some("git@github.com:empresa-a/x.git")
    );
    assert_eq!(
        canonicalize_remote("https://juan@github.com/empresa-a/x", &state).map(|c| c.0).as_deref(),
        Some("https://github.com/empresa-a/x.git")
    );
    assert!(canonicalize_remote("git@github.com:empresa-a/x.git", &state).is_none());
}

#[test]
fn diff_shows_changes() {
    let d = text_diff::lines(Some("a\nb\n"), Some("Include x\na\nb\n"));
    assert_eq!(d[0].kind, DiffKind::Add);
    assert_eq!(d[0].text, "Include x");
    assert_eq!(d[1].kind, DiffKind::Ctx);
    assert!(!text_diff::has_changes(Some("a\r\n"), Some("a\n")));
}

#[test]
fn parses_git_version() {
    assert_eq!(parse_version("git version 2.53.0.windows.1"), Some((2, 53, 0)));
}

#[test]
fn parses_full_git_version() {
    let v = parse_version_full("git version 2.53.0.windows.2").unwrap();
    assert_eq!(v, GitVersion { major: 2, minor: 53, patch: 0, win_rev: 2 });
    assert_eq!(v.to_string(), "2.53.0.2");
    assert_eq!(parse_version_full("v2.56.0.windows.1").unwrap().to_string(), "2.56.0");
    assert_eq!(parse_version_full("git version 2.45.0").unwrap().win_rev, 0);
}

#[test]
fn orders_git_versions_with_windows_revision() {
    let v = |s| parse_version_full(s).unwrap();
    assert!(v("2.53.0.windows.2") > v("2.53.0.windows.1"));
    assert!(v("2.54.0.windows.1") > v("2.53.0.windows.9"));
    assert_eq!(v("v2.53.0.windows.1"), v("git version 2.53.0.windows.1"));
}

const RELEASE_JSON: &str = r#"{
  "tag_name": "v2.56.0.windows.2",
  "assets": [
    { "name": "Git-2.56.0.2-64-bit.tar.bz2", "browser_download_url": "https://x/a.tar.bz2", "size": 1, "digest": "sha256:00" },
    { "name": "PortableGit-2.56.0.2-64-bit.7z.exe", "browser_download_url": "https://x/p.exe", "size": 2,
      "digest": "sha256:075e158ef8e1f0ab80b347e245405d3eca735c2dc88fd8e032e137d0ca61f61b" },
    { "name": "Git-2.56.0.2-64-bit.exe", "browser_download_url": "https://x/Git-2.56.0.2-64-bit.exe", "size": 66763664,
      "digest": "sha256:52188F917B378F00C70EC136BCF090005F30D44FBC4EBA0BCE759CC6592D60F6" },
    { "name": "Git-2.56.0.2-arm64.exe", "browser_download_url": "https://x/Git-2.56.0.2-arm64.exe", "size": 64316408,
      "digest": "sha256:b9ced78ce371577dc966f50ae571909d6731e36d31065d35c8efa21544c58bf0" }
  ]
}"#;

#[test]
fn picks_git_installer_from_release() {
    let r = release_from_json(RELEASE_JSON, "64-bit").unwrap();
    assert_eq!(r.version.to_string(), "2.56.0.2");
    assert_eq!(r.asset_name, "Git-2.56.0.2-64-bit.exe");
    assert_eq!(r.size, 66763664);
    assert_eq!(r.sha256, "52188f917b378f00c70ec136bcf090005f30d44fbc4eba0bce759cc6592d60f6");
    let arm = release_from_json(RELEASE_JSON, "arm64").unwrap();
    assert_eq!(arm.url, "https://x/Git-2.56.0.2-arm64.exe");
}

#[test]
fn rejects_git_release_without_digest() {
    let json = RELEASE_JSON
        .replace(r#""sha256:52188F917B378F00C70EC136BCF090005F30D44FBC4EBA0BCE759CC6592D60F6""#, "null");
    assert!(release_from_json(&json, "64-bit").is_err());
    assert!(release_from_json(r#"{"tag_name":"latest","assets":[]}"#, "64-bit").is_err());
}

#[test]
fn detects_paths_under_local_app_data() {
    let local = std::path::Path::new(r"C:\Users\juan\AppData\Local");
    assert!(is_under(std::path::Path::new(r"C:\Users\Juan\AppData\Local\Programs\Git"), local));
    assert!(!is_under(std::path::Path::new(r"C:\Program Files\Git"), local));
    assert!(!is_under(std::path::Path::new(r"C:\Users\juan\AppData\LocalLow\Git"), local));
}

#[test]
fn builds_silent_installer_args() {
    let log = std::path::Path::new(r"C:\tmp\git-install.log");
    let has = |args: &[String], prefix: &str| args.iter().any(|a| a.starts_with(prefix));

    // Actualización: reutiliza las opciones y la carpeta de la instalación existente.
    let update = installer_args(log, None);
    assert!(has(&update, "/VERYSILENT"));
    assert!(!has(&update, "/o:") && !has(&update, "/DIR="));

    // Desde cero: GCM y PATH siempre; la carpeta solo para el usuario.
    let machine = installer_args(log, Some(InstallScope::Machine));
    assert!(has(&machine, "/o:UseCredentialManager=Enabled") && has(&machine, "/o:PathOption=Cmd"));
    assert!(!has(&machine, "/DIR="));
    let user = installer_args(log, Some(InstallScope::User));
    let dir = format!("/DIR={}", user_install_dir().display());
    assert!(user.contains(&dir) && dir.ends_with(r"Programs\Git"));
}

#[test]
fn reads_profiles_json() {
    let json = r#"{
  "SchemaVersion": 1,
  "Profiles": [
    {
      "Id": "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
      "DisplayName": "Personal",
      "Slug": "personal",
      "Provider": "GitHub",
      "Host": "github.com",
      "GitUserName": "Juan",
      "GitUserEmail": "juan@personal.dev",
      "SshKeyPath": null,
      "HttpsUsername": null,
      "HttpsCheckRepoUrl": null,
      "Signing": "None",
      "SigningKey": null,
      "Rules": [ { "Id": "2b4e28ba-2fa1-11d2-883f-0016d3cca427", "Type": "Remote", "Value": "org", "Host": null, "Order": 3 } ],
      "IsDefault": true,
      "PreferredCloneMethod": "Https"
    }
  ],
  "Settings": { "SshClient": "GitBundled", "NoProfileMode": "Strict", "GenerateSshAliases": false },
  "FileHashes": { "C:\\Users\\juan\\.gitprofiles\\rules.gitconfig": "ABC" },
  "IntegrationEnabled": true,
  "FirstRunCompleted": true,
  "SavedGlobalIdentity": { "Name": "Juan", "Email": "j@x.com" }
}"#;
    let state: gpm_core::models::AppState = serde_json::from_str(json).unwrap();
    assert_eq!(state.profiles[0].preferred_clone_method, CloneMethod::Https);
    assert_eq!(state.profiles[0].rules[0].kind, RuleType::Remote);
    assert_eq!(state.settings.ssh_client, SshClientKind::GitBundled);
    // Un profiles.json anterior a las actualizaciones carga con el modo por defecto.
    assert_eq!(state.settings.update_mode, UpdateMode::Auto);
    assert_eq!(state.hash_for(r"c:\users\JUAN\.gitprofiles\rules.gitconfig"), Some("ABC"));
    let back = serde_json::to_string(&state).unwrap();
    assert!(back.contains("\"PreferredCloneMethod\":\"Https\""));
    assert!(back.contains("\"Type\":\"Remote\""));
}

// ─── SourceTree ───────────────────────────────────────────────────────────

fn settings(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

fn warnings(pairs: &[(&str, &str)]) -> Vec<String> {
    findings_from_settings(&settings(pairs)).into_iter().filter_map(|f| f.warning).collect()
}

#[test]
fn sourcetree_own_agent_is_reported_but_not_a_problem() {
    // Los perfiles con OpenSSH de Windows fijan el agente de Windows: el de SourceTree no les afecta.
    let all = findings_from_settings(&settings(&[("SSHClientType", "OpenSSH"), ("AutoStartSSHAgent", "True")]));
    assert!(all.iter().any(|f| f.setting == "AutoStartSSHAgent"));
    assert!(warnings(&[("SSHClientType", "OpenSSH"), ("AutoStartSSHAgent", "True")]).is_empty());
    // Con PuTTY el aviso es el de PuTTY: el agente de SourceTree es entonces Pageant.
    let putty = warnings(&[("SSHClientType", "PuTTY"), ("AutoStartSSHAgent", "True")]);
    assert_eq!(putty.len(), 1);
    assert!(putty[0].contains("PuTTY"));
}

#[test]
fn sourcetree_embedded_git_is_still_flagged() {
    assert!(warnings(&[("GitWhichOne", "1"), ("GitSystemPath", "C:\\Program Files\\Git")]).is_empty());
    assert_eq!(warnings(&[("UseEmbeddedGit", "True")]).len(), 1);
}