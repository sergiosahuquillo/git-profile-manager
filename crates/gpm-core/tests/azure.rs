//! Azure DevOps: URLs con hosts y rutas distintos por método, reglas de organización, SSH y GCM.

mod common;

use common::{TempHome, join};
use gpm_core::config::ConfigGenerator;
use gpm_core::config::generator::conditions;
use gpm_core::credentials::service::parse_azure_bindings;
use gpm_core::diagnostics::repo::canonicalize_remote;
use gpm_core::git::GitUrl;
use gpm_core::integration::IntegrationService;
use gpm_core::models::{AppState, CloneMethod, GitProvider, Profile, Rule, RuleType, ssh_host};
use gpm_core::rule_matcher;
use gpm_core::ssh::{SshKeyType, SshManager, keygen_args, parse_connection_output};

fn azure_profile(rules: Vec<Rule>) -> Profile {
    Profile {
        display_name: "Contoso".into(),
        slug: "contoso".into(),
        provider: GitProvider::AzureDevOps,
        host: "dev.azure.com".into(),
        git_user_name: "Ana".into(),
        git_user_email: "ana@contoso.com".into(),
        ssh_key_path: Some("~/.ssh/id_rsa_contoso".into()),
        https_username: Some("ana@contoso.com".into()),
        rules,
        ..Profile::default()
    }
}

fn org_rule(value: &str) -> Rule {
    Rule { kind: RuleType::Remote, value: value.into(), ..Rule::default() }
}

fn state() -> AppState {
    AppState {
        profiles: vec![
            Profile {
                display_name: "Personal".into(),
                slug: "personal".into(),
                git_user_name: "Ana".into(),
                git_user_email: "ana@personal.dev".into(),
                is_default: true,
                ..Profile::default()
            },
            azure_profile(vec![org_rule("contoso")]),
        ],
        ..AppState::default()
    }
}

// ─── URLs ─────────────────────────────────────────────────────────────────

#[test]
fn parses_every_azure_form_to_the_same_logical_url() {
    for input in [
        "git@ssh.dev.azure.com:v3/contoso/Web/portal",
        "https://dev.azure.com/contoso/Web/_git/portal",
        "https://contoso@dev.azure.com/contoso/Web/_git/portal",
        "contoso@vs-ssh.visualstudio.com:v3/contoso/Web/portal",
        "https://contoso.visualstudio.com/Web/_git/portal",
        "https://contoso.visualstudio.com/DefaultCollection/Web/_git/portal",
    ] {
        let url = GitUrl::parse(input).unwrap_or_else(|| panic!("{input}"));
        assert!(url.azure, "{input}");
        assert_eq!(url.host, "dev.azure.com", "{input}");
        assert_eq!(url.path, "contoso/Web/portal", "{input}");
        assert_eq!(url.org(), "contoso");
        assert_eq!(url.repo(), "portal");
        assert_eq!(url.to_ssh(), "git@ssh.dev.azure.com:v3/contoso/Web/portal");
        assert_eq!(url.to_https(), "https://dev.azure.com/contoso/Web/_git/portal");
    }
}

#[test]
fn keeps_the_embedded_org_but_drops_it_from_canonical_https() {
    let url = GitUrl::parse("https://contoso@dev.azure.com/contoso/Web/_git/portal").unwrap();
    assert_eq!(url.method, CloneMethod::Https);
    assert_eq!(url.user.as_deref(), Some("contoso"));
    assert_eq!(url.literal(), "https://contoso@dev.azure.com/contoso/Web/_git/portal");
    assert_eq!(url.canonical(), "https://dev.azure.com/contoso/Web/_git/portal");
}

#[test]
fn accepts_encoded_spaces_and_decodes_the_repo_name() {
    let url = GitUrl::parse("https://dev.azure.com/contoso/Mi%20Proyecto/_git/Mi%20Repo").unwrap();
    assert_eq!(url.path, "contoso/Mi%20Proyecto/Mi%20Repo");
    assert_eq!(url.repo(), "Mi Repo");
    assert_eq!(url.to_ssh(), "git@ssh.dev.azure.com:v3/contoso/Mi%20Proyecto/Mi%20Repo");
}

