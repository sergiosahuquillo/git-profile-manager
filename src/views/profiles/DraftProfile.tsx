// Alta de perfil: vive como borrador hasta que se crea; nada se escribe en disco antes de la confirmación.
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { GitProvider } from "../../api/bindings/GitProvider";
import type { Profile } from "../../api/bindings/Profile";
import type { SshClientInfo } from "../../api/bindings/SshClientInfo";
import { Icon } from "../../components/Icon";
import { Btn, Code, DraftNote, Field, gap, Pill, Seg } from "../../components/ui";
import { t } from "../../i18n";
import {
  bareSshCommand,
  DEFAULT_HOST,
  DEFAULT_SSH_CLIENT,
  EMAIL_RE,
  emptyProfile,
  gitConfigValue,
  isAzure,
  normalizeProfile,
  PROVIDERS,
  SLUG_RE,
  signingProgram,
  slugify,
  sshCommand,
  withProfile,
} from "../../lib/profiles";
import { confirmSave, savedState } from "../../state/actions";
import { DRAFT_ID, type DraftProfile, toast, useStore } from "../../state/store";
import { ProfileTabs } from "./Tabs";
import { CLONE_OPTIONS } from "./tabs/IdentityTab";
import { SigningModes } from "./tabs/SigningTab";

type DraftError = { id: string; field: string; msg: string };

export function startDraft() {
  const s = useStore.getState();
  const existing = Boolean(s.newDraft);
  if (!s.newDraft) s.setNewDraft({ ...emptyProfile(), slugTouched: false, hostTouched: false });
  s.selectProfile(DRAFT_ID);
  s.goto("perfiles");
  requestAnimationFrame(() => document.getElementById("f-name")?.focus());
  if (existing) toast(t("profiles.draft.resumed"), "warn");
}

function validate(d: DraftProfile): DraftError[] {
  const profiles = useStore.getState().overview?.state.Profiles ?? [];
  const errs: DraftError[] = [];
  if (!d.DisplayName.trim())
    errs.push({
      id: "f-name",
      field: t("profiles.identity.name"),
      msg: t("profiles.draft.errName"),
    });
  if (!d.Slug.trim())
    errs.push({
      id: "f-slug",
      field: "Slug",
      msg: t("profiles.draft.errSlugEmpty"),
    });
  else if (!SLUG_RE.test(d.Slug))
    errs.push({
      id: "f-slug",
      field: "Slug",
      msg: t("profiles.draft.errSlugFormat"),
    });
  else if (d.Slug === "rules")
    errs.push({ id: "f-slug", field: "Slug", msg: t("profiles.draft.errSlugReserved") });
  else if (profiles.some((p) => p.Slug.toLowerCase() === d.Slug.toLowerCase()))
    errs.push({
      id: "f-slug",
      field: "Slug",
      msg: t("profiles.draft.errSlugTaken", { slug: d.Slug }),
    });
  if (!d.GitUserName.trim())
    errs.push({
      id: "f-user",
      field: "user.name",
      msg: t("profiles.draft.errUser"),
    });
  if (!d.GitUserEmail.trim())
    errs.push({
      id: "f-email",
      field: "user.email",
      msg: t("profiles.draft.errEmail"),
    });
  else if (!EMAIL_RE.test(d.GitUserEmail.trim()))
    errs.push({ id: "f-email", field: "user.email", msg: t("profiles.draft.errEmailFormat") });
  if (!d.Host.trim())
    errs.push({
      id: "f-host",
      field: "Host",
      msg: t("profiles.draft.errHost"),
    });
  return errs;
}

function toProfile(d: DraftProfile): Profile {
  const { slugTouched: _a, hostTouched: _b, ...p } = d;
  const signingKey =
    d.Signing === "Ssh"
      ? d.SigningKey?.trim() || `${d.SshKeyPath?.trim() || `~/.ssh/id_ed25519_${d.Slug}`}.pub`
      : d.SigningKey;
  const isFirst = (useStore.getState().overview?.state.Profiles.length ?? 0) === 0;
  return normalizeProfile({
    ...p,
    DisplayName: d.DisplayName.trim(),
    GitUserName: d.GitUserName.trim(),
    SigningKey: signingKey,
    IsDefault: isFirst,
  });
}

