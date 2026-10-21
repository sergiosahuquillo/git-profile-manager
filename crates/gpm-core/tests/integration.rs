//! Tests de integración contra Git real sobre un HOME temporal.

mod common;

use std::path::Path;

use common::{TempHome, join, sample_state};
use gpm_core::app_paths::{RULES_INCLUDE_VALUE, SSH_INCLUDE_LINE};
use gpm_core::config::SshClientInfo;
use gpm_core::config::generator::HEADER;
use gpm_core::diagnostics::repo::RepoDiagnostics;
use gpm_core::diagnostics::smart_clone::{CloneRequest, CoverageStatus, SmartCloneService};
use gpm_core::diagnostics::ProblemKind;
use gpm_core::files::FileGuard;
use gpm_core::git::GitUrl;
use gpm_core::git::runner::GitRun;
use gpm_core::integration::IntegrationService;
use gpm_core::models::{CloneMethod, NoProfileMode};
use gpm_core::rule_matcher;

fn setup(h: &mut TempHome, remove_global_identity: bool) -> String {
    let work = h.dir(&["dev", "empresa-a"]);
    h.ws.save(&sample_state(&work), false).unwrap();
    let integration = IntegrationService::new(&h.ws.paths, &h.ws.git);
    let plan = integration.plan_enable(&h.ws.state, remove_global_identity).unwrap();
    let mut state = h.ws.state.clone();
    integration.apply(&plan, &mut state).unwrap();
    h.ws.save_state_only(|s| {
        s.integration_enabled = state.integration_enabled;
        s.saved_global_identity = state.saved_global_identity.clone();
    })
    .unwrap();
    work
}

#[test]
fn folder_rule_applies_work_profile() {
    let mut h = TempHome::new();
    let work = setup(&mut h, false);
    let repo = h.init_repo(&join(&work, "proyecto"), None);
    assert_eq!(h.get(&repo, "user.email").as_deref(), Some("juan@empresa-a.com"));
    assert_eq!(h.get(&repo, "credential.https://github.com.username").as_deref(), Some("juan-empresa"));
    let ssh = h.get(&repo, "core.sshCommand").unwrap();
    assert!(ssh.contains("id_ed25519_trabajo"));
    assert!(ssh.contains("IdentitiesOnly=yes"));
}

#[test]
fn repo_without_rule_uses_default_profile_over_global_identity() {
    let mut h = TempHome::new();
    setup(&mut h, false);
    let repo = h.init_repo(&join(&h.dir(&["otros"]), "x"), None);
    assert_eq!(h.get(&repo, "user.email").as_deref(), Some("juan@personal.dev"));
}

#[test]
fn remote_rule_applies_anywhere() {
    for remote in ["git@github.com:empresa-a/api.git", "https://github.com/empresa-a/api.git"] {
        let mut h = TempHome::new();
        setup(&mut h, false);
        let repo = h.init_repo(&join(&h.dir(&["otros"]), "api"), Some(remote));
        assert_eq!(h.get(&repo, "user.email").as_deref(), Some("juan@empresa-a.com"), "{remote}");
    }
}

#[test]
fn other_org_is_not_matched() {
    let mut h = TempHome::new();
    setup(&mut h, false);
    let repo = h.init_repo(&join(&h.dir(&["otros"]), "lib"), Some("git@github.com:empresa-b/lib.git"));
    assert_eq!(h.get(&repo, "user.email").as_deref(), Some("juan@personal.dev"));
}

#[test]
fn enable_is_idempotent_and_disable_restores_identity() {
    let mut h = TempHome::new();
    setup(&mut h, true);
    let global = h.read(&h.global_config.to_string_lossy());
    assert!(global.contains(RULES_INCLUDE_VALUE));
    assert!(!global.contains("global@example.com"));
    assert_eq!(h.ws.state.saved_global_identity.as_ref().and_then(|i| i.email.as_deref()), Some("global@example.com"));
    assert!(h.read(&h.paths.ssh_config()).starts_with(SSH_INCLUDE_LINE));

    let integration = IntegrationService::new(&h.ws.paths, &h.ws.git);
    let again = integration.plan_enable(&h.ws.state, false).unwrap();
    assert!(again.changes.iter().all(|c| !c.has_changes));

    let disable = integration.plan_disable(&h.ws.state).unwrap();
    let mut state = h.ws.state.clone();
    integration.apply(&disable, &mut state).unwrap();
    let global = h.read(&h.global_config.to_string_lossy());
    assert!(!global.contains(RULES_INCLUDE_VALUE));
    assert!(global.contains("global@example.com"));
    assert!(!h.read(&h.paths.ssh_config()).contains(SSH_INCLUDE_LINE));
    assert!(!h.ws.guard().list_backups().is_empty());
}

