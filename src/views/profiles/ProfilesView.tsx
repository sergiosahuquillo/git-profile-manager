import { useTranslation } from "react-i18next";
import type { Profile } from "../../api/bindings/Profile";
import { api } from "../../api/commands";
import { Icon } from "../../components/Icon";
import { Btn, Empty } from "../../components/ui";
import { t as tr } from "../../i18n";
import { type Cap, httpsCap, isDirty, signCap, sshCap } from "../../lib/profiles";
import { GlobalBanners } from "../../shell/Shell";
import { run } from "../../state/actions";
import { DRAFT_ID, NO_PROFILES, useStore } from "../../state/store";
import { DraftDetail, startDraft } from "./DraftProfile";
import { ProfileDetail } from "./ProfileDetail";

const CAP_CLS = { ok: "cap-ok", warn: "cap-warn", err: "cap-err", off: "cap-off" } as const;
const CAP_ICON = { ok: "check", warn: "alert", err: "x", off: "info" } as const;

export function CapPill({ label, cap }: { label: string; cap: Cap }) {
  const { t } = useTranslation();
  return (
    <span className={`cap ${CAP_CLS[cap.state]}`} title={cap.text}>
      <Icon name={CAP_ICON[cap.state]} />
      <span>{label}</span>
      <span className="sr-only">: {t(`profiles.capWord.${cap.state}`)}</span>
    </span>
  );
}

function ProfileRow({ p }: { p: Profile }) {
  const selected = useStore((s) => s.profileId === p.Id);
  const draft = useStore((s) => s.drafts[p.Id]);
  const health = useStore((s) => s.overview?.profilesHealth.find((h) => h.id === p.Id));
  const conn = useStore((s) => s.conn[p.Id]);
  const cred = useStore((s) => s.cred[p.Id]);
  const selectProfile = useStore((s) => s.selectProfile);
  const { t } = useTranslation();
  const dirty = isDirty(p, draft);
  return (
    <li>
      <button
        type="button"
        className="profile-item"
        aria-current={selected}
        onClick={() => selectProfile(p.Id)}
      >
        <span>
          <span className="profile-name od-truncate">{p.DisplayName}</span>
          <span className="profile-mail od-truncate">{p.GitUserEmail}</span>
          <span className="profile-caps">
            <CapPill label="SSH" cap={sshCap(p, health, conn)} />
            <CapPill label="HTTPS" cap={httpsCap(p, cred)} />
            <CapPill label={t("profiles.signingLabel")} cap={signCap(p, health)} />
            {dirty && (
              <span className="cap cap-off">
                <Icon name="pen" />
                <span>{t("profiles.unsaved")}</span>
              </span>
            )}
          </span>
        </span>
        {p.IsDefault ? (
          <span className="default-star">
            <Icon name="star" />
            <span className="sr-only">{t("profiles.defaultProfile")}</span>
          </span>
        ) : (
          <span />
        )}
      </button>
    </li>
  );
}

function DraftRow() {
  const d = useStore((s) => s.newDraft);
  const selected = useStore((s) => s.profileId === DRAFT_ID);
  const selectProfile = useStore((s) => s.selectProfile);
  const { t } = useTranslation();
  if (!d) return null;
  return (
    <li>
      <button
        type="button"
        className="profile-item is-draft"
        aria-current={selected}
        onClick={() => selectProfile(DRAFT_ID)}
      >
        <span>
          <span className="profile-name od-truncate">
            {d.DisplayName.trim() ? d.DisplayName : t("profiles.newProfile")}
          </span>
          <span className="profile-mail od-truncate">
            {d.GitUserEmail.trim() ? d.GitUserEmail : t("profiles.noIdentityYet")}
          </span>
          <span className="profile-caps">
            <span className="cap cap-off">
              <Icon name="pen" />
              <span>{t("profiles.unsaved")}</span>
            </span>
          </span>
        </span>
        <span />
      </button>
    </li>
  );
}

export async function showGeneratedFiles() {
  const o = useStore.getState().overview;
  if (!o) return;
  const files = await run(() => api.previewGenerated(o.state));
  if (!files) return;
  useStore.getState().askChange({
    title: tr("profiles.generatedTitle"),
    note: tr("profiles.generatedNote"),
    readOnly: true,
    blocks: files.map((f) => ({
      type: "code",
      label: <code>{f.displayPath}</code>,
      text: f.content.replace(/\n$/, ""),
    })),
  });
}

export function ProfilesView() {
  const profiles = useStore((s) => s.overview?.state.Profiles ?? NO_PROFILES);
  const profileId = useStore((s) => s.profileId);
  const newDraft = useStore((s) => s.newDraft);
  const current = profiles.find((p) => p.Id === profileId);
  const { t } = useTranslation();

  return (
    <section className="view" id="view-perfiles" aria-labelledby="h-perfiles">
      <div className="view-head">
        <div className="od-fill">
          <h1 id="h-perfiles">{t("profiles.title")}</h1>
          <p className="view-sub">{t("profiles.sub")}</p>
        </div>
        <div className="od-cluster od-fixed">
          <Btn icon="file-code" onClick={showGeneratedFiles}>
            <span>{t("profiles.showFiles")}</span>
          </Btn>
          <Btn variant="primary" icon="plus" onClick={startDraft}>
            <span>{t("profiles.newProfile")}</span>
          </Btn>
        </div>
      </div>

      <GlobalBanners />

      {profiles.length === 0 && !newDraft ? (
        <Empty icon="person" title={t("profiles.emptyTitle")} text={t("profiles.emptyText")}>
          <Btn variant="primary" size="sm" icon="plus" onClick={startDraft}>
            <span>{t("profiles.create")}</span>
          </Btn>
        </Empty>
      ) : (
        <div className="split">
          <div className="panel panel-list">
            <div className="panel-head od-row">
              <span className="od-fill">{t("profiles.title")}</span>
              <span className="meta od-nowrap">{t("profiles.listOrder")}</span>
            </div>
            <ul className="profile-list" id="profile-list" role="list">
              {profiles.map((p) => (
                <ProfileRow key={p.Id} p={p} />
              ))}
              <DraftRow />
            </ul>
          </div>
          <div id="profile-detail" className="profile-detail">
            {profileId === DRAFT_ID && newDraft ? (
              <DraftDetail />
            ) : current ? (
              <ProfileDetail key={current.Id} saved={current} />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
