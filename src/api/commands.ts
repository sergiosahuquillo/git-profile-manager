// Wrappers tipados de los comandos de Tauri. Fuera de Tauri (vite dev en un navegador) se usa un
// backend simulado con los datos del prototipo, solo para revisar el diseño.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import i18next from "i18next";
import type { AclFix } from "./bindings/AclFix";
import type { AgentState } from "./bindings/AgentState";
import type { AppState } from "./bindings/AppState";
import type { BackupSet } from "./bindings/BackupSet";
import type { Bootstrap } from "./bindings/Bootstrap";
import type { CloneDefaults } from "./bindings/CloneDefaults";
import type { CloneInput } from "./bindings/CloneInput";
import type { CloneOutcome } from "./bindings/CloneOutcome";
import type { ClonePreview } from "./bindings/ClonePreview";
import type { CloneRemedy } from "./bindings/CloneRemedy";
import type { ConnectionTestResult } from "./bindings/ConnectionTestResult";
import type { CredentialCheckResult } from "./bindings/CredentialCheckResult";
import type { DetectedRepo } from "./bindings/DetectedRepo";
import type { DiagnosticReport } from "./bindings/DiagnosticReport";
import type { EnvironmentReport } from "./bindings/EnvironmentReport";
import type { FileChange } from "./bindings/FileChange";
import type { FixAction } from "./bindings/FixAction";
import type { GeneratedPreview } from "./bindings/GeneratedPreview";
import type { GitInstallOptions } from "./bindings/GitInstallOptions";
import type { GitInstallResult } from "./bindings/GitInstallResult";
import type { GitUpdateInfo } from "./bindings/GitUpdateInfo";
import type { InstallScope } from "./bindings/InstallScope";
import type { IntegrationPlan } from "./bindings/IntegrationPlan";
import type { Lang } from "./bindings/Lang";
import type { Overview } from "./bindings/Overview";
import type { Profile } from "./bindings/Profile";
import type { ProfileCheck } from "./bindings/ProfileCheck";
import type { ProfileHealth } from "./bindings/ProfileHealth";
import type { RulesAnalysis } from "./bindings/RulesAnalysis";
import type { SavePlan } from "./bindings/SavePlan";
import type { SourceTreeReport } from "./bindings/SourceTreeReport";
import type { SshClientInfo } from "./bindings/SshClientInfo";
import type { SshClientKind } from "./bindings/SshClientKind";
import type { SshKeyStatus } from "./bindings/SshKeyStatus";
import type { SshKeyType } from "./bindings/SshKeyType";
import type { StoredAccount } from "./bindings/StoredAccount";
import type { UninstallPlan } from "./bindings/UninstallPlan";
import type { UpdateMode } from "./bindings/UpdateMode";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (inTauri) return tauriInvoke<T>(cmd, args);
  if (!import.meta.env.DEV) throw { message: i18next.t("common.desktopOnly") };
  const { mockInvoke } = await import("./mock");
  return mockInvoke<T>(cmd, args);
}

