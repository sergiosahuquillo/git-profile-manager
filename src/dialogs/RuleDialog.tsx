import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Rule } from "../api/bindings/Rule";
import type { RuleType } from "../api/bindings/RuleType";
import { pickFolder } from "../api/platform";
import { Modal } from "../components/Modal";
import { Btn, Choice, Field, gap } from "../components/ui";
import {
  conditionsFor,
  isAzure,
  isAzureHost,
  newId,
  nextRuleOrder,
  normalizeOrg,
  upsertRule,
} from "../lib/profiles";
import { confirmSave, savedState } from "../state/actions";
import { NO_PROFILES, toast, useStore } from "../state/store";

/** Alta y edición de reglas: perfil, tipo, carpeta u organización y host opcional. */
export function RuleDialog() {
  const spec = useStore((s) => s.ruleDialog);
  const close = useStore((s) => s.openRuleDialog);
  if (!spec) return null;
  return <RuleForm key={spec.rule?.Id ?? "new"} onClose={() => close(null)} />;
}

function RuleForm({ onClose }: { onClose: () => void }) {
  const spec = useStore((s) => s.ruleDialog)!;
  const profiles = useStore((s) => s.overview?.state.Profiles ?? NO_PROFILES);
  const editing = spec.rule;
  const ownerId = editing
    ? profiles.find((p) => p.Rules.some((r) => r.Id === editing.Id))?.Id
    : spec.profileId;
  const [profileId, setProfileId] = useState(ownerId ?? profiles[0]?.Id ?? "");
  const [type, setType] = useState<RuleType>(editing?.Type ?? "Folder");
  const [value, setValue] = useState(editing?.Value ?? spec.presetFolder ?? "");
  const [host, setHost] = useState(editing?.Host ?? "");
  const [err, setErr] = useState<string | null>(null);
  const { t } = useTranslation();
  const profile = profiles.find((p) => p.Id === profileId);
  const azure = host.trim() ? isAzureHost(host) : !!profile && isAzure(profile);

  const rule: Rule = {
    Id: editing?.Id ?? newId(),
    Type: type,
    Value: type === "Folder" ? value.trim().replace(/\\/g, "/") : normalizeOrg(value),
    Host: type === "Remote" && host.trim() ? host.trim() : null,
    Order: editing && editing.Type === type ? editing.Order : nextRuleOrder(savedState()),
  };
  const conds = profile && rule.Value ? conditionsFor(profile, rule) : [];

  const submit = async () => {
    if (!profile) {
      toast(t("rules.needProfile"), "err");
      return;
    }
    if (!rule.Value) {
      setErr(type === "Folder" ? t("rules.dialog.pickFolder") : t("rules.dialog.pickOrg"));
      return;
    }
    onClose();
    await confirmSave(upsertRule(savedState(), profile.Id, rule), {
      title: editing
        ? t("rules.dialog.editTitle")
        : type === "Folder"
          ? t("rules.dialog.createFolder")
          : t("rules.dialog.createOrg"),
      note: t("rules.dialog.note"),
      done: editing ? t("rules.dialog.updated") : t("rules.dialog.created"),
    });
  };

  const browse = async () => {
    const f = await pickFolder(t("rules.dialog.folderPicker"));
    if (f) setValue(f.replace(/\\/g, "/"));
  };

  return (
    <Modal
      icon="rules"
      title={editing ? t("rules.dialog.edit") : t("rules.add")}
      size="md"
      onClose={onClose}
      labelId="rule-title"
      foot={
        <>
          <div className="od-fill meta">{t("rules.dialog.footNote")}</div>
          <button type="button" className="btn btn-default" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <Btn variant="primary" onClick={submit}>
            {editing ? t("rules.dialog.save") : t("rules.dialog.addEllipsis")}
          </Btn>
        </>
      }
    >
      <div className="modal-body od-stack" style={gap(16)}>
        <Field id="rule-profile" label={t("rules.col.profile")}>
          <select
            id="rule-profile"
            className="input"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.Id} value={p.Id}>
                {p.DisplayName}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="choice-set">
          <legend className="label-like" style={{ marginBlockEnd: 6 }}>
            {t("rules.dialog.type")}
          </legend>
          <Choice
            name="rule-type"
            value="folder"
            checked={type === "Folder"}
            onChange={() => setType("Folder")}
            title={t("rules.folder")}
            help={t("rules.dialog.folderHelp")}
          />
          <Choice
            name="rule-type"
            value="remote"
            checked={type === "Remote"}
            onChange={() => setType("Remote")}
            title={t("rules.dialog.remote")}
            help={t("rules.dialog.remoteHelp")}
          />
        </fieldset>
        {type === "Folder" ? (
          <Field id="rule-value" label={t("rules.folder")} req err={err}>
            <div className="od-row" style={gap(8)}>
              <input
                id="rule-value"
                className={`input input-mono od-fill${err ? " is-invalid" : ""}`}
                value={value}
                placeholder="C:/dev/empresa-a"
                onChange={(e) => {
                  setValue(e.target.value);
                  setErr(null);
                }}
              />
              <Btn className="od-fixed" onClick={browse}>
                {t("rules.dialog.browse")}
              </Btn>
            </div>
          </Field>
        ) : (
          <div className="form-2">
            <Field
              id="rule-value"
              label={azure ? t("rules.dialog.azureOrg") : t("rules.dialog.org")}
              req
              err={err}
              help={azure ? t("rules.dialog.azureHelp") : t("rules.dialog.orgHelp")}
            >
              <input
                id="rule-value"
                className={`input input-mono${err ? " is-invalid" : ""}`}
                value={value}
                placeholder="empresa-a"
                onChange={(e) => {
                  setValue(e.target.value);
                  setErr(null);
                }}
              />
            </Field>
            <Field id="rule-host" label="Host" opt help={t("rules.dialog.hostHelp")}>
              <input
                id="rule-host"
                className="input input-mono"
                value={host}
                placeholder={profile?.Host || "github.com"}
                onChange={(e) => setHost(e.target.value)}
              />
            </Field>
          </div>
        )}
        <div className="od-field" style={gap(6)}>
          <span className="label-like">{t("rules.col.condition")}</span>
          <pre className="code">{conds.length ? conds.join("\n") : "—"}</pre>
        </div>
      </div>
    </Modal>
  );
}
