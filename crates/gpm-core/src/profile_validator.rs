use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;
use ts_rs::TS;
use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;
use uuid::Uuid;

use crate::config::generator::{normalize_folder, normalize_org, ordered_rules};
use crate::git::text::{eq_ci, starts_with_ci};
use crate::models::{AppState, NoProfileMode, RuleType, SigningMode, blank};
use crate::tr;

static SLUG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$").unwrap());
static EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[^@\s]+@[^@\s]+$").unwrap());
static HOST_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9.-]+(:\d+)?$").unwrap());

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum ConflictSeverity {
    Warning,
    Error,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RuleConflict {
    pub severity: ConflictSeverity,
    pub message: String,
    pub rule_a: Uuid,
    pub rule_b: Uuid,
}

pub fn is_valid_slug(s: &str) -> bool {
    SLUG_RE.is_match(s)
}
pub fn is_valid_email(s: &str) -> bool {
    EMAIL_RE.is_match(s)
}
pub fn is_valid_host(s: &str) -> bool {
    HOST_RE.is_match(s)
}

/// Slug a partir del nombre: sin acentos, solo `a-z0-9` y guiones, máximo 40.
/// Descarta también las letras no ASCII, que el validador rechazaría.
pub fn make_slug(display_name: &str) -> String {
    let mapped: String = display_name
        .nfd()
        .filter(|c| !is_combining_mark(*c))
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let mut slug = String::with_capacity(mapped.len());
    for c in mapped.chars() {
        if c == '-' && slug.ends_with('-') {
            continue;
        }
        slug.push(c);
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.len() > 40 { slug[..40].trim_matches('-').to_string() } else { slug }
}

/// Errores que impiden guardar el estado.
pub fn validate(state: &AppState) -> Vec<String> {
    let mut errors = Vec::new();
    for p in &state.profiles {
        let name = if p.display_name.trim().is_empty() { tr!("(sin nombre)", "(no name)") } else { p.display_name.clone() };
        if p.display_name.trim().is_empty() {
            errors.push(tr!("Hay un perfil sin nombre.", "There's a profile with no name."));
        }
        if !is_valid_slug(&p.slug) {
            errors.push(tr!(
                "{name}: el slug solo admite [a-z0-9-] y no puede empezar ni acabar en guion.",
                "{name}: the slug only allows [a-z0-9-] and can't start or end with a hyphen."
            ));
        }
        if p.slug == "rules" {
            errors.push(tr!("{name}: \"rules\" está reservado como slug.", "{name}: \"rules\" is reserved as a slug."));
        }
        if p.git_user_name.trim().is_empty() {
            errors.push(tr!("{name}: falta user.name.", "{name}: user.name is missing."));
        }
        if !is_valid_email(&p.git_user_email) {
            errors.push(tr!("{name}: email no válido.", "{name}: invalid email."));
        }
        if !is_valid_host(&p.host) {
            errors.push(tr!("{name}: host no válido.", "{name}: invalid host."));
        }
        if p.signing != SigningMode::None && blank(&p.signing_key) {
            errors.push(tr!("{name}: la firma requiere una clave.", "{name}: signing requires a key."));
        }
        for r in &p.rules {
            if r.value.trim().is_empty() {
                errors.push(tr!("{name}: hay una regla vacía.", "{name}: there's an empty rule."));
            }
            if r.kind == RuleType::Remote && !blank(&r.host) && !is_valid_host(r.host.as_deref().unwrap()) {
                errors.push(tr!(
                    "{name}: host de regla no válido ({}).",
                    "{name}: invalid rule host ({}).",
                    r.host.as_deref().unwrap()
                ));
            }
        }
    }
    let mut seen: Vec<String> = Vec::new();
    let mut reported: Vec<String> = Vec::new();
    for p in &state.profiles {
        let lower = p.slug.to_lowercase();
        if seen.contains(&lower) {
            if !reported.contains(&lower) {
                errors.push(tr!("Slug duplicado: {}.", "Duplicate slug: {}.", p.slug));
                reported.push(lower);
            }
        } else {
            seen.push(lower);
        }
    }
    let defaults = state.profiles.iter().filter(|p| p.is_default).count();
    if !state.profiles.is_empty() && defaults != 1 && state.settings.no_profile_mode == NoProfileMode::DefaultProfile {
        errors.push(tr!("Debe haber exactamente un perfil por defecto.", "There must be exactly one default profile."));
    }

    // credential.<url>.username no se puede anular: un perfil sin usuario heredaría el de otro perfil
    // del mismo host que se aplique antes (el por defecto u otra regla).
    for p in state.profiles.iter().filter(|p| !p.is_default && !p.rules.is_empty() && blank(&p.https_username)) {
        let other = state
            .profiles
            .iter()
            .find(|o| o.id != p.id && !blank(&o.https_username) && eq_ci(&o.host, &p.host));
        if let Some(other) = other {
            errors.push(tr!(
                "{}: «{}» fija el usuario HTTPS de {} ({}). Sin usuario propio, los repos de «{}» usarían esa cuenta. Indica su usuario HTTPS.",
                "{}: “{}” sets the HTTPS username for {} ({}). Without its own username, “{}” repos would use that account. Enter its HTTPS username.",
                p.display_name,
                other.display_name,
                p.host,
                other.https_username.as_deref().unwrap_or(""),
                p.display_name
            ));
        }
    }
    errors
}

/// Conflictos entre reglas de perfiles con emails distintos que pueden coincidir en el mismo repo.
pub fn detect_conflicts(state: &AppState) -> Vec<RuleConflict> {
    let rules = ordered_rules(state);
    let mut result = Vec::new();
    for i in 0..rules.len() {
        for j in i + 1..rules.len() {
            let (pa, ra) = rules[i];
            let (pb, rb) = rules[j];
            if pa.id == pb.id || eq_ci(&pa.git_user_email, &pb.git_user_email) {
                continue;
            }
            if ra.kind == RuleType::Folder && rb.kind == RuleType::Folder {
                let fa = normalize_folder(&ra.value);
                let fb = normalize_folder(&rb.value);
                if starts_with_ci(&fa, &fb) || starts_with_ci(&fb, &fa) {
                    let same = eq_ci(&fa, &fb);
                    result.push(RuleConflict {
                        severity: if same { ConflictSeverity::Error } else { ConflictSeverity::Warning },
                        message: if same {
                            tr!(
                                "La carpeta {fa} está asignada a «{}» y a «{}». Gana «{}» (última).",
                                "Folder {fa} is assigned to “{}” and “{}”. “{}” wins (last).",
                                pa.display_name,
                                pb.display_name,
                                pb.display_name
                            )
                        } else {
                            tr!(
                                "Carpetas anidadas: {fa} («{}») y {fb} («{}»). En la parte común gana «{}».",
                                "Nested folders: {fa} (“{}”) and {fb} (“{}”). “{}” wins in the shared part.",
                                pa.display_name,
                                pb.display_name,
                                pb.display_name
                            )
                        },
                        rule_a: ra.id,
                        rule_b: rb.id,
                    });
                }
            } else if ra.kind == RuleType::Remote && rb.kind == RuleType::Remote {
                let ha = if blank(&ra.host) { pa.host.clone() } else { ra.host.clone().unwrap() };
                let hb = if blank(&rb.host) { pb.host.clone() } else { rb.host.clone().unwrap() };
                if !eq_ci(&ha, &hb) {
                    continue;
                }
                let oa = format!("{}/", normalize_org(&ra.value));
                let ob = format!("{}/", normalize_org(&rb.value));
                if starts_with_ci(&oa, &ob) || starts_with_ci(&ob, &oa) {
                    result.push(RuleConflict {
                        severity: ConflictSeverity::Error,
                        message: tr!(
                            "La organización {ha}/{} coincide en «{}» y «{}». Gana «{}» (última).",
                            "Organization {ha}/{} matches in “{}” and “{}”. “{}” wins (last).",
                            oa.trim_end_matches('/'),
                            pa.display_name,
                            pb.display_name,
                            pb.display_name
                        ),
                        rule_a: ra.id,
                        rule_b: rb.id,
                    });
                }
            } else {
                let (fp, fr, rp, rr) = if ra.kind == RuleType::Folder { (pa, ra, pb, rb) } else { (pb, rb, pa, ra) };
                result.push(RuleConflict {
                    severity: ConflictSeverity::Warning,
                    message: tr!(
                        "Un repo de {} dentro de {} usará «{}» (el remoto prevalece sobre «{}»).",
                        "A repo from {} inside {} will use “{}” (the remote wins over “{}”).",
                        rr.value,
                        normalize_folder(&fr.value),
                        rp.display_name,
                        fp.display_name
                    ),
                    rule_a: fr.id,
                    rule_b: rr.id,
                });
            }
        }
    }
    result
}
