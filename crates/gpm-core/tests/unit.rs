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
use gpm_core::git::runner::parse_version;
use gpm_core::integration::{add_ssh_include, remove_ssh_include};
use gpm_core::models::{CloneMethod, Profile, Rule, RuleType, SigningMode, SshClientKind};
use gpm_core::profile_validator::{ConflictSeverity, detect_conflicts, make_slug, validate};
use gpm_core::ssh::parse_connection_output;

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