export function DraftDetail() {
  const d = useStore((s) => s.newDraft)!;
  const setNewDraft = useStore((s) => s.setNewDraft);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const [errors, setErrors] = useState<DraftError[]>([]);
  const [tried, setTried] = useState(false);

  const update = (patch: Partial<DraftProfile>) => {
    const next = { ...d, ...patch };
    if (patch.DisplayName !== undefined && !d.slugTouched) next.Slug = slugify(patch.DisplayName);
    if (patch.Provider !== undefined && !d.hostTouched) next.Host = DEFAULT_HOST[patch.Provider];
    setNewDraft(next);
    if (tried) setErrors(validate(next));
  };

  const discard = () => {
    setNewDraft(null);
    const first = useStore.getState().overview?.state.Profiles[0]?.Id ?? null;
    useStore.getState().selectProfile(first);
    toast(t("profiles.draft.discarded"), "warn");
  };

  const create = async () => {
    setTried(true);
    const errs = validate(d);
    setErrors(errs);
    if (errs.length) {
      const wasIdentity = tab === "identidad";
      setTab("identidad");
      requestAnimationFrame(() => document.getElementById(errs[0].id)?.focus());
      toast(wasIdentity ? t("profiles.draft.reviewFields") : t("profiles.draft.missingIdentity"), "err");
      return;
    }
    const profile = toProfile(d);
    await confirmSave(withProfile(savedState(), profile), {
      title: t("profiles.draft.createTitle", { name: profile.DisplayName }),
      note: t("profiles.draft.createNote"),
      warn: profile.IsDefault ? t("profiles.draft.firstWarn") : t("profiles.draft.noRulesWarn"),
      applyLabel: t("profiles.create"),
      done: t("profiles.draft.created", { name: profile.DisplayName }),
      onDone: () => {
        setNewDraft(null);
        useStore.getState().selectProfile(profile.Id, profile.IsDefault ? "identidad" : "reglas");
      },
    });
  };

  const err = (id: string) => errors.find((e) => e.id === id)?.msg ?? null;
  useTranslation();

  return (
    <>
      <div className="detail-head">
        <div className="od-fill od-stack" style={gap(6)}>
          <div className="detail-title">
            <h2>{d.DisplayName.trim() ? d.DisplayName : t("profiles.newProfile")}</h2>
            <Pill tone="neutral" icon="pen">
              {t("profiles.unsaved")}
            </Pill>
          </div>
          <span className="meta">{t("profiles.draft.intro")}</span>
        </div>
        <div className="od-cluster od-fixed">
          <Btn size="sm" icon="x" onClick={discard}>
            <span>{t("profiles.detail.discard")}</span>
          </Btn>
          <Btn size="sm" variant="primary" icon="check" onClick={create}>
            <span>{t("profiles.draft.createEllipsis")}</span>
          </Btn>
        </div>
      </div>
      <ProfileTabs rulesCount={0}>
        {tab === "identidad" && <DraftIdentity d={d} update={update} errors={errors} err={err} />}
        {tab === "ssh" && <DraftSsh d={d} update={update} />}
        {tab === "https" && <DraftHttps d={d} update={update} />}
        {tab === "firma" && <DraftSigning d={d} update={update} />}
        {tab === "reglas" && <DraftRules d={d} />}
      </ProfileTabs>
    </>
  );
}

type TabProps = { d: DraftProfile; update: (p: Partial<DraftProfile>) => void };

