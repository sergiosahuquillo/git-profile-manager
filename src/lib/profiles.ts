// Lógica de presentación de perfiles y reglas. Replica en TS lo imprescindible del núcleo (condiciones,
// orden de reglas, estado de cada perfil) para pintar sin ir y venir al backend.
import type { AppState } from "../api/bindings/AppState";
import type { ConnectionTestResult } from "../api/bindings/ConnectionTestResult";
import type { GitProvider } from "../api/bindings/GitProvider";
import type { Profile } from "../api/bindings/Profile";
import type { ProfileHealth } from "../api/bindings/ProfileHealth";
import type { Rule } from "../api/bindings/Rule";
import type { SshClientInfo } from "../api/bindings/SshClientInfo";
import { dateLocale, t } from "../i18n";

export const PROVIDERS: { value: GitProvider; label: string }[] = [
  { value: "GitHub", label: "GitHub" },
  { value: "GitLab", label: "GitLab" },
  { value: "Bitbucket", label: "Bitbucket" },
  { value: "AzureDevOps", label: "Azure DevOps" },
  {
    value: "Other",
    get label() {
      return t("common.providerOther");
    },
  },
];

export const providerLabel = (p: GitProvider) => PROVIDERS.find((x) => x.value === p)?.label ?? p;

export const DEFAULT_HOST: Record<GitProvider, string> = {
  GitHub: "github.com",
  GitLab: "gitlab.com",
  Bitbucket: "bitbucket.org",
  AzureDevOps: "dev.azure.com",
  Other: "",
};