#[test]
fn rejects_azure_urls_that_are_not_repos() {
    for input in [
        "https://dev.azure.com/contoso/Web",
        "https://dev.azure.com/contoso/Web/_wiki/portal",
        "git@ssh.dev.azure.com:contoso/Web/portal",
        "git@ssh.dev.azure.com:v3/contoso/portal",
    ] {
        assert!(GitUrl::parse(input).is_none(), "{input}");
    }
}

#[test]
fn github_urls_are_unchanged() {
    let url = GitUrl::parse("https://github.com/empresa-a/repo.git").unwrap();
    assert!(!url.azure);
    assert_eq!(url.to_ssh(), "git@github.com:empresa-a/repo.git");
    assert_eq!(url.org(), "empresa-a");
}

// ─── Reglas ───────────────────────────────────────────────────────────────

#[test]
fn org_rule_generates_all_azure_patterns() {
    let p = azure_profile(vec![]);
    let conds = conditions(&p, &org_rule("contoso"));
    let expected = [
        "git@ssh.dev.azure.com:v3/contoso/**",
        "https://dev.azure.com/contoso/**",
        "https://contoso@dev.azure.com/contoso/**",
        "contoso@vs-ssh.visualstudio.com:v3/contoso/**",
        "https://contoso.visualstudio.com/**",
    ];
    assert_eq!(conds, expected.map(|u| format!("hasconfig:remote.*.url:{u}")));

    let project = conditions(&p, &org_rule("contoso/Mi Proyecto"));
    assert!(project.contains(&"hasconfig:remote.*.url:https://dev.azure.com/contoso/Mi%20Proyecto/**".to_string()));
    assert!(project.contains(&"hasconfig:remote.*.url:https://contoso.visualstudio.com/Mi%20Proyecto/**".to_string()));
}

#[test]
fn matcher_follows_the_literal_url_like_git() {
    let s = state();
    let (azure, rule) = (&s.profiles[1], &s.profiles[1].rules[0]);
    for input in [
        "git@ssh.dev.azure.com:v3/contoso/Web/portal",
        "https://dev.azure.com/contoso/Web/_git/portal",
        "https://contoso@dev.azure.com/contoso/Web/_git/portal",
    ] {
        assert!(rule_matcher::remote_matches(azure, rule, &GitUrl::parse(input).unwrap()), "{input}");
    }
    // Otra organización, o una cuenta incrustada que no es la organización: Git no aplicaría la regla.
    for input in [
        "https://dev.azure.com/fabrikam/Web/_git/portal",
        "https://ana@dev.azure.com/contoso/Web/_git/portal",
    ] {
        assert!(!rule_matcher::remote_matches(azure, rule, &GitUrl::parse(input).unwrap()), "{input}");
    }
    let url = GitUrl::parse("https://dev.azure.com/contoso/Web/_git/portal").unwrap();
    assert_eq!(rule_matcher::profile_for_url(&s, &url).map(|p| p.id), Some(azure.id));
}

/// Las reglas se comprueban con Git real: `hasconfig` debe aplicar el perfil con cada forma de URL.
#[test]
fn git_applies_the_azure_profile_for_every_remote_form() {
    let mut h = TempHome::new();
    h.ws.save(&state(), false).unwrap();
    let integration = IntegrationService::new(&h.ws.paths, &h.ws.git);
    let plan = integration.plan_enable(&h.ws.state, false).unwrap();
    integration.apply(&plan, &mut h.ws.state.clone()).unwrap();

    let base = h.dir(&["repos"]);
    for (i, remote) in [
        "git@ssh.dev.azure.com:v3/contoso/Web/portal",
        "https://dev.azure.com/contoso/Web/_git/portal",
        "https://contoso@dev.azure.com/contoso/Web/_git/portal",
        "contoso@vs-ssh.visualstudio.com:v3/contoso/Web/portal",
        "https://contoso.visualstudio.com/Web/_git/portal",
    ]
    .iter()
    .enumerate()
    {
        let repo = h.init_repo(&join(&base, &format!("r{i}")), Some(remote));
        assert_eq!(h.get(&repo, "user.email").as_deref(), Some("ana@contoso.com"), "{remote}");
        assert!(h.get(&repo, "core.sshCommand").unwrap().contains("id_rsa_contoso"), "{remote}");
    }
    let other = h.init_repo(&join(&base, "other"), Some("https://dev.azure.com/fabrikam/Web/_git/portal"));
    assert_eq!(h.get(&other, "user.email").as_deref(), Some("ana@personal.dev"));
}