#[test]
fn drift_is_detected_and_blocks_save_without_confirmation() {
    let mut h = TempHome::new();
    setup(&mut h, false);
    let rules = h.paths.rules_file();
    let mut text = h.read(&rules);
    text.push_str("\n# edición manual\n");
    std::fs::write(&rules, text).unwrap();
    assert_eq!(FileGuard::detect_drift(&h.ws.state).len(), 1);

    let draft = h.ws.state.clone();
    assert_eq!(h.ws.plan_save(&draft).files.iter().filter(|f| f.drifted).count(), 1);
    assert!(h.ws.save(&draft, false).is_err());
    h.ws.save(&draft, true).unwrap();
    assert!(FileGuard::detect_drift(&h.ws.state).is_empty());
}

#[test]
fn renamed_slug_removes_obsolete_file() {
    let mut h = TempHome::new();
    setup(&mut h, false);
    let mut draft = h.ws.state.clone();
    draft.profiles[1].slug = "empresa-a".into();
    h.ws.save(&draft, false).unwrap();
    assert!(!Path::new(&h.paths.profile_file("trabajo")).exists());
    assert!(Path::new(&h.paths.profile_file("empresa-a")).exists());
}

#[test]
fn diagnostics_reports_origin_and_local_override() {
    let mut h = TempHome::new();
    let work = setup(&mut h, false);
    let repo = h.init_repo(&join(&work, "svc"), Some("git@github-trabajo:empresa-a/svc.git"));
    h.ws.git.run_in(Path::new(&repo), &["config", "--local", "user.email", "otro@x.com"]);

    let diag = RepoDiagnostics::new(&h.ws.paths, &h.ws.git);
    let report = diag.analyze(&repo, &h.ws.state).unwrap();
    let email = report.values.iter().find(|v| v.key == "user.email").unwrap();
    assert_eq!(email.scope.as_deref(), Some("local"));
    assert_eq!(report.applied_profile_slug.as_deref(), Some("trabajo"));
    assert!(!report.problems.iter().any(|p| p.kind == ProblemKind::NoProfile));
    assert!(report.problems.iter().any(|p| p.kind == ProblemKind::LocalOverride));
    let remote = report.problems.iter().find(|p| p.kind == ProblemKind::NonCanonicalRemote).unwrap();
    assert!(remote.fix_preview.join("\n").contains("git@github.com:empresa-a/svc.git"));

    for p in report.problems.iter().filter(|p| p.fix.is_some()) {
        diag.apply_fix(&repo, p.fix.as_ref().unwrap()).unwrap();
    }
    let after = diag.analyze(&repo, &h.ws.state).unwrap();
    assert_eq!(after.applied_profile_slug.as_deref(), Some("trabajo"));
    assert!(!after.problems.iter().any(|p| matches!(p.kind, ProblemKind::LocalOverride | ProblemKind::NonCanonicalRemote)));
    // Coinciden el perfil por defecto y dos reglas del mismo perfil: es lo normal, no se avisa.
    assert!(!after.problems.iter().any(|p| p.kind == ProblemKind::MultipleProfiles));
}

#[test]
fn diagnostics_warns_only_when_rules_of_two_profiles_match() {
    let mut h = TempHome::new();
    let work = h.dir(&["dev", "empresa-a"]);
    let mut state = sample_state(&work);
    // Un tercer perfil con una regla de carpeta anidada dentro de la de «trabajo».
    let labs = join(&work, "labs");
    state.profiles.push(gpm_core::models::Profile {
        display_name: "Labs".into(),
        slug: "labs".into(),
        git_user_name: "Juan".into(),
        git_user_email: "labs@empresa-a.com".into(),
        https_username: Some("juan-labs".into()),
        rules: vec![gpm_core::models::Rule {
            kind: gpm_core::models::RuleType::Folder,
            value: labs.clone(),
            order: 5,
            ..Default::default()
        }],
        ..Default::default()
    });
    h.ws.save(&state, false).unwrap();
    let integration = IntegrationService::new(&h.ws.paths, &h.ws.git);
    let plan = integration.plan_enable(&h.ws.state, false).unwrap();
    integration.apply(&plan, &mut h.ws.state.clone()).unwrap();

    let diag = RepoDiagnostics::new(&h.ws.paths, &h.ws.git);
    let only_work = h.init_repo(&join(&work, "web"), None);
    let report = diag.analyze(&only_work, &h.ws.state).unwrap();
    assert!(!report.problems.iter().any(|p| p.kind == ProblemKind::MultipleProfiles));

    let nested = h.init_repo(&join(&labs, "api"), None);
    let report = diag.analyze(&nested, &h.ws.state).unwrap();
    assert_eq!(report.applied_profile_slug.as_deref(), Some("labs"));
    assert!(report.problems.iter().any(|p| p.kind == ProblemKind::MultipleProfiles));
}