export function sshKeysPage(p: Profile): string | null {
  switch (p.Provider) {
    case "GitHub":
      return `https://${p.Host}/settings/keys`;
    case "GitLab":
      return `https://${p.Host}/-/user_settings/ssh_keys`;
    case "Bitbucket":
      return "https://bitbucket.org/account/settings/ssh-keys/";
    case "AzureDevOps": {
      // La página de claves cuelga de una organización: se usa la de la primera regla de organización.
      const org = p.Rules.find((r) => r.Type === "Remote")
        ?.Value.split("/")[0]
        ?.trim();
      return org ? `https://dev.azure.com/${org}/_usersSettings/keys` : "https://dev.azure.com/";
    }
    default:
      return null;
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Igual que `make_slug` del núcleo: sin acentos, `a-z0-9` y guiones, máximo 40. */
export function slugify(s: string): string {
  const slug = s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 40 ? slug.slice(0, 40).replace(/^-+|-+$/g, "") : slug;
}

export const blank = (s: string | null | undefined) => !s || s.trim() === "";

export function newId(): string {
  return crypto.randomUUID();
}

export function emptyProfile(): Profile {
  return {
    Id: newId(),
    DisplayName: "",
    Slug: "",
    Provider: "GitHub",
    Host: "github.com",
    GitUserName: "",
    GitUserEmail: "",
    SshKeyPath: null,
    HttpsUsername: null,
    HttpsCheckRepoUrl: null,
    Signing: "None",
    SigningKey: null,
    Rules: [],
    IsDefault: false,
    PreferredCloneMethod: "Ssh",
  };
}

/** Campos que se editan en las pestañas del perfil (las reglas y el «por defecto» van aparte). */
export const EDITABLE: (keyof Profile)[] = [
  "DisplayName",
  "Slug",
  "Provider",
  "Host",
  "GitUserName",
  "GitUserEmail",
  "SshKeyPath",
  "HttpsUsername",
  "HttpsCheckRepoUrl",
  "Signing",
  "SigningKey",
  "PreferredCloneMethod",
];

export function mergeEdits(saved: Profile, draft: Profile): Profile {
  const out = { ...saved } as Record<string, unknown>;
  for (const k of EDITABLE) out[k] = draft[k];
  return out as Profile;
}

export function isDirty(saved: Profile, draft: Profile | undefined): boolean {
  if (!draft) return false;
  return EDITABLE.some((k) => (saved[k] ?? null) !== (draft[k] ?? null));
}

/** Normaliza lo que escribe el usuario en cada campo antes de guardarlo. */
export function normalizeProfile(p: Profile): Profile {
  const opt = (v: string | null) => (v == null || v.trim() === "" ? null : v.trim());
  return {
    ...p,
    Host: p.Host.trim(),
    GitUserEmail: p.GitUserEmail.trim(),
    SshKeyPath: opt(p.SshKeyPath)?.replace(/\\/g, "/") ?? null,
    HttpsUsername: opt(p.HttpsUsername),
    HttpsCheckRepoUrl: opt(p.HttpsCheckRepoUrl),
    SigningKey: p.Signing === "Ssh" ? (opt(p.SigningKey)?.replace(/\\/g, "/") ?? null) : opt(p.SigningKey),
  };
}

export function withProfile(state: AppState, profile: Profile): AppState {
  const exists = state.Profiles.some((p) => p.Id === profile.Id);
  return {
    ...state,
    Profiles: exists
      ? state.Profiles.map((p) => (p.Id === profile.Id ? profile : p))
      : [...state.Profiles, profile],
  };
}

export function uniqueSlug(state: AppState, base: string): string {
  const taken = new Set(state.Profiles.map((p) => p.Slug.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function nextRuleOrder(state: AppState): number {
  const orders = state.Profiles.flatMap((p) => p.Rules.map((r) => r.Order));
  return orders.length ? Math.max(...orders) + 1 : 0;
}

// ─── Reglas ──────────────────────────────────────────────────────────────

export function normalizeFolder(folder: string): string {
  let f = folder
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\\/g, "/");
  if (!f) return "";
  while (f.includes("//")) f = f.replace(/\/\//g, "/");
  return f.endsWith("/") ? f : `${f}/`;
}

export const normalizeOrg = (org: string) =>
  org
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\\/g, "/");

export function conditionsFor(profile: Profile, rule: Rule): string[] {
  if (rule.Type === "Folder") {
    const folder = normalizeFolder(rule.Value);
    return folder ? [`gitdir/i:${folder}`] : [];
  }
  const host = blank(rule.Host) ? profile.Host : (rule.Host ?? "").trim();
  const org = normalizeOrg(rule.Value);
  if (!host || !org) return [];
  if (isAzureHost(host) || (blank(rule.Host) && profile.Provider === "AzureDevOps"))
    return azureConditions(org);
  return [`hasconfig:remote.*.url:git@${host}:${org}/**`, `hasconfig:remote.*.url:https://${host}/${org}/**`];
}

// ─── Azure DevOps (igual que el núcleo) ──────────────────────────────────

export function isAzureHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return (
    h === "dev.azure.com" ||
    h === "ssh.dev.azure.com" ||
    h === "vs-ssh.visualstudio.com" ||
    h.endsWith(".visualstudio.com")
  );
}

export const isAzure = (p: Profile) => p.Provider === "AzureDevOps" || isAzureHost(p.Host);

/** Host al que se conecta SSH: en Azure no coincide con el host HTTPS. */
export function sshHost(p: Profile): string {
  if (!isAzure(p)) return p.Host;
  return p.Host.trim().toLowerCase().endsWith(".visualstudio.com")
    ? "vs-ssh.visualstudio.com"
    : "ssh.dev.azure.com";
}

/** `org` u `org/proyecto`: todas las formas literales con las que aparecen las URLs de Azure. */
function azureConditions(orgPath: string): string[] {
  const path = orgPath.replace(/ /g, "%20");
  const [org, ...rest] = path.split("/");
  const project = rest.join("/");
  return [
    `git@ssh.dev.azure.com:v3/${path}/**`,
    `https://dev.azure.com/${path}/**`,
    `https://${org}@dev.azure.com/${path}/**`,
    `${org}@vs-ssh.visualstudio.com:v3/${path}/**`,
    project ? `https://${org}.visualstudio.com/${project}/**` : `https://${org}.visualstudio.com/**`,
  ].map((u) => `hasconfig:remote.*.url:${u}`);
}

export type OrderedRule = { profile: Profile; rule: Rule };

/** Orden de aplicación: carpetas primero y remotos después, cada grupo por `Order`. */
export function orderedRules(state: AppState): OrderedRule[] {
  const all = state.Profiles.flatMap((profile) => profile.Rules.map((rule) => ({ profile, rule })));
  return all
    .map((x, i) => ({ x, i }))
    .sort(
      (a, b) =>
        (a.x.rule.Type === "Folder" ? 0 : 1) - (b.x.rule.Type === "Folder" ? 0 : 1) ||
        a.x.rule.Order - b.x.rule.Order ||
        a.i - b.i,
    )
    .map(({ x }) => x);
}

/** Sube o baja una regla dentro de su tipo y renumera todas desde 0. */
export function moveRule(state: AppState, ruleId: string, delta: -1 | 1): AppState | null {
  const ordered = orderedRules(state);
  const idx = ordered.findIndex((x) => x.rule.Id === ruleId);
  if (idx < 0) return null;
  const target = idx + delta;
  if (target < 0 || target >= ordered.length || ordered[target].rule.Type !== ordered[idx].rule.Type)
    return null;
  const ids = ordered.map((x) => x.rule.Id);
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  const order = new Map(ids.map((id, i) => [id, i]));
  return {
    ...state,
    Profiles: state.Profiles.map((p) => ({
      ...p,
      Rules: p.Rules.map((r) => ({ ...r, Order: order.get(r.Id) ?? r.Order })),
    })),
  };
}

export function removeRule(state: AppState, ruleId: string): AppState {
  return {
    ...state,
    Profiles: state.Profiles.map((p) => ({ ...p, Rules: p.Rules.filter((r) => r.Id !== ruleId) })),
  };
}

export function upsertRule(state: AppState, profileId: string, rule: Rule): AppState {
  return {
    ...state,
    Profiles: state.Profiles.map((p) => {
      if (p.Id !== profileId) return { ...p, Rules: p.Rules.filter((r) => r.Id !== rule.Id) };
      const exists = p.Rules.some((r) => r.Id === rule.Id);
      return { ...p, Rules: exists ? p.Rules.map((r) => (r.Id === rule.Id ? rule : r)) : [...p.Rules, rule] };
    }),
  };
}

// ─── Estado de cada perfil (SSH · HTTPS · Firma) ─────────────────────────

export type CapState = "ok" | "warn" | "err" | "off";
export type Cap = { state: CapState; text: string };
/** `offline`: la última prueba falló por la red y se conserva el OK anterior. */
export type ConnSession = { result: ConnectionTestResult; when: Date; offline?: boolean };
export type CredSession = { valid: boolean; message: string; when: Date; offline?: boolean };

function accountMatches(r: ConnectionTestResult, expected: string | null): boolean {
  return !r.account || blank(expected) || r.account.toLowerCase() === (expected ?? "").toLowerCase();
}

export function sshCap(p: Profile, health: ProfileHealth | undefined, conn: ConnSession | undefined): Cap {
  if (blank(p.SshKeyPath)) return { state: "warn", text: t("common.caps.sshNoKey") };
  const st = health?.ssh;
  if (!st) return { state: "warn", text: t("common.caps.sshUntested") };
  if (!st.privateExists) return { state: "err", text: t("common.caps.sshMissingKey") };
  if (!st.publicExists) return { state: "err", text: t("common.caps.sshMissingPub") };
  if (!st.aclOk) return { state: "err", text: t("common.caps.sshAcl") };
  const r = conn?.result;
  if (r?.success && conn?.offline)
    return { state: "warn", text: t("common.caps.sshOffline", { when: relativeTime(conn.when) }) };
  if (r && !r.success) return { state: "err", text: t("common.caps.sshFailed") };
  if (r && !accountMatches(r, p.HttpsUsername))
    return {
      state: "err",
      text: t("common.caps.sshWrongAccount", { account: r.account, expected: p.HttpsUsername }),
    };
  if (r) return { state: "ok", text: `SSH: OK${r.account ? ` · ${r.account}` : ""}` };
  return { state: "warn", text: t("common.caps.sshUntested") };
}

export function httpsCap(p: Profile, cred: CredSession | undefined): Cap {
  if (blank(p.HttpsUsername)) return { state: "warn", text: t("common.caps.httpsNoUser") };
  if (cred?.valid === true && cred.offline)
    return { state: "warn", text: t("common.caps.httpsOffline", { when: relativeTime(cred.when) }) };
  if (cred?.valid === true) return { state: "ok", text: t("common.caps.httpsValid") };
  if (cred?.valid === false) return { state: "err", text: t("common.caps.httpsInvalid") };
  return { state: "warn", text: t("common.caps.httpsUnchecked") };
}

export function signCap(p: Profile, health: ProfileHealth | undefined): Cap {
  if (p.Signing === "None") return { state: "off", text: t("common.caps.signOff") };
  if (p.Signing === "Gpg")
    return blank(p.SigningKey)
      ? { state: "err", text: t("common.caps.gpgNoKey") }
      : { state: "ok", text: t("common.caps.gpgOk") };
  if (health?.signingKeyExists && health.signingNeedsSessionAgent)
    return { state: "warn", text: t("common.caps.sshSignAgent") };
  return health?.signingKeyExists
    ? { state: "ok", text: t("common.caps.sshSignOk") }
    : { state: "err", text: t("common.caps.sshSignNoPub") };
}

export function sshAlias(p: Profile): string {
  if (isAzure(p)) return `azure-${p.Slug}`;
  const first = p.Host.split(".")[0];
  return `${first || "git"}-${p.Slug}`;
}

const q = (s: string) => (s.includes(" ") ? `"${s}"` : s);

/** Cliente por defecto mientras no ha llegado el resumen del backend (igual que `SshClientInfo::windows_openssh`). */
export const DEFAULT_SSH_CLIENT: SshClientInfo = {
  kind: "WindowsOpenSsh",
  sshPath: "C:/Windows/System32/OpenSSH/ssh.exe",
  sshKeygenPath: "C:/Windows/System32/OpenSSH/ssh-keygen.exe",
  sshCommandPrefix: "SSH_AUTH_SOCK='\\\\.\\pipe\\openssh-ssh-agent' ",
};

/** `core.sshCommand` del perfil (con el prefijo que fija el agente de Windows, como el núcleo). */
export function sshCommand(client: SshClientInfo, key: string): string {
  return `${client.sshCommandPrefix}${q(client.sshPath)} -i ${q(key)} -o IdentitiesOnly=yes`;
}

export const bareSshCommand = (client: SshClientInfo) => `${client.sshCommandPrefix}${q(client.sshPath)}`;

/** `gpg.ssh.program`: con OpenSSH de Windows, el envoltorio `~/.gitprofiles/ssh-keygen.cmd`. */
export function signingProgram(client: SshClientInfo, gitProfilesDir: string | undefined): string {
  if (client.kind !== "WindowsOpenSsh") return client.sshKeygenPath;
  return `${(gitProfilesDir ?? "~/.gitprofiles").replace(/\\/g, "/")}/ssh-keygen.cmd`;
}

/** Valor tal como lo escribe `git config` en el fichero (barras invertidas y comillas escapadas). */
export const gitConfigValue = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// ─── Formato ─────────────────────────────────────────────────────────────

const time = (d: Date) => d.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });

/** «ahora», «hoy 09:41», «ayer 18:30» o «hace 3 días», como en el prototipo. */
export function relativeTime(d: Date, now = new Date()): string {
  const ms = now.getTime() - d.getTime();
  if (ms < 60_000) return t("common.time.now");
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days === 0) return t("common.time.today", { time: time(d) });
  if (days === 1) return t("common.time.yesterday", { time: time(d) });
  return t("common.time.daysAgo", { count: days });
}

export const nowTime = () => time(new Date());
