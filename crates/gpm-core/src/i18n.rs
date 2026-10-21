//! Idioma de los mensajes que el núcleo devuelve al usuario.
//!
//! Se fija con [`set_lang`] en el arranque (el idioma guardado en Ajustes o el del sistema) y al cambiarlo
//! en Ajustes. Los textos se
//! escriben en su sitio con las dos variantes mediante [`tr!`](crate::tr). Los ficheros generados no
//! dependen del idioma (siempre en inglés): cambiar de idioma no debe reescribirlos.

use std::sync::atomic::{AtomicU8, Ordering};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Lang {
    #[default]
    Es,
    En,
}

static LANG: AtomicU8 = AtomicU8::new(0);

pub fn set_lang(lang: Lang) {
    LANG.store(lang as u8, Ordering::Relaxed);
}

pub fn lang() -> Lang {
    match LANG.load(Ordering::Relaxed) {
        1 => Lang::En,
        _ => Lang::Es,
    }
}

/// `tr!("texto {x}", "text {x}", args...)` formatea la variante del idioma actual.
#[macro_export]
macro_rules! tr {
    ($es:literal, $en:literal $(, $($arg:tt)*)?) => {
        match $crate::i18n::lang() {
            $crate::i18n::Lang::Es => format!($es $(, $($arg)*)?),
            $crate::i18n::Lang::En => format!($en $(, $($arg)*)?),
        }
    };
}
