// Actualizaciones de Git for Windows y de la propia app. Se comprueban al arrancar (salvo en modo Off) y
// desde Ajustes. En modo Auto se descargan e instalan solas, salvo Git cuando su instalador va a pedir UAC:
// entonces se queda descargado y el usuario pulsa Instalar. En Manual solo se avisa.
import { create } from "zustand";
import type { GitUpdateInfo } from "../api/bindings/GitUpdateInfo";
import type { InstallScope } from "../api/bindings/InstallScope";
import type { UpdateMode } from "../api/bindings/UpdateMode";
import type { UpdateProgress } from "../api/bindings/UpdateProgress";
import { api, errorMessage } from "../api/commands";
import { type AppUpdate, appVersion, checkAppUpdate, listen, relaunchApp } from "../api/platform";
import { t } from "../i18n";
import { isDirty } from "../lib/profiles";
import { refresh } from "./actions";
import { toast, useStore } from "./store";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "verifying"
  | "ready"
  | "installing"
  | "error";

export type ComponentUpdate = {
  installed: string | null;
  latest: string | null;
  phase: UpdatePhase;
  /** 0-100 durante la descarga; null si no se sabe. */
  percent: number | null;
  error: string | null;
};

type UpdatesState = {
  git: ComponentUpdate & { info: GitUpdateInfo | null };
  app: ComponentUpdate;
  checkedAt: Date | null;
  checkError: string | null;
};

const idle: ComponentUpdate = { installed: null, latest: null, phase: "idle", percent: null, error: null };

export const useUpdates = create<UpdatesState>(() => ({
  git: { ...idle, info: null },
  app: idle,
  checkedAt: null,
  checkError: null,
}));

const setGit = (patch: Partial<UpdatesState["git"]>) =>
  useUpdates.setState((s) => ({ git: { ...s.git, ...patch } }));
const setApp = (patch: Partial<ComponentUpdate>) =>
  useUpdates.setState((s) => ({ app: { ...s.app, ...patch } }));

let pendingApp: AppUpdate | null = null;

export const updateMode = (): UpdateMode => useStore.getState().overview?.state.Settings.UpdateMode ?? "Auto";

/** Fases en las que hay trabajo en curso: no se lanza nada encima. */
export const isBusy = (p: UpdatePhase) =>
  p === "checking" || p === "downloading" || p === "verifying" || p === "installing";

/** Nada abierto que una instalación automática pueda pisar (un clon usa Git; reiniciar perdería borradores). */
function quiet(forApp: boolean): boolean {
  const s = useStore.getState();
  if (s.cloneOpen || s.onboardingOpen) return false;
  if (!forApp) return true;
  const saved = s.overview?.state.Profiles ?? [];
  const dirty = saved.some((p) => isDirty(p, s.drafts[p.Id])) || s.newDraft !== null;
  return !dirty && !s.change && !s.ruleDialog;
}

/** Espera a que no haya nada abierto que la instalación pueda interrumpir. */
function whenQuiet(forApp: boolean): Promise<void> {
  if (quiet(forApp)) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useStore.subscribe(() => {
      if (!quiet(forApp)) return;
      unsub();
      resolve();
    });
  });
}

/** Escucha el progreso de Git y carga la versión de la app. Devuelve la función que deja de escuchar. */
export async function startUpdates(): Promise<() => void> {
  const unlisten = await listen<UpdateProgress>("git-update-progress", (p) => {
    const phase =
      p.phase === "Downloading" ? "downloading" : p.phase === "Verifying" ? "verifying" : "installing";
    setGit({ phase, percent: p.phase === "Downloading" ? p.percent : null, error: null });
  });
  appVersion()
    .then((v) => setApp({ installed: v }))
    .catch(() => undefined);
  return unlisten;
}

/**
 * Comprueba las dos actualizaciones y, en modo Auto, las lanza. Sin red falla en silencio.
 * `manual`: búsqueda pedida por el usuario; en modo Off se comporta como Solo avisar.
 */
export async function checkUpdates(manual = false): Promise<void> {
  const saved = updateMode();
  if (saved === "Off" && !manual) return;
  const mode = saved === "Off" ? "Manual" : saved;
  const { git, app } = useUpdates.getState();
  useUpdates.setState({ checkError: null });
  const errors: string[] = [];
  await Promise.all([
    isBusy(git.phase) ? null : checkGit(mode).catch((e) => errors.push(errorMessage(e))),
    isBusy(app.phase) ? null : checkApp(mode).catch((e) => errors.push(errorMessage(e))),
  ]);
  useUpdates.setState({ checkedAt: new Date(), checkError: errors[0] ?? null });
}

async function checkGit(mode: UpdateMode) {
  setGit({ phase: "checking", error: null });
  let info: GitUpdateInfo | null;
  try {
    info = await api.checkGitUpdate();
  } catch (e) {
    setGit({ phase: "idle" });
    throw e;
  }
  if (!info?.available) {
    setGit({ phase: "idle", info, installed: info?.installed ?? null, latest: info?.latest ?? null });
    return;
  }
  setGit({
    phase: info.downloaded ? "ready" : "available",
    info,
    installed: info.installed,
    latest: info.latest,
    percent: null,
  });
  if (mode !== "Auto") return;
  if (!info.downloaded) {
    info = await downloadGit();
    if (!info) return;
  }
  if (!info.promptsUac) {
    await whenQuiet(false);
    await installGit();
  }
}

