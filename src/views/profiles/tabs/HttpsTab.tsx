import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { Profile } from "../../../api/bindings/Profile";
import type { StoredAccount } from "../../../api/bindings/StoredAccount";
import { api } from "../../../api/commands";
import { Icon } from "../../../components/Icon";
import { Btn, Code, Field, gap, InlineStatus } from "../../../components/ui";
import { blank, isAzure, providerLabel, relativeTime } from "../../../lib/profiles";
import { run } from "../../../state/actions";
import { recordCred } from "../../../state/connection";
import { toast, useStore } from "../../../state/store";
import { type Editor, SaveRow } from "../ProfileDetail";

function setCred(p: Profile, valid: boolean, message: string) {
  useStore.getState().setCred(p.Id, { valid, message, when: new Date() });
}

export function HttpsTab({ editor }: { editor: Editor }) {
  const p = editor.current;
  const env = useStore((s) => s.env);
  const cred = useStore((s) => s.cred[p.Id]);
  const askChange = useStore((s) => s.askChange);
  const [token, setToken] = useState("");
  const [tokenErr, setTokenErr] = useState(false);
  const [accounts, setAccounts] = useState<StoredAccount[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const user = p.HttpsUsername ?? "";
  const gcm = env?.gcm;
  const { t } = useTranslation();
  const code = { code: <code /> };

  useEffect(() => {
    setAccounts(null);
    if (blank(p.Host)) return;
    let alive = true;
    api
      .credentialSavedAccounts(p.Host)
      .then((a) => alive && setAccounts(a))
      .catch(() => alive && setAccounts([]));
    return () => {
      alive = false;
    };
  }, [p.Host]);

  const setUser = (v: string) => {
    editor.update({ HttpsUsername: v || null });
    useStore.getState().setCred(p.Id, null);
  };

  const check = async () => {
    const r = await run(() => api.credentialCheck(p));
    if (!r) return;
    recordCred(p.Id, r);
    setResult(r.message);
    toast(
      r.valid ? t("profiles.https.validFor", { host: p.Host }) : r.message,
      r.valid ? "ok" : r.networkError ? "warn" : "err",
    );
  };

  const providerFlow = async () => {
    const r = await run(() => api.credentialProviderFlow(p));
    if (!r) return;
    if (r.valid) setCred(p, true, r.message);
    setResult(r.message);
    toast(r.message, r.valid ? "ok" : "err");
  };

  const saveToken = async () => {
    if (!token.trim()) {
      setTokenErr(true);
      document.getElementById("f-token")?.focus();
      toast(t("profiles.https.pasteToken"), "err");
      return;
    }
    if (blank(user)) {
      toast(t("profiles.https.needUserToken"), "err");
      return;
    }
    setTokenErr(false);
    const value = token;
    setToken("");
    const ok = await run(() => api.credentialApprove(p.Host, user, value));
    if (ok === undefined) return;
    setResult(t("profiles.https.tokenSent"));
    toast(t("profiles.https.tokenToast"));
  };

  const relogin = async (username: string) => {
    if (blank(username)) {
      toast(t("profiles.https.needUserRelogin"), "err");
      return;
    }
    const preview = await run(() => api.credentialDescribeRelogin(p, username));
    if (preview === undefined) return;
    askChange({
      title: t("profiles.https.reloginTitle", { user: username }),
      note: t("profiles.https.reloginNote"),
      blocks: [{ type: "cmd", lines: preview.split("\n") }],
      applyLabel: t("profiles.https.signIn"),
      onApply: async () => {
        const r = await api.credentialRelogin(p, username);
        if (r.valid) setCred(p, true, r.message);
        setResult(r.message);
        toast(r.message, r.valid ? "ok" : "err");
      },
    });
  };

  const reject = () => {
    if (blank(user)) {
      toast(t("profiles.https.needUserReject"), "err");
      return;
    }
    askChange({
      title: t("profiles.https.rejectTitle"),
      note: t("profiles.https.rejectNote"),
      blocks: [
        {
          type: "cmd",
          lines: [`git credential reject   (protocol=https, host=${p.Host}, username=${user})`],
        },
      ],
      applyLabel: t("profiles.https.delete"),
      danger: true,
      onApply: async () => {
        await api.credentialReject(p.Host, user);
        useStore.getState().setCred(p.Id, null);
        setResult(t("profiles.https.rejected"));
        toast(t("profiles.https.rejectToast"), "warn");
      },
    });
  };

  const st = cred?.valid === true ? "ok" : cred?.valid === false ? "err" : "warn";

  return (
    <div className="od-stack" style={gap(16)}>
      {gcm && !gcm.installed && <InlineStatus tone="err">{t("profiles.https.gcmMissing")}</InlineStatus>}
      {gcm?.installed && !gcm.configuredAsHelper && (
        <InlineStatus tone="err">
          <Trans
            i18nKey="profiles.https.gcmNotHelper"
            values={{ helpers: gcm.helpers.length ? gcm.helpers.join(", ") : t("profiles.https.none") }}
            components={code}
          />
        </InlineStatus>
      )}

      <div className="panel">
        <div className="panel-head">{t("profiles.https.accountPanel")}</div>
        <div className="panel-body od-stack" style={gap(12)}>
          <Field
            id="f-https"
            label={t("profiles.https.user")}
            opt
            help={<Trans i18nKey="profiles.https.userHelp" components={code} />}
          >
            <input
              id="f-https"
              className="input input-mono"
              value={user}
              placeholder={t("profiles.https.userPlaceholder")}
              aria-describedby="f-https-help"
              onChange={(e) => setUser(e.target.value)}
            />
          </Field>
          <div className="od-field" style={gap(6)}>
            <span className="label-like">{t("profiles.https.saved")}</span>
            {accounts === null ? (
              <span className="field-help">{t("profiles.https.searching", { host: p.Host })}</span>
            ) : accounts.length === 0 ? (
              <span className="field-help">{t("profiles.https.noAccounts", { host: p.Host })}</span>
            ) : (
              <>
                <div className="account-chips">
                  {accounts.map((a) => (
                    <span className="account-chip" key={a.username}>
                      <button
                        type="button"
                        className={`btn btn-sm ${a.username === user ? "btn-accent" : "btn-default"}`}
                        title={
                          a.source === "GCM"
                            ? t("profiles.https.listedByGcm")
                            : t("profiles.https.windowsStore")
                        }
                        onClick={() => setUser(a.username)}
                      >
                        {a.username}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-default"
                        title={t("profiles.https.reloginWith", { user: a.username })}
                        onClick={() => relogin(a.username)}
                      >
                        <Icon name="sync" />
                        <span className="sr-only">
                          {t("profiles.https.reloginWith", { user: a.username })}
                        </span>
                      </button>
                    </span>
                  ))}
                </div>
                <span className="field-help">{t("profiles.https.accountsHelp")}</span>
              </>
            )}
          </div>
          <Field
            id="f-checkrepo"
            label={t("profiles.https.checkRepo")}
            help={
              <Trans
                i18nKey="profiles.https.checkRepoHelp"
                values={{ host: p.Host || "<host>" }}
                components={code}
              />
            }
          >
            <input
              id="f-checkrepo"
              className="input input-mono"
              value={p.HttpsCheckRepoUrl ?? ""}
              placeholder={
                isAzure(p)
                  ? t("profiles.https.repoPlaceholderAzure")
                  : t("profiles.https.repoPlaceholder", { host: p.Host || "github.com" })
              }
              aria-describedby="f-checkrepo-help"
              onChange={(e) => editor.update({ HttpsCheckRepoUrl: e.target.value || null })}
            />
          </Field>
          <div className="od-field" style={gap(6)}>
            <span className="label-like">{t("profiles.https.materialized")}</span>
            <Code>{`[credential "https://${p.Host}"]\n    username = ${user || t("profiles.https.unset")}`}</Code>
          </div>
          <InlineStatus
            tone={st}
            action={
              <Btn
                size="sm"
                icon="sync"
                className="od-fixed"
                onClick={check}
                busyLabel={t("common.checking")}
              >
                <span>{t("common.check")}</span>
              </Btn>
            }
          >
            {cred?.valid === true ? (
              <Trans
                i18nKey="profiles.https.validRich"
                values={{ host: p.Host, when: relativeTime(cred.when) }}
                components={code}
              />
            ) : cred?.valid === false ? (
              <Trans
                i18nKey="profiles.https.invalidRich"
                values={{ message: cred.message }}
                components={code}
              />
            ) : blank(user) ? (
              t("profiles.https.noUser")
            ) : (
              t("profiles.https.unchecked")
            )}
          </InlineStatus>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">{t("profiles.https.signupPanel")}</div>
        <div className="panel-body od-stack" style={gap(12)}>
          <p className="meta">{t("profiles.https.secretNote")}</p>
          <div className="choice-set">
            <div className="choice" style={{ cursor: "default" }}>
              <span>
                <Icon name="external" />
              </span>
              <span className="choice-body">
                <span className="choice-title">
                  {t("profiles.https.providerFlow")}{" "}
                  <span className="tag">{t("profiles.https.recommended")}</span>
                </span>
                <span className="choice-help">
                  <Trans i18nKey="profiles.https.providerFlowHelp" components={code} />
                </span>
                <span style={{ marginBlockStart: 8 }}>
                  <Btn
                    variant="primary"
                    size="sm"
                    onClick={providerFlow}
                    busyLabel={t("profiles.https.waitingGcm")}
                  >
                    {t("profiles.https.startFlow", { provider: providerLabel(p.Provider) })}
                  </Btn>
                </span>
              </span>
            </div>
            <div className="choice" style={{ cursor: "default" }}>
              <span>
                <Icon name="key" />
              </span>
              <span className="choice-body">
                <span className="choice-title">{t("profiles.https.tokenTitle")}</span>
                <span className="choice-help">
                  <Trans i18nKey="profiles.https.tokenHelp" components={code} />
                </span>
                <span className="od-row" style={{ ...gap(8), marginBlockStart: 8 }}>
                  <input
                    type="password"
                    className={`input od-fill${tokenErr ? " is-invalid" : ""}`}
                    id="f-token"
                    placeholder={t("profiles.https.tokenPlaceholder")}
                    autoComplete="off"
                    aria-label={t("profiles.https.tokenLabel")}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <Btn className="od-fixed" onClick={saveToken}>
                    {t("profiles.https.saveGcm")}
                  </Btn>
                </span>
              </span>
            </div>
          </div>
          <div className="od-cluster">
            <Btn size="sm" icon="sync" onClick={() => relogin(user)}>
              <span>{t("profiles.https.relogin")}</span>
            </Btn>
            <Btn size="sm" variant="danger" icon="trash" onClick={reject}>
              <span>{t("profiles.https.deleteCred")}</span>
            </Btn>
          </div>
          {result && <InlineStatus tone="muted">{result}</InlineStatus>}
        </div>
      </div>
      <SaveRow editor={editor} />
    </div>
  );
}
