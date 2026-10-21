import { Trans, useTranslation } from "react-i18next";
import type { Profile } from "../../api/bindings/Profile";
import { api } from "../../api/commands";
import { Btn, gap, Pill } from "../../components/ui";
import { t } from "../../i18n";
import {
  blank,
  DEFAULT_HOST,
  isDirty,
  mergeEdits,
  newId,
  normalizeProfile,
  providerLabel,
  relativeTime,
  slugify,
  uniqueSlug,
  withProfile,
} from "../../lib/profiles";
import { confirmSave, run, savedState } from "../../state/actions";
import { recordSsh } from "../../state/connection";
import { toast, useStore } from "../../state/store";
import { ProfileTabs } from "./Tabs";
import { HttpsTab } from "./tabs/HttpsTab";
import { IdentityTab } from "./tabs/IdentityTab";
import { RulesTab } from "./tabs/RulesTab";
import { SigningTab } from "./tabs/SigningTab";
import { SshTab } from "./tabs/SshTab";

export type Editor = {
  saved: Profile;
  current: Profile;
  dirty: boolean;
  update: (patch: Partial<Profile>) => void;
  discard: () => void;
  save: () => Promise<void>;
};

export function useEditor(saved: Profile): Editor {
  const draft = useStore((s) => s.drafts[saved.Id]);
  const setDraft = useStore((s) => s.setDraft);
  const current = draft ?? saved;
  const update = (patch: Partial<Profile>) => {
    const base = useStore.getState().drafts[saved.Id] ?? saved;
    const next = { ...base, ...patch };
    // Derivaciones automáticas: slug a partir del nombre, host por proveedor y clave de firma.
    if (patch.DisplayName !== undefined && (blank(base.Slug) || base.Slug === slugify(base.DisplayName)))
      next.Slug = slugify(patch.DisplayName);
    if (patch.Provider !== undefined && (blank(base.Host) || base.Host === DEFAULT_HOST[base.Provider]))
      next.Host = DEFAULT_HOST[patch.Provider];
    if (patch.Signing === "Ssh" && blank(base.SigningKey) && !blank(next.SshKeyPath))
      next.SigningKey = `${next.SshKeyPath}.pub`;
    setDraft(saved.Id, isDirty(saved, next) ? next : null);
  };
  return {
    saved,
    current,
    dirty: isDirty(saved, draft),
    update,
    discard: () => setDraft(saved.Id, null),
    save: () =>
      confirmSave(withProfile(savedState(), mergeEdits(saved, normalizeProfile(current))), {
        title: t("profiles.detail.saveTitle"),
        done: t("profiles.detail.saved"),
        onDone: () => setDraft(saved.Id, null),
      }),
  };
}

/** Fila «Descartar / Guardar cambios…» del diseño. */
export function SaveRow({ editor, always }: { editor: Editor; always?: boolean }) {
  const { t } = useTranslation();
  if (!always && !editor.dirty) return null;
  return (
    <div className="od-row" style={gap(8)}>
      <span className="od-fill meta">
        {editor.dirty ? (
          t("profiles.detail.unsavedNote")
        ) : (
          <Trans i18nKey="profiles.detail.globalNote" components={{ code: <code /> }} />
        )}
      </span>
      <Btn
        className="od-fixed"
        disabled={!editor.dirty}
        onClick={() => {
          editor.discard();
          toast(t("profiles.detail.discarded"), "warn");
        }}
      >
        {t("profiles.detail.discard")}
      </Btn>
      <Btn variant="primary" className="od-fixed" disabled={!editor.dirty} onClick={editor.save}>
        {t("profiles.detail.saveChanges")}
      </Btn>
    </div>
  );
}

export async function testConnection(p: Profile) {
  const r = await run(() => api.sshTestConnection(p));
  if (!r) return;
  recordSsh(p.Id, r);
  if (r.success)
    toast(
      r.account ? t("profiles.detail.connectedAs", { account: r.account }) : t("profiles.detail.connected"),
    );
  else if (r.networkError) toast(t("profiles.detail.offline"), "warn");
  else toast(t("profiles.detail.connFailed"), "err");
}