// ─── Diagnóstico ──────────────────────────────────────────────────────────

#[test]
fn the_org_azure_embeds_in_https_urls_is_not_a_problem() {
    let s = state();
    assert!(canonicalize_remote("https://contoso@dev.azure.com/contoso/Web/_git/portal", &s).is_none());
    let (fixed, reason) = canonicalize_remote("https://ana@dev.azure.com/contoso/Web/_git/portal", &s).unwrap();
    assert_eq!(fixed, "https://dev.azure.com/contoso/Web/_git/portal");
    assert!(reason.contains("usuario"));
}

#[test]
fn azure_ssh_alias_is_normalized_to_the_azure_ssh_host() {
    let s = state();
    let (fixed, _) = canonicalize_remote("git@azure-contoso:v3/contoso/Web/portal", &s).unwrap();
    assert_eq!(fixed, "git@ssh.dev.azure.com:v3/contoso/Web/portal");
}

// ─── SSH y GCM ────────────────────────────────────────────────────────────

#[test]
fn ssh_uses_the_azure_ssh_host() {
    let s = state();
    assert_eq!(ssh_host(&s.profiles[1]), "ssh.dev.azure.com");
    assert_eq!(ssh_host(&s.profiles[0]), "github.com");
    let aliases = ConfigGenerator::new(&TempHome::new().paths).generate_ssh_aliases(&AppState {
        profiles: vec![azure_profile(vec![])],
        ..AppState::default()
    });
    assert!(aliases.contains("Host azure-contoso\n    HostName ssh.dev.azure.com\n"));
}

#[test]
fn azure_connection_test_succeeds_without_an_account() {
    let r = parse_connection_output("remote: Shell access is not supported.\nshell request failed on channel 0");
    assert!(r.success);
    assert_eq!(r.account, None);
    assert!(!parse_connection_output("git@ssh.dev.azure.com: Permission denied (publickey).").success);
}

#[test]
fn rsa_is_recommended_for_azure_and_generated_with_4096_bits() {
    let s = state();
    assert_eq!(SshKeyType::recommended_for(&s.profiles[1]), SshKeyType::Rsa);
    assert_eq!(SshKeyType::recommended_for(&s.profiles[0]), SshKeyType::Ed25519);
    assert_eq!(
        keygen_args("contoso", "ana@contoso.com", SshKeyType::Rsa),
        ["-t", "rsa", "-b", "4096", "-C", "ana@contoso.com", "-f", "~/.ssh/id_rsa_contoso"]
    );

    let h = TempHome::new();
    let ssh = SshManager::new(&h.paths);
    let client = gpm_core::config::SshClientInfo::windows_openssh();
    let key = ssh.generate_key(&client, "contoso", "ana@contoso.com", false, SshKeyType::Rsa).unwrap();
    assert_eq!(key, "~/.ssh/id_rsa_contoso");
    assert!(ssh.read_public_key(&key).unwrap().starts_with("ssh-rsa "));
}

#[test]
fn parses_gcm_azure_bindings() {
    let out = "contoso:\n  (global) -> ana@contoso.com\n  (local) -> (no inherit)\nfabrikam:\n  (global) -> luis@fabrikam.com\n";
    assert_eq!(parse_azure_bindings(out), ["ana@contoso.com", "luis@fabrikam.com"]);
}
