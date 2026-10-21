//! Simula cómo resolverá Git las reglas para una carpeta y unas URLs remotas.

use crate::app_paths::{AppPaths, full_path};
use crate::config::generator::{HASCONFIG_URL, conditions, normalize_folder, ordered_rules};
use crate::git::GitUrl;
use crate::git::text::starts_with_ci;
use crate::models::{AppState, NoProfileMode, Profile, Rule, RuleType};

pub fn folder_matches(paths: &AppPaths, rule: &Rule, repo_dir: &str) -> bool {
    if rule.kind != RuleType::Folder {
        return false;
    }
    let folder = normalize_folder(&paths.expand_tilde(rule.value.trim()));
    let git_dir = format!("{}.git/", normalize_folder(&full_path(repo_dir)));
    starts_with_ci(&git_dir, &folder)
}

pub fn remote_matches(profile: &Profile, rule: &Rule, url: &GitUrl) -> bool {
    matching_condition(profile, rule, url).is_some()
}

/// Condición `hasconfig` de la regla que coincide con la URL, evaluada como Git: contra la URL literal
/// (con usuario y puerto) y distinguiendo mayúsculas.
pub fn matching_condition(profile: &Profile, rule: &Rule, url: &GitUrl) -> Option<String> {
    if rule.kind != RuleType::Remote {
        return None;
    }
    let literal = url.literal();
    conditions(profile, rule).into_iter().find(|c| {
        c.strip_prefix(HASCONFIG_URL).is_some_and(|pattern| url_pattern_matches(pattern, &literal))
    })
}

/// Los patrones generados son siempre `<prefijo>/**`: coincide todo lo que cuelga del prefijo.
fn url_pattern_matches(pattern: &str, url: &str) -> bool {
    match pattern.strip_suffix("**") {
        Some(prefix) => url.len() > prefix.len() && url.starts_with(prefix),
        None => url == pattern,
    }
}

/// Perfil que ganará: el último include que coincida, empezando por el perfil por defecto.
pub fn winner<'a>(paths: &AppPaths, state: &'a AppState, repo_dir: &str, remotes: &[GitUrl]) -> Option<&'a Profile> {
    let mut winner =
        if state.settings.no_profile_mode == NoProfileMode::DefaultProfile { state.default_profile() } else { None };
    for (profile, rule) in ordered_rules(state) {
        let matched = if rule.kind == RuleType::Folder {
            folder_matches(paths, rule, repo_dir)
        } else {
            remotes.iter().any(|u| remote_matches(profile, rule, u))
        };
        if matched {
            winner = Some(profile);
        }
    }
    winner
}

/// Regla que hace ganar a `winner` (la última que coincide), o `None` si gana por ser el perfil por defecto.
pub fn winning_rule<'a>(paths: &AppPaths, state: &'a AppState, repo_dir: &str, remotes: &[GitUrl]) -> Option<&'a Rule> {
    let mut found = None;
    for (profile, rule) in ordered_rules(state) {
        let matched = if rule.kind == RuleType::Folder {
            folder_matches(paths, rule, repo_dir)
        } else {
            remotes.iter().any(|u| remote_matches(profile, rule, u))
        };
        if matched {
            found = Some(rule);
        }
    }
    found
}

/// Perfil cuya regla de organización coincide con la URL (para preseleccionar en Smart Clone).
pub fn profile_for_url<'a>(state: &'a AppState, url: &GitUrl) -> Option<&'a Profile> {
    // Para preseleccionar, la URL se compara en su forma canónica.
    let canonical = GitUrl::parse(&url.canonical())?;
    let mut matched = None;
    for (profile, rule) in ordered_rules(state).into_iter().filter(|(_, r)| r.kind == RuleType::Remote) {
        if remote_matches(profile, rule, &canonical) {
            matched = Some(profile);
        }
    }
    matched
}
