//! Lectura de solo metadatos del Administrador de credenciales de Windows, donde GCM guarda las credenciales
//! (destinos `git:https://[usuario@]host`). Solo se leen el destino y el usuario: el secreto nunca se toca.

pub struct Entry {
    pub target: String,
    pub user_name: Option<String>,
}

/// Host y usuario de un destino de GCM: `git:https://usuario@github.com/ruta`.
pub fn parse_target(target: &str) -> Option<(String, Option<String>)> {
    if target.len() < 4 || !target[..4].eq_ignore_ascii_case("git:") {
        return None;
    }
    let uri = url::Url::parse(&target[4..]).ok()?;
    if uri.scheme() != "https" && uri.scheme() != "http" {
        return None;
    }
    let host = uri.host_str()?.to_string();
    // `port()` es None cuando es el puerto por defecto del esquema.
    let host = match uri.port() {
        Some(p) => format!("{host}:{p}"),
        None => host,
    };
    let user = if uri.username().is_empty() {
        None
    } else {
        Some(percent_encoding::percent_decode_str(uri.username()).decode_utf8_lossy().into_owned())
    };
    Some((host, user))
}

#[cfg(windows)]
pub fn enumerate_git_targets() -> Vec<Entry> {
    use windows::Win32::Security::Credentials::{CREDENTIALW, CRED_ENUMERATE_FLAGS, CredEnumerateW, CredFree};
    use windows::core::HSTRING;

    let mut result = Vec::new();
    unsafe {
        let mut count = 0u32;
        let mut list: *mut *mut CREDENTIALW = std::ptr::null_mut();
        if CredEnumerateW(&HSTRING::from("git:*"), Some(CRED_ENUMERATE_FLAGS(0)), &mut count, &mut list).is_err() {
            return result;
        }
        for i in 0..count as usize {
            let cred = &**list.add(i);
            let Ok(target) = cred.TargetName.to_string() else { continue };
            if target.is_empty() {
                continue;
            }
            let user = if cred.UserName.is_null() { None } else { cred.UserName.to_string().ok() };
            result.push(Entry { target, user_name: user });
        }
        CredFree(list as *const std::ffi::c_void);
    }
    result
}

#[cfg(not(windows))]
pub fn enumerate_git_targets() -> Vec<Entry> {
    Vec::new()
}
