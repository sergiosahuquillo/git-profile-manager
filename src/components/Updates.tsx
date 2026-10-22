// Piezas de las actualizaciones: el indicador de cada línea del sidebar, el selector de modo (Ajustes y
// primer arranque), las filas por componente del panel de Ajustes y la instalación de Git donde no lo hay.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitInstallOptions } from "../api/bindings/GitInstallOptions";
import type { InstallScope } from "../api/bindings/InstallScope";
import type { UpdateMode } from "../api/bindings/UpdateMode";
import { api } from "../api/commands";
import { dateLocale, t as tr } from "../i18n";
import { run } from "../state/actions";
import { useStore } from "../state/store";
import { type ComponentUpdate, installGitFresh, isBusy, runUpdate, useUpdates } from "../state/updates";
import { Icon } from "./Icon";
import { Btn, Choice, gap, InlineStatus } from "./ui";

type Component = "git" | "app";

/** Texto del progreso en curso, o null si no hay nada en marcha. */
function busyText(u: ComponentUpdate): string | null {
  switch (u.phase) {
    case "checking":
      return tr("updates.checking");
    case "downloading":
      return u.percent == null
        ? tr("updates.downloadingNoPct")
        : tr("updates.downloading", { percent: u.percent });
    case "verifying":
      return tr("updates.verifying");
    case "installing":
      return tr("updates.installing");
    default:
      return null;
  }
}

/**
 * Lo que va a la derecha de una línea del sidebar: botón de actualizar, progreso o reintento.
 * `missing`: Git no está instalado; el botón lo instala.
 */
export function UpdateTrail({ component, missing }: { component: Component; missing?: boolean }) {
  const u = useUpdates((s) => s[component]);
  const { t } = useTranslation();
  const name = t(`updates.${component}`);
  const busy = busyText(u);
  if (busy) {
    // Comprobando: solo el icono girando, sin texto, para no llenar el sidebar en cada arranque.
    return (
      <span className="env-update is-busy" role="status" title={busy} aria-label={`${name}: ${busy}`}>
        <Icon name="sync" />
        {u.phase === "downloading" && u.percent != null && <span>{u.percent} %</span>}
        {u.phase === "installing" && <span>{t("updates.installing")}</span>}
      </span>
    );
  }
  if (missing)
    return (
      <button
        type="button"
        className={`env-update ${u.phase === "error" ? "is-error" : "is-ready"}`}
        title={u.phase === "error" ? t("updates.retryTitle", { error: u.error }) : t("updates.fresh.button")}
        aria-label={
          u.phase === "error" ? t("updates.retryTitle", { error: u.error }) : t("updates.fresh.button")
        }
        onClick={() => void confirmInstallGitFresh()}
      >
        <Icon name={u.phase === "error" ? "alert" : "arrow-down"} />
        <span>{u.phase === "error" ? t("updates.retry") : t("updates.install")}</span>
      </button>
    );
  if (u.phase === "available")
    return (
      <button
        type="button"
        className="env-update"
        title={t("updates.updateTo", { name, version: u.latest })}
        aria-label={t("updates.updateTo", { name, version: u.latest })}
        onClick={() => runUpdate(component)}
      >
        <Icon name="arrow-up" />
        <span>{u.latest}</span>
      </button>
    );
  if (u.phase === "ready")
    return (
      <button
        type="button"
        className="env-update is-ready"
        title={t("updates.installTo", { name, version: u.latest })}
        aria-label={t("updates.installTo", { name, version: u.latest })}
        onClick={() => runUpdate(component)}
      >
        <Icon name="arrow-down" />
        <span>{t("updates.install")}</span>
      </button>
    );
  if (u.phase === "error")
    return (
      <button
        type="button"
        className="env-update is-error"
        title={t("updates.retryTitle", { error: u.error })}
        aria-label={t("updates.retryTitle", { error: u.error })}
        onClick={() => runUpdate(component)}
      >
        <Icon name="alert" />
        <span>{t("updates.retry")}</span>
      </button>
    );
  return null;
}

/** Las tres opciones de modo. `uac`: la instalación de Git va a pedir permiso (se avisa en Automáticas). */
export function UpdateModeChoices({
  name,
  value,
  onChange,
  uac,
}: {
  name: string;
  value: UpdateMode;
  onChange: (m: UpdateMode) => void;
  uac?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="choice-set">
      <legend className="sr-only">{t("updates.legend")}</legend>
      <Choice
        name={name}
        value="Auto"
        checked={value === "Auto"}
        onChange={() => onChange("Auto")}
        title={t("updates.auto.title")}
        tag={t("updates.recommended")}
        help={uac ? `${t("updates.auto.help")} ${t("updates.uacNote")}` : t("updates.auto.help")}
      />
      <Choice
        name={name}
        value="Manual"
        checked={value === "Manual"}
        onChange={() => onChange("Manual")}
        title={t("updates.manual.title")}
        help={t("updates.manual.help")}
      />
      <Choice
        name={name}
        value="Off"
        checked={value === "Off"}
        onChange={() => onChange("Off")}
        title={t("updates.off.title")}
        help={t("updates.off.help")}
      />
    </fieldset>
  );
}

