import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { SshKeyStatus } from "../../../api/bindings/SshKeyStatus";
import type { SshKeyType } from "../../../api/bindings/SshKeyType";
import { api } from "../../../api/commands";
import { copyText, openUrl, pickFile } from "../../../api/platform";
import { Btn, Check, Code, Empty, Field, gap, InlineStatus, Seg } from "../../../components/ui";
import {
  blank,
  DEFAULT_SSH_CLIENT,
  isAzure,
  providerLabel,
  relativeTime,
  sshAlias,
  sshCommand,
  sshHost,
  sshKeysPage,
} from "../../../lib/profiles";
import { refresh, run } from "../../../state/actions";
import { toast, useStore } from "../../../state/store";
import { type Editor, SaveRow, testConnection } from "../ProfileDetail";

/** Estado de la clave: el del último refresco o, si la ruta del borrador cambió, uno recién leído. */
function useKeyStatus(id: string, keyPath: string | null): SshKeyStatus | null {
  const fromOverview = useStore((s) => s.overview?.profilesHealth.find((h) => h.id === id)?.ssh ?? null);
  const savedKey = useStore((s) => s.overview?.state.Profiles.find((p) => p.Id === id)?.SshKeyPath ?? null);
  const [fresh, setFresh] = useState<SshKeyStatus | null>(null);
  useEffect(() => {
    setFresh(null);
    if (!keyPath || keyPath === savedKey) return;
    let alive = true;
    api
      .sshKeyStatus(keyPath)
      .then((s) => alive && setFresh(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [keyPath, savedKey]);
  return keyPath && keyPath !== savedKey ? fresh : fromOverview;
}

type KeyOpts = { passphrase: boolean; keyType: SshKeyType };

const keyFile = (slug: string, t: SshKeyType) => `~/.ssh/${t === "Rsa" ? "id_rsa" : "id_ed25519"}_${slug}`;
const keygenLine = (email: string, slug: string, t: SshKeyType) =>
  `ssh-keygen ${t === "Rsa" ? "-t rsa -b 4096" : "-t ed25519"} -C ${email} -f ${keyFile(slug, t)}`;

/** Tipo de clave y passphrase; el comando se actualiza con la elección para que la vista previa sea exacta. */
function KeyOptions({
  opts,
  agentRunning,
  azure,
  email,
  slug,
}: {
  opts: KeyOpts;
  agentRunning: boolean;
  azure: boolean;
  email: string;
  slug: string;
}) {
  const [keyType, setKeyType] = useState(opts.keyType);
  const { t } = useTranslation();
  return (
    <div className="od-stack" style={gap(12)}>
      <div className="od-field" style={gap(6)}>
        <span className="label-like">{t("profiles.ssh.keyType")}</span>
        <Seg<SshKeyType>
          name="key-type"
          value={keyType}
          options={[
            { value: "Ed25519", label: "ed25519" },
            { value: "Rsa", label: "RSA 4096" },
          ]}
          onChange={(k) => {
            setKeyType(k);
            opts.keyType = k;
          }}
        />
        {azure && <span className="field-help">{t("profiles.ssh.azureRsa")}</span>}
      </div>
      <div className="od-field" style={gap(6)}>
        <span className="label-like">{t("profiles.ssh.willRun")}</span>
        <Code wrap>{keygenLine(email, slug, keyType)}</Code>
      </div>
      <PassphraseOption opts={opts} agentRunning={agentRunning} />
    </div>
  );
}

function PassphraseOption({ opts, agentRunning }: { opts: { passphrase: boolean }; agentRunning: boolean }) {
  const [v, setV] = useState(opts.passphrase);
  const { t } = useTranslation();
  return (
    <Check
      checked={v}
      onChange={(x) => {
        setV(x);
        opts.passphrase = x;
      }}
    >
      {t("profiles.ssh.passphrase")}
      {!agentRunning && v && (
        <span className="field-help" style={{ display: "block", color: "var(--warn)" }}>
          {t("profiles.ssh.passphraseNoAgent")}
        </span>
      )}
    </Check>
  );
}

export function SshTab({ editor }: { editor: Editor }) {
  const p = editor.current;
  const env = useStore((s) => s.env);
  const overview = useStore((s) => s.overview);
  const conn = useStore((s) => s.conn[p.Id]);
  const setConn = useStore((s) => s.setConn);
  const askChange = useStore((s) => s.askChange);
  const status = useKeyStatus(p.Id, p.SshKeyPath);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const client = overview?.sshClient;
  const sshClient = client ?? DEFAULT_SSH_CLIENT;
  const hasKey = !blank(p.SshKeyPath);
  const key = p.SshKeyPath ?? "";
  const agent = env?.agentState;
  const agentRunning = agent === "Running";
  const azure = isAzure(p);
  const { t } = useTranslation();

  useEffect(() => {
    setFingerprint(null);
    if (!hasKey || !status?.publicExists) return;
    api
      .sshFingerprint(key)
      .then(setFingerprint)
      .catch(() => undefined);
  }, [hasKey, key, status?.publicExists]);

  const setKey = (path: string | null) => {
    editor.update({ SshKeyPath: path });
    setConn(p.Id, null);
  };

  const createKey = () => {
    if (blank(p.Slug) || blank(p.GitUserEmail)) {
      toast(t("profiles.ssh.needSlugEmail"), "err");
      return;
    }
    const opts: KeyOpts = {
      passphrase: client?.kind === "WindowsOpenSsh" && agentRunning,
      keyType: azure ? "Rsa" : "Ed25519",
    };
    askChange({
      title: t("profiles.ssh.createTitle"),
      note: t("profiles.ssh.createNote"),
      blocks: [],
      extra: (
        <KeyOptions
          opts={opts}
          agentRunning={agentRunning}
          azure={azure}
          email={p.GitUserEmail.trim()}
          slug={p.Slug}
        />
      ),
      applyLabel: t("profiles.ssh.create"),
      onApply: async () => {
        const path = await api.sshGenerateKey(p.Slug, p.GitUserEmail.trim(), opts.passphrase, opts.keyType);
        setKey(path);
        toast(t("profiles.ssh.created"));
        askChange(null);
        setTimeout(() => offerUpload(path), 0);
      },
    });
  };

  const offerUpload = (path: string) => {
    const page = sshKeysPage(p);
    askChange({
      title: t("profiles.ssh.createdTitle"),
      note: t("profiles.ssh.createdNote"),
      blocks: [{ type: "code", label: t("profiles.ssh.newKey"), text: path }],
      warn: azure
        ? t("profiles.ssh.uploadAzure")
        : t("profiles.ssh.upload", { provider: providerLabel(p.Provider) }),
      applyLabel: page ? t("profiles.ssh.copyAndOpen") : t("profiles.ssh.copyPub"),
      onApply: async () => {
        const pub = await api.sshReadPublicKey(path);
        if (pub) await copyText(pub);
        if (page) await openUrl(page);
        toast(t("profiles.ssh.pubCopied"));
      },
    });
  };

  const importKey = async () => {
    const file = await pickFile(t("profiles.ssh.pickKey"));
    if (!file) return;
    const path = await run(() => api.sshImportKey(file));
    if (path) {
      setKey(path);
      toast(t("profiles.ssh.imported"));
    }
  };

  const reviewAcl = async () => {
    const fix = await run(() => api.sshPlanAclFix(key));
    if (!fix) return;
    askChange({
      title: t("profiles.ssh.aclTitle"),
      note: t("profiles.ssh.aclNote"),
      warn: status?.aclOk ? t("profiles.ssh.aclAlreadyOk") : undefined,
      blocks: [{ type: "cmd", lines: fix.preview }],
      applyLabel: t("profiles.ssh.aclFix"),
      onApply: async () => {
        await api.sshApplyAclFix(key);
        await refresh();
        toast(t("profiles.ssh.aclFixed"));
      },
    });
  };

  const copyPub = async () => {
    const pub = await run(() => api.sshReadPublicKey(key));
    if (!pub) {
      toast(t("profiles.ssh.noPub"), "err");
      return;
    }
    await copyText(pub);
    toast(t("profiles.ssh.pubCopied"));
  };

  const openProvider = async () => {
    const page = sshKeysPage(p);
    if (!page) {
      toast(t("profiles.ssh.genericProvider"), "warn");
      return;
    }
    await openUrl(page);
  };

  const addToAgent = () => run(() => api.sshAddToAgent(key));

  const offenders = status?.aclOffenderNames ?? [];
  const r = conn?.result;
  const mismatch =
    r?.success &&
    r.account &&
    !blank(p.HttpsUsername) &&
    r.account.toLowerCase() !== p.HttpsUsername?.toLowerCase();

  return (
    <div className="od-stack" style={gap(16)}>
      {!hasKey && (
        <Empty icon="key" title={t("profiles.ssh.emptyTitle")} text={t("profiles.ssh.emptyText")}>
          <span className="od-cluster" style={{ justifyContent: "center" }}>
            <Btn variant="primary" size="sm" icon="plus" onClick={createKey}>
              <span>{azure ? t("profiles.ssh.createRsa") : t("profiles.ssh.createEd")}</span>
            </Btn>
            <Btn size="sm" icon="folder" onClick={importKey}>
              <span>{t("profiles.ssh.importExisting")}</span>
            </Btn>
          </span>
        </Empty>
      )}

      <div className="panel">
        <div className="panel-head">{t("profiles.ssh.keyPanel")}</div>
        <div className="panel-body od-stack" style={gap(12)}>
          <Field
            id="f-sshkey"
            label={t("profiles.ssh.privateKey")}
            opt={!hasKey}
            help={<Trans i18nKey="profiles.ssh.privateHelp" components={{ code: <code /> }} />}
          >
            <input
              id="f-sshkey"
              className="input input-mono"
              value={p.SshKeyPath ?? ""}
              placeholder={keyFile(p.Slug || "<slug>", azure ? "Rsa" : "Ed25519")}
              aria-describedby="f-sshkey-help"
              onChange={(e) => setKey(e.target.value.replace(/\\/g, "/") || null)}
            />
          </Field>
          {hasKey && (
            <>
              <div className="kv-grid">
                <div className="od-stat" style={gap(4)}>
                  <span className="kv-label">{t("profiles.ssh.publicKey")}</span>
                  <code className="kv-value od-truncate">{key}.pub</code>
                </div>
                <div className="od-stat" style={gap(4)}>
                  <span className="kv-label">{t("profiles.ssh.fingerprint")}</span>
                  <code className="kv-value od-truncate">
                    {!status
                      ? "…"
                      : !status.privateExists
                        ? t("profiles.ssh.noPrivate")
                        : !status.publicExists
                          ? t("profiles.ssh.missingPub")
                          : (fingerprint ?? status.fingerprint ?? "—")}
                  </code>
                </div>
              </div>
              <div className="od-field" style={gap(6)}>
                <span className="label-like">
                  <Trans
                    i18nKey="profiles.ssh.materialized"
                    values={{ target: "core.sshCommand" }}
                    components={{ code: <code /> }}
                  />
                </span>
                <Code>{sshCommand(sshClient, key)}</Code>
                <span className="field-help">
                  <Trans i18nKey="profiles.ssh.identitiesOnly" components={{ code: <code /> }} />
                </span>
              </div>
              {status?.privateExists && (
                <InlineStatus
                  tone={status.aclOk ? "ok" : "err"}
                  action={
                    <Btn size="sm" className="od-fixed" onClick={reviewAcl}>
                      {status.aclOk ? t("profiles.ssh.reviewAcl") : t("profiles.ssh.fixAcl")}
                    </Btn>
                  }
                >
                  {status.aclOk
                    ? t("profiles.ssh.aclOk")
                    : t("profiles.ssh.aclBad", { users: offenders.join(", ") })}
                </InlineStatus>
              )}
              {client?.kind === "WindowsOpenSsh" && agent && !agentRunning && (
                <InlineStatus tone="warn">
                  {agent === "Disabled"
                    ? t("profiles.ssh.agentDisabled")
                    : agent === "NotInstalled"
                      ? t("profiles.ssh.agentNotInstalled")
                      : t("profiles.ssh.agentStopped")}
                </InlineStatus>
              )}
              <div className="od-cluster">
                <Btn icon="copy" onClick={copyPub}>
                  <span>{t("profiles.ssh.copyPub")}</span>
                </Btn>
                <Btn icon="external" onClick={openProvider}>
                  <span>{t("profiles.ssh.openKeys", { provider: providerLabel(p.Provider) })}</span>
                </Btn>
                <Btn icon="key" onClick={addToAgent}>
                  <span>{t("profiles.ssh.addToAgent")}</span>
                </Btn>
                <Btn icon="plus" onClick={createKey}>
                  <span>{t("profiles.ssh.createNew")}</span>
                </Btn>
                <Btn icon="folder" onClick={importKey}>
                  <span>{t("profiles.ssh.import")}</span>
                </Btn>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">{t("profiles.ssh.testPanel")}</div>
        <div className="panel-body od-stack" style={gap(10)}>
          <Code>
            ssh -T git@{sshHost(p)}
            {hasKey ? ` -i ${key} -o IdentitiesOnly=yes` : ""}
          </Code>
          <InlineStatus
            tone={!r ? "warn" : r.success && !mismatch ? "ok" : "err"}
            action={
              <Btn
                size="sm"
                icon="plug"
                className="od-fixed"
                disabled={!hasKey}
                onClick={() => testConnection(p)}
                busyLabel={t("profiles.ssh.testing")}
              >
                <span>{t("profiles.ssh.test")}</span>
              </Btn>
            }
          >
            {!r ? (
              t("profiles.ssh.notTested")
            ) : r.success ? (
              <>
                {r.account ? (
                  <Trans
                    i18nKey="profiles.ssh.respondsAs"
                    values={{ account: r.account }}
                    components={{ strong: <strong /> }}
                  />
                ) : (
                  t("profiles.detail.connected")
                )}{" "}
                · {relativeTime(conn.when)}
                {mismatch && t("profiles.ssh.expected", { user: p.HttpsUsername })}
              </>
            ) : (
              t("profiles.ssh.failed", { when: relativeTime(conn.when) })
            )}
          </InlineStatus>
          {!hasKey && <span className="field-help">{t("profiles.ssh.needKey")}</span>}
          {r?.hint && <InlineStatus tone="warn">{r.hint}</InlineStatus>}
          {r && r.output && <pre className="code code-output">{r.output}</pre>}
        </div>
      </div>

      {hasKey && overview?.state.Settings.GenerateSshAliases && (
        <div className="panel">
          <div className="panel-head">
            {t("profiles.ssh.aliasPanel")} <span className="meta">{t("common.optional")}</span>
          </div>
          <div className="panel-body od-stack" style={gap(10)}>
            <p className="meta">{t("profiles.ssh.aliasText")}</p>
            <Code>{`Host ${sshAlias(p)}\n    HostName ${sshHost(p)}\n    User git\n    IdentityFile ${key}\n    IdentitiesOnly yes`}</Code>
            <span className="field-help">
              <Trans i18nKey="profiles.ssh.aliasFile" components={{ code: <code /> }} />
            </span>
          </div>
        </div>
      )}
      <SaveRow editor={editor} />
    </div>
  );
}
