import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { DetectedRepo } from "../api/bindings/DetectedRepo";
import type { DiagnosticReport } from "../api/bindings/DiagnosticReport";
import type { Problem } from "../api/bindings/Problem";
import { api, errorMessage } from "../api/commands";
import { onDragDrop, pickFolder } from "../api/platform";
import { Icon } from "../components/Icon";
import { Banner, Btn, gap, Pill } from "../components/ui";
import { GlobalBanners } from "../shell/Shell";
import { run } from "../state/actions";
import { toast, useStore } from "../state/store";

type Summary = { count: number } | "loading" | "error";

/** Solo cuentan como problemas los avisos y errores; los informativos se listan pero no suman. */
const issueCount = (ps: { severity: Problem["severity"] }[]) =>
  ps.filter((p) => p.severity !== "Info").length;

const SEV = { Error: "err", Warning: "warn", Info: "info" } as const;

const CODE = { code: <code />, strong: <strong /> };

/** Diagnóstico en segundo plano de los repos detectados, de 4 en 4, solo para el recuento. */
function useSummaries(repos: DetectedRepo[]) {
  const [map, setMap] = useState<Record<string, Summary>>({});
  useEffect(() => {
    let alive = true;
    const queue = repos.map((r) => r.path);
    setMap(Object.fromEntries(queue.map((p) => [p, "loading" as const])));
    const worker = async () => {
      while (alive && queue.length) {
        const path = queue.shift()!;
        try {
          const r = await api.diagnoseRepo(path);
          if (alive) setMap((m) => ({ ...m, [path]: { count: issueCount(r.problems) } }));
        } catch {
          if (alive) setMap((m) => ({ ...m, [path]: "error" }));
        }
      }
    };
    for (let i = 0; i < 4; i++) void worker();
    return () => {
      alive = false;
    };
  }, [repos]);
  return [map, setMap] as const;
}

