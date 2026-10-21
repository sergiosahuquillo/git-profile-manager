/// Deshace el entrecomillado estilo C que Git aplica a rutas con caracteres especiales.
pub fn unquote_c(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() < 2 || chars[0] != '"' || chars[chars.len() - 1] != '"' {
        return s.to_string();
    }
    let end = chars.len() - 1;
    let mut bytes: Vec<u8> = Vec::new();
    let mut i = 1;
    while i < end {
        let c = chars[i];
        if c != '\\' || i + 1 >= end {
            let mut buf = [0u8; 4];
            bytes.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            i += 1;
            continue;
        }
        i += 1;
        let n = chars[i];
        match n {
            'n' => bytes.push(b'\n'),
            't' => bytes.push(b'\t'),
            '"' => bytes.push(b'"'),
            '\\' => bytes.push(b'\\'),
            '0'..='7' if i + 2 < end => {
                let oct: String = chars[i..i + 3].iter().collect();
                if let Ok(b) = u8::from_str_radix(&oct, 8) {
                    bytes.push(b);
                }
                i += 2;
            }
            other => {
                let mut buf = [0u8; 4];
                bytes.extend_from_slice(other.encode_utf8(&mut buf).as_bytes());
            }
        }
        i += 1;
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Comparación sin distinguir mayúsculas (como `StringComparison.OrdinalIgnoreCase`).
pub fn eq_ci(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b) || a.to_lowercase() == b.to_lowercase()
}

pub fn starts_with_ci(s: &str, prefix: &str) -> bool {
    s.to_lowercase().starts_with(&prefix.to_lowercase())
}

pub fn contains_ci(s: &str, needle: &str) -> bool {
    s.to_lowercase().contains(&needle.to_lowercase())
}

/// Divide en líneas no vacías (como `Split('\n', RemoveEmptyEntries)`), quitando `\r` final.
pub fn lines(s: &str) -> impl Iterator<Item = &str> {
    s.split('\n').map(|l| l.trim_end_matches('\r')).filter(|l| !l.is_empty())
}
