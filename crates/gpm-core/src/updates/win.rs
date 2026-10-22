//! Windows: elevación (UAC), firma Authenticode y registro de la instalación de Git.

use std::ffi::c_void;
use std::path::Path;

use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, ERROR_SUCCESS, HANDLE};
use windows::Win32::Security::WinTrust::{
    WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO, WTD_CHOICE_FILE,
    WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE, WinVerifyTrust,
};
use windows::Win32::Security::{
    GetTokenInformation, TOKEN_ELEVATION, TOKEN_ELEVATION_TYPE, TOKEN_QUERY, TokenElevation, TokenElevationType,
    TokenElevationTypeLimited,
};
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_REG_DWORD, RegCloseKey, RegGetValueW, RegOpenKeyExW,
};
use windows::Win32::System::Threading::{GetCurrentProcess, GetExitCodeProcess, INFINITE, OpenProcessToken, WaitForSingleObject};
use windows::Win32::UI::Shell::{SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW};
use windows::core::{HSTRING, PCWSTR, w};

use crate::{Error, Result, tr};

const GIT_UNINSTALL_KEY: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Git_is1");
const UAC_POLICY_KEY: PCWSTR = w!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System");

fn key_exists(root: HKEY, sub: PCWSTR) -> bool {
    unsafe {
        let mut key = HKEY::default();
        if RegOpenKeyExW(root, sub, None, KEY_READ, &mut key) != ERROR_SUCCESS {
            return false;
        }
        let _ = RegCloseKey(key);
        true
    }
}

fn read_dword(root: HKEY, sub: PCWSTR, value: PCWSTR) -> Option<u32> {
    let mut data = 0u32;
    let mut size = size_of::<u32>() as u32;
    let r = unsafe {
        RegGetValueW(root, sub, value, RRF_RT_REG_DWORD, None, Some(&mut data as *mut u32 as *mut c_void), Some(&mut size))
    };
    (r == ERROR_SUCCESS).then_some(data)
}

/// `Some(true)` si Git for Windows está registrado solo para el usuario; `None` si no aparece en el registro.
pub fn git_registered_per_user() -> Option<bool> {
    let machine = key_exists(HKEY_LOCAL_MACHINE, GIT_UNINSTALL_KEY);
    let user = key_exists(HKEY_CURRENT_USER, GIT_UNINSTALL_KEY);
    (machine || user).then_some(user && !machine)
}

fn token_info<T: Default>(class: windows::Win32::Security::TOKEN_INFORMATION_CLASS) -> Option<T> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).ok()?;
        let mut out = T::default();
        let mut len = 0u32;
        let ok = GetTokenInformation(token, class, Some(&mut out as *mut T as *mut c_void), size_of::<T>() as u32, &mut len);
        let _ = CloseHandle(token);
        ok.ok()?;
        Some(out)
    }
}

/// La app ya se ejecuta con permisos de administrador.
pub fn is_elevated() -> bool {
    token_info::<TOKEN_ELEVATION>(TokenElevation).is_some_and(|t| t.TokenIsElevated != 0)
}

/// El usuario pertenece a Administradores: la app ya está elevada o tiene un token dividido por el UAC.
pub fn is_admin_user() -> bool {
    is_elevated() || token_info::<TOKEN_ELEVATION_TYPE>(TokenElevationType) == Some(TokenElevationTypeLimited)
}

/// Elevar va a mostrar el diálogo de UAC. No lo muestra si la app ya está elevada, si el UAC está apagado
/// (`EnableLUA = 0`) o si el usuario es administrador y la directiva eleva sin preguntar
/// (`ConsentPromptBehaviorAdmin = 0`).
pub fn elevation_prompts() -> bool {
    if is_elevated() {
        return false;
    }
    if read_dword(HKEY_LOCAL_MACHINE, UAC_POLICY_KEY, w!("EnableLUA")) == Some(0) {
        return false;
    }
    let split_admin = token_info::<TOKEN_ELEVATION_TYPE>(TokenElevationType) == Some(TokenElevationTypeLimited);
    !(split_admin && read_dword(HKEY_LOCAL_MACHINE, UAC_POLICY_KEY, w!("ConsentPromptBehaviorAdmin")) == Some(0))
}

/// Firma Authenticode válida y de confianza (sin consultar revocación: no debe depender de la red).
pub fn authenticode_valid(path: &Path) -> bool {
    let file = HSTRING::from(path.as_os_str());
    let mut info = WINTRUST_FILE_INFO {
        cbStruct: size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: PCWSTR(file.as_ptr()),
        ..Default::default()
    };
    let mut data = WINTRUST_DATA {
        cbStruct: size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 { pFile: &mut info },
        dwStateAction: WTD_STATEACTION_VERIFY,
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    unsafe {
        let status = WinVerifyTrust(Default::default(), &mut action, &mut data as *mut _ as *mut c_void);
        data.dwStateAction = WTD_STATEACTION_CLOSE;
        let _ = WinVerifyTrust(Default::default(), &mut action, &mut data as *mut _ as *mut c_void);
        status == 0
    }
}

fn quote_arg(a: &str) -> String {
    if !a.is_empty() && !a.contains([' ', '\t', '"']) { a.to_string() } else { format!("\"{}\"", a.replace('"', "\\\"")) }
}

/// Lanza `exe` con el verbo `runas` y espera a que termine. `None` si el usuario rechazó el UAC.
pub fn run_elevated(exe: &Path, args: &[String]) -> Result<Option<i32>> {
    let file = HSTRING::from(exe.as_os_str());
    let params = HSTRING::from(args.iter().map(|a| quote_arg(a)).collect::<Vec<_>>().join(" "));
    let mut sei = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: 0,
        ..Default::default()
    };
    unsafe {
        if let Err(e) = ShellExecuteExW(&mut sei) {
            if e.code() == ERROR_CANCELLED.to_hresult() {
                return Ok(None);
            }
            return Err(Error::msg(tr!("No se pudo lanzar el instalador: {}", "Couldn't start the installer: {}", e.message())));
        }
        if sei.hProcess.is_invalid() {
            return Err(Error::msg(tr!("No se pudo seguir el instalador.", "Couldn't track the installer.")));
        }
        WaitForSingleObject(sei.hProcess, INFINITE);
        let mut code = 0u32;
        let r = GetExitCodeProcess(sei.hProcess, &mut code);
        let _ = CloseHandle(sei.hProcess);
        r.map_err(|e| Error::msg(e.message()))?;
        Ok(Some(code as i32))
    }
}
