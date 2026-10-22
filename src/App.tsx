import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api, errorMessage } from "./api/commands";
import { destroyWindow, onCloseRequested, onWindowFocus } from "./api/platform";
import { IconSprite } from "./components/Icon";
import { Toasts } from "./components/Toasts";
import { ChangeDialog } from "./dialogs/ChangeDialog";
import { OnboardingDialog } from "./dialogs/OnboardingDialog";
import { RuleDialog } from "./dialogs/RuleDialog";
import { SmartCloneDialog } from "./dialogs/SmartCloneDialog";
import { applySavedLanguage, systemLang, t } from "./i18n";
import { isDirty, mergeEdits, normalizeProfile } from "./lib/profiles";
import { Sidebar, StatusBar, TitleBar } from "./shell/Shell";
import { confirmSave, refresh } from "./state/actions";
import { startConnectionStatus } from "./state/connection";
import { toast, useStore } from "./state/store";
import { checkUpdates, startUpdates } from "./state/updates";
import { DiagnosticsView } from "./views/DiagnosticsView";
import { ProfilesView } from "./views/profiles/ProfilesView";
import { RulesView } from "./views/RulesView";
import { SettingsView } from "./views/SettingsView";

function unsavedProfiles() {
  const s = useStore.getState();
  const saved = s.overview?.state.Profiles ?? [];
  return saved.filter((p) => isDirty(p, s.drafts[p.Id]));
}

/** Al cerrar con cambios sin guardar: Guardar / Salir sin guardar / Cancelar */
function confirmClose() {
  const s = useStore.getState();
  const dirty = unsavedProfiles();
  const names = [
    ...dirty.map((p) => p.DisplayName),
    ...(s.newDraft ? [s.newDraft.DisplayName || t("common.close_app.newProfile")] : []),
  ];
  s.askChange({
    title: t("common.close_app.title"),
    note: t("common.close_app.note"),
    warn:
      t("common.close_app.warn", { names: names.join(", ") }) +
      (s.newDraft ? t("common.close_app.newLost") : ""),
    blocks: [],
    applyLabel: dirty.length ? t("common.close_app.saveAndExit") : t("common.close_app.exitWithoutSaving"),
    danger: !dirty.length,
    extra: dirty.length ? (
      <div className="od-cluster">
        <button type="button" className="btn btn-danger btn-sm" onClick={() => destroyWindow()}>
          {t("common.close_app.exitWithoutSaving")}
        </button>
      </div>
    ) : undefined,
    onApply: async () => {
      if (!dirty.length) return destroyWindow();
      const state = useStore.getState().overview!.state;
      const merged = {
        ...state,
        Profiles: state.Profiles.map((p) => {
          const d = useStore.getState().drafts[p.Id];
          return d ? mergeEdits(p, normalizeProfile(d)) : p;
        }),
      };
      useStore.getState().askChange(null);
      await confirmSave(merged, {
        title: t("common.close_app.saveTitle"),
        done: t("common.close_app.saved"),
        onDone: () => destroyWindow(),
      });
    },
  });
}

export function App() {
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);
  const ready = useStore((s) => s.overview !== null);
  useTranslation();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const s = useStore.getState();
    // El núcleo aplica el idioma guardado (o el del sistema) antes de generar sus mensajes de arranque.
    api
      .bootstrap(systemLang())
      .then(async (b) => {
        await applySavedLanguage(b.overview.state.Settings.Language);
        s.setOverview(b.overview);
        s.setEnv(b.environment);
        const problems = [
          ...(b.loadError ? [t("common.boot.loadError", { error: b.loadError })] : []),
          ...b.regenerateErrors.map((e) => t("common.boot.regenerateError", { error: e })),
        ];
        if (problems.length) {
          s.askChange({
            title: b.loadError ? t("common.boot.loadErrorTitle") : t("common.boot.reviewTitle"),
            note: t("common.boot.note"),
            readOnly: true,
            errors: problems,
            blocks: [],
          });
        } else if (b.firstLaunch && !b.overview.state.FirstRunCompleted && !b.environment.blockingError) {
          // El asistente pregunta el modo de actualización y comprueba al cerrarse.
          s.setOnboardingOpen(true);
          return;
        }
        void checkUpdates();
      })
      .catch((e) => toast(errorMessage(e), "err"));

    const cleanups: Promise<() => void>[] = [
      startConnectionStatus(),
      startUpdates(),
      onWindowFocus(() => void refresh()),
      onCloseRequested(() => {
        const st = useStore.getState();
        if (!unsavedProfiles().length && !st.newDraft) return true;
        confirmClose();
        return false;
      }),
    ];
    const onError = (e: ErrorEvent) =>
      void api.logError(`${e.message}\n${e.error?.stack ?? ""}`).catch(() => undefined);
    const onRejection = (e: PromiseRejectionEvent) =>
      void api.logError(errorMessage(e.reason)).catch(() => undefined);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      for (const c of cleanups) void c.then((f) => f());
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <>
      <IconSprite />
      <div className="app">
        <TitleBar />
        <div className="app-body">
          <Sidebar />
          <main className="content od-scroll" id="main" tabIndex={-1}>
            {!ready ? (
              <div className="view">
                <div className="od-stack" style={{ "--od-gap": "12px" } as React.CSSProperties}>
                  <span className="skeleton" style={{ height: 28, width: 220 }} />
                  <span className="skeleton" />
                  <span className="skeleton" />
                </div>
              </div>
            ) : view === "perfiles" ? (
              <ProfilesView />
            ) : view === "reglas" ? (
              <RulesView />
            ) : view === "diagnostico" ? (
              <DiagnosticsView />
            ) : (
              <SettingsView />
            )}
          </main>
        </div>
        <StatusBar />
      </div>
      <RuleDialog />
      <SmartCloneDialog />
      <OnboardingDialog />
      <ChangeDialog />
      <Toasts />
    </>
  );
}
