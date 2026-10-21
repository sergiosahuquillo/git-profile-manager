import type { ReactNode } from "react";
import { create } from "zustand";
import type { DiffLine } from "../api/bindings/DiffLine";
import type { EnvironmentReport } from "../api/bindings/EnvironmentReport";
import type { Overview } from "../api/bindings/Overview";
import type { Profile } from "../api/bindings/Profile";
import type { Rule } from "../api/bindings/Rule";
import type { ConnSession, CredSession } from "../lib/profiles";

export type View = "perfiles" | "reglas" | "diagnostico" | "ajustes";
export type Tab = "identidad" | "ssh" | "https" | "firma" | "reglas";
export const DRAFT_ID = "__draft";

export type ToastKind = "ok" | "warn" | "err";
export type Toast = { id: number; msg: ReactNode; kind: ToastKind; out?: boolean };

/** Bloques de la vista previa obligatoria: diff de un fichero, comandos o texto. */
export type ChangeBlock =
  | { type: "diff"; file: string; lines: DiffLine[]; label?: string }
  | { type: "cmd"; lines: string[]; label?: string }
  | { type: "code"; label: ReactNode; text: string };

export type ChangeRequest = {
  title: string;
  note: string;
  warn?: ReactNode;
  errors?: string[];
  blocks: ChangeBlock[];
  /** Contenido extra encima de los bloques (p. ej. una casilla que recalcula el plan). */
  extra?: ReactNode;
  applyLabel?: string;
  danger?: boolean;
  /** Sin acción: el modal solo muestra contenido y el botón principal cierra. */
  readOnly?: boolean;
  onApply?: () => Promise<void>;
  onCancel?: () => void;
};

export type DraftProfile = Profile & { slugTouched: boolean; hostTouched: boolean };

export type RuleDialogSpec = { profileId?: string; rule?: Rule; presetFolder?: string };

type State = {
  overview: Overview | null;
  env: EnvironmentReport | null;
  view: View;
  profileId: string | null;
  tab: Tab;
  theme: "light" | "dark";
  /** Ediciones sin guardar por perfil (solo los campos de las pestañas). */
  drafts: Record<string, Profile>;
  newDraft: DraftProfile | null;
  conn: Record<string, ConnSession>;
  cred: Record<string, CredSession>;
  statusMsg: string;
  toasts: Toast[];
  change: ChangeRequest | null;
  cloneOpen: boolean;
  onboardingOpen: boolean;
  ruleDialog: RuleDialogSpec | null;
  diagPath: string | null;
  dismissed: Record<string, boolean>;
};

type Actions = {
  setOverview: (o: Overview) => void;
  setEnv: (e: EnvironmentReport) => void;
  goto: (v: View) => void;
  selectProfile: (id: string | null, tab?: Tab) => void;
  setTab: (t: Tab) => void;
  setTheme: (t: "light" | "dark") => void;
  setDraft: (id: string, p: Profile | null) => void;
  setNewDraft: (d: DraftProfile | null) => void;
  setConn: (id: string, s: ConnSession | null) => void;
  setCred: (id: string, s: CredSession | null) => void;
  setStatus: (msg: string) => void;
  toast: (msg: ReactNode, kind?: ToastKind) => void;
  askChange: (r: ChangeRequest | null) => void;
  setCloneOpen: (v: boolean) => void;
  setOnboardingOpen: (v: boolean) => void;
  openRuleDialog: (spec: RuleDialogSpec | null) => void;
  diagnose: (path: string | null) => void;
  dismiss: (key: string, v?: boolean) => void;
};

let toastId = 0;

function initialTheme(): "light" | "dark" {
  try {
    const t = localStorage.getItem("gpm-theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    /* almacenamiento no disponible */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const useStore = create<State & Actions>((set, get) => ({
  overview: null,
  env: null,
  view: "perfiles",
  profileId: null,
  tab: "identidad",
  theme: initialTheme(),
  drafts: {},
  newDraft: null,
  conn: {},
  cred: {},
  statusMsg: "",
  toasts: [],
  change: null,
  cloneOpen: false,
  onboardingOpen: false,
  ruleDialog: null,
  diagPath: null,
  dismissed: {},

  setOverview: (o) => {
    const { profileId } = get();
    const exists = profileId === DRAFT_ID || o.state.Profiles.some((p) => p.Id === profileId);
    set({ overview: o, profileId: exists ? profileId : (o.state.Profiles[0]?.Id ?? null) });
  },
  setEnv: (env) => set({ env }),
  goto: (view) => {
    set({ view });
    document.getElementById("main")?.scrollTo({ top: 0 });
  },
  selectProfile: (profileId, tab = "identidad") => set({ profileId, tab }),
  setTab: (tab) => set({ tab }),
  setTheme: (theme) => {
    try {
      localStorage.setItem("gpm-theme", theme);
    } catch {
      /* almacenamiento no disponible */
    }
    set({ theme });
  },
  setDraft: (id, p) =>
    set((s) => {
      const drafts = { ...s.drafts };
      if (p) drafts[id] = p;
      else delete drafts[id];
      return { drafts };
    }),
  setNewDraft: (newDraft) => set({ newDraft }),
  setConn: (id, v) =>
    set((s) => {
      const conn = { ...s.conn };
      if (v) conn[id] = v;
      else delete conn[id];
      return { conn };
    }),
  setCred: (id, v) =>
    set((s) => {
      const cred = { ...s.cred };
      if (v) cred[id] = v;
      else delete cred[id];
      return { cred };
    }),
  setStatus: (statusMsg) => set({ statusMsg }),
  toast: (msg, kind = "ok") => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, msg, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, out: true } : t)) }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 200);
    }, 3600);
  },
  askChange: (change) => set({ change }),
  setCloneOpen: (cloneOpen) => set({ cloneOpen }),
  setOnboardingOpen: (onboardingOpen) => set({ onboardingOpen }),
  openRuleDialog: (ruleDialog) => set({ ruleDialog }),
  diagnose: (diagPath) => set({ diagPath, view: "diagnostico" }),
  dismiss: (key, v = true) => set((s) => ({ dismissed: { ...s.dismissed, [key]: v } })),
}));

export const NO_PROFILES: Profile[] = [];

export const toast = (msg: ReactNode, kind?: ToastKind) => useStore.getState().toast(msg, kind);