/** Fila de un componente en Ajustes: versión instalada, la nueva y su acción o progreso. */
function UpdateRow({ component, detail }: { component: Component; detail?: string }) {
  const u = useUpdates((s) => s[component]);
  const { t } = useTranslation();
  const name = t(`updates.${component}`);
  const busy = busyText(u);
  const state =
    busy ??
    (u.phase === "available"
      ? t("updates.newVersion", { version: u.latest })
      : u.phase === "ready"
        ? t("updates.ready")
        : u.phase === "error"
          ? u.error
          : u.latest && u.latest === u.installed
            ? t("updates.upToDate")
            : null);
  const action =
    u.phase === "available" ? (
      <Btn
        size="sm"
        variant="primary"
        icon="arrow-up"
        className="od-fixed"
        onClick={() => runUpdate(component)}
      >
        {t("updates.update")}
      </Btn>
    ) : u.phase === "ready" ? (
      <Btn
        size="sm"
        variant="primary"
        icon="arrow-down"
        className="od-fixed"
        onClick={() => runUpdate(component)}
      >
        {t("updates.install")}
      </Btn>
    ) : u.phase === "error" ? (
      <Btn size="sm" icon="sync" className="od-fixed" onClick={() => runUpdate(component)}>
        {t("updates.retry")}
      </Btn>
    ) : null;
  return (
    <div className="kv od-row">
      <span className="od-fill od-stack" style={gap(2)}>
        <span className="kv-label">{name}</span>
        <span className="update-versions">
          {u.installed ? t("updates.installed", { version: u.installed }) : "—"}
          {state && (
            <span className={`update-state${u.phase === "error" ? " is-error" : ""}`}>
              {busy && <Icon name="sync" className="icon icon-12 spin" />}
              {state}
            </span>
          )}
        </span>
        {detail && <span className="kv-row-help">{detail}</span>}
        {u.phase === "downloading" && u.percent != null && (
          <span className="progress" aria-hidden="true">
            <span className="progress-bar" style={{ width: `${u.percent}%` }} />
          </span>
        )}
      </span>
      {action}
    </div>
  );
}

/** Filas de Git y de la app, con la última comprobación y el botón de buscar. */
export function UpdateRows({ onCheck, off }: { onCheck: () => Promise<void>; off: boolean }) {
  const { t } = useTranslation();
  const checkedAt = useUpdates((s) => s.checkedAt);
  const checkError = useUpdates((s) => s.checkError);
  const busy = useUpdates((s) => isBusy(s.git.phase) || isBusy(s.app.phase));
  return (
    <>
      <UpdateRow component="git" detail={t("updates.gitIncludes")} />
      <UpdateRow component="app" />
      <InlineStatus
        tone={checkError ? "warn" : "muted"}
        icon={checkError ? "alert" : "info"}
        action={
          <Btn
            size="sm"
            icon="sync"
            className="od-fixed"
            onClick={onCheck}
            disabled={busy}
            busyLabel={t("updates.checking")}
          >
            {t("updates.checkNow")}
          </Btn>
        }
      >
        {checkError
          ? t("updates.checkFailed", { error: checkError })
          : checkedAt
            ? t("updates.lastCheck", {
                time: checkedAt.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" }),
              })
            : off
              ? t("updates.off.help")
              : t("updates.neverChecked")}
      </InlineStatus>
    </>
  );
}

// ─── Instalar Git donde no lo hay ─────────────────────────────────────────

function ScopeChoice({ opts, onChange }: { opts: GitInstallOptions; onChange: (s: InstallScope) => void }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<InstallScope>("Machine");
  const pick = (s: InstallScope) => {
    setScope(s);
    onChange(s);
  };
  return (
    <fieldset className="choice-set">
      <legend className="sr-only">{t("updates.fresh.legend")}</legend>
      <Choice
        name="git-scope"
        value="Machine"
        checked={scope === "Machine"}
        onChange={() => pick("Machine")}
        title={t("updates.fresh.machine")}
        tag={t("updates.recommended")}
        help={opts.machinePromptsUac ? t("updates.fresh.machineHelpUac") : t("updates.fresh.machineHelp")}
      />
      <Choice
        name="git-scope"
        value="User"
        checked={scope === "User"}
        onChange={() => pick("User")}
        title={t("updates.fresh.user")}
        help={t("updates.fresh.userHelp")}
      />
    </fieldset>
  );
}

/**
 * Pregunta para quién instalar Git y lo instala. Un administrador elige (por defecto, para todos); un
 * usuario estándar solo puede instalarlo para sí, y una app ya elevada solo para todos.
 */
export async function confirmInstallGitFresh(): Promise<void> {
  const opts = await run(() => api.gitInstallOptions());
  if (!opts) return;
  const choose = opts.canInstallMachine && opts.canInstallUser;
  const choice: { scope: InstallScope } = { scope: opts.canInstallMachine ? "Machine" : "User" };
  const note = choose
    ? tr("updates.fresh.noteChoose")
    : choice.scope === "Machine"
      ? opts.machinePromptsUac
        ? tr("updates.fresh.noteMachineUac")
        : tr("updates.fresh.noteMachine")
      : tr("updates.fresh.noteUser");
  useStore.getState().askChange({
    title: tr("updates.fresh.title", { version: opts.latest }),
    note: `${note} ${tr("updates.fresh.options")}`,
    extra: choose ? <ScopeChoice opts={opts} onChange={(s) => (choice.scope = s)} /> : undefined,
    blocks: [],
    applyLabel: tr("updates.fresh.apply"),
    onApply: async () => {
      useStore.getState().askChange(null);
      await installGitFresh(choice.scope);
    },
  });
}

/** Botón de los avisos de requisitos: instalar Git, o el progreso si ya se está instalando. */
export function InstallGitAction() {
  const u = useUpdates((s) => s.git);
  const { t } = useTranslation();
  const busy = busyText(u);
  if (busy)
    return (
      <span className="env-update is-busy" role="status">
        <Icon name="sync" />
        <span>{busy}</span>
      </span>
    );
  return (
    <Btn
      size="sm"
      variant="primary"
      icon="arrow-down"
      onClick={confirmInstallGitFresh}
      busyLabel={t("updates.checking")}
    >
      {u.phase === "error" ? t("updates.retry") : t("updates.fresh.button")}
    </Btn>
  );
}
