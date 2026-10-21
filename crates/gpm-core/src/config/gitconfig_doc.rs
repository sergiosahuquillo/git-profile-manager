/// Construye ficheros de configuración de Git con el mismo escapado que `git config`.
/// El resultado se valida con `git config --file <tmp> --list` antes de escribirse.
#[derive(Default)]
pub struct GitConfigDocument {
    out: String,
    has_section: bool,
}

impl GitConfigDocument {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn comment(&mut self, text: &str) -> &mut Self {
        self.out.push_str("# ");
        self.out.push_str(text);
        self.out.push('\n');
        self
    }

    pub fn blank_line(&mut self) -> &mut Self {
        self.out.push('\n');
        self
    }

    pub fn section(&mut self, name: &str, subsection: Option<&str>) -> &mut Self {
        match subsection {
            None => self.out.push_str(&format!("[{name}]\n")),
            Some(sub) => self.out.push_str(&format!("[{name} \"{}\"]\n", escape_subsection(sub))),
        }
        self.has_section = true;
        self
    }

    pub fn set(&mut self, key: &str, value: &str) -> &mut Self {
        assert!(self.has_section, "Set antes de Section.");
        self.out.push('\t');
        self.out.push_str(key);
        self.out.push_str(" = ");
        self.out.push_str(&escape_value(value));
        self.out.push('\n');
        self
    }

    pub fn finish(&self) -> String {
        self.out.clone()
    }
}

pub fn escape_subsection(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn escape_value(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    for c in value.chars() {
        match c {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\t' => escaped.push_str("\\t"),
            _ => escaped.push(c),
        }
    }
    let first = value.chars().next();
    let last = value.chars().last();
    let needs_quotes = !value.is_empty()
        && (first.is_some_and(char::is_whitespace)
            || last.is_some_and(char::is_whitespace)
            || value.contains(';')
            || value.contains('#'));
    if needs_quotes { format!("\"{escaped}\"") } else { escaped }
}
