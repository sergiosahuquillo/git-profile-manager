// Web de GitProfile Manager: textos, idioma, tema y enlace de descarga. Sin compilación.
//
// Los textos viven en i18n/<idioma>.json. En el HTML cada elemento dice qué clave lleva:
//   data-i18n="a.b"            → textContent
//   data-i18n-html="a.b"       → innerHTML (solo textos propios, con <code>, <em>…)
//   data-i18n-attr="alt:a.b"   → atributos, separados por «;»
// check-i18n.mjs comprueba que las claves coinciden entre idiomas y con lo que usa la página.

const LANGS = ["en", "es"];
const REPO = "sergiosahuquillo/git-profile-manager";
const LANG_KEY = "gpm-site-lang";
const THEME_KEY = "gpm-site-theme";

let messages = {};
let release = null;

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

// ?lang=es manda (para enlazar una versión concreta), luego lo elegido antes y luego el navegador.
function initialLang() {
  const param = new URLSearchParams(location.search).get("lang");
  if (LANGS.includes(param)) return param;
  const saved = store.get(LANG_KEY);
  if (LANGS.includes(saved)) return saved;
  return (navigator.languages || [navigator.language]).some((l) => /^es\b/i.test(l)) ? "es" : "en";
}

function t(key, vars = {}) {
  const value = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), messages);
  if (typeof value !== "string") {
    console.warn(`i18n: falta la clave ${key}`);
    return key;
  }
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? "");
}

async function setLang(lang) {
  const res = await fetch(`i18n/${lang}.json`);
  if (!res.ok) throw new Error(`i18n/${lang}.json: ${res.status}`);
  messages = await res.json();

  document.documentElement.lang = lang;
  document.title = t("meta.title");
  document.querySelector('meta[name="description"]').content = t("meta.description");

  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":");
      el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
  renderRelease();
  document.documentElement.classList.remove("i18n-pending");
}

// El botón apunta a la página de la última release y, si la API responde, directamente al instalador.
// Sin conexión con la API (límite de 60 peticiones por hora e IP) se queda el enlace a la página.
async function loadRelease() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    const data = await res.json();
    const asset = (data.assets || []).find((a) => a.name.endsWith("-setup.exe"));
    if (!asset) return;
    release = {
      version: data.tag_name.replace(/^v/, ""),
      size: (asset.size / 1024 / 1024).toFixed(1),
      url: asset.browser_download_url,
    };
    renderRelease();
  } catch {}
}

function renderRelease() {
  if (!release) return;
  for (const a of document.querySelectorAll("a.download")) a.href = release.url;
  for (const el of document.querySelectorAll("[data-version]")) {
    el.textContent = t("hero.version", { version: release.version, size: release.size });
  }
}

function initTheme() {
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set(THEME_KEY, next);
  });
}

function initLang(current) {
  let lang = current;
  document.getElementById("lang-toggle").addEventListener("click", async () => {
    lang = lang === "en" ? "es" : "en";
    store.set(LANG_KEY, lang);
    const url = new URL(location.href);
    url.searchParams.delete("lang");
    history.replaceState(null, "", url);
    await setLang(lang);
  });
}

// Escaparate de funciones (patrón de pestañas). Avanza solo: cada vez que termina la barra de la pestaña
// activa (animación CSS) pasa a la siguiente. Al elegir una a mano, o con «reducir movimiento», se para.
function initShowcase() {
  const root = document.querySelector("[data-showcase]");
  if (!root) return;
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const slides = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));
  let current = 0;

  const select = (i, focus = false) => {
    current = (i + tabs.length) % tabs.length;
    tabs.forEach((tab, k) => {
      const on = k === current;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      slides[k].classList.toggle("is-active", on);
    });
    if (focus) tabs[current].focus();
  };
  const stop = () => root.classList.add("is-manual");

  tabs.forEach((tab, i) =>
    tab.addEventListener("click", () => {
      stop();
      select(i);
    }),
  );
  root.querySelector('[role="tablist"]').addEventListener("keydown", (e) => {
    const moves = { ArrowDown: current + 1, ArrowRight: current + 1, ArrowUp: current - 1, ArrowLeft: current - 1, Home: 0, End: -1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    stop();
    select(moves[e.key], true);
  });
  root.addEventListener("animationend", (e) => {
    if (e.target.classList.contains("showcase-progress") && !root.classList.contains("is-manual")) select(current + 1);
  });

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) stop();
  // Fuera de pantalla no avanza: así se ve desde la primera al llegar al apartado.
  new IntersectionObserver(([entry]) => root.classList.toggle("is-offscreen", !entry.isIntersecting), {
    threshold: 0.4,
  }).observe(root);
}

const lang = initialLang();
initTheme();
initLang(lang);
initShowcase();
loadRelease();
setLang(lang).catch((err) => {
  console.error(err);
  document.documentElement.classList.remove("i18n-pending");
});
