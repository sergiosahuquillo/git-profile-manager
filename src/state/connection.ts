// Estado de las pruebas SSH/HTTPS: lo guardado en status.json al arrancar, lo que llega del refresco en
// segundo plano y lo de las pruebas manuales. Un fallo de red no pisa un OK: se marca «sin conexión».
import type { ConnectionTestResult } from "../api/bindings/ConnectionTestResult";
import type { CredentialCheckResult } from "../api/bindings/CredentialCheckResult";
import type { ProfileCheck } from "../api/bindings/ProfileCheck";
import { api } from "../api/commands";
import { listen } from "../api/platform";
import { useStore } from "./store";

export function applyCheck(c: ProfileCheck) {
  const s = useStore.getState();
  const when = new Date(c.record.checkedAt);
  if (c.kind === "Ssh") {
    s.setConn(c.profileId, {
      result: {
        success: c.record.success,
        account: c.record.account,
        output: c.record.message,
        hint: null,
        networkError: false,
      },
      when,
      offline: c.offline,
    });
  } else {
    s.setCred(c.profileId, { valid: c.record.success, message: c.record.message, when, offline: c.offline });
  }
}

/** Resultado de una prueba manual de SSH. */
export function recordSsh(profileId: string, r: ConnectionTestResult) {
  const s = useStore.getState();
  const prev = s.conn[profileId];
  if (r.networkError && prev?.result.success) s.setConn(profileId, { ...prev, offline: true });
  else s.setConn(profileId, { result: r, when: new Date() });
}

/** Resultado de una comprobación manual de HTTPS. */
export function recordCred(profileId: string, r: CredentialCheckResult) {
  const s = useStore.getState();
  const prev = s.cred[profileId];
  if (r.networkError && prev?.valid) s.setCred(profileId, { ...prev, offline: true });
  else s.setCred(profileId, { valid: r.valid, message: r.message, when: new Date() });
}

/** Carga lo guardado y recomprueba en segundo plano lo caducado. Devuelve la función que deja de escuchar. */
export async function startConnectionStatus(): Promise<() => void> {
  const unlisten = await listen<ProfileCheck>("connection-status", applyCheck);
  try {
    for (const c of await api.connectionStatus()) applyCheck(c);
    void api.connectionStatusRefresh().catch(() => undefined);
  } catch {
    /* sin estado guardado: los perfiles salen como «sin probar» */
  }
  return unlisten;
}