#[test]
fn diagnostics_detects_missing_profile_when_integration_off() {
    let h = TempHome::new();
    let repo = h.init_repo(&join(&h.dir(&["x"]), "r"), None);
    let report = RepoDiagnostics::new(&h.ws.paths, &h.ws.git).analyze(&repo, &h.ws.state).unwrap();
    assert!(report.problems.iter().any(|p| p.kind == ProblemKind::NoProfile));
}

#[test]
fn diagnostics_reports_default_profile_without_specific_rule() {
    let mut h = TempHome::new();
    setup(&mut h, false);
    let repo = h.init_repo(&join(&h.dir(&["otros"]), "sandbox"), None);
    let report = RepoDiagnostics::new(&h.ws.paths, &h.ws.git).analyze(&repo, &h.ws.state).unwrap();
    assert_eq!(report.applied_profile_slug.as_deref(), Some("personal"));
    assert!(report.problems.iter().any(|p| p.kind == ProblemKind::NoSpecificRule));
}

#[test]
fn diagnostics_flags_unpushed_commits_with_foreign_email() {
    let mut h = TempHome::new();
    let work = setup(&mut h, false);
    let upstream = join(&h.root.to_string_lossy(), "upstream.git");
    h.ws.git.run(&["init", "-q", "--bare", &upstream]);
    let repo = h.init_repo(&join(&work, "foreign"), None);
    let r = Path::new(&repo);
    h.ws.git.run_in(r, &["remote", "add", "origin", &upstream]);
    h.ws.git.run_in(r, &["commit", "-q", "--allow-empty", "-m", "a"]);
    h.ws.git.run_in(r, &["push", "-q", "-u", "origin", "main"]);
    h.ws.git.run_in(r, &["-c", "user.email=ajeno@x.com", "commit", "-q", "--allow-empty", "-m", "b"]);

    let report = RepoDiagnostics::new(&h.ws.paths, &h.ws.git).analyze(&repo, &h.ws.state).unwrap();
    assert!(
        report.problems.iter().any(|p| p.kind == ProblemKind::ForeignEmailCommits && p.message.contains("ajeno@x.com"))
    );
}

#[test]
fn smart_clone_coverage_and_args() {
    let mut h = TempHome::new();
    let work = setup(&mut h, false);
    let state = &h.ws.state;
    let trabajo = state.profiles.iter().find(|p| p.slug == "trabajo").unwrap();
    let url = GitUrl::parse("https://github.com/empresa-a/web").unwrap();
    let clone = SmartCloneService::new(&h.ws.paths, &h.ws.git);
    let root = h.root.to_string_lossy().into_owned();

    assert_eq!(rule_matcher::profile_for_url(state, &url).map(|p| p.id), Some(trabajo.id));
    assert_eq!(clone.check_coverage(state, trabajo, &join(&join(&root, "x"), "web"), &url).status, CoverageStatus::Covered);
    let other = GitUrl::parse("git@github.com:juan/dotfiles.git").unwrap();
    assert_eq!(
        clone.check_coverage(state, trabajo, &join(&join(&root, "x"), "dotfiles"), &other).status,
        CoverageStatus::CoveredByOtherProfile
    );
    assert_eq!(clone.check_coverage(state, trabajo, &join(&work, "dotfiles"), &other).status, CoverageStatus::Covered);

    let req = CloneRequest {
        url: url.clone(),
        method: CloneMethod::Ssh,
        profile: trabajo,
        destination: join(&work, "web"),
        write_local_identity: false,
    };
    let args = clone.build_clone_args(&req, &SshClientInfo::windows_openssh());
    assert_eq!(args[0], "-c");
    assert!(args[1].starts_with(
        r"core.sshCommand=SSH_AUTH_SOCK='\\.\pipe\openssh-ssh-agent' C:/Windows/System32/OpenSSH/ssh.exe -i ~/.ssh/id_ed25519_trabajo -o IdentitiesOnly=yes"
    ));
    assert!(args.contains(&"git@github.com:empresa-a/web.git".to_string()));

    // HTTPS: el usuario del perfil solo se fija para su propio host.
    let https = |u: &str| CloneRequest {
        url: GitUrl::parse(u).unwrap(),
        method: CloneMethod::Https,
        profile: trabajo,
        destination: join(&work, "x"),
        write_local_identity: false,
    };
    let same = clone.build_clone_args(&https("https://github.com/empresa-a/web"), &SshClientInfo::windows_openssh());
    assert!(same.contains(&"credential.https://github.com.username=juan-empresa".to_string()));
    let other = clone.build_clone_args(&https("https://gitlab.com/grupo/web"), &SshClientInfo::windows_openssh());
    assert!(!other.iter().any(|a| a.starts_with("credential.")), "{other:?}");
    assert_eq!(other[0], "clone");
}

