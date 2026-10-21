import { useStore } from "../state/store";
import { Icon } from "./Icon";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === "ok" ? "" : ` is-${t.kind}`}${t.out ? " is-out" : ""}`}>
          <Icon name={t.kind === "ok" ? "check" : t.kind === "err" ? "x" : "alert"} />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
