import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { Rule } from "../../../api/bindings/Rule";
import { api } from "../../../api/commands";
import { Icon } from "../../../components/Icon";
import { Btn, Empty, gap, Pill } from "../../../components/ui";
import { t as tr } from "../../../i18n";
import { conditionsFor, mergeEdits, normalizeProfile, removeRule, withProfile } from "../../../lib/profiles";
import { confirmSave, savedState } from "../../../state/actions";
import { useStore } from "../../../state/store";
import { type Editor, SaveRow } from "../ProfileDetail";

export function deleteRule(rule: Rule) {
  return confirmSave(removeRule(savedState(), rule.Id), {
    title: tr("rules.deleteTitle"),
    note: tr("rules.deleteNote"),
    applyLabel: tr("rules.delete"),
    danger: true,
    done: tr("rules.deleteDone"),
  });
}

export function TypePill({ rule }: { rule: Rule }) {
  const { t } = useTranslation();
  return rule.Type === "Folder" ? (
    <Pill tone="neutral" icon="folder">
      {t("rules.folder")}
    </Pill>
  ) : (
    <Pill tone="neutral" icon="globe">
      {t("rules.organization")}
    </Pill>
  );
}

export function RulesTab({ editor }: { editor: Editor }) {
  const p = editor.saved;
  const openRuleDialog = useStore((s) => s.openRuleDialog);
  const overview = useStore((s) => s.overview);
  const [preview, setPreview] = useState<string>("");
  const { t } = useTranslation();
  const rules = [...p.Rules].sort((a, b) =>
    a.Type === b.Type ? a.Order - b.Order : a.Type === "Folder" ? -1 : 1,
  );

  // Vista previa del fichero del perfil con las ediciones sin guardar incluidas.
  const merged = mergeEdits(p, normalizeProfile(editor.current));
  const key = JSON.stringify(merged);
  useEffect(() => {
    if (!overview) return;
    let alive = true;
    api
      .previewGenerated(withProfile(overview.state, merged))
      .then((files) => {
        const f = files.find((x) => x.displayPath.endsWith(`/${merged.Slug}.gitconfig`));
        if (alive) setPreview(f?.content.replace(/\n$/, "") ?? "");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, overview?.state]);

  return (
    <div className="od-stack" style={gap(16)}>
      <div className="panel">
        <div className="panel-head od-row">
          <span className="od-fill">{t("rules.tab.title")}</span>
          <Btn size="sm" icon="plus" className="od-fixed" onClick={() => openRuleDialog({ profileId: p.Id })}>
            <span>{t("rules.tab.add")}</span>
          </Btn>
        </div>
        {rules.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t("rules.tab.caption", { name: p.DisplayName })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("rules.col.type")}</th>
                  <th scope="col">{t("rules.col.condition")}</th>
                  <th scope="col" className="col-act">
                    <span className="sr-only">{t("rules.col.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.Id}>
                    <td data-label={t("rules.col.type")}>
                      <TypePill rule={r} />
                    </td>
                    <td data-label={t("rules.col.condition")}>
                      <span className="cond-list">
                        {conditionsFor(p, r).map((c) => (
                          <span key={c}>{c}</span>
                        ))}
                      </span>
                    </td>
                    <td data-label={t("rules.col.actions")}>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-default btn-sm"
                          onClick={() => openRuleDialog({ rule: r })}
                        >
                          <Icon name="pen" />
                          <span className="sr-only">{t("rules.tab.edit")}</span>
                        </button>
                        <Btn size="sm" variant="danger" onClick={() => deleteRule(r)}>
                          <Icon name="trash" />
                          <span className="sr-only">{t("rules.tab.delete")}</span>
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel-body">
            <Empty
              icon="rules"
              title={t("rules.tab.emptyTitle")}
              text={p.IsDefault ? t("rules.tab.emptyDefault") : t("rules.tab.emptyOther")}
            >
              <Btn
                variant="primary"
                size="sm"
                icon="plus"
                onClick={() => openRuleDialog({ profileId: p.Id })}
              >
                <span>{t("rules.add")}</span>
              </Btn>
            </Empty>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <Trans
            i18nKey="rules.tab.preview"
            values={{ file: `~/.gitprofiles/${merged.Slug}.gitconfig` }}
            components={{ code: <code /> }}
          />
        </div>
        <div className="panel-body">
          <pre className="code">{preview || "…"}</pre>
        </div>
      </div>
      <SaveRow editor={editor} />
    </div>
  );
}