function DraftIdentity({
  d,
  update,
  errors,
  err,
}: TabProps & { errors: DraftError[]; err: (id: string) => string | null }) {
  const inv = (id: string) => (err(id) ? " is-invalid" : "");
  const { t } = useTranslation();
  return (
    <div className="panel">
      <div className="panel-body od-stack" style={gap(16)}>
        {errors.length > 0 && (
          <div className="banner banner-danger" style={{ margin: 0 }} role="alert">
            <Icon name="alert" />
            <div className="od-fill od-stack" style={gap(4)}>
              <strong>{t("profiles.draft.missing", { count: errors.length })}</strong>
              <ul className="err-list" role="list">
                {errors.map((e) => (
                  <li key={e.id + e.msg}>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => {
                        const el = document.getElementById(e.id);
                        el?.scrollIntoView({ block: "center", behavior: "smooth" });
                        el?.focus();
                      }}
                    >
                      {e.field}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <div className="kv-grid">
          <Field id="f-name" label={t("profiles.identity.name")} req err={err("f-name")}>
            <input
              id="f-name"
              className={`input${inv("f-name")}`}
              value={d.DisplayName}
              placeholder={t("profiles.identity.namePlaceholder")}
              autoComplete="off"
              aria-invalid={Boolean(err("f-name")) || undefined}
              onChange={(e) => update({ DisplayName: e.target.value })}
            />
          </Field>
          <Field
            id="f-slug"
            label="Slug"
            req
            err={err("f-slug")}
            help={<Trans i18nKey="profiles.draft.slugHelp" components={{ code: <code /> }} />}
          >
            <input
              id="f-slug"
              className={`input input-mono${inv("f-slug")}`}
              value={d.Slug}
              placeholder={t("profiles.draft.slugPlaceholder")}
              autoComplete="off"
              aria-invalid={Boolean(err("f-slug")) || undefined}
              onChange={(e) => update({ Slug: e.target.value, slugTouched: true })}
            />
          </Field>
          <Field id="f-user" label="user.name" req err={err("f-user")}>
            <input
              id="f-user"
              className={`input${inv("f-user")}`}
              value={d.GitUserName}
              placeholder="Alex Romero"
              autoComplete="off"
              aria-invalid={Boolean(err("f-user")) || undefined}
              onChange={(e) => update({ GitUserName: e.target.value })}
            />
          </Field>
          <Field id="f-email" label="user.email" req err={err("f-email")}>
            <input
              id="f-email"
              className={`input${inv("f-email")}`}
              type="email"
              value={d.GitUserEmail}
              placeholder={t("profiles.draft.emailPlaceholder")}
              autoComplete="off"
              aria-invalid={Boolean(err("f-email")) || undefined}
              onChange={(e) => update({ GitUserEmail: e.target.value })}
            />
          </Field>
          <Field
            id="f-provider"
            label={t("profiles.identity.provider")}
            help={t("profiles.draft.providerHelp")}
          >
            <select
              id="f-provider"
              className="input"
              value={d.Provider}
              onChange={(e) => update({ Provider: e.target.value as GitProvider })}
            >
              {PROVIDERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="f-host" label="Host" req err={err("f-host")} help={t("profiles.draft.hostHelp")}>
            <input
              id="f-host"
              className={`input input-mono${inv("f-host")}`}
              value={d.Host}
              placeholder="github.com"
              autoComplete="off"
              aria-invalid={Boolean(err("f-host")) || undefined}
              onChange={(e) => update({ Host: e.target.value, hostTouched: true })}
            />
          </Field>
          <div className="od-field" style={gap(6)}>
            <span className="label-like" id="l-clone">
              {t("profiles.identity.cloneMethod")}
            </span>
            <Seg
              name="pclone"
              value={d.PreferredCloneMethod}
              options={CLONE_OPTIONS}
              labelledBy="l-clone"
              onChange={(v) => update({ PreferredCloneMethod: v })}
            />
            <span className="field-help">{t("profiles.identity.cloneHelp")}</span>
          </div>
        </div>
        <DraftNote>
          <Trans i18nKey="profiles.draft.identityNote" components={{ code: <code />, strong: <strong /> }} />
        </DraftNote>
      </div>
    </div>
  );
}

function DraftSsh({ d, update }: TabProps) {
  const client = useStore((s) => s.overview?.sshClient) ?? DEFAULT_SSH_CLIENT;
  const placeholder = `~/.ssh/${isAzure(d) ? "id_rsa" : "id_ed25519"}_${d.Slug || "<slug>"}`;
  const key = d.SshKeyPath ?? "";
  const { t } = useTranslation();
  return (
    <div className="od-stack" style={gap(16)}>
      <div className="panel">
        <div className="panel-head">
          {t("profiles.ssh.keyPanel")} <span className="meta">{t("common.optional")}</span>
        </div>
        <div className="panel-body od-stack" style={gap(12)}>
          <Field
            id="f-sshkey"
            label={t("profiles.draft.keyPath")}
            opt
            help={<Trans i18nKey="profiles.draft.keyPathHelp" components={{ code: <code /> }} />}
          >
            <input
              id="f-sshkey"
              className="input input-mono"
              value={key}
              placeholder={placeholder}
              autoComplete="off"
              onChange={(e) => update({ SshKeyPath: e.target.value || null })}
            />
          </Field>
          <div className="od-field" style={gap(6)}>
            <span className="label-like">
              <Trans
                i18nKey="profiles.draft.willMaterialize"
                values={{ target: "core.sshCommand" }}
                components={{ code: <code /> }}
              />
            </span>
            <Code wrap>{key.trim() ? sshCommand(client, key) : t("profiles.draft.noKey")}</Code>
          </div>
          <div className="od-cluster">
            <Btn icon="plus" disabled>
              <span>{t("profiles.draft.createKey")}</span>
            </Btn>
            <Btn icon="folder" disabled>
              <span>{t("profiles.ssh.importExisting")}</span>
            </Btn>
            <Btn icon="plug" disabled>
              <span>{t("profiles.ssh.test")}</span>
            </Btn>
          </div>
          <DraftNote>{t("profiles.draft.sshNote")}</DraftNote>
        </div>
      </div>
    </div>
  );
}

function DraftHttps({ d, update }: TabProps) {
  const { t } = useTranslation();
  return (
    <div className="od-stack" style={gap(16)}>
      <div className="panel">
        <div className="panel-head">{t("profiles.https.accountPanel")}</div>
        <div className="panel-body od-stack" style={gap(12)}>
          <Field
            id="f-https"
            label={t("profiles.https.user")}
            opt
            help={<Trans i18nKey="profiles.https.userHelp" components={{ code: <code /> }} />}
          >
            <input
              id="f-https"
              className="input input-mono"
              value={d.HttpsUsername ?? ""}
              placeholder={t("profiles.https.userPlaceholder")}
              autoComplete="off"
              onChange={(e) => update({ HttpsUsername: e.target.value || null })}
            />
          </Field>
          <Field
            id="f-checkrepo"
            label={t("profiles.https.checkRepo")}
            opt
            help={<Trans i18nKey="profiles.https.checkRepoDraftHelp" components={{ code: <code /> }} />}
          >
            <input
              id="f-checkrepo"
              className="input input-mono"
              value={d.HttpsCheckRepoUrl ?? ""}
              autoComplete="off"
              placeholder={t("profiles.https.repoPlaceholder", { host: d.Host || "github.com" })}
              onChange={(e) => update({ HttpsCheckRepoUrl: e.target.value || null })}
            />
          </Field>
          <div className="od-field" style={gap(6)}>
            <span className="label-like">{t("profiles.draft.willMaterializePlain")}</span>
            <Code>{`[credential "https://${d.Host || "<host>"}"]\n    username = ${d.HttpsUsername || t("profiles.https.unset")}`}</Code>
          </div>
          <div className="od-cluster">
            <Btn icon="external" disabled>
              <span>{t("profiles.https.providerFlow")}</span>
            </Btn>
            <Btn icon="key" disabled>
              <span>{t("profiles.draft.pasteToken")}</span>
            </Btn>
          </div>
          <DraftNote>{t("profiles.draft.httpsNote")}</DraftNote>
        </div>
      </div>
    </div>
  );
}

function DraftSigning({ d, update }: TabProps) {
  const ssh = d.Signing === "Ssh";
  const gpg = d.Signing === "Gpg";
  const { t } = useTranslation();
  return (
    <div className="od-stack" style={gap(16)}>
      <div className="panel">
        <div className="panel-head">{t("profiles.signing.mode")}</div>
        <div className="panel-body od-stack" style={gap(12)}>
          <SigningModes value={d.Signing} onChange={(v) => update({ Signing: v })} initialTag />
          {ssh && (
            <>
              <Field id="f-signkey" label={t("profiles.signing.key")} help={t("profiles.signing.keyHelp")}>
                <input
                  id="f-signkey"
                  className="input input-mono"
                  value={d.SigningKey ?? ""}
                  autoComplete="off"
                  placeholder={`${d.SshKeyPath || `~/.ssh/id_ed25519_${d.Slug || "<slug>"}`}.pub`}
                  onChange={(e) => update({ SigningKey: e.target.value || null })}
                />
              </Field>
              <DraftNote>{t("profiles.signing.githubReminder")}</DraftNote>
            </>
          )}
          {gpg && (
            <Field
              id="f-signkey"
              label={t("profiles.signing.gpgKey")}
              help={t("profiles.signing.gpgKeyDraftHelp")}
            >
              <input
                id="f-signkey"
                className="input input-mono"
                value={d.SigningKey ?? ""}
                autoComplete="off"
                placeholder="ABCDEF0123456789"
                onChange={(e) => update({ SigningKey: e.target.value || null })}
              />
            </Field>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftRules({ d }: { d: DraftProfile }) {
  const client = useStore((s) => s.overview?.sshClient) ?? DEFAULT_SSH_CLIENT;
  const gitProfilesDir = useStore((s) => s.overview?.paths.gitProfilesDir);
  const has = d.DisplayName.trim() || d.GitUserEmail.trim() || (d.SshKeyPath ?? "").trim();
  const p = toPreview(d, client, signingProgram(client, gitProfilesDir));
  const { t } = useTranslation();
  return (
    <div className="od-stack" style={gap(16)}>
      <div className="panel">
        <div className="panel-head od-row">
          <span className="od-fill">{t("rules.tab.title")}</span>
          <Btn size="sm" icon="plus" className="od-fixed" disabled>
            <span>{t("rules.tab.add")}</span>
          </Btn>
        </div>
        <div className="panel-body od-stack" style={gap(12)}>
          <div className="empty">
            <Icon name="rules" className="icon icon-24" />
            <span className="empty-title">{t("profiles.draft.rulesEmptyTitle")}</span>
            <span className="empty-text">{t("profiles.draft.rulesEmptyText")}</span>
          </div>
          <DraftNote>
            <Trans i18nKey="profiles.draft.rulesNote" components={{ code: <code /> }} />
          </DraftNote>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <Trans
            i18nKey="rules.tab.preview"
            values={{ file: `~/.gitprofiles/${d.Slug || "<slug>"}.gitconfig` }}
            components={{ code: <code /> }}
          />
        </div>
        <div className="panel-body">
          <pre className="code">{has ? p : t("profiles.draft.previewEmpty")}</pre>
        </div>
      </div>
    </div>
  );
}

/** Vista previa aproximada del fichero del perfil antes de crearlo (el exacto se muestra al confirmar). */
function toPreview(d: DraftProfile, client: SshClientInfo, keygen: string): string {
  const isFirst = (useStore.getState().overview?.state.Profiles.length ?? 0) === 0;
  const lines = [
    "# Generated by GitProfile Manager. Do not edit by hand.",
    `# Profile: ${d.DisplayName}`,
    "[user]",
    `\tname = ${d.GitUserName || "<user.name>"}`,
    `\temail = ${d.GitUserEmail || "<user.email>"}`,
  ];
  const signKey =
    d.Signing === "Ssh"
      ? d.SigningKey || `${d.SshKeyPath || `~/.ssh/id_ed25519_${d.Slug || "<slug>"}`}.pub`
      : d.SigningKey;
  if (d.Signing !== "None" && signKey) lines.push(`\tsigningkey = ${signKey}`);
  if (d.SshKeyPath?.trim())
    lines.push("[core]", `\tsshCommand = ${gitConfigValue(sshCommand(client, d.SshKeyPath.trim()))}`);
  else if (!isFirst) lines.push("[core]", `\tsshCommand = ${gitConfigValue(bareSshCommand(client))}`);
  if (d.HttpsUsername?.trim())
    lines.push(`[credential "https://${d.Host}"]`, `\tusername = ${d.HttpsUsername.trim()}`);
  if (d.Signing === "Ssh")
    lines.push(
      "[gpg]",
      "\tformat = ssh",
      '[gpg "ssh"]',
      `\tprogram = ${keygen}`,
      "\tallowedSignersFile = ~/.gitprofiles/allowed_signers",
      "[commit]",
      "\tgpgsign = true",
    );
  else if (d.Signing === "Gpg" && signKey)
    lines.push("[gpg]", "\tformat = openpgp", "[commit]", "\tgpgsign = true");
  else if (!isFirst) lines.push("[gpg]", "\tformat = openpgp", "[commit]", "\tgpgsign = false");
  return lines.join("\n");
}