export function DiagnosticsView() {
  const diagPath = useStore((s) => s.diagPath);
  const diagnose = useStore((s) => s.diagnose);
  const overview = useStore((s) => s.overview);
  const view = useStore((s) => s.view);
  const [repos, setRepos] = useState<DetectedRepo[]>([]);
  const [summaries, setSummaries] = useSummaries(repos);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [manual, setManual] = useState("");
  const { t, i18n } = useTranslation();
  const viewRef = useRef(view);
  viewRef.current = view;
  const reportPath = useRef<string | null>(null);
  reportPath.current = report?.repoPath ?? null;
  const shownLang = useRef(i18n.language);

  const rulesKey = JSON.stringify(overview?.state.Profiles.map((p) => p.Rules));
  useEffect(() => {
    void rulesKey;
    api
      .findRepos()
      .then(setRepos)
      .catch(() => setRepos([]));
  }, [rulesKey]);

  const analyze = useCallback(
    async (path: string, sub = false) => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.diagnoseRepo(path);
        setReport(r);
        setSummaries((m) => ({ ...m, [path]: { count: issueCount(r.problems) } }));
        if (!sub) setTrail([]);
      } catch (e) {
        setError(errorMessage(e));
        setReport(null);
      } finally {
        setLoading(false);
      }
    },
    [setSummaries],
  );

  // Al cambiar de idioma, el informe abierto se vuelve a pedir para traducir sus mensajes.
  useEffect(() => {
    if (shownLang.current === i18n.language) return;
    shownLang.current = i18n.language;
    if (reportPath.current) void analyze(reportPath.current, true);
  }, [i18n.language, analyze]);

  useEffect(() => {
    if (diagPath) {
      setManual(diagPath);
      void analyze(diagPath);
    }
  }, [diagPath, analyze]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onDragDrop((e) => {
      if (viewRef.current !== "diagnostico") return;
      if (e.type === "over") setOver(true);
      else if (e.type === "leave") setOver(false);
      else {
        setOver(false);
        const path = e.paths[0];
        if (path) {
          toast(t("diagnostics.dropped"));
          diagnose(path);
        }
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [diagnose, t]);

  const choose = async () => {
    const f = await pickFolder(t("diagnostics.pickRepo"));
    if (f) diagnose(f);
  };

  const openSub = (path: string) => {
    if (report) setTrail((t) => [...t, report.repoPath]);
    void analyze(path, true);
  };

  const back = () => {
    const prev = trail[trail.length - 1];
    if (!prev) return;
    setTrail((t) => t.slice(0, -1));
    void analyze(prev, true);
  };

  return (
    <section className="view" id="view-diagnostico" aria-labelledby="h-diag">
      <div className="view-head">
        <div className="od-fill">
          <h1 id="h-diag">{t("diagnostics.title")}</h1>
          <p className="view-sub">{t("diagnostics.sub")}</p>
        </div>
        <Btn
          icon="sync"
          className="od-fixed"
          disabled={!report}
          busyLabel={t("diagnostics.analyzing")}
          onClick={async () => {
            if (!report) return;
            await analyze(report.repoPath, true);
            toast(t("diagnostics.updated"));
          }}
        >
          <span>{t("diagnostics.reanalyze")}</span>
        </Btn>
      </div>

      <GlobalBanners />

      <div className="diag-top">
        <div
          className={`dropzone${over ? " is-over" : ""}`}
          id="dropzone"
          tabIndex={0}
          role="button"
          aria-describedby="dropzone-help"
          onClick={choose}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void choose();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
        >
          <Icon name="folder" className="icon icon-24" />
          <strong>{t("diagnostics.drop")}</strong>
          <span id="dropzone-help">{t("diagnostics.dropHelp")}</span>
          <span className="btn btn-default btn-sm" aria-hidden="true">
            {t("diagnostics.chooseFolder")}
          </span>
        </div>
        <div className="panel">
          <div className="panel-head">{t("diagnostics.detected")}</div>
          {repos.length === 0 ? (
            <div className="panel-body">
              <p className="meta">{t("diagnostics.noneDetected")}</p>
            </div>
          ) : (
            <ul className="repo-list" id="repo-list" role="list">
              {repos.map((r) => {
                const s = summaries[r.path];
                return (
                  <li key={r.path}>
                    <button
                      type="button"
                      className="repo-item"
                      aria-current={report?.repoPath === r.path}
                      onClick={() => diagnose(r.path)}
                    >
                      <Icon name="folder" />
                      <span>
                        <span className="repo-path od-truncate">{r.path}</span>
                        <span className="repo-profile od-truncate">
                          {r.profileName ?? t("diagnostics.noProfile")}
                        </span>
                      </span>
                      {s === "loading" || s === undefined ? (
                        <span className="skeleton" aria-label={t("diagnostics.analyzingLabel")} />
                      ) : s === "error" ? (
                        <Pill tone="neutral" icon="info">
                          —
                        </Pill>
                      ) : s.count ? (
                        <Pill tone="warn" icon="alert">
                          {s.count}
                          <span className="sr-only">{t("diagnostics.problemsSr")}</span>
                        </Pill>
                      ) : (
                        <Pill tone="ok" icon="check">
                          OK
                        </Pill>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <form
        className="path-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) diagnose(manual.trim());
        }}
      >
        <label htmlFor="diag-path" className="sr-only">
          {t("diagnostics.repoPath")}
        </label>
        <input
          id="diag-path"
          className="input input-mono od-fill"
          placeholder={t("diagnostics.repoPlaceholder")}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button type="submit" className="btn btn-primary od-fixed">
          {t("diagnostics.analyze")}
        </button>
      </form>

      {error && <Banner tone="danger" title={t("diagnostics.failed")} text={error} role="alert" />}

      {loading && !report && (
        <div className="panel">
          <div className="panel-body od-stack" style={gap(8)}>
            {[0, 1, 2, 3].map((i) => (
              <span className="skeleton" key={i} />
            ))}
          </div>
        </div>
      )}

      {report && (
        <ReportPanel
          report={report}
          loading={loading}
          onSub={openSub}
          onBack={trail.length ? back : undefined}
          onUpdate={setReport}
        />
      )}
    </section>
  );
}

function ReportPanel({
  report,
  loading,
  onSub,
  onBack,
  onUpdate,
}: {
  report: DiagnosticReport;
  loading: boolean;
  onSub: (path: string) => void;
  onBack?: () => void;
  onUpdate: (r: DiagnosticReport) => void;
}) {
  const overview = useStore((s) => s.overview);
  const env = useStore((s) => s.env);
  const cred = useStore((s) => s.cred);
  const askChange = useStore((s) => s.askChange);
  const openRuleDialog = useStore((s) => s.openRuleDialog);
  const goto = useStore((s) => s.goto);
  const selectProfile = useStore((s) => s.selectProfile);
  const [sourcetree, setSourcetree] = useState<string | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    api
      .sourcetreeStatus()
      .then((s) => setSourcetree(s.exePath))
      .catch(() => undefined);
  }, []);

  const applied = overview?.state.Profiles.find((p) => p.Slug === report.appliedProfileSlug);
  const problems: (Problem & { extra?: "cred" })[] = [...report.problems];
  const appliedCred = applied ? cred[applied.Id] : undefined;
  if (applied && appliedCred && !appliedCred.valid) {
    problems.unshift({
      kind: "LocalOverride",
      severity: "Error",
      message: t("diagnostics.credFailed", { host: applied.Host, user: applied.HttpsUsername ?? "" }),
      fix: null,
      fixPreview: [],
      target: null,
      extra: "cred",
    });
  }

  const fix = (p: Problem) => {
    if (!p.fix) return;
    askChange({
      title: p.fix.description,
      note: t("diagnostics.fixNote", { repo: report.repoPath }),
      blocks: [
        {
          type: "cmd",
          lines: p.fixPreview.map((c) =>
            c.replace(/^git /, `git -C ${report.repoPath.replace(/\\/g, "/")} `),
          ),
        },
      ],
      onApply: async () => {
        const r = await api.applyFix(report.repoPath, p.fix!);
        onUpdate(r);
        toast(t("diagnostics.fixDone", { fix: p.fix!.description }));
      },
    });
  };

  const action = (p: Problem & { extra?: "cred" }) => {
    if (p.extra === "cred" && applied) {
      return (
        <Btn
          variant="accent"
          size="sm"
          onClick={() => {
            selectProfile(applied.Id, "https");
            goto("perfiles");
          }}
        >
          {t("diagnostics.relogin")}
        </Btn>
      );
    }
    if (p.fix) {
      return (
        <Btn variant={p.severity === "Error" ? "accent" : "default"} size="sm" onClick={() => fix(p)}>
          {p.kind === "NonCanonicalRemote" ? t("diagnostics.normalize") : p.fix.description}…
        </Btn>
      );
    }
    if (p.kind === "NoProfile" || p.kind === "NoSpecificRule") {
      return (
        <Btn
          variant={p.severity === "Error" ? "accent" : "default"}
          size="sm"
          onClick={() => openRuleDialog({ presetFolder: report.repoPath.replace(/\\/g, "/") })}
        >
          {t("diagnostics.createRule")}
        </Btn>
      );
    }
    if (p.kind === "MultipleProfiles" || p.kind === "MixedProfiles") {
      return (
        <Btn size="sm" onClick={() => goto("reglas")}>
          {t("diagnostics.viewRules")}
        </Btn>
      );
    }
    if (p.kind === "Submodule" && p.target) {
      return (
        <Btn size="sm" onClick={() => onSub(p.target!)}>
          {t("diagnostics.diagnoseSub")}
        </Btn>
      );
    }
    return (
      <Pill tone="neutral" icon="info">
        {t("diagnostics.warnOnly")}
      </Pill>
    );
  };

  const n = issueCount(problems);
  return (
    <div className="panel panel-current-repo">
      <div className="panel-head od-row">
        {onBack && (
          <button
            type="button"
            className="icon-btn od-fixed"
            onClick={onBack}
            title={t("diagnostics.backToMain")}
          >
            <Icon name="arrow-up" />
            <span className="sr-only">{t("diagnostics.backToMain")}</span>
          </button>
        )}
        <Icon name="folder" className="icon od-fixed" />
        <span className="od-fill od-truncate" id="diag-repo-path">
          {report.repoPath}
        </span>
        {loading && <Icon name="sync" className="icon od-fixed" />}
        <Pill tone={n ? "warn" : "ok"} icon={n ? "alert" : "check"} className="od-fixed">
          {n ? t("diagnostics.problems", { count: n }) : t("diagnostics.noProblems")}
        </Pill>
      </div>
      <div className="panel-body od-stack" style={gap(20)}>
        <div className="sub-head">
          <span className="od-fill">
            {applied ? (
              <Trans i18nKey="diagnostics.applied" values={{ name: applied.DisplayName }} components={CODE} />
            ) : (
              t("diagnostics.noneApplied")
            )}
          </span>
          <Btn size="sm" icon="folder" onClick={() => run(() => api.openInExplorer(report.repoPath))}>
            <span>{t("diagnostics.openExplorer")}</span>
          </Btn>
          {sourcetree && (
            <Btn size="sm" icon="external" onClick={() => run(() => api.openInSourcetree(report.repoPath))}>
              <span>{t("diagnostics.openSourcetree")}</span>
            </Btn>
          )}
        </div>
        <div>
          <h2 className="h-sub">{t("diagnostics.values")}</h2>
          <p className="meta mb-8">
            <Trans i18nKey="diagnostics.valuesHelp" components={CODE} shouldUnescape />
          </p>
          <div className="table-wrap">
            <table className="table table-values">
              <caption className="sr-only">{t("diagnostics.valuesCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("diagnostics.col.key")}</th>
                  <th scope="col">{t("diagnostics.col.value")}</th>
                  <th scope="col">{t("diagnostics.col.scope")}</th>
                  <th scope="col">{t("diagnostics.col.origin")}</th>
                </tr>
              </thead>
              <tbody id="diag-values">
                {report.values.map((v) => (
                  <tr key={v.key}>
                    <td data-label={t("diagnostics.col.key")}>
                      <code>{v.key}</code>
                    </td>
                    <td data-label={t("diagnostics.col.value")}>
                      {v.value == null ? (
                        <span className="meta">{t("diagnostics.undefinedValue")}</span>
                      ) : (
                        <code className="od-truncate">{v.value}</code>
                      )}
                    </td>
                    <td data-label={t("diagnostics.col.scope")}>
                      <span className={`scope scope-${v.scope ?? "none"}`}>{v.scope ?? "—"}</span>
                    </td>
                    <td data-label={t("diagnostics.col.origin")}>
                      <span className={`origin${v.profileSlug ? " origin-profile" : ""} od-truncate`}>
                        {v.originDisplay ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="h-sub">{t("diagnostics.problemsTitle")}</h2>
          <p className="meta mb-8">{t("diagnostics.problemsHelp")}</p>
          <ul className="problem-list" id="diag-problems" role="list">
            {problems.length ? (
              problems.map((p, i) => {
                const sev = SEV[p.severity];
                return (
                  <li className={`problem sev-${sev}`} key={`${p.kind}-${i}`}>
                    <span className={`problem-ico sev-${sev}`}>
                      <Icon name={sev === "err" ? "x" : sev === "warn" ? "alert" : "info"} />
                    </span>
                    <span className="problem-body">
                      <span className="problem-title">
                        {p.extra === "cred" ? t("diagnostics.credTitle") : t(`diagnostics.titles.${p.kind}`)}
                      </span>
                      <span className="problem-text">{p.message}</span>
                      <span className="problem-how">
                        <Trans
                          i18nKey={p.extra === "cred" ? "diagnostics.how.cred" : `diagnostics.how.${p.kind}`}
                          components={CODE}
                        />
                      </span>
                    </span>
                    <span className="od-fixed">{action(p)}</span>
                  </li>
                );
              })
            ) : (
              <li>
                <div className="empty">
                  <Icon name="check" className="icon icon-24" />
                  <span className="empty-title">{t("diagnostics.emptyTitle")}</span>
                  <span className="empty-text">{t("diagnostics.emptyText")}</span>
                </div>
              </li>
            )}
          </ul>
        </div>
        {env?.blockingError && (
          <Banner tone="danger" title={t("diagnostics.incompatible")} text={env.blockingError} />
        )}
      </div>
    </div>
  );
}