async function checkApp(mode: UpdateMode) {
  setApp({ phase: "checking", error: null });
  try {
    pendingApp = await checkAppUpdate();
  } catch (e) {
    setApp({ phase: "idle" });
    throw e;
  }
  if (!pendingApp) {
    setApp({ phase: "idle", latest: useUpdates.getState().app.installed });
    return;
  }
  setApp({ phase: "available", latest: pendingApp.version, percent: null });
  if (mode === "Auto") {
    await whenQuiet(true);
    await installApp(true);
  }
}

/** Descarga y verifica el instalador de Git; queda listo para instalar. */
async function downloadGit(): Promise<GitUpdateInfo | null> {
  setGit({ phase: "downloading", percent: 0, error: null });
  try {
    const info = await api.downloadGitUpdate();
    setGit({ phase: "ready", info, percent: null });
    return info;
  } catch (e) {
    setGit({ phase: "error", error: errorMessage(e) });
    return null;
  }
}

/** Instala Git (descargándolo antes si hace falta). Con UAC, la espera incluye la respuesta del usuario. */
export async function installGit(): Promise<void> {
  const { git } = useUpdates.getState();
  if (isBusy(git.phase)) return;
  setGit({ phase: git.info?.downloaded ? "installing" : "downloading", percent: 0, error: null });
  try {
    const r = await api.installGitUpdate();
    if (r.cancelled) {
      setGit({ phase: "error", error: t("updates.uacCancelled") });
      return;
    }
    useStore.getState().setEnv(r.environment);
    const latest = useUpdates.getState().git.latest;
    setGit({
      phase: "idle",
      installed: latest,
      percent: null,
      info: git.info ? { ...git.info, available: false, downloaded: false, installed: latest } : null,
    });
    toast(t("updates.gitUpdated", { version: latest }));
  } catch (e) {
    setGit({ phase: "error", error: errorMessage(e) });
  }
}

/**
 * Pide confirmación antes de instalar Git cuando va a salir el UAC (o cuando el usuario lo lanza en
 * modo Manual): el instalador cierra las ventanas de Git Bash abiertas.
 */
export function confirmInstallGit(): void {
  const { git } = useUpdates.getState();
  const s = useStore.getState();
  s.askChange({
    title: t("updates.confirm.title", { version: git.latest }),
    note: git.info?.promptsUac ? t("updates.confirm.noteUac") : t("updates.confirm.note"),
    warn: t("updates.confirm.warn"),
    blocks: [],
    applyLabel: t("updates.confirm.apply"),
    onApply: async () => {
      useStore.getState().askChange(null);
      await installGit();
    },
  });
}

/**
 * Instala Git donde no lo hay. Al terminar vuelve a comprobar el entorno, que deja de estar bloqueado, y si
 * el primer arranque no se completó (no se pudo abrir sin Git), abre el asistente.
 */
export async function installGitFresh(scope: InstallScope): Promise<void> {
  if (isBusy(useUpdates.getState().git.phase)) return;
  setGit({ phase: "downloading", percent: 0, error: null });
  try {
    const r = await api.installGit(scope);
    if (r.cancelled) {
      setGit({ phase: "error", error: t("updates.uacCancelled") });
      return;
    }
    const s = useStore.getState();
    s.setEnv(r.environment);
    setGit({
      phase: "idle",
      installed: r.environment.gitVersion,
      latest: r.environment.gitVersion,
      percent: null,
    });
    toast(t("updates.fresh.done", { version: r.environment.gitVersion }));
    const o = await refresh();
    if (o && !o.state.FirstRunCompleted && !r.environment.blockingError) s.setOnboardingOpen(true);
    else void checkUpdates();
  } catch (e) {
    setGit({ phase: "error", error: errorMessage(e) });
  }
}

/** Descarga e instala la versión nueva de la app y la reinicia. */
export async function installApp(auto = false): Promise<void> {
  const update = pendingApp;
  if (!update || isBusy(useUpdates.getState().app.phase)) return;
  setApp({ phase: "downloading", percent: 0, error: null });
  try {
    await update.install((pct) =>
      setApp({ phase: pct === 100 ? "installing" : "downloading", percent: pct === 100 ? null : pct }),
    );
    setApp({ phase: "installing", percent: null });
    if (auto) {
      toast(t("updates.restarting", { version: update.version }));
      await new Promise((r) => setTimeout(r, 1500));
    }
    await relaunchApp();
    // En Tauri no se llega aquí: la app se reinicia (o el instalador la cierra).
    setApp({ phase: "idle", installed: update.version, latest: update.version });
    pendingApp = null;
  } catch (e) {
    setApp({ phase: "error", error: errorMessage(e) });
  }
}

/** Acción del botón de una línea (sidebar o Ajustes) según su estado. */
export function runUpdate(component: "git" | "app"): void {
  const u = useUpdates.getState()[component];
  if (component === "app") {
    void installApp();
    return;
  }
  if (u.phase === "error" && !useUpdates.getState().git.info) {
    void checkUpdates();
    return;
  }
  confirmInstallGit();
}
