// Operaciones compartidas entre vistas: refrescar, guardar con vista previa y aplicar al momento.
import type { ReactNode } from "react";
import type { AppState } from "../api/bindings/AppState";
import type { Overview } from "../api/bindings/Overview";
import { api, errorMessage } from "../api/commands";
import { t } from "../i18n";
import { nowTime } from "../lib/profiles";
import type { ChangeBlock } from "./store";
import { toast, useStore } from "./store";

export async function refresh(): Promise<Overview | null> {
  try {
    const o = await api.getOverview();
    useStore.getState().setOverview(o);
    return o;
  } catch (e) {
    toast(errorMessage(e), "err");
    return null;
  }
}

export function savedState(): AppState {
  const o = useStore.getState().overview;
  if (!o) throw new Error(t("common.save.notLoaded"));
  return o.state;
}

export function status(done: string) {
  useStore.getState().setStatus(`${done} · ${nowTime()}`);
}

type SaveOptions = {
  title: string;
  note?: string;
  done: string;
  warn?: ReactNode;
  applyLabel?: string;
  danger?: boolean;
  onDone?: (o: Overview) => void;
  /** Se llama si el usuario cancela la vista previa o no se pudo calcular. */
  onCancel?: () => void;
};

/**
 * Guardar con vista previa obligatoria: calcula el plan, muestra el diff exacto de cada fichero
 * generado (y los que se borrarán) y solo escribe al confirmar.
 */
export async function confirmSave(draft: AppState, opts: SaveOptions): Promise<void> {
  let plan: Awaited<ReturnType<typeof api.planSave>>;
  try {
    plan = await api.planSave(draft);
  } catch (e) {
    toast(errorMessage(e), "err");
    opts.onCancel?.();
    return;
  }
  const changed = plan.files.filter((f) => f.hasChanges);
  if (plan.canSave && !plan.hasChanges) {
    // Solo cambian metadatos de profiles.json (p. ej. el método de clonado): se guarda sin preguntar.
    try {
      const o = await api.save(draft, false);
      useStore.getState().setOverview(o);
      toast(opts.done);
      status(opts.done);
      opts.onDone?.(o);
    } catch (e) {
      toast(errorMessage(e), "err");
      opts.onCancel?.();
    }
    return;
  }
  const blocks: ChangeBlock[] = [
    ...changed.map((f) => ({ type: "diff" as const, file: f.displayPath, lines: f.diff })),
    ...plan.filesToDelete.map((f) => ({
      type: "diff" as const,
      file: t("common.save.willDelete", { file: f.displayPath }),
      lines: (f.currentContent ?? "")
        .replace(/\n$/, "")
        .split("\n")
        .map((text) => ({ kind: "del" as const, text })),
    })),
  ];
  const drifted = plan.files.filter((f) => f.drifted).map((f) => f.displayPath);
  const warn =
    drifted.length > 0 ? (
      <>
        {t("common.save.drifted", { count: drifted.length, files: drifted.join(", ") })}
        {opts.warn ? (
          <>
            <br />
            {opts.warn}
          </>
        ) : null}
      </>
    ) : (
      opts.warn
    );
  const n = changed.length + plan.filesToDelete.length;
  useStore.getState().askChange({
    title: opts.title,
    note: opts.note ?? t("common.save.note"),
    warn,
    errors: plan.errors,
    blocks,
    applyLabel: opts.applyLabel,
    danger: opts.danger,
    onCancel: opts.onCancel,
    onApply: async () => {
      const o = await api.save(draft, plan.hasDrift);
      useStore.getState().setOverview(o);
      toast(opts.done);
      status(`${opts.done} · ${t("common.save.regenerated", { count: n })}`);
      opts.onDone?.(o);
    },
  });
}

/** Guarda sin vista previa (cambios de orden en ficheros propios). Si hay deriva, pide confirmación. */
export async function saveNow(draft: AppState, done: string): Promise<boolean> {
  try {
    const plan = await api.planSave(draft);
    if (!plan.canSave) {
      toast(plan.errors[0] ?? t("common.save.cantSave"), "err");
      return false;
    }
    if (plan.hasDrift) {
      await confirmSave(draft, { title: t("common.save.regenerateDrifted"), done });
      return false;
    }
    const o = await api.save(draft, false);
    useStore.getState().setOverview(o);
    toast(done);
    status(done);
    return true;
  } catch (e) {
    toast(errorMessage(e), "err");
    return false;
  }
}

/** Ejecuta una acción con su mensaje de error en un toast. */
export async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toast(errorMessage(e), "err");
    return undefined;
  }
}
