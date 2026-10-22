// Primer arranque: entorno, identidad global y activación. Nada se escribe hasta el último paso.
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { AppState } from "../api/bindings/AppState";
import type { GitProvider } from "../api/bindings/GitProvider";
import type { IntegrationPlan } from "../api/bindings/IntegrationPlan";
import type { UpdateMode } from "../api/bindings/UpdateMode";
import { api, errorMessage } from "../api/commands";
import { DiffBlocks } from "../components/DiffBlocks";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { InstallGitAction, UpdateModeChoices } from "../components/Updates";
import { Banner, Btn, Choice, Field, gap, Pill } from "../components/ui";
import { DEFAULT_HOST, EMAIL_RE, emptyProfile, PROVIDERS, slugify } from "../lib/profiles";
import { toast, useStore } from "../state/store";
import { checkUpdates } from "../state/updates";
import { planBlocks } from "../views/SettingsView";

export function OnboardingDialog() {
  const open = useStore((s) => s.onboardingOpen);
  if (!open) return null;
  return <Wizard />;
}

function Wizard() {
  const env = useStore((s) => s.env);
  const overview = useStore((s) => s.overview);
  const setOpen = useStore((s) => s.setOnboardingOpen);
  const setOverview = useStore((s) => s.setOverview);
  const [step, setStep] = useState(1);
  const { t } = useTranslation();
  const rich = { code: <code />, strong: <strong /> };
  const hasProfiles = (overview?.state.Profiles.length ?? 0) > 0;
  const globalName = env?.globalUserName ?? "";
  const globalEmail = env?.globalUserEmail ?? "";
  const hasGlobal = Boolean(globalName || globalEmail);
  const [mode, setMode] = useState<"convert" | "keep">("convert");
  const [name, setName] = useState(() => t("onboarding.defaultName"));
  const [user, setUser] = useState(globalName);
  const [email, setEmail] = useState(globalEmail);
  const [provider, setProvider] = useState<GitProvider>("GitHub");
  const [errors, setErrors] = useState<string[]>([]);
  const [plan, setPlan] = useState<IntegrationPlan | null>(null);
  const [updateMode, setUpdateMode] = useState<UpdateMode>(overview?.state.Settings.UpdateMode ?? "Auto");
  const blocked = Boolean(env?.blockingError);
  // Sin OpenSSH de Windows pero con el SSH de Git, se usa este último.
  const useGitSsh = Boolean(env && !env.windowsOpenSshAvailable && env.gitBundledSshAvailable);
  const creates = !hasProfiles && mode === "convert";

  const draftState = (): AppState | null => {
    if (!overview) return null;
    const settings = useGitSsh
      ? { ...overview.state.Settings, SshClient: "GitBundled" as const }
      : overview.state.Settings;
    if (!creates) return { ...overview.state, Settings: settings };
    const p = {
      ...emptyProfile(),
      DisplayName: name.trim(),
      Slug: slugify(name),
      Provider: provider,
      Host: DEFAULT_HOST[provider] || "example.com",
      GitUserName: user.trim(),
      GitUserEmail: email.trim(),
      IsDefault: true,
    };
    return { ...overview.state, Settings: settings, Profiles: [p] };
  };

  // El modo de actualización se guarda salga como salga el asistente, y entonces se hace la primera
  // comprobación (en el arranque se espera a que el usuario elija).
  const saveUpdateMode = async () => {
    try {
      setOverview(await api.setUpdateMode(updateMode));
    } catch {
      /* se queda el valor por defecto */
    }
    void checkUpdates();
  };

  const later = async () => {
    setOpen(false);
    try {
      setOverview(await api.setFirstRunCompleted(true));
    } catch {
      /* se volverá a ofrecer en el siguiente arranque */
    }
    await saveUpdateMode();
  };

  useEffect(() => {
    if (step !== 4 || (!hasProfiles && mode === "keep")) return;
    setPlan(null);
    api
      .integrationPlanEnable(hasGlobal && mode === "convert")
      .then(setPlan)
      .catch((e) => toast(errorMessage(e), "err"));
  }, [step, mode, hasGlobal, hasProfiles]);

  const next = async () => {
    if (step === 1) return setStep(2);
    if (step === 2) return setStep(3);
    if (step === 3) {
      if (creates) {
        const errs: string[] = [];
        if (!name.trim()) errs.push(t("onboarding.errName"));
        if (!user.trim()) errs.push(t("onboarding.errUser"));
        if (!EMAIL_RE.test(email.trim())) errs.push(t("onboarding.errEmail"));
        setErrors(errs);
        if (errs.length) return;
        const draft = draftState();
        if (draft) {
          const plan = await api.planSave(draft);
          if (!plan.canSave) {
            setErrors(plan.errors);
            return;
          }
        }
      }
      return setStep(4);
    }
    // Paso 4: aquí sí se escribe, con copia de seguridad previa.
    if (!hasProfiles && mode === "keep") {
      await later();
      toast(t("onboarding.keptGlobal"), "warn");
      return;
    }
    try {
      const draft = draftState();
      if (draft && (creates || useGitSsh)) setOverview(await api.save(draft, true));
      setOverview(await api.integrationEnable(hasGlobal && mode === "convert"));
      setOverview(await api.setFirstRunCompleted(true));
      setOpen(false);
      void saveUpdateMode();
      toast(t("onboarding.enabled"));
      useStore.getState().setStatus(t("settings.enable.status"));
    } catch (e) {
      toast(errorMessage(e), "err");
    }
  };

  const notes = [
    t("onboarding.notes.env"),
    t("onboarding.notes.updates"),
    t("onboarding.notes.identity"),
    t("onboarding.notes.activate"),
  ];

  return (
    <Modal
      icon="branch"
      title={t("onboarding.title")}
      size="md"
      onClose={later}
      labelId="ob-title"
      steps={
        <ol className="steps" id="ob-steps">
          {[
            t("onboarding.steps.env"),
            t("onboarding.steps.updates"),
            t("onboarding.steps.identity"),
            t("onboarding.steps.activate"),
          ].map((s, i) => (
            <li
              key={s}
              className={`step${step === i + 1 ? " is-current" : ""}${step > i + 1 ? " is-done" : ""}`}
              data-step={i + 1}
            >
              <span className="step-n">{i + 1}</span>
              <span className="step-t">{s}</span>
            </li>
          ))}
        </ol>
      }
      foot={
        <>
          <div className="od-fill meta" id="ob-note">
            {notes[step - 1]}
          </div>
          <button
            type="button"
            className="btn btn-default"
            id="ob-back"
            disabled={step === 1}
            onClick={() => setStep(step - 1)}
          >
            {t("onboarding.back")}
          </button>
          <Btn
            variant="primary"
            id="ob-next"
            onClick={next}
            disabled={blocked || (step === 4 && !plan && !(mode === "keep" && !hasProfiles))}
            busyLabel={step === 4 ? t("onboarding.activating") : undefined}
          >
            {step === 4 ? (
              mode === "keep" && !hasProfiles ? (
                <span>{t("onboarding.finish")}</span>
              ) : (
                <>
                  <Icon name="check" />
                  <span>{t("onboarding.activate")}</span>
                </>
              )
            ) : (
              <span>{t("onboarding.next")}</span>
            )}
          </Btn>
        </>
      }
    >
      <div className="modal-body" id="ob-body">
        {step === 1 && env && (
          <div className="od-stack" style={gap(12)}>
            <p>{t("onboarding.envIntro")}</p>
            <ul className="check-list" role="list">
              <li className={`check-item${env.gitOk ? "" : " is-blocked"}`}>
                <Icon name={env.gitOk ? "check" : "x"} />
                <span>
                  <span className="check-name">Git for Windows</span>
                  <span className="check-detail">
                    {env.gitPath ?? t("onboarding.notFound")}
                    {env.gitVersion ? ` · ${env.gitVersion}` : ""}
                  </span>
                </span>
                <Pill tone={env.gitOk ? "ok" : "err"}>
                  {env.gitOk ? t("onboarding.compatible") : t("onboarding.blocked")}
                </Pill>
              </li>
              <li className="check-item">
                <Icon name={env.gcm.installed ? "check" : "alert"} />
                <span>
                  <span className="check-name">Git Credential Manager</span>
                  <span className="check-detail">
                    {env.gcm.installed
                      ? `credential.helper = ${env.gcm.helpers.join(", ") || t("settings.env.none")} · ${env.gcm.version}`
                      : t("onboarding.gcmMissing")}
                  </span>
                </span>
                <Pill tone={env.gcm.installed && env.gcm.configuredAsHelper ? "ok" : "warn"}>
                  {env.gcm.installed
                    ? env.gcm.configuredAsHelper
                      ? t("onboarding.ready")
                      : t("onboarding.notHelper")
                    : t("onboarding.absent")}
                </Pill>
              </li>
              <li className="check-item">
                <Icon name={env.windowsOpenSshAvailable ? "check" : "alert"} />
                <span>
                  <span className="check-name">
                    {env.windowsOpenSshAvailable ? t("onboarding.winSsh") : t("onboarding.gitSsh")}
                  </span>
                  <span className="check-detail">
                    {env.windowsOpenSshAvailable
                      ? t("onboarding.agent", {
                          state:
                            env.agentState === "Running" ? t("onboarding.running") : t("onboarding.stopped"),
                        })
                      : useGitSsh
                        ? t("onboarding.useGitSsh")
                        : t("onboarding.noSsh")}
                  </span>
                </span>
                <Pill tone={env.windowsOpenSshAvailable && env.agentState === "Running" ? "ok" : "warn"}>
                  {env.windowsOpenSshAvailable && env.agentState === "Running"
                    ? t("onboarding.ready")
                    : t("onboarding.review")}
                </Pill>
              </li>
            </ul>
            {blocked ? (
              <Banner
                tone="danger"
                title={t("onboarding.requirements")}
                style={{ margin: 0 }}
                text={t("onboarding.blockedText", { error: env.blockingError })}
                actions={env.gitPath ? undefined : <InstallGitAction />}
              />
            ) : (
              <Banner
                tone="info"
                title={t("onboarding.needGit")}
                style={{ margin: 0 }}
                text={<Trans i18nKey="onboarding.needGitText" components={rich} />}
              />
            )}
          </div>
        )}

        {step === 2 && (
          <div className="od-stack" style={gap(12)}>
            <p>{t("updates.onboarding.intro")}</p>
            <UpdateModeChoices
              name="ob-updates"
              value={updateMode}
              onChange={setUpdateMode}
              uac={env?.gitUpdatePromptsUac}
            />
            <div className="od-stack" style={gap(4)}>
              <span className="kv-label">{t("updates.onboarding.what")}</span>
              <ul className="check-list" role="list">
                <li className="check-item">
                  <Icon name="sync" />
                  <span>
                    <span className="check-name">{t("updates.git")}</span>
                    <span className="check-detail">{t("updates.gitIncludes")}</span>
                  </span>
                </li>
                <li className="check-item">
                  <Icon name="sync" />
                  <span>
                    <span className="check-name">{t("updates.app")}</span>
                  </span>
                </li>
              </ul>
            </div>
            <span className="field-help">{t("updates.onboarding.later")}</span>
          </div>
        )}

        {step === 3 && (
          <div className="od-stack" style={gap(12)}>
            {hasProfiles ? (
              <p>
                {t("onboarding.hasProfiles", { count: overview?.state.Profiles.length ?? 0 })}
                {hasGlobal && t("onboarding.decideGlobal")}
              </p>
            ) : hasGlobal ? (
              <p>
                <Trans i18nKey="onboarding.foundGlobal" components={rich} />
              </p>
            ) : (
              <p>{t("onboarding.noGlobal")}</p>
            )}
            {hasGlobal && (
              <pre className="code">{`[user]\n    name = ${globalName}\n    email = ${globalEmail}`}</pre>
            )}
            {(hasGlobal || !hasProfiles) && (
              <fieldset className="choice-set">
                <legend className="sr-only">{t("onboarding.legend")}</legend>
                <Choice
                  name="ob-global"
                  value="convert"
                  checked={mode === "convert"}
                  onChange={() => setMode("convert")}
                  title={
                    hasProfiles
                      ? t("onboarding.removeOnActivate")
                      : hasGlobal
                        ? t("onboarding.convert")
                        : t("onboarding.createDefault")
                  }
                  tag={t("onboarding.recommended")}
                  help={
                    <Trans
                      i18nKey={
                        hasProfiles
                          ? "onboarding.helpRemove"
                          : hasGlobal
                            ? "onboarding.helpCreateRemove"
                            : "onboarding.helpCreate"
                      }
                      values={{ name: name || t("onboarding.defaultName") }}
                      components={rich}
                    />
                  }
                />
                <Choice
                  name="ob-global"
                  value="keep"
                  checked={mode === "keep"}
                  onChange={() => setMode("keep")}
                  title={hasGlobal ? t("onboarding.keep") : t("onboarding.skip")}
                  help={hasGlobal ? t("onboarding.keepHelp") : t("onboarding.skipHelp")}
                />
              </fieldset>
            )}
            {creates && (
              <div className="kv-grid">
                <Field id="ob-name" label={t("profiles.identity.name")} req>
                  <input
                    id="ob-name"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field id="ob-user" label="user.name" req>
                  <input
                    id="ob-user"
                    className="input"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                  />
                </Field>
                <Field id="ob-email" label="user.email" req>
                  <input
                    id="ob-email"
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field id="ob-provider" label={t("profiles.identity.provider")}>
                  <select
                    id="ob-provider"
                    className="input"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as GitProvider)}
                  >
                    {PROVIDERS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            {errors.length > 0 && (
              <Banner tone="danger" title={t("onboarding.reviewProfile")} style={{ margin: 0 }} role="alert">
                <ul className="err-list" role="list">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Banner>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="od-stack" style={gap(12)}>
            {!hasProfiles && mode === "keep" ? (
              <p>{t("onboarding.nothingToActivate")}</p>
            ) : (
              <>
                <p>
                  {creates ? (
                    <Trans
                      i18nKey="onboarding.changesCreate"
                      values={{ file: `~/.gitprofiles/${slugify(name)}.gitconfig` }}
                      components={rich}
                    />
                  ) : (
                    t("onboarding.changes")
                  )}
                </p>
                {plan ? <DiffBlocks blocks={planBlocks(plan)} /> : <span className="skeleton" />}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