/** Mensaje de un error de comando (`CmdError`) o de cualquier excepción. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export const api = {
  setLanguage: (lang: Lang) => invoke<Overview>("set_language", { lang }),
  bootstrap: (fallback: Lang) => invoke<Bootstrap>("bootstrap", { fallback }),
  getOverview: () => invoke<Overview>("get_overview"),
  getEnvironment: () => invoke<EnvironmentReport>("get_environment"),
  profilesHealth: (draft: AppState) => invoke<ProfileHealth[]>("profiles_health", { draft }),

  planSave: (draft: AppState) => invoke<SavePlan>("plan_save", { draft }),
  save: (draft: AppState, overwriteDrifted: boolean) => invoke<Overview>("save", { draft, overwriteDrifted }),
  setFirstRunCompleted: (completed: boolean) => invoke<Overview>("set_first_run_completed", { completed }),
  analyzeRules: (draft: AppState) => invoke<RulesAnalysis>("analyze_rules", { draft }),
  previewGenerated: (draft: AppState) => invoke<GeneratedPreview[]>("preview_generated", { draft }),
  driftChanges: () => invoke<FileChange[]>("drift_changes"),
  regenerateDrifted: () => invoke<Overview>("regenerate_drifted"),

  sshGenerateKey: (slug: string, email: string, withPassphrase: boolean, keyType: SshKeyType) =>
    invoke<string>("ssh_generate_key", { slug, email, withPassphrase, keyType }),
  sshImportKey: (path: string) => invoke<string>("ssh_import_key", { path }),
  sshKeyStatus: (keyPath: string) => invoke<SshKeyStatus>("ssh_key_status", { keyPath }),
  sshFingerprint: (keyPath: string) => invoke<string | null>("ssh_fingerprint", { keyPath }),
  sshReadPublicKey: (keyPath: string) => invoke<string | null>("ssh_read_public_key", { keyPath }),
  sshPlanAclFix: (keyPath: string) => invoke<AclFix>("ssh_plan_acl_fix", { keyPath }),
  sshApplyAclFix: (keyPath: string) => invoke<SshKeyStatus>("ssh_apply_acl_fix", { keyPath }),
  sshAgentState: () => invoke<AgentState>("ssh_agent_state"),
  sshAddToAgent: (keyPath: string) => invoke<void>("ssh_add_to_agent", { keyPath }),
  sshTestConnection: (profile: Profile) => invoke<ConnectionTestResult>("ssh_test_connection", { profile }),
  sshClientInfo: (kind: SshClientKind) => invoke<SshClientInfo>("ssh_client_info", { kind }),

  credentialApprove: (host: string, username: string, token: string) =>
    invoke<void>("credential_approve", { host, username, token }),
  credentialReject: (host: string, username: string) => invoke<void>("credential_reject", { host, username }),
  credentialCheck: (profile: Profile) => invoke<CredentialCheckResult>("credential_check", { profile }),
  connectionStatus: () => invoke<ProfileCheck[]>("connection_status"),
  connectionStatusRefresh: () => invoke<number>("connection_status_refresh"),
  credentialProviderFlow: (profile: Profile) =>
    invoke<CredentialCheckResult>("credential_provider_flow", { profile }),
  credentialDescribeRelogin: (profile: Profile, username: string) =>
    invoke<string>("credential_describe_relogin", { profile, username }),
  credentialRelogin: (profile: Profile, username: string) =>
    invoke<CredentialCheckResult>("credential_relogin", { profile, username }),
  credentialSavedAccounts: (host: string) => invoke<StoredAccount[]>("credential_saved_accounts", { host }),

  integrationPlanEnable: (removeGlobalIdentity: boolean) =>
    invoke<IntegrationPlan>("integration_plan_enable", { removeGlobalIdentity }),
  integrationPlanDisable: () => invoke<IntegrationPlan>("integration_plan_disable"),
  integrationEnable: (removeGlobalIdentity: boolean) =>
    invoke<Overview>("integration_enable", { removeGlobalIdentity }),
  integrationDisable: () => invoke<Overview>("integration_disable"),
  uninstallPlan: () => invoke<UninstallPlan>("uninstall_plan"),
  uninstall: () => invoke<Overview>("uninstall"),

  listBackups: () => invoke<BackupSet[]>("list_backups"),
  backupRestorePlan: (id: string) => invoke<FileChange[]>("backup_restore_plan", { id }),
  restoreBackup: (id: string) => invoke<Overview>("restore_backup", { id }),

  diagnoseRepo: (path: string) => invoke<DiagnosticReport>("diagnose_repo", { path }),
  findRepos: () => invoke<DetectedRepo[]>("find_repos"),
  applyFix: (repo: string, fix: FixAction) => invoke<DiagnosticReport>("apply_fix", { repo, fix }),

  cloneDefaults: (url: string, profileId: string | null) =>
    invoke<CloneDefaults>("clone_defaults", { url, profileId }),
  clonePreview: (input: CloneInput) => invoke<ClonePreview>("clone_preview", { input }),
  cloneRun: (input: CloneInput, remedy: CloneRemedy) => invoke<CloneOutcome>("clone_run", { input, remedy }),

  setUpdateMode: (mode: UpdateMode) => invoke<Overview>("set_update_mode", { mode }),
  checkGitUpdate: () => invoke<GitUpdateInfo | null>("check_git_update"),
  downloadGitUpdate: () => invoke<GitUpdateInfo>("download_git_update"),
  installGitUpdate: () => invoke<GitInstallResult>("install_git_update"),
  gitInstallOptions: () => invoke<GitInstallOptions>("git_install_options"),
  installGit: (scope: InstallScope) => invoke<GitInstallResult>("install_git", { scope }),

  sourcetreeStatus: () => invoke<SourceTreeReport>("sourcetree_status"),
  openInExplorer: (path: string) => invoke<void>("open_in_explorer", { path }),
  openInSourcetree: (repo: string) => invoke<void>("open_in_sourcetree", { repo }),
  isDirectory: (path: string) => invoke<boolean>("is_directory", { path }),
  logError: (message: string) => invoke<void>("log_error", { message }),
};
