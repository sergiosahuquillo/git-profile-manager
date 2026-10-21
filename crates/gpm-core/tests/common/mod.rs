//! HOME temporal con `GIT_CONFIG_GLOBAL` propio: los tests nunca tocan la configuración real.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use gpm_core::models::{AppState, Profile, Rule, RuleType};
use gpm_core::{AppPaths, Workspace};

pub struct TempHome {
    _dir: tempfile::TempDir,
    pub root: PathBuf,
    pub home: PathBuf,
    pub global_config: PathBuf,
    pub paths: AppPaths,
    pub ws: Workspace,
}

impl TempHome {
    pub fn new() -> Self {
        let dir = tempfile::Builder::new().prefix("gpm-tests-").tempdir().unwrap();
        // Ruta canónica sin el prefijo \\?\ para que coincida con lo que muestra Git. Canonicalizar
        // expande los nombres cortos 8.3 (en los runners de GitHub, TEMP es C:\Users\RUNNER~1\...):
        // Git compara gitdir con la ruta larga y una regla con la corta no coincidiría nunca.
        let canonical = std::fs::canonicalize(dir.path()).unwrap().to_string_lossy().into_owned();
        let root = PathBuf::from(canonical.strip_prefix(r"\\?\").unwrap_or(&canonical));
        let home = root.join("home");
        std::fs::create_dir_all(&home).unwrap();
        let global_config = home.join(".gitconfig");
        std::fs::write(
            &global_config,
            "[user]\n\tname = Global User\n\temail = global@example.com\n[init]\n\tdefaultBranch = main\n",
        )
        .unwrap();
        let mut paths = AppPaths::new(&home, root.join("appdata"));
        paths.child_env = vec![
            ("HOME".into(), Some(home.to_string_lossy().into_owned())),
            ("GIT_CONFIG_GLOBAL".into(), Some(global_config.to_string_lossy().into_owned())),
            ("GIT_CONFIG_NOSYSTEM".into(), Some("1".into())),
            ("GIT_CONFIG_PARAMETERS".into(), None),
        ];
        let ws = Workspace::new(paths.clone(), None);
        TempHome { _dir: dir, root, home, global_config, paths, ws }
    }

    pub fn dir(&self, parts: &[&str]) -> String {
        let mut d = self.root.clone();
        for p in parts {
            d.push(p);
        }
        std::fs::create_dir_all(&d).unwrap();
        d.to_string_lossy().into_owned()
    }

    pub fn init_repo(&self, dir: &str, remote: Option<&str>) -> String {
        std::fs::create_dir_all(dir).unwrap();
        self.ws.git.run_in(Path::new(dir), &["init", "-q"]);
        if let Some(r) = remote {
            self.ws.git.run_in(Path::new(dir), &["remote", "add", "origin", r]);
        }
        dir.to_string()
    }

    pub fn get(&self, repo: &str, key: &str) -> Option<String> {
        let r = self.ws.git.run_in(Path::new(repo), &["config", "--get", key]);
        r.success().then(|| r.stdout.trim().to_string())
    }

    pub fn read(&self, path: &str) -> String {
        std::fs::read_to_string(path).unwrap()
    }
}

pub fn join(a: &str, b: &str) -> String {
    Path::new(a).join(b).to_string_lossy().into_owned()
}

pub fn sample_state(work_folder: &str) -> AppState {
    AppState {
        profiles: vec![
            Profile {
                display_name: "Personal".into(),
                slug: "personal".into(),
                git_user_name: "Juan".into(),
                git_user_email: "juan@personal.dev".into(),
                ssh_key_path: Some("~/.ssh/id_ed25519_personal".into()),
                is_default: true,
                ..Profile::default()
            },
            Profile {
                display_name: "Trabajo - Empresa A".into(),
                slug: "trabajo".into(),
                git_user_name: "Juan Pérez".into(),
                git_user_email: "juan@empresa-a.com".into(),
                ssh_key_path: Some("~/.ssh/id_ed25519_trabajo".into()),
                https_username: Some("juan-empresa".into()),
                rules: vec![
                    Rule { kind: RuleType::Folder, value: work_folder.into(), order: 0, ..Rule::default() },
                    Rule { kind: RuleType::Remote, value: "empresa-a".into(), order: 1, ..Rule::default() },
                ],
                ..Profile::default()
            },
        ],
        ..AppState::default()
    }
}
