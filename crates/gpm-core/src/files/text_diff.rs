//! Diff de líneas (LCS) para las vistas previas obligatorias antes de modificar ficheros.

use serde::Serialize;
use ts_rs::TS;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum DiffKind {
    Ctx,
    Add,
    Del,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct DiffLine {
    pub kind: DiffKind,
    pub text: String,
}

fn split_lines(text: Option<&str>) -> Vec<String> {
    match text {
        None | Some("") => Vec::new(),
        Some(t) => {
            let t = t.replace("\r\n", "\n");
            let t = t.strip_suffix('\n').unwrap_or(&t);
            t.split('\n').map(String::from).collect()
        }
    }
}

/// Diff completo (sin hunks): todas las líneas con su tipo, para pintarlo como en el diseño.
pub fn lines(before: Option<&str>, after: Option<&str>) -> Vec<DiffLine> {
    let a = split_lines(before);
    let b = split_lines(after);
    let mut lcs = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for i in (0..a.len()).rev() {
        for j in (0..b.len()).rev() {
            lcs[i][j] = if a[i] == b[j] { lcs[i + 1][j + 1] + 1 } else { lcs[i + 1][j].max(lcs[i][j + 1]) };
        }
    }
    let (mut x, mut y) = (0, 0);
    let mut out = Vec::with_capacity(a.len().max(b.len()));
    while x < a.len() || y < b.len() {
        if x < a.len() && y < b.len() && a[x] == b[y] {
            out.push(DiffLine { kind: DiffKind::Ctx, text: a[x].clone() });
            x += 1;
            y += 1;
        } else if x < a.len() && (y == b.len() || lcs[x + 1][y] >= lcs[x][y + 1]) {
            // Ante un empate se muestra antes la línea que desaparece, como en el diseño.
            out.push(DiffLine { kind: DiffKind::Del, text: a[x].clone() });
            x += 1;
        } else {
            out.push(DiffLine { kind: DiffKind::Add, text: b[y].clone() });
            y += 1;
        }
    }
    out
}

pub fn has_changes(before: Option<&str>, after: Option<&str>) -> bool {
    before.unwrap_or("").replace("\r\n", "\n") != after.unwrap_or("").replace("\r\n", "\n")
        || before.is_none() != after.is_none()
}
