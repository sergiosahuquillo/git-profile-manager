import i18n from "i18next";
import { type ReactNode, useEffect, useRef } from "react";
import { Icon, type IconName } from "./Icon";

// Pila de modales abiertos: Esc y Tab solo actúan sobre el de arriba.
const stack: number[] = [];
let seq = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  icon,
  title,
  size,
  onClose,
  children,
  foot,
  steps,
  labelId,
}: {
  icon: IconName;
  title: ReactNode;
  size?: "md";
  onClose: () => void;
  children: ReactNode;
  foot: ReactNode;
  steps?: ReactNode;
  labelId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = ++seq;
    stack.push(id);
    const lastFocus = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const first =
      root?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close-overlay])") ??
      root?.querySelector<HTMLElement>("button");
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || !root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const f = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (!f.length) return;
      const [a, z] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(id), 1);
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    };
  }, []);

  return (
    <div className="overlay">
      <div className="scrim" data-close-overlay onClick={onClose} />
      <div
        ref={ref}
        className={`modal${size ? ` modal-${size}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
      >
        <header className="modal-head">
          <Icon name={icon} className="icon icon-20 od-fixed" />
          <h2 id={labelId} className="od-fill">
            {title}
          </h2>
          <button type="button" className="icon-btn od-fixed" data-close-overlay onClick={onClose}>
            <Icon name="x" />
            <span className="sr-only">{i18n.t("common.close")}</span>
          </button>
        </header>
        {steps}
        {children}
        <footer className="modal-foot">{foot}</footer>
      </div>
    </div>
  );
}
