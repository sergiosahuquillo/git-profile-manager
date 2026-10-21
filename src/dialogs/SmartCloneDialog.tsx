import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { CloneInput } from "../api/bindings/CloneInput";
import type { CloneMethod } from "../api/bindings/CloneMethod";
import type { CloneOutcome } from "../api/bindings/CloneOutcome";
import type { ClonePreview } from "../api/bindings/ClonePreview";
import type { CloneProgress } from "../api/bindings/CloneProgress";
import type { CloneRemedy } from "../api/bindings/CloneRemedy";
import { api, errorMessage } from "../api/commands";
import { listen, pickFolder, readClipboard } from "../api/platform";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { Btn, Choice, Field, gap, Seg } from "../components/ui";
import { refresh, run } from "../state/actions";
import { NO_PROFILES, toast, useStore } from "../state/store";

const METHODS: { value: CloneMethod; label: string }[] = [
  { value: "Ssh", label: "SSH" },
  { value: "Https", label: "HTTPS" },
];

const STEPS = ["normalize", "coverage", "clone", "diagnose"] as const;

const looksLikeGitUrl = (s: string) =>
  /^(git@[^:\s]+:[^\s]+|ssh:\/\/[^\s]+|https?:\/\/[^\s/]+\/[^\s]+\/[^\s]+)$/.test(s.trim());

export function SmartCloneDialog() {
  const open = useStore((s) => s.cloneOpen);
  if (!open) return null;
  return <CloneForm />;
}