function DetailHead({ editor }: { editor: Editor }) {
  const p = editor.current;
  const saved = editor.saved;
  const conn = useStore((s) => s.conn[saved.Id]);
  const ok = conn?.result.success;
  const { t } = useTranslation();

  const makeDefault = () =>
    confirmSave(
      {
        ...savedState(),
        Profiles: savedState().Profiles.map((x) => ({ ...x, IsDefault: x.Id === saved.Id })),
      },
      {
        title: t("profiles.detail.defaultTitle", { name: saved.DisplayName }),
        note: t("profiles.detail.defaultNote"),
        done: t("profiles.detail.defaultDone", { name: saved.DisplayName }),
      },
    );

  const duplicate = () => {
    const state = savedState();
    const copy: Profile = {
      ...saved,
      Id: newId(),
      IsDefault: false,
      DisplayName: `${saved.DisplayName}${t("profiles.detail.copySuffix")}`,
      Slug: uniqueSlug(state, `${saved.Slug}-${t("profiles.detail.copySlug")}`),
      Rules: [],
    };
    return confirmSave(withProfile(state, copy), {
      title: t("profiles.detail.duplicateTitle", { name: saved.DisplayName }),
      note: t("profiles.detail.duplicateNote"),
      done: t("profiles.detail.duplicateDone", { name: copy.DisplayName }),
      onDone: () => useStore.getState().selectProfile(copy.Id),
    });
  };

  const remove = () => {
    const state = savedState();
    const rest = state.Profiles.filter((x) => x.Id !== saved.Id);
    if (saved.IsDefault && rest.length > 0 && !rest.some((x) => x.IsDefault))
      rest[0] = { ...rest[0], IsDefault: true };
    const n = saved.Rules.length;
    return confirmSave(
      { ...state, Profiles: rest },
      {
        title: t("profiles.detail.deleteTitle", { name: saved.DisplayName }),
        warn: t("profiles.detail.deleteWarn", { count: n, slug: saved.Slug }),
        note: t("profiles.detail.deleteNote"),
        applyLabel: t("profiles.detail.delete"),
        danger: true,
        done: t("profiles.detail.deleteDone", { name: saved.DisplayName }),
        onDone: () => useStore.getState().setDraft(saved.Id, null),
      },
    );
  };

  return (
    <div className="detail-head">
      <div className="od-fill od-stack" style={gap(6)}>
        <div className="detail-title">
          <h2>{p.DisplayName || t("profiles.detail.noName")}</h2>
          {saved.IsDefault && <span className="tag">{t("profiles.detail.default")}</span>}
          <span className="tag tag-neutral">{providerLabel(p.Provider)}</span>
        </div>
        <div className="od-cluster" style={gap(6)}>
          <code>{p.GitUserEmail}</code>
          {ok ? (
            <Pill tone="ok" icon="check">
              {t("profiles.detail.connectedPill", { account: conn?.result.account ?? p.Host })}
            </Pill>
          ) : conn ? (
            <Pill tone="err" icon="x">
              {t("profiles.detail.failedPill", { when: relativeTime(conn.when) })}
            </Pill>
          ) : (
            <Pill tone="neutral" icon="info">
              {t("profiles.detail.untested")}
            </Pill>
          )}
          <span className="meta od-nowrap">
            slug <code>{p.Slug}</code>
          </span>
        </div>
      </div>
      <div className="od-cluster od-fixed">
        {!saved.IsDefault && (
          <Btn size="sm" icon="star" onClick={makeDefault} title={t("profiles.detail.makeDefaultHint")}>
            <span>{t("profiles.detail.makeDefault")}</span>
          </Btn>
        )}
        <Btn size="sm" icon="duplicate" onClick={duplicate}>
          <span>{t("profiles.detail.duplicate")}</span>
        </Btn>
        <Btn size="sm" variant="danger" icon="trash" onClick={remove}>
          <span>{t("profiles.detail.delete")}</span>
        </Btn>
      </div>
    </div>
  );
}

export function ProfileDetail({ saved }: { saved: Profile }) {
  const editor = useEditor(saved);
  const tab = useStore((s) => s.tab);
  return (
    <>
      <DetailHead editor={editor} />
      <ProfileTabs rulesCount={saved.Rules.length}>
        {tab === "identidad" && <IdentityTab editor={editor} />}
        {tab === "ssh" && <SshTab editor={editor} />}
        {tab === "https" && <HttpsTab editor={editor} />}
        {tab === "firma" && <SigningTab editor={editor} />}
        {tab === "reglas" && <RulesTab editor={editor} />}
      </ProfileTabs>
    </>
  );
}
