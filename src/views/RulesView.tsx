import { useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { RuleConflict } from "../api/bindings/RuleConflict";
import { api } from "../api/commands";
import { Icon } from "../components/Icon";
import { Banner, Btn, Pill } from "../components/ui";
import { t as tr } from "../i18n";
import { conditionsFor, moveRule, orderedRules } from "../lib/profiles";
import { GlobalBanners } from "../shell/Shell";
import { run, savedState, saveNow } from "../state/actions";
import { toast, useStore } from "../state/store";
import { deleteRule, TypePill } from "./profiles/tabs/RulesTab";

export async function showRulesPreview() {
  const r = await run(() => api.analyzeRules(savedState()));
  if (!r) return;
  useStore.getState().askChange({
    title: tr("rules.previewTitle"),
    note: tr("rules.previewNote"),
    readOnly: true,
    blocks: [
      {
        type: "code",
        label: <code>~/.gitprofiles/rules.gitconfig</code>,
        text: r.rulesFile.replace(/\n$/, ""),
      },
    ],
  });
}

export function RulesView() {
  const overview = useStore((s) => s.overview);
  const openRuleDialog = useStore((s) => s.openRuleDialog);
  const selectProfile = useStore((s) => s.selectProfile);
  const goto = useStore((s) => s.goto);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const { t } = useTranslation();
  if (!overview) return null;
  const state = overview.state;
  const rows = orderedRules(state);
  const def = state.Settings.NoProfileMode === "Strict" ? null : state.Profiles.find((p) => p.IsDefault);
  const strict = state.Settings.NoProfileMode === "Strict";

  const conflictsOf = (ruleId: string): RuleConflict[] =>
    overview.conflicts.filter((c) => c.ruleA === ruleId || c.ruleB === ruleId);
  const conflictCount = new Set(overview.conflicts.map((c) => `${c.ruleA}|${c.ruleB}`)).size;
  const hasError = overview.conflicts.some((c) => c.severity === "Error");

  const move = async (id: string, delta: -1 | 1) => {
    const next = moveRule(state, id, delta);
    if (!next) {
      toast(t("rules.orderFixed"), "warn");
      return;
    }
    await saveNow(next, t("rules.orderDone"));
  };

  const focusConflict = () => {
    const row = tbody.current?.querySelector<HTMLElement>(".is-conflict");
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    row?.querySelector("button")?.focus();
  };

  const goProfile = (id: string) => {
    selectProfile(id);
    goto("perfiles");
  };

  const addRule = () => {
    if (!state.Profiles.length) {
      toast(t("rules.needProfile"), "err");
      return;
    }
    openRuleDialog({});
  };

  let index = 0;
  return (
    <section className="view" id="view-reglas" aria-labelledby="h-reglas">
      <div className="view-head">
        <div className="od-fill">
          <h1 id="h-reglas">{t("rules.title")}</h1>
          <p className="view-sub">{t("rules.sub")}</p>
        </div>
        <div className="od-cluster od-fixed">
          <Btn icon="file-code" onClick={showRulesPreview}>
            <span>
              <Trans i18nKey="rules.previewButton" components={{ code: <code /> }} />
            </span>
          </Btn>
          <Btn variant="primary" icon="plus" onClick={addRule}>
            <span>{t("rules.add")}</span>
          </Btn>
        </div>
      </div>

      <GlobalBanners />

      {conflictCount > 0 && (
        <Banner
          tone={hasError ? "danger" : "warn"}
          title={t("rules.conflicts", { count: conflictCount })}
          text={t("rules.conflictsText")}
          actions={
            <Btn size="sm" onClick={focusConflict}>
              {t("rules.goConflict")}
            </Btn>
          }
        />
      )}

      <div className="panel">
        <div className="panel-head od-row">
          <span className="od-fill">{t("rules.order")}</span>
          <span className="meta od-nowrap">{t("rules.orderHint")}</span>
        </div>
        <div className="table-wrap">
          <table className="table table-rules">
            <caption className="sr-only">{t("rules.caption")}</caption>
            <thead>
              <tr>
                <th scope="col" className="col-ord">
                  #
                </th>
                <th scope="col">{t("rules.col.type")}</th>
                <th scope="col">{t("rules.col.condition")}</th>
                <th scope="col">{t("rules.col.profile")}</th>
                <th scope="col">{t("rules.col.identity")}</th>
                <th scope="col" className="col-act">
                  <span className="sr-only">{t("rules.col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody ref={tbody}>
              {(def || strict) && (
                <tr>
                  <td data-label={t("rules.col.order")}>
                    <span className="ord">—</span>
                  </td>
                  <td data-label={t("rules.col.type")}>
                    <Pill tone="accent" icon="star">
                      {strict ? t("rules.strict") : t("rules.default")}
                    </Pill>
                  </td>
                  <td data-label={t("rules.col.condition")}>
                    <span className="cond-list">
                      <span>{strict ? "[user] useConfigOnly = true" : t("rules.unconditional")}</span>
                    </span>
                  </td>
                  <td data-label={t("rules.col.profile")}>
                    {def ? (
                      <button type="button" className="linkish" onClick={() => goProfile(def.Id)}>
                        {def.DisplayName}
                      </button>
                    ) : (
                      <span className="meta">{t("rules.none")}</span>
                    )}
                  </td>
                  <td data-label={t("rules.col.identity")}>
                    {def ? (
                      <code className="od-truncate">{def.GitUserEmail}</code>
                    ) : (
                      <span className="meta">{t("rules.noIdentity")}</span>
                    )}
                  </td>
                  <td data-label={t("rules.col.actions")}>
                    <div className="row-actions">
                      <span className="meta od-nowrap">{t("rules.fixed")}</span>
                    </div>
                  </td>
                </tr>
              )}
              {rows.map(({ profile, rule }, i) => {
                index += 1;
                const conflicts = conflictsOf(rule.Id);
                const sameTypePrev = i > 0 && rows[i - 1].rule.Type === rule.Type;
                const sameTypeNext = i < rows.length - 1 && rows[i + 1].rule.Type === rule.Type;
                return (
                  <tr
                    key={rule.Id}
                    className={conflicts.length ? "is-conflict" : ""}
                    id={`rule-row-${index}`}
                  >
                    <td data-label={t("rules.col.order")}>
                      <span className="ord">{index}</span>
                    </td>
                    <td data-label={t("rules.col.type")}>
                      <TypePill rule={rule} />
                    </td>
                    <td data-label={t("rules.col.condition")}>
                      <span className="cond-list">
                        {conditionsFor(profile, rule).map((c) => (
                          <span key={c}>{c}</span>
                        ))}
                      </span>
                      {conflicts.map((c) => (
                        <div className="meta" style={{ marginBlockStart: 4 }} key={c.message}>
                          <Icon name="alert" className="icon icon-12" />{" "}
                          {t("rules.conflict", { message: c.message })}
                        </div>
                      ))}
                    </td>
                    <td data-label={t("rules.col.profile")}>
                      <button type="button" className="linkish" onClick={() => goProfile(profile.Id)}>
                        {profile.DisplayName}
                      </button>
                    </td>
                    <td data-label={t("rules.col.identity")}>
                      <code className="od-truncate">{profile.GitUserEmail}</code>
                    </td>
                    <td data-label={t("rules.col.actions")}>
                      <div className="row-actions">
                        <Btn size="sm" disabled={!sameTypePrev} onClick={() => move(rule.Id, -1)}>
                          <Icon name="arrow-up" />
                          <span className="sr-only">{t("rules.up")}</span>
                        </Btn>
                        <Btn size="sm" disabled={!sameTypeNext} onClick={() => move(rule.Id, 1)}>
                          <Icon name="arrow-down" />
                          <span className="sr-only">{t("rules.down")}</span>
                        </Btn>
                        <Btn size="sm" variant="danger" onClick={() => deleteRule(rule)}>
                          <Icon name="trash" />
                          <span className="sr-only">{t("rules.delete")}</span>
                        </Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">
                      <Icon name="rules" className="icon icon-24" />
                      <span className="empty-title">{t("rules.emptyTitle")}</span>
                      <span className="empty-text">{t("rules.emptyText")}</span>
                      <Btn variant="primary" size="sm" icon="plus" onClick={addRule}>
                        <span>{t("rules.add")}</span>
                      </Btn>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
