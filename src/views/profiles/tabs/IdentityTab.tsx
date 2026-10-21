import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { CloneMethod } from "../../../api/bindings/CloneMethod";
import type { GitProvider } from "../../../api/bindings/GitProvider";
import { Field, gap, Seg } from "../../../components/ui";
import { EMAIL_RE, PROVIDERS, SLUG_RE } from "../../../lib/profiles";
import { type Editor, SaveRow } from "../ProfileDetail";

export const CLONE_OPTIONS: { value: CloneMethod; label: string }[] = [
  { value: "Ssh", label: "SSH" },
  { value: "Https", label: "HTTPS" },
];

export function IdentityTab({ editor }: { editor: Editor }) {
  const p = editor.current;
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [slugErr, setSlugErr] = useState<string | null>(null);
  const { t } = useTranslation();

  return (
    <div className="panel">
      <div className="panel-body od-stack" style={gap(16)}>
        <div className="kv-grid">
          <Field id="f-name" label={t("profiles.identity.name")} req>
            <input
              id="f-name"
              className="input"
              value={p.DisplayName}
              placeholder={t("profiles.identity.namePlaceholder")}
              onChange={(e) => editor.update({ DisplayName: e.target.value })}
            />
          </Field>
          <Field
            id="f-slug"
            label="Slug"
            req
            err={slugErr}
            help={<Trans i18nKey="profiles.identity.slugHelp" components={{ code: <code /> }} />}
          >
            <input
              id="f-slug"
              className={`input input-mono${slugErr ? " is-invalid" : ""}`}
              value={p.Slug}
              aria-describedby="f-slug-help"
              onChange={(e) => editor.update({ Slug: e.target.value })}
              onBlur={() => setSlugErr(SLUG_RE.test(p.Slug) ? null : t("profiles.identity.slugErr"))}
            />
          </Field>
          <Field id="f-user" label="user.name" req>
            <input
              id="f-user"
              className="input"
              value={p.GitUserName}
              onChange={(e) => editor.update({ GitUserName: e.target.value })}
            />
          </Field>
          <Field id="f-email" label="user.email" req err={emailErr}>
            <input
              id="f-email"
              className={`input${emailErr ? " is-invalid" : ""}`}
              type="email"
              value={p.GitUserEmail}
              aria-describedby="f-email-err"
              onChange={(e) => editor.update({ GitUserEmail: e.target.value })}
              onBlur={() =>
                setEmailErr(EMAIL_RE.test(p.GitUserEmail.trim()) ? null : t("profiles.identity.emailErr"))
              }
            />
          </Field>
          <Field id="f-provider" label={t("profiles.identity.provider")}>
            <select
              id="f-provider"
              className="input"
              value={p.Provider}
              onChange={(e) => editor.update({ Provider: e.target.value as GitProvider })}
            >
              {PROVIDERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="f-host" label="Host" help={t("profiles.identity.hostHelp")}>
            <input
              id="f-host"
              className="input input-mono"
              value={p.Host}
              placeholder="github.com"
              aria-describedby="f-host-help"
              onChange={(e) => editor.update({ Host: e.target.value })}
            />
          </Field>
          <div className="od-field" style={gap(6)}>
            <span className="label-like" id="l-clone">
              {t("profiles.identity.cloneMethod")}
            </span>
            <Seg
              name="pclone"
              value={p.PreferredCloneMethod}
              options={CLONE_OPTIONS}
              labelledBy="l-clone"
              onChange={(v) => editor.update({ PreferredCloneMethod: v })}
            />
            <span className="field-help">{t("profiles.identity.cloneHelp")}</span>
          </div>
        </div>
        <SaveRow editor={editor} always />
      </div>
    </div>
  );
}
