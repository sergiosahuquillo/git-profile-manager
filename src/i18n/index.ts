// Traducciones de la interfaz (i18next). El idioma elegido se guarda en profiles.json (Settings.Language)
// y el núcleo lo aplica a sus mensajes. localStorage solo guarda una copia para pintar el primer
// fotograma en el idioma correcto antes de que llegue el arranque.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { Lang } from "../api/bindings/Lang";
import { api } from "../api/commands";
import { en } from "./en";
import { es } from "./es";

export const LANGS: { value: Lang; label: string }[] = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
];

const KEY = "gpm-lang";

/** Idioma del sistema: español si el navegador lo indica, inglés en cualquier otro caso. */
export function systemLang(): Lang {
  const nav = typeof navigator === "undefined" ? "" : navigator.language;
  return nav?.toLowerCase().startsWith("es") ? "es" : "en";
}

function initialLang(): Lang {
  try {
    const l = localStorage.getItem(KEY);
    if (l === "es" || l === "en") return l;
  } catch {
    /* almacenamiento no disponible */
  }
  return systemLang();
}

void i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en } },
  lng: initialLang(),
  fallbackLng: "es",
  interpolation: { escapeValue: false },
});
if (typeof document !== "undefined") document.documentElement.lang = i18n.language;

export default i18n;

/** `t` para el código fuera de React (acciones, toasts, diálogos de confirmación). */
export const t = i18n.t.bind(i18n) as typeof i18n.t;

export const currentLang = (): Lang => (i18n.language === "en" ? "en" : "es");

/** Locale para fechas y horas. */
export const dateLocale = () => (currentLang() === "en" ? "en-US" : "es-ES");

/** `saved`: idioma elegido en Ajustes; `null` sigue al sistema y no deja copia en caché. */
async function apply(lang: Lang, saved: boolean) {
  try {
    if (saved) localStorage.setItem(KEY, lang);
    else localStorage.removeItem(KEY);
  } catch {
    /* almacenamiento no disponible */
  }
  if (currentLang() !== lang) await i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
}

/** Tras el arranque: manda el idioma guardado en profiles.json; sin elegir, el del sistema. */
export const applySavedLanguage = (saved: Lang | null) => apply(saved ?? systemLang(), saved !== null);

/**
 * Cambia el idioma en caliente. El núcleo lo guarda y lo aplica primero, para que lo que se recargue
 * después ya llegue traducido. Devuelve el resumen con el ajuste guardado.
 */
export async function setLanguage(lang: Lang) {
  const overview = await api.setLanguage(lang);
  await apply(lang, true);
  return overview;
}
