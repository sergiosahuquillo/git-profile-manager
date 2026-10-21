import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../../components/Icon";
import { type Tab, useStore } from "../../state/store";

export const TABS: { id: Tab; icon: IconName }[] = [
  { id: "identidad", icon: "person" },
  { id: "ssh", icon: "key" },
  { id: "https", icon: "link" },
  { id: "firma", icon: "shield" },
  { id: "reglas", icon: "rules" },
];

/** Pestañas con navegación por teclado (flechas, Inicio y Fin), como en el prototipo. */
export function ProfileTabs({ rulesCount, children }: { rulesCount: number; children: ReactNode }) {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const { t: tr } = useTranslation();
  const go = (t: Tab) => {
    setTab(t);
    requestAnimationFrame(() => document.getElementById(`tab-${t}`)?.focus());
  };
  const onKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let n: number | null = null;
    if (e.key === "ArrowRight") n = (i + 1) % TABS.length;
    if (e.key === "ArrowLeft") n = (i - 1 + TABS.length) % TABS.length;
    if (e.key === "Home") n = 0;
    if (e.key === "End") n = TABS.length - 1;
    if (n === null) return;
    e.preventDefault();
    go(TABS[n].id);
  };
  return (
    <div>
      <div className="tabs" role="tablist" aria-label={tr("profiles.tabs.label")}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="tab"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === tab}
            aria-controls={`panel-${t.id}`}
            tabIndex={t.id === tab ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={onKey}
          >
            <Icon name={t.icon} />
            <span>{tr(`profiles.tabs.${t.id}`)}</span>
            {t.id === "reglas" && rulesCount > 0 && <span className="meta">{rulesCount}</span>}
          </button>
        ))}
      </div>
      <div
        className="tabpanel"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