function CloneForm() {
  const setOpen = useStore((s) => s.setCloneOpen);
  const profiles = useStore((s) => s.overview?.state.Profiles ?? NO_PROFILES);
  const diagnose = useStore((s) => s.diagnose);
  const [url, setUrl] = useState("");
  const [profileId, setProfileId] = useState<string>(
    profiles.find((p) => p.IsDefault)?.Id ?? profiles[0]?.Id ?? "",
  );
  const [matched, setMatched] = useState<boolean | null>(null);
  const [method, setMethod] = useState<CloneMethod>("Ssh");
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [remedy, setRemedy] = useState<CloneRemedy>("FolderRule");
  const [preview, setPreview] = useState<ClonePreview | null>(null);
  const [phase, setPhase] = useState<"form" | "running" | "done" | "failed">("form");
  const [progress, setProgress] = useState<CloneProgress>({ step: 0, percent: 0, phase: "" });
  const [outcome, setOutcome] = useState<CloneOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sourcetree, setSourcetree] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const code = { code: <code /> };
  const close = () => {
    if (phase !== "running") setOpen(false);
  };

  const applyDefaults = async (u: string, pid: string | null) => {
    try {
      const d = await api.cloneDefaults(u, pid);
      if (d.profileId && (pid || d.matchedByRule)) setProfileId(d.profileId);
      setMatched(pid ? null : d.matchedByRule);
      setMethod(d.method);
      if (d.parent) setParent(d.parent);
      if (!pid && d.name) setName(d.name);
    } catch {
      /* sin valores sugeridos */
    }
  };

  useEffect(() => {
    if (!profiles.length) {
      toast(t("clone.needProfile"), "err");
      setOpen(false);
      return;
    }
    readClipboard().then((text) => {
      const v = text.trim();
      if (v && looksLikeGitUrl(v)) {
        setUrl(v);
        void applyDefaults(v, null);
      } else {
        void applyDefaults("", profileId);
      }
    });
    api
      .sourcetreeStatus()
      .then((s) => setSourcetree(s.exePath))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const input: CloneInput = { url, profileId, method, parent, name };
  const key = JSON.stringify(input);
  useEffect(() => {
    if (!profileId) return;
    let alive = true;
    const timer = setTimeout(() => {
      api
        .clonePreview(input)
        .then((p) => alive && setPreview(p))
        .catch(() => undefined);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const onUrl = (v: string) => {
    setUrl(v);
    void applyDefaults(v, null);
  };

  const onProfile = (id: string) => {
    setProfileId(id);
    void applyDefaults(url, id);
  };

  const browse = async () => {
    const f = await pickFolder(t("clone.pickParent"));
    if (f) setParent(f);
  };

  const parsed = preview?.parsed;
  const valid = Boolean(parsed) && parent.trim() !== "" && name.trim() !== "";
  const cov = preview?.coverage;
  const covered = cov?.status === "Covered";
  const profile = profiles.find((p) => p.Id === profileId);

  const doClone = async () => {
    setPhase("running");
    setProgress({ step: 0, percent: 0, phase: "" });
    const unlisten = await listen<CloneProgress>("clone-progress", setProgress);
    try {
      const r = await api.cloneRun(input, covered ? "None" : remedy);
      setOutcome(r);
      await refresh();
      if (r.result.success) {
        setPhase("done");
        toast(t("clone.done"));
      } else {
        setFailure(r.result.output.slice(-1500));
        setPhase("failed");
      }
    } catch (e) {
      setFailure(errorMessage(e));
      setPhase("failed");
    } finally {
      unlisten();
    }
  };

  const pct =
    phase === "running" ? Math.round(((progress.step + progress.percent / 100) / STEPS.length) * 100) : 0;
  const report = outcome?.result.report;
  const issues = report?.problems.filter((p) => p.severity !== "Info") ?? [];

  return (
    <Modal
      icon="clone"
      title="Smart Clone"
      onClose={close}
      labelId="clone-title"
      foot={
        <>
          <div className="od-fill meta">{t("clone.footNote")}</div>
          <button
            type="button"
            className="btn btn-default"
            data-close-overlay
            onClick={close}
            disabled={phase === "running"}
          >
            {phase === "done" || phase === "failed" ? t("common.close") : t("common.cancel")}
          </button>
          {phase === "done" && outcome ? (
            <Btn
              variant="primary"
              icon="pulse"
              onClick={() => {
                setOpen(false);
                diagnose(outcome.destination);
              }}
            >
              <span>{t("clone.viewDiagnostics")}</span>
            </Btn>
          ) : phase === "failed" ? (
            <Btn variant="primary" icon="clone" onClick={() => setPhase("form")}>
              <span>{t("clone.back")}</span>
            </Btn>
          ) : (
            <Btn variant="primary" icon="clone" disabled={!valid || phase === "running"} onClick={doClone}>
              <span>{t("clone.clone")}</span>
            </Btn>
          )}
        </>
      }
    >
      <div className="modal-body od-stack" style={gap(16)}>
        <Field
          id="clone-url"
          label={t("clone.url")}
          req
          err={url.trim() && preview && !parsed ? t("clone.urlErr") : null}
          help={<Trans i18nKey="clone.urlHelp" components={code} />}
        >
          <input
            ref={urlRef}
            id="clone-url"
            className={`input input-mono${url.trim() && preview && !parsed ? " is-invalid" : ""}`}
            type="text"
            value={url}
            placeholder="git@github.com:org/repo.git"
            autoComplete="off"
            aria-describedby="clone-url-help clone-url-err"
            disabled={phase === "running"}
            onChange={(e) => onUrl(e.target.value)}
          />
        </Field>

        <div className="parsed" id="clone-parsed">
          <div className="od-stat">
            <span className="parsed-k">Host</span>
            <code className="parsed-v od-truncate">{parsed?.host ?? "—"}</code>
          </div>
          <div className="od-stat">
            <span className="parsed-k">{t("clone.org")}</span>
            <code className="parsed-v od-truncate">{parsed ? preview?.org || "—" : "—"}</code>
          </div>
          <div className="od-stat">
            <span className="parsed-k">{t("clone.repo")}</span>
            <code className="parsed-v od-truncate">{parsed ? preview?.repo : "—"}</code>
          </div>
        </div>

        <div className="form-2">
          <Field
            id="clone-profile"
            label={t("rules.col.profile")}
            help={matched === null ? t("clone.manual") : matched ? t("clone.matched") : t("clone.notMatched")}
          >
            <select
              id="clone-profile"
              className="input"
              value={profileId}
              disabled={phase === "running"}
              onChange={(e) => onProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.Id} value={p.Id}>
                  {p.DisplayName}
                </option>
              ))}
            </select>
          </Field>
          <div className="od-field" style={gap(6)}>
            <span className="label-like" id="clone-method-label">
              {t("clone.method")}
            </span>
            <Seg
              name="clonemethod"
              value={method}
              options={METHODS}
              labelledBy="clone-method-label"
              onChange={setMethod}
            />
            <span className="field-help">{t("clone.methodHelp")}</span>
          </div>
        </div>

        <div className="form-2">
          <Field id="clone-dest" label={t("clone.dest")} help={t("clone.destHelp")}>
            <div className="od-row" style={gap(8)}>
              <input
                id="clone-dest"
                className="input input-mono od-fill"
                type="text"
                value={parent}
                placeholder={t("clone.destPlaceholder")}
                disabled={phase === "running"}
                onChange={(e) => setParent(e.target.value)}
              />
              <Btn className="od-fixed" onClick={browse} disabled={phase === "running"}>
                {t("rules.dialog.browse")}
              </Btn>
            </div>
          </Field>
          <Field
            id="clone-name"
            label={t("clone.name")}
            help={
              <Trans
                i18nKey="clone.nameHelp"
                values={{ dest: preview?.destination || "—" }}
                components={code}
              />
            }
          >
            <input
              id="clone-name"
              className="input input-mono"
              type="text"
              value={name}
              disabled={phase === "running"}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>

        <div className="od-field" style={gap(6)}>
          <span className="label-like">{t("clone.command")}</span>
          <pre className="code code-wrap" id="clone-cmd">
            {preview?.command || t("clone.invalidUrl")}
          </pre>
        </div>

        {phase === "form" &&
          cov &&
          (covered ? (
            <div className="banner banner-ok" id="clone-coverage">
              <Icon name="check" className="icon od-fixed" />
              <div className="od-fill od-stack" style={gap(2)}>
                <strong>{t("clone.covered")}</strong>
                <span className="banner-text">
                  {cov.byDefault ? (
                    t("clone.coveredDefault", { name: cov.winnerName })
                  ) : (
                    <Trans
                      i18nKey="clone.coveredRule"
                      values={{ rule: cov.ruleCondition, name: cov.winnerName }}
                      components={code}
                    />
                  )}
                </span>
              </div>
            </div>
          ) : (
            <div className="banner banner-warn" id="clone-coverage">
              <Icon name="alert" className="icon od-fixed" />
              <div className="od-fill od-stack" style={gap(8)}>
                <strong>
                  {cov.status === "CoveredByOtherProfile"
                    ? t("clone.otherProfile", { name: cov.winnerName })
                    : t("clone.uncovered")}
                </strong>
                <span className="banner-text">{t("clone.chooseRemedy", { name: profile?.DisplayName })}</span>
                <fieldset className="choice-set">
                  <legend className="sr-only">{t("clone.remedyLegend")}</legend>
                  <Choice
                    name="remedy"
                    value="folder"
                    checked={remedy === "FolderRule"}
                    onChange={() => setRemedy("FolderRule")}
                    title={
                      <Trans
                        i18nKey="clone.folderRule"
                        values={{ rule: preview?.folderRule }}
                        components={code}
                      />
                    }
                    tag={t("clone.recommended")}
                    help={t("clone.folderHelp")}
                  />
                  <Choice
                    name="remedy"
                    value="org"
                    checked={remedy === "OrgRule"}
                    onChange={() => setRemedy("OrgRule")}
                    disabled={!preview?.orgRule}
                    title={
                      preview?.orgRule ? (
                        <Trans i18nKey="clone.orgRule" values={{ rule: preview.orgRule }} components={code} />
                      ) : (
                        t("clone.orgRuleNone")
                      )
                    }
                    help={t("clone.orgHelp")}
                  />
                  <Choice
                    name="remedy"
                    value="local"
                    checked={remedy === "LocalIdentity"}
                    onChange={() => setRemedy("LocalIdentity")}
                    title={<Trans i18nKey="clone.localIdentity" components={code} />}
                    help={t("clone.localHelp")}
                  />
                </fieldset>
              </div>
            </div>
          ))}

        {phase === "running" && (
          <div className="clone-progress" id="clone-progress" aria-live="polite">
            <div className="progress">
              <div className="progress-bar" id="clone-bar" style={{ width: `${pct}%` }} />
            </div>
            <span id="clone-step">
              {t(`clone.steps.${STEPS[progress.step] ?? "diagnose"}`)}
              {progress.step === 2 && progress.phase ? ` ${progress.phase} · ${progress.percent}%` : ""}
            </span>
          </div>
        )}

        {phase === "done" && outcome && (
          <div className={`banner ${issues.length ? "banner-warn" : "banner-ok"}`} id="clone-done">
            <Icon name={issues.length ? "alert" : "check"} className="icon od-fixed" />
            <div className="od-fill od-stack" style={gap(2)}>
              <strong>{t("clone.clonedTitle")}</strong>
              <span className="banner-text">
                <Trans i18nKey="clone.clonedIn" values={{ dest: outcome.destination }} components={code} />{" "}
                {issues.length
                  ? t("clone.diagnostics", { problems: issues.map((p) => p.message).join(" ") })
                  : t("clone.identityApplied", { name: report?.appliedProfileSlug ?? t("clone.none") })}
              </span>
              <span className="od-cluster" style={{ marginBlockStart: 6 }}>
                <Btn
                  size="sm"
                  icon="folder"
                  onClick={() => run(() => api.openInExplorer(outcome.destination))}
                >
                  <span>{t("diagnostics.openExplorer")}</span>
                </Btn>
                {sourcetree && (
                  <Btn
                    size="sm"
                    icon="external"
                    onClick={() => run(() => api.openInSourcetree(outcome.destination))}
                  >
                    <span>{t("diagnostics.openSourcetree")}</span>
                  </Btn>
                )}
              </span>
            </div>
          </div>
        )}

        {phase === "failed" && (
          <div className="banner banner-danger" role="alert" style={{ margin: 0 }}>
            <Icon name="x" className="icon od-fixed" />
            <div className="od-fill od-stack" style={gap(6)}>
              <strong>{t("clone.failed")}</strong>
              <pre className="code code-output">{failure}</pre>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
