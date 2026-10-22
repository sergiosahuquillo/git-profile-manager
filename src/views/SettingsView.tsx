import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { AgentState } from "../api/bindings/AgentState";
import type { AppSettings } from "../api/bindings/AppSettings";
import type { BackupSet } from "../api/bindings/BackupSet";
import type { IntegrationPlan } from "../api/bindings/IntegrationPlan";
import type { Lang } from "../api/bindings/Lang";
import type { SourceTreeReport } from "../api/bindings/SourceTreeReport";
import type { SshClientInfo } from "../api/bindings/SshClientInfo";
import type { UpdateMode } from "../api/bindings/UpdateMode";
import { api } from "../api/commands";
import { Icon } from "../components/Icon";
import { UpdateModeChoices, UpdateRows } from "../components/Updates";
import { Banner, Btn, Check, Choice, Field, gap, InlineStatus, Pill, Switch } from "../components/ui";
import { currentLang, LANGS, setLanguage, t } from "../i18n";
import { GlobalBanners } from "../shell/Shell";
import { confirmSave, run, savedState, status } from "../state/actions";
import type { ChangeBlock } from "../state/store";
import { toast, useStore } from "../state/store";
import { checkUpdates, useUpdates } from "../state/updates";

export function planBlocks(plan: IntegrationPlan): ChangeBlock[] {
  return plan.changes.map((c) => ({
    type: "diff",
    file: c.displayPath,
    label: c.description,
    lines: c.hasChanges ? c.diff : [{ kind: "ctx", text: t("settings.noChanges") }],
  }));
}

/** Activar (o reaplicar) la integración con vista previa; la casilla de identidad global recalcula el plan. */
export async function enableIntegration(onDone?: () => void) {
  const s = useStore.getState();
  const o = s.overview;
  if (!o) return;
  if (!o.state.Profiles.length) {
    toast(t("settings.enable.needProfile"), "err");
    return;
  }
  const env = s.env;
  const hasGlobal = Boolean(env?.globalUserName || env?.globalUserEmail);
  const opts = { remove: o.state.Settings.NoProfileMode === "Strict" || hasGlobal };
  const plan = await run(() => api.integrationPlanEnable(opts.remove));
  if (!plan) return;

  const open = (p: IntegrationPlan) =>
    s.askChange({
      title: t("settings.enable.title"),
      note: t("settings.enable.note"),
      extra: hasGlobal ? <RemoveIdentity initial={opts.remove} onChange={reload} /> : undefined,
      blocks: planBlocks(p),
      applyLabel: t("settings.enable.apply"),
      onApply: async () => {
        const next = await api.integrationEnable(opts.remove);
        useStore.getState().setOverview(next);
        toast(t("settings.enable.done"));
        status(t("settings.enable.status"));
        onDone?.();
      },
    });
  async function reload(remove: boolean) {
    opts.remove = remove;
    const p = await run(() => api.integrationPlanEnable(remove));
    if (p) open(p);
  }
  open(plan);
}

function RemoveIdentity({ initial, onChange }: { initial: boolean; onChange: (v: boolean) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Check
      checked={v}
      onChange={(x) => {
        setV(x);
        onChange(x);
      }}
    >
      <Trans i18nKey="settings.enable.removeIdentity" components={{ code: <code /> }} />
    </Check>
  );
}

export async function disableIntegration() {
  const plan = await run(() => api.integrationPlanDisable());
  if (!plan) return;
  useStore.getState().askChange({
    title: t("settings.disable.title"),
    note: t("settings.disable.note"),
    warn: t("settings.disable.warn"),
    blocks: planBlocks(plan),
    danger: true,
    applyLabel: t("settings.disable.apply"),
    onApply: async () => {
      const o = await api.integrationDisable();
      useStore.getState().setOverview(o);
      toast(t("settings.disable.done"), "warn");
      status(t("settings.disable.done"));
    },
  });
}

const agentText = (a: AgentState) => t(`settings.agent.${a}`);

/** Cambia el idioma en caliente y vuelve a pedir al núcleo los textos que ya había enviado. */
async function changeLanguage(lang: Lang) {
  const overview = await run(() => setLanguage(lang));
  if (!overview) return;
  const s = useStore.getState();
  s.setStatus("");
  s.setOverview(overview);
  const env = await api.getEnvironment().catch(() => null);
  if (env) s.setEnv(env);
  toast(t("settings.appearance.languageChanged"));
}