#[test]
fn smart_clone_clones_a_local_repo_and_diagnoses_it() {
    let mut h = TempHome::new();
    let work = setup(&mut h, false);
    // Origen local accesible por ruta: se clona con la misma función que usa la app.
    let upstream = join(&h.root.to_string_lossy(), "src");
    h.init_repo(&upstream, None);
    h.ws.git.run_in(Path::new(&upstream), &["commit", "-q", "--allow-empty", "-m", "init"]);
    let dest = join(&work, "copia");
    let r = h.ws.git.run_with(
        vec!["clone".into(), "--progress".into(), "--".into(), upstream.clone(), dest.clone()],
        GitRun::default(),
    );
    assert!(r.success(), "{}", r.combined());
    let report = RepoDiagnostics::new(&h.ws.paths, &h.ws.git).analyze(&dest, &h.ws.state).unwrap();
    assert_eq!(report.applied_profile_slug.as_deref(), Some("trabajo"));
}

#[test]
fn strict_mode_blocks_commit_without_rule() {
    let mut h = TempHome::new();
    let work = h.dir(&["dev", "empresa-a"]);
    let mut state = sample_state(&work);
    state.settings.no_profile_mode = NoProfileMode::Strict;
    h.ws.save(&state, false).unwrap();
    let integration = IntegrationService::new(&h.ws.paths, &h.ws.git);
    let plan = integration.plan_enable(&h.ws.state, true).unwrap();
    integration.apply(&plan, &mut h.ws.state.clone()).unwrap();

    let outside = h.init_repo(&join(&h.dir(&["otros"]), "s"), None);
    let commit = h.ws.git.run_with(
        ["commit", "--allow-empty", "-m", "x"].iter().map(|s| s.to_string()).collect(),
        GitRun {
            cwd: Some(Path::new(&outside)),
            env: vec![("GIT_AUTHOR_EMAIL".into(), None), ("GIT_COMMITTER_EMAIL".into(), None), ("EMAIL".into(), None)],
            ..Default::default()
        },
    );
    assert!(!commit.success());

    let inside = h.init_repo(&join(&work, "s"), None);
    assert!(h.ws.git.run_in(Path::new(&inside), &["commit", "-q", "--allow-empty", "-m", "x"]).success());
}

#[test]
fn generated_rules_file_matches_spec_layout() {
    let mut h = TempHome::new();
    setup(&mut h, false);
    let rules = h.read(&h.paths.rules_file());
    assert!(rules.starts_with(&format!("# {HEADER}")));
    let include = rules.find("[include]").unwrap();
    let folder = rules.find("gitdir/i:").unwrap();
    let ssh = rules.find("hasconfig:remote.*.url:git@github.com:empresa-a/**").unwrap();
    let https = rules.find("hasconfig:remote.*.url:https://github.com/empresa-a/**").unwrap();
    assert!(include < folder && folder < ssh && ssh < https);
    assert!(!rules.contains('\\'));
}

#[test]
fn backups_restore_previous_content() {
    let mut h = TempHome::new();
    setup(&mut h, true);
    let guard = h.ws.guard();
    let set = guard.list_backups().into_iter().next().unwrap();
    assert_eq!(set.reason, "enable-integration");
    assert!(set.display.ends_with(" · Activar integración"));
    guard.restore(&set).unwrap();
    let global = h.read(&h.global_config.to_string_lossy());
    assert!(global.contains("global@example.com"));
    assert!(!global.contains(RULES_INCLUDE_VALUE));
    // Restaurar crea antes otro backup.
    let backups = guard.list_backups();
    assert_eq!(backups.len(), 2);
    assert_eq!(backups[0].reason, format!("before-restore:{}", set.id));
}
