// Armazón de la ventana: barra de título propia, barra lateral, avisos globales y barra de estado.
import { Trans, useTranslation } from "react-i18next";
import { api, errorMessage } from "../api/commands";
import { windowAction } from "../api/platform";
import { Icon } from "../components/Icon";
import { Banner, Btn } from "../components/ui";
import { dateLocale, t as tr } from "../i18n";
import { isDirty } from "../lib/profiles";
import { NO_PROFILES, toast, useStore, type View } from "../state/store";

export function useUnsavedCount(): number {
  const drafts = useStore((s) => s.drafts);
  const newDraft = useStore((s) => s.newDraft);
  const profiles = useStore((s) => s.overview?.state.Profiles ?? NO_PROFILES);
  return profiles.filter((p) => isDirty(p, drafts[p.Id])).length + (newDraft ? 1 : 0);
}

export function TitleBar() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const overview = useStore((s) => s.overview);
  const unsaved = useUnsavedCount();
  const { t } = useTranslation();
  const n = overview?.state.Profiles.length ?? 0;
  const active = overview?.state.IntegrationEnabled && overview.integration.gitInclude;
  const dark = theme === "dark";
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-id" data-tauri-drag-region>
        <Icon name="branch" className="icon icon-20 titlebar-mark" />
        <span className="titlebar-name" data-tauri-drag-region>
          GitProfile Manager
        </span>
        <span className="titlebar-sub od-truncate" data-tauri-drag-region>
          {t("shell.profiles", { count: n })}
          {unsaved ? t("shell.unsaved", { count: unsaved }) : ""}
          {active ? t("shell.integrationOn") : t("shell.integrationOff")}
        </span>
      </div>
      <div className="titlebar-tools">
        <button
          type="button"
          className="win-btn"
          title={dark ? t("shell.lightTheme") : t("shell.darkTheme")}
          aria-pressed={dark}
          onClick={() => setTheme(dark ? "light" : "dark")}
        >
          <Icon name={dark ? "sun" : "moon"} />
          <span className="sr-only">{dark ? t("shell.toLight") : t("shell.toDark")}</span>
        </button>
        <div className="window-controls" role="group" aria-label={t("shell.windowControls")}>
          <button
            type="button"
            className="win-btn"
            title={t("shell.minimize")}
            onClick={() => windowAction("minimize")}
          >
            <Icon name="win-min" />
            <span className="sr-only">{t("shell.minimize")}</span>
          </button>
          <button
            type="button"
            className="win-btn"
            title={t("shell.maximize")}
            onClick={() => windowAction("toggleMaximize")}
          >
            <Icon name="win-max" />
            <span className="sr-only">{t("shell.maximize")}</span>
          </button>
          <button
            type="button"
            className="win-btn win-close"
            title={t("common.close")}
            onClick={() => windowAction("close")}
          >
            <Icon name="x" />
            <span className="sr-only">{t("common.close")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

const NAV: { view: View; icon: "person" | "rules" | "pulse" | "sliders" }[] = [
  { view: "perfiles", icon: "person" },
  { view: "reglas", icon: "rules" },
  { view: "diagnostico", icon: "pulse" },
  { view: "ajustes", icon: "sliders" },
];

export function Sidebar() {
  const view = useStore((s) => s.view);
  const goto = useStore((s) => s.goto);
  const overview = useStore((s) => s.overview);
  const env = useStore((s) => s.env);
  const setCloneOpen = useStore((s) => s.setCloneOpen);
  const { t } = useTranslation();
  const conflicts = new Set(overview?.conflicts.map((c) => `${c.ruleA}|${c.ruleB}`)).size;
  const agent = env?.agentState;
  const lines: { ok: boolean; text: string }[] = env
    ? [
        { ok: env.gitOk, text: env.gitVersion ? `Git ${env.gitVersion}` : t("shell.env.gitMissing") },
        {
          ok: env.gcm.installed,
          text: env.gcm.version ? `GCM ${env.gcm.version}` : t("shell.env.gcmMissing"),
        },
        {
          ok: agent === "Running",
          text:
            agent === "Running"
              ? t("shell.env.agentRunning")
              : agent === "Disabled"
                ? t("shell.env.agentDisabled")
                : agent === "NotInstalled"
                  ? t("shell.env.agentNotInstalled")
                  : t("shell.env.agentStopped"),
        },
      ]
    : [];
  return (
    <nav className="sidebar" aria-label={t("shell.mainNav")}>
      <button
        type="button"
        className="btn btn-primary btn-block"
        aria-label="Smart Clone"
        onClick={() => setCloneOpen(true)}
      >
        <Icon name="clone" />
        <span>Smart Clone</span>
      </button>
      <ul className="nav" role="list">
        {NAV.map((n) => (
          <li key={n.view}>
            <button
              type="button"
              className="nav-item"
              aria-current={view === n.view ? "page" : undefined}
              aria-label={t(`shell.nav.${n.view}`)}
              onClick={() => goto(n.view)}
            >
              <Icon name={n.icon} />
              <span className="nav-label">{t(`shell.nav.${n.view}`)}</span>
              {n.view === "perfiles" && (
                <span className="nav-count" aria-hidden="true">
                  {overview?.state.Profiles.length ?? 0}
                </span>
              )}
              {n.view === "reglas" && conflicts > 0 && (
                <span className="nav-badge nav-badge-warn">
                  {conflicts}
                  <span className="sr-only"> {t("shell.conflicts", { count: conflicts })}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar-foot">
        {lines.map((l) => (
          <div className="env-line" key={l.text}>
            <Icon name={l.ok ? "check" : "alert"} className={l.ok ? "icon" : "icon env-warn"} />
            <span className="od-truncate">{l.text}</span>
          </div>
        ))}
      </div>
    </nav>
  );
}

export function StatusBar() {
  const overview = useStore((s) => s.overview);
  const statusMsg = useStore((s) => s.statusMsg);
  const { t } = useTranslation();
  const active = overview?.state.IntegrationEnabled && overview.integration.gitInclude;
  const last = overview?.lastSaved ? new Date(overview.lastSaved) : null;
  const fallback = last
    ? t("shell.status.lastSaved", {
        date: last.toLocaleDateString(dateLocale()),
        time: last.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" }),
      })
    : t("shell.status.noneSaved");
  return (
    <footer className="statusbar">
      <span className="od-row od-fixed">
        <Icon
          name={active ? "check" : "alert"}
          className={active ? "icon icon-12" : "icon icon-12 env-warn"}
        />
        {active ? t("shell.status.active") : t("shell.status.inactive")}
      </span>
      <span className="sep" aria-hidden="true">
        ·
      </span>
      <span className="od-truncate" id="status-msg">
        {statusMsg || fallback}
      </span>
      <span className="od-fill" />
      <span className="od-nowrap od-fixed">~/.gitprofiles</span>
    </footer>
  );
}

/** Avisos de entorno, integración y deriva que se muestran encima de cada vista. */
export function GlobalBanners() {
  const overview = useStore((s) => s.overview);
  const env = useStore((s) => s.env);
  const dismissed = useStore((s) => s.dismissed);
  const dismiss = useStore((s) => s.dismiss);
  const goto = useStore((s) => s.goto);
  const askChange = useStore((s) => s.askChange);
  const { t } = useTranslation();
  if (!overview) return null;
  const { state, integration, drift } = overview;
  const missing = [
    !integration.gitInclude && "~/.gitconfig",
    state.Settings.GenerateSshAliases && !integration.sshInclude && "~/.ssh/config",
  ].filter(Boolean) as string[];
  const driftKey = `drift:${drift.map((d) => d.path).join("|")}`;

  const showDrift = async () => {
    try {
      const changes = await api.driftChanges();
      askChange({
        title: tr("shell.banners.regenerateFiles", {
          count: drift.length,
          file: drift[0].path.split(/[\\/]/).pop(),
        }),
        note: tr("shell.banners.regenerateNote"),
        warn: tr("shell.banners.regenerateWarn"),
        blocks: changes.map((c) => ({ type: "diff", file: c.displayPath, lines: c.diff })),
        applyLabel: tr("shell.banners.regenerateNow"),
        onApply: async () => {
          const o = await api.regenerateDrifted();
          useStore.getState().setOverview(o);
          toast(tr("shell.banners.regenerated"));
        },
      });
    } catch (e) {
      toast(errorMessage(e), "err");
    }
  };

  return (
    <>
      {env?.blockingError && (
        <Banner tone="danger" title={t("shell.banners.requirements")} text={env.blockingError} role="alert" />
      )}
      {!env?.blockingError && state.IntegrationEnabled && missing.length > 0 && !dismissed.integration && (
        <Banner
          tone="warn"
          title={t("shell.banners.missingInclude")}
          text={t("shell.banners.missingIncludeText", { files: missing.join(t("shell.banners.and")) })}
          actions={
            <>
              <Btn size="sm" onClick={() => goto("ajustes")}>
                {t("shell.banners.goSettings")}
              </Btn>
              <Btn size="sm" onClick={() => dismiss("integration")}>
                {t("shell.banners.dismiss")}
              </Btn>
            </>
          }
        />
      )}
      {!env?.blockingError &&
        !state.IntegrationEnabled &&
        state.FirstRunCompleted &&
        !dismissed.integration && (
          <Banner
            tone="warn"
            title={t("shell.banners.integrationOff")}
            text={t("shell.banners.integrationOffText")}
            actions={
              <>
                <Btn size="sm" onClick={() => goto("ajustes")}>
                  {t("shell.banners.goSettings")}
                </Btn>
                <Btn size="sm" onClick={() => dismiss("integration")}>
                  {t("shell.banners.dismiss")}
                </Btn>
              </>
            }
          />
        )}
      {drift.length > 0 && !dismissed[driftKey] && (
        <Banner
          tone="warn"
          title={
            drift.length === 1 ? (
              <Trans
                i18nKey="shell.banners.driftOne"
                values={{ file: drift[0].path.split(/[\\/]/).pop() }}
                components={{ code: <code /> }}
              />
            ) : (
              t("shell.banners.driftMany", { count: drift.length })
            )
          }
          text={
            drift.length === 1
              ? t("shell.banners.driftOneText")
              : t("shell.banners.driftManyText", {
                  files: drift.map((d) => d.path.split(/[\\/]/).pop()).join(", "),
                })
          }
          actions={
            <>
              <Btn size="sm" onClick={showDrift}>
                {t("shell.banners.showDiff")}
              </Btn>
              <Btn size="sm" onClick={() => dismiss(driftKey)}>
                {t("shell.banners.dismiss")}
              </Btn>
            </>
          }
        />
      )}
    </>
  );
}