function Kv({ label, value, pill }: { label: string; value: React.ReactNode; pill?: React.ReactNode }) {
  return (
    <div className="kv od-row">
      <span className="od-fill od-stack" style={gap(2)}>
        <span className="kv-label">{label}</span>
        <code className="kv-value od-truncate">{value}</code>
      </span>
      {pill}
    </div>
  );
}

export function SettingsView() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const overview = useStore((s) => s.overview);
  const env = useStore((s) => s.env);
  const setEnv = useStore((s) => s.setEnv);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setOnboardingOpen = useStore((s) => s.setOnboardingOpen);
  const askChange = useStore((s) => s.askChange);
  const [backups, setBackups] = useState<BackupSet[]>([]);
  const [sourcetree, setSourcetree] = useState<SourceTreeReport | null>(null);
  const [pending, setPending] = useState<Partial<AppSettings>>({});
  const [clients, setClients] = useState<Record<string, SshClientInfo>>({});
  const gitUpdate = useUpdates((s) => s.git);

  const lastSaved = overview?.lastSaved;
  useEffect(() => {
    void lastSaved;
    void lang;
    api
      .listBackups()
      .then(setBackups)
      .catch(() => setBackups([]));
  }, [lastSaved, lang]);
  useEffect(() => {
    void lang;
    api
      .sourcetreeStatus()
      .then(setSourcetree)
      .catch(() => undefined);
  }, [lang]);
  useEffect(() => {
    for (const k of ["WindowsOpenSsh", "GitBundled"] as const)
      api
        .sshClientInfo(k)
        .then((c) => setClients((m) => ({ ...m, [k]: c })))
        .catch(() => undefined);
  }, []);

  if (!overview) return null;
  const st = overview.state;
  const settings = { ...st.Settings, ...pending };
  const integ = overview.integration;
  const enabled = st.IntegrationEnabled;
  const def = st.Profiles.find((p) => p.IsDefault);
  const client = clients[settings.SshClient] ?? overview.sshClient;

  const change = (patch: Partial<AppSettings>, done: string) => {
    setPending(patch);
    // Si se cancela la vista previa, el control vuelve a su valor guardado.
    return confirmSave(
      { ...savedState(), Settings: { ...savedState().Settings, ...patch } },
      {
        title: t("settings.regenerateTitle"),
        done,
        onDone: () => setPending({}),
        onCancel: () => setPending({}),
      },
    );
  };

  const recheck = async () => {
    const e = await run(() => api.getEnvironment());
    if (e) {
      setEnv(e);
      toast(t("settings.envChecked"));
      void checkUpdates();
    }
  };

  const changeUpdateMode = async (mode: UpdateMode) => {
    const o = await run(() => api.setUpdateMode(mode));
    if (!o) return;
    useStore.getState().setOverview(o);
    toast(t("updates.modeChanged"));
    // Pasar a Automáticas aplica ya lo pendiente; las demás no lanzan nada.
    if (mode === "Auto") void checkUpdates();
  };

  const checkAgent = async () => {
    const a = await run(() => api.sshAgentState());
    if (!a) return;
    if (env) setEnv({ ...env, agentState: a });
    toast(
      a === "Running"
        ? t("settings.agent.running")
        : t("settings.agent.state", { state: agentText(a).toLowerCase() }),
      a === "Running" ? "ok" : "warn",
    );
  };

  const restore = async (b: BackupSet) => {
    const changes = await run(() => api.backupRestorePlan(b.Id));
    if (!changes) return;
    askChange({
      title: t("settings.restore.title"),
      note: t("settings.restore.note", { name: b.Display }),
      blocks: changes.map((c) => ({ type: "diff", file: c.displayPath, lines: c.diff })),
      applyLabel: t("settings.restore.apply"),
      onApply: async () => {
        const o = await api.restoreBackup(b.Id);
        useStore.getState().setOverview(o);
        toast(t("settings.restore.done"));
        setBackups(await api.listBackups());
      },
    });
  };

  const uninstall = async () => {
    const plan = await run(() => api.uninstallPlan());
    if (!plan) return;
    if (!plan.integration && !plan.files.length) {
      toast(t("settings.uninstall.nothing"), "warn");
      return;
    }
    askChange({
      title: t("settings.uninstall.title"),
      note: t("settings.uninstall.note"),
      warn: t("settings.uninstall.warn"),
      blocks: [
        ...(plan.integration ? planBlocks(plan.integration) : []),
        ...(plan.files.length
          ? [{ type: "cmd" as const, label: t("settings.uninstall.files"), lines: plan.files }]
          : []),
      ],
      danger: true,
      applyLabel: t("settings.uninstall.apply"),
      onApply: async () => {
        const o = await api.uninstall();
        useStore.getState().setOverview(o);
        toast(t("settings.uninstall.done"), "warn");
      },
    });
  };

  const backupFiles = (b: BackupSet) => b.Entries.map((e) => e.OriginalPath.split(/[\\/]/).pop()).join(", ");
  const code = { code: <code />, strong: <strong /> };

  return (
    <section className="view" id="view-ajustes" aria-labelledby="h-ajustes">
      <div className="view-head">
        <div className="od-fill">
          <h1 id="h-ajustes">{t("settings.title")}</h1>
          <p className="view-sub">{t("settings.sub")}</p>
        </div>
      </div>

      <GlobalBanners />

      <div className="settings-grid">
        <section className="panel" aria-labelledby="s-env">
          <div className="panel-head od-row" id="s-env">
            <span className="od-fill">{t("settings.env.title")}</span>
            <Btn
              size="sm"
              icon="sync"
              className="od-fixed"
              onClick={recheck}
              busyLabel={t("common.checking")}
            >
              <span>{t("settings.env.recheck")}</span>
            </Btn>
          </div>
          <div className="panel-body od-stack" style={gap(12)}>
            {env ? (
              <>
                <Kv
                  label="Git"
                  value={env.gitPath ?? t("settings.env.notFound")}
                  pill={
                    env.gitVersion && (gitUpdate.phase === "available" || gitUpdate.phase === "ready") ? (
                      <Pill tone="accent" icon="arrow-up" className="od-fixed">
                        {env.gitVersion} → {gitUpdate.latest}
                      </Pill>
                    ) : env.gitVersion ? (
                      <Pill
                        tone={env.gitOk ? "ok" : "err"}
                        icon={env.gitOk ? "check" : "x"}
                        className="od-fixed"
                      >
                        {env.gitVersion}
                        {env.gitOk ? "" : t("settings.env.needsGit")}
                      </Pill>
                    ) : (
                      <Pill tone="err" icon="x" className="od-fixed">
                        {t("settings.env.notFound")}
                      </Pill>
                    )
                  }
                />
                <Kv
                  label={t("settings.env.gcm")}
                  value={`credential.helper = ${env.gcm.helpers.length ? env.gcm.helpers.join(", ") : t("settings.env.none")}`}
                  pill={
                    env.gcm.installed ? (
                      <Pill
                        tone={env.gcm.configuredAsHelper ? "ok" : "warn"}
                        icon={env.gcm.configuredAsHelper ? "check" : "alert"}
                        className="od-fixed"
                      >
                        {env.gcm.version}
                        {env.gcm.configuredAsHelper ? "" : t("settings.env.notHelper")}
                      </Pill>
                    ) : (
                      <Pill tone="err" icon="x" className="od-fixed">
                        {t("settings.env.notInstalled")}
                      </Pill>
                    )
                  }
                />
                <Kv
                  label={t("settings.env.winSsh")}
                  value="C:\Windows\System32\OpenSSH\ssh.exe"
                  pill={
                    <Pill
                      tone={env.windowsOpenSshAvailable ? "ok" : "neutral"}
                      icon={env.windowsOpenSshAvailable ? "check" : "info"}
                      className="od-fixed"
                    >
                      {env.windowsOpenSshAvailable
                        ? t("settings.env.available")
                        : t("settings.env.notInstalled")}
                    </Pill>
                  }
                />
                <Kv
                  label={t("settings.env.agent")}
                  value={agentText(env.agentState)}
                  pill={
                    <Pill
                      tone={env.agentState === "Running" ? "ok" : "warn"}
                      icon={env.agentState === "Running" ? "check" : "alert"}
                      className="od-fixed"
                    >
                      {env.agentState === "Running" ? t("settings.env.active") : t("settings.env.inactive")}
                    </Pill>
                  }
                />
                <Kv
                  label={t("settings.env.gitSsh")}
                  value={clients.GitBundled?.sshPath ?? "—"}
                  pill={
                    <Pill
                      tone={env.gitBundledSshAvailable ? "ok" : "neutral"}
                      icon={env.gitBundledSshAvailable ? "check" : "info"}
                      className="od-fixed"
                    >
                      {env.gitBundledSshAvailable ? t("settings.env.available") : t("settings.env.notFound")}
                    </Pill>
                  }
                />
                <Kv
                  label={t("settings.env.globalConfig")}
                  value={env.globalConfigPath}
                  pill={
                    <Pill tone={integ.gitInclude ? "neutral" : "warn"} className="od-fixed">
                      {integ.gitInclude ? t("settings.env.includesRules") : t("settings.env.noInclude")}
                    </Pill>
                  }
                />
                <Kv
                  label={t("settings.env.identity")}
                  value={
                    env.globalUserEmail
                      ? `${env.globalUserName ?? ""} <${env.globalUserEmail}>`
                      : t("settings.env.noIdentity")
                  }
                />
                <Kv label={t("settings.env.appData")} value={env.appDataDir} />
              </>
            ) : (
              <span className="skeleton" />
            )}
          </div>
        </section>

        <div className="od-stack" style={gap(16)}>
          <section className="panel" aria-labelledby="s-ssh">
            <div className="panel-head" id="s-ssh">
              {t("settings.ssh.title")}
            </div>
            <div className="panel-body od-stack" style={gap(12)}>
              <fieldset className="choice-set">
                <legend className="sr-only">{t("settings.ssh.legend")}</legend>
                <Choice
                  name="sshclient"
                  value="win"
                  checked={settings.SshClient === "WindowsOpenSsh"}
                  onChange={() => change({ SshClient: "WindowsOpenSsh" }, t("settings.ssh.changed"))}
                  title={t("settings.ssh.winTitle")}
                  tag={t("settings.ssh.recommended")}
                  help={<Trans i18nKey="settings.ssh.winHelp" components={code} />}
                />
                <Choice
                  name="sshclient"
                  value="git"
                  checked={settings.SshClient === "GitBundled"}
                  onChange={() => change({ SshClient: "GitBundled" }, t("settings.ssh.changed"))}
                  title={t("settings.ssh.gitTitle")}
                  disabled={env ? !env.gitBundledSshAvailable : false}
                  help={t("settings.ssh.gitHelp")}
                />
              </fieldset>
              <span className="field-help">
                <Trans
                  i18nKey="settings.ssh.uses"
                  values={{ ssh: client.sshPath, keygen: client.sshKeygenPath }}
                  components={code}
                />
              </span>
              <InlineStatus
                tone={
                  settings.SshClient === "WindowsOpenSsh"
                    ? env?.agentState === "Running"
                      ? "ok"
                      : "warn"
                    : "warn"
                }
                action={
                  <Btn size="sm" className="od-fixed" onClick={checkAgent} busyLabel={t("common.checking")}>
                    {t("common.check")}
                  </Btn>
                }
              >
                {settings.SshClient === "WindowsOpenSsh" ? (
                  env?.agentState === "Running" ? (
                    <Trans i18nKey="settings.agent.runningRich" components={code} />
                  ) : (
                    <Trans
                      i18nKey="settings.agent.stateRich"
                      values={{ state: env ? agentText(env.agentState).toLowerCase() : "…" }}
                      components={code}
                    />
                  )
                ) : (
                  t("settings.agent.gitBash")
                )}
              </InlineStatus>
              <Switch
                checked={settings.GenerateSshAliases}
                onChange={(v) =>
                  change(
                    { GenerateSshAliases: v },
                    v ? t("settings.ssh.aliasesOn") : t("settings.ssh.aliasesOff"),
                  )
                }
              >
                <Trans i18nKey="settings.ssh.aliases" components={code} />
              </Switch>
            </div>
          </section>

          <section className="panel" aria-labelledby="s-updates">
            <div className="panel-head" id="s-updates">
              {t("updates.title")}
            </div>
            <div className="panel-body od-stack" style={gap(12)}>
              <UpdateModeChoices
                name="updatemode"
                value={st.Settings.UpdateMode}
                onChange={changeUpdateMode}
                uac={env?.gitUpdatePromptsUac}
              />
              <UpdateRows onCheck={() => checkUpdates(true)} off={st.Settings.UpdateMode === "Off"} />
            </div>
          </section>
        </div>

        <section className="panel" aria-labelledby="s-mode">
          <div className="panel-head" id="s-mode">
            {t("settings.mode.title")}
          </div>
          <div className="panel-body od-stack" style={gap(12)}>
            <fieldset className="choice-set">
              <legend className="sr-only">{t("settings.mode.legend")}</legend>
              <Choice
                name="nomode"
                value="default"
                checked={settings.NoProfileMode === "DefaultProfile"}
                onChange={() => change({ NoProfileMode: "DefaultProfile" }, t("settings.mode.defaultDone"))}
                title={t("settings.mode.defaultTitle")}
                tag={st.Settings.NoProfileMode === "DefaultProfile" ? t("settings.mode.current") : undefined}
                help={
                  <Trans
                    i18nKey="settings.mode.defaultHelp"
                    values={{ name: def?.DisplayName ?? t("settings.mode.none") }}
                    components={code}
                  />
                }
              />
              <Choice
                name="nomode"
                value="strict"
                checked={settings.NoProfileMode === "Strict"}
                onChange={() => change({ NoProfileMode: "Strict" }, t("settings.mode.strictDone"))}
                title={t("settings.mode.strictTitle")}
                tag={st.Settings.NoProfileMode === "Strict" ? t("settings.mode.current") : undefined}
                help={<Trans i18nKey="settings.mode.strictHelp" components={code} />}
              />
            </fieldset>
            <span className="field-help">{t("settings.mode.strictNote")}</span>
          </div>
        </section>

        <section className="panel" aria-labelledby="s-theme">
          <div className="panel-head" id="s-theme">
            {t("settings.appearance.title")}
          </div>
          <div className="panel-body od-stack" style={gap(12)}>
            <Field
              id="sel-theme"
              label={t("settings.appearance.theme")}
              help={t("settings.appearance.themeHelp")}
            >
              <select
                id="sel-theme"
                className="input"
                value={theme}
                onChange={(e) => setTheme(e.target.value as "light" | "dark")}
              >
                <option value="light">{t("settings.appearance.light")}</option>
                <option value="dark">{t("settings.appearance.dark")}</option>
              </select>
            </Field>
            <Field
              id="sel-lang"
              label={t("settings.appearance.language")}
              help={t("settings.appearance.languageHelp")}
            >
              <select
                id="sel-lang"
                className="input"
                value={currentLang()}
                onChange={(e) => void changeLanguage(e.target.value as Lang)}
              >
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value} lang={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className="panel" aria-labelledby="s-backups">
          <div className="panel-head od-row" id="s-backups">
            <span className="od-fill">{t("settings.backups.title")}</span>
            <Btn
              size="sm"
              icon="folder"
              className="od-fixed"
              onClick={() => run(() => api.openInExplorer(overview.paths.backupsDir))}
            >
              <span>{t("settings.backups.openFolder")}</span>
            </Btn>
          </div>
          <div className="panel-body od-stack" style={gap(8)}>
            <p className="meta">
              <Trans i18nKey="settings.backups.intro" components={code} />
            </p>
            {backups.length === 0 ? (
              <p className="meta">{t("settings.backups.empty")}</p>
            ) : (
              <ul className="backup-list" id="backup-list" role="list">
                {backups.map((b) => (
                  <li className="backup-item" key={b.Id}>
                    <Icon name="file-code" />
                    <span>
                      <span className="backup-name od-truncate">
                        {b.Id} · {backupFiles(b)}
                      </span>
                      <span className="backup-when od-truncate">{b.Display}</span>
                    </span>
                    <Btn size="sm" onClick={() => restore(b)}>
                      {t("settings.backups.restore")}
                    </Btn>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="s-first">
          <div className="panel-head" id="s-first">
            {t("settings.firstRun.title")}
          </div>
          <div className="panel-body od-stack" style={gap(10)}>
            <p className="meta">{t("settings.firstRun.text")}</p>
            <div className="od-cluster">
              <Btn icon="sync" onClick={() => setOnboardingOpen(true)}>
                <span>{t("settings.firstRun.run")}</span>
              </Btn>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="s-st">
          <div className="panel-head" id="s-st">
            SourceTree
          </div>
          <div className="panel-body od-stack" style={gap(10)}>
            <p className="meta">{t("settings.sourcetree.intro")}</p>
            {!sourcetree ? (
              <span className="skeleton" />
            ) : !sourcetree.found ? (
              <InlineStatus tone="muted">{t("settings.sourcetree.notFound")}</InlineStatus>
            ) : (
              <>
                <span className="field-help">
                  <Trans
                    i18nKey="settings.sourcetree.readFrom"
                    values={{ path: sourcetree.configPath }}
                    components={code}
                  />
                </span>
                {sourcetree.findings
                  .filter((f) => f.warning)
                  .map((f) => (
                    <InlineStatus tone="warn" key={f.setting}>
                      {f.warning}
                    </InlineStatus>
                  ))}
                {!sourcetree.findings.some((f) => f.warning) && (
                  <InlineStatus tone={sourcetree.findings.length ? "ok" : "muted"}>
                    {sourcetree.findings.length
                      ? t("settings.sourcetree.ok")
                      : t("settings.sourcetree.unknown")}
                  </InlineStatus>
                )}
              </>
            )}
          </div>
        </section>

        <section className="panel panel-danger" aria-labelledby="s-int">
          <div className="panel-head" id="s-int">
            {t("settings.integration.title")}
          </div>
          <div className="panel-body od-stack" style={gap(12)}>
            <InlineStatus tone={enabled && integ.gitInclude ? "ok" : "warn"}>
              {enabled ? (
                <>
                  <Trans
                    i18nKey="settings.integration.activeGit"
                    values={{
                      state: integ.gitInclude
                        ? t("settings.integration.includes")
                        : t("settings.integration.notIncludes"),
                    }}
                    components={code}
                  />
                  {st.Settings.GenerateSshAliases && (
                    <Trans
                      i18nKey="settings.integration.activeSsh"
                      values={{
                        state: integ.sshInclude
                          ? t("settings.integration.includes")
                          : t("settings.integration.notIncludes"),
                      }}
                      components={code}
                    />
                  )}
                  .
                </>
              ) : (
                t("settings.integration.inactive")
              )}
            </InlineStatus>
            {st.SavedGlobalIdentity && (
              <span className="field-help">
                {t("settings.integration.savedIdentity")}{" "}
                <code>
                  {st.SavedGlobalIdentity.Name} &lt;{st.SavedGlobalIdentity.Email}&gt;
                </code>
              </span>
            )}
            <p className="meta">{t("settings.integration.disableNote")}</p>
            <div className="od-cluster">
              <Btn
                variant="primary"
                icon="check"
                onClick={() => enableIntegration()}
                disabled={Boolean(env?.blockingError)}
              >
                <span>{enabled ? t("settings.integration.reapply") : t("settings.integration.enable")}</span>
              </Btn>
              <Btn
                variant="danger"
                icon="x"
                onClick={disableIntegration}
                disabled={!enabled && !integ.gitInclude && !integ.sshInclude}
              >
                <span>{t("settings.integration.disable")}</span>
              </Btn>
            </div>
          </div>
        </section>

        <section className="panel panel-danger" aria-labelledby="s-rm">
          <div className="panel-head" id="s-rm">
            {t("settings.remove.title")}
          </div>
          <div className="panel-body od-stack" style={gap(12)}>
            <p className="meta">
              <Trans i18nKey="settings.remove.text" components={code} />
            </p>
            <div className="od-cluster">
              <Btn variant="danger" icon="trash" onClick={uninstall}>
                <span>{t("settings.remove.button")}</span>
              </Btn>
            </div>
          </div>
        </section>
      </div>
      {env?.blockingError && (
        <Banner tone="danger" title={t("settings.integration.blocked")} text={env.blockingError} />
      )}
    </section>
  );
}
