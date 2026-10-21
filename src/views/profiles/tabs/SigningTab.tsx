import { Trans, useTranslation } from "react-i18next";
import type { SigningMode } from "../../../api/bindings/SigningMode";
import { openUrl } from "../../../api/platform";
import { Btn, Choice, Code, Field, gap, InlineStatus } from "../../../components/ui";
import { blank, DEFAULT_SSH_CLIENT, providerLabel, signingProgram, sshKeysPage } from "../../../lib/profiles";
import { useStore } from "../../../state/store";
import { type Editor, SaveRow } from "../ProfileDetail";

export function SigningModes({
  value,
  onChange,
  initialTag,
}: {
  value: SigningMode;
  onChange: (v: SigningMode) => void;
  initialTag?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="choice-set">
      <legend className="sr-only">{t("profiles.signing.legend")}</legend>
      <Choice
        name="sign"
        value="none"
        checked={value === "None"}
        onChange={() => onChange("None")}
        title={t("profiles.signing.none")}
        tag={initialTag ? t("profiles.signing.initial") : undefined}
        tagNeutral
        help={t("profiles.signing.noneHelp")}
      />
      <Choice
        name="sign"
        value="ssh"
        checked={value === "Ssh"}
        onChange={() => onChange("Ssh")}
        title={t("profiles.signing.ssh")}
        tag={t("profiles.signing.recommended")}
        help={t("profiles.signing.sshHelp")}
      />
      <Choice
        name="sign"
        value="gpg"
        checked={value === "Gpg"}
        onChange={() => onChange("Gpg")}
        title="GPG"
        help={t("profiles.signing.gpgHelp")}
      />
    </fieldset>
  );
}

export function SigningTab({ editor }: { editor: Editor }) {
  const p = editor.current;
  const { t } = useTranslation();
  const client = useStore((s) => s.overview?.sshClient) ?? DEFAULT_SSH_CLIENT;
  const gitProfilesDir = useStore((s) => s.overview?.paths.gitProfilesDir);
  const keygen = signingProgram(client, gitProfilesDir);
  const ssh = p.Signing === "Ssh";
  const gpg = p.Signing === "Gpg";
  const key = p.SigningKey ?? "";
  const page = sshKeysPage(p);
  // El estado se calcula sobre lo guardado: solo vale mientras la clave del borrador no cambie.
  const saved = useStore((s) => s.overview?.state.Profiles.find((x) => x.Id === p.Id));
  const health = useStore((s) => s.overview?.profilesHealth.find((h) => h.id === p.Id));
  const needsSessionAgent =
    ssh &&
    client.kind === "GitBundled" &&
    saved?.SigningKey === p.SigningKey &&
    !!health?.signingNeedsSessionAgent;

  return (
    <div className="od-stack" style={gap(16)}>
      <div className="panel">
        <div className="panel-head">{t("profiles.signing.mode")}</div>
        <div className="panel-body od-stack" style={gap(12)}>
          <SigningModes value={p.Signing} onChange={(v) => editor.update({ Signing: v })} />
          {(ssh || gpg) && (
            <Field
              id="f-signkey"
              label={ssh ? t("profiles.signing.key") : t("profiles.signing.gpgKey")}
              help={ssh ? t("profiles.signing.keyHelp") : t("profiles.signing.gpgKeyHelp")}
            >
              <input
                id="f-signkey"
                className="input input-mono"
                value={key}
                placeholder={
                  ssh
                    ? `${p.SshKeyPath || `~/.ssh/id_ed25519_${p.Slug || "<slug>"}`}.pub`
                    : "ABCDEF0123456789"
                }
                aria-describedby="f-signkey-help"
                onChange={(e) => editor.update({ SigningKey: e.target.value || null })}
              />
            </Field>
          )}
          {ssh && (
            <div className="od-cluster">
              <Btn
                size="sm"
                disabled={blank(p.SshKeyPath)}
                onClick={() => editor.update({ SigningKey: `${p.SshKeyPath}.pub` })}
              >
                {t("profiles.signing.useAuthKey")}
              </Btn>
            </div>
          )}
        </div>
      </div>

      {needsSessionAgent && (
        <InlineStatus tone="warn" icon="alert">
          <Trans
            i18nKey="profiles.signing.sessionAgent"
            values={{ key: key.replace(/\.pub$/, "") }}
            components={{ code: <code /> }}
          />
        </InlineStatus>
      )}
      {ssh && (
        <>
          <div className="panel">
            <div className="panel-head">
              <Trans
                i18nKey="profiles.signing.materialized"
                values={{ file: `${p.Slug}.gitconfig` }}
                components={{ code: <code /> }}
              />
            </div>
            <div className="panel-body od-stack" style={gap(10)}>
              <Code>{`[gpg]\n    format = ssh\n[gpg "ssh"]\n    program = ${keygen}\n    allowedSignersFile = ~/.gitprofiles/allowed_signers\n[user]\n    signingkey = ${key || t("profiles.signing.signingKeyPlaceholder")}\n[commit]\n    gpgsign = true`}</Code>
              <span className="field-help">
                <Trans i18nKey="profiles.signing.allowedSigners" components={{ code: <code /> }} />
              </span>
            </div>
          </div>
          <InlineStatus
            tone="warn"
            action={
              page ? (
                <Btn size="sm" icon="external" className="od-fixed" onClick={() => openUrl(page)}>
                  <span>{t("profiles.signing.open")}</span>
                </Btn>
              ) : undefined
            }
          >
            <Trans
              i18nKey="profiles.signing.upload"
              values={{
                provider: providerLabel(p.Provider),
                extra: p.Provider === "GitHub" ? t("profiles.signing.githubHint") : "",
              }}
              components={{ em: <em /> }}
            />
          </InlineStatus>
        </>
      )}
      {gpg && (
        <div className="panel">
          <div className="panel-head">
            <Trans
              i18nKey="profiles.signing.materialized"
              values={{ file: `${p.Slug}.gitconfig` }}
              components={{ code: <code /> }}
            />
          </div>
          <div className="panel-body">
            <Code>{`[user]\n    signingkey = ${key || t("profiles.signing.keyIdPlaceholder")}\n[gpg]\n    format = openpgp\n[commit]\n    gpgsign = true`}</Code>
          </div>
        </div>
      )}
      <SaveRow editor={editor} />
    </div>
  );
}
