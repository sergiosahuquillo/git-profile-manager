// Acceso a las capacidades nativas (ventana, diálogos, portapapeles, navegador) con alternativas
// inofensivas cuando el frontend corre fuera de Tauri.
import i18n from "i18next";
import { inTauri } from "./commands";

export async function pickFolder(title = i18n.t("common.pickFolder")): Promise<string | null> {
  if (!inTauri) return window.prompt(title, "C:\\dev\\") || null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, multiple: false, title });
  return typeof r === "string" ? r : null;
}

export async function pickFile(title = i18n.t("common.pickFile")): Promise<string | null> {
  if (!inTauri) return window.prompt(title, "C:\\Users\\Alex\\.ssh\\id_ed25519") || null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: false, multiple: false, title });
  return typeof r === "string" ? r : null;
}

export async function copyText(text: string): Promise<void> {
  if (!inTauri) {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    return;
  }
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
  await writeText(text);
}

export async function readClipboard(): Promise<string> {
  try {
    if (!inTauri) return (await navigator.clipboard?.readText()) ?? "";
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    return (await readText()) ?? "";
  } catch {
    return "";
  }
}

export async function openUrl(url: string): Promise<void> {
  if (!inTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl: open } = await import("@tauri-apps/plugin-opener");
  await open(url);
}

export async function windowAction(action: "minimize" | "toggleMaximize" | "close"): Promise<void> {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  if (action === "minimize") await w.minimize();
  else if (action === "toggleMaximize") await w.toggleMaximize();
  else await w.close();
}

/** Cierra la ventana sin volver a pasar por la confirmación de cambios sin guardar. */
export async function destroyWindow(): Promise<void> {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().destroy();
}

export async function onCloseRequested(handler: () => boolean): Promise<() => void> {
  if (!inTauri) return () => undefined;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onCloseRequested((event) => {
    if (!handler()) event.preventDefault();
  });
}

export async function onWindowFocus(handler: () => void): Promise<() => void> {
  if (!inTauri) {
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onFocusChanged(({ payload }) => {
    if (payload) handler();
  });
}

export type DragDropHandler = (e: { type: "over" | "drop" | "leave"; paths: string[] }) => void;

export async function onDragDrop(handler: DragDropHandler): Promise<() => void> {
  if (!inTauri) return () => undefined;
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === "over" || payload.type === "enter") handler({ type: "over", paths: [] });
    else if (payload.type === "drop") handler({ type: "drop", paths: payload.paths });
    else handler({ type: "leave", paths: [] });
  });
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!inTauri) {
    if (!import.meta.env.DEV) return () => undefined;
    const { mockListen } = await import("./mock");
    return mockListen(event, (p) => handler(p as T));
  }
  const { listen: l } = await import("@tauri-apps/api/event");
  return l<T>(event, (e) => handler(e.payload));
}

// ─── Autoactualización de la app (plugin updater) ─────────────────────────

export type AppUpdate = {
  version: string;
  /** Descarga e instala. `onProgress` recibe el porcentaje (o null si el servidor no da el tamaño). */
  install: (onProgress: (pct: number | null) => void) => Promise<void>;
};

export async function appVersion(): Promise<string> {
  if (!inTauri) return import.meta.env.DEV ? (await import("./mock")).mockAppVersion() : "";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** Versión nueva publicada de la app, o null si es la última. */
export async function checkAppUpdate(): Promise<AppUpdate | null> {
  if (!inTauri) return import.meta.env.DEV ? (await import("./mock")).mockAppUpdate() : null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    install: async (onProgress) => {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          done += e.data.chunkLength;
          onProgress(total ? Math.min(100, Math.round((done * 100) / total)) : null);
        }
      });
    },
  };
}

/** Reinicia la app. Fuera de Tauri no hace nada (el simulado ya "instaló" la versión nueva). */
export async function relaunchApp(): Promise<void> {
  if (!inTauri) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
