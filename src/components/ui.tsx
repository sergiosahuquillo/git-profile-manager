// Piezas del sistema de diseño (clases de styles.css): mismo marcado que el prototipo.
import i18n from "i18next";
import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";
import { Icon, type IconName } from "./Icon";

type BtnVariant = "default" | "primary" | "accent" | "danger";

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  variant?: BtnVariant;
  size?: "sm";
  block?: boolean;
  icon?: IconName;
  /** Texto mientras la acción asíncrona está en curso (estado `is-loading` del prototipo). */
  busyLabel?: string;
  onClick?: () => unknown;
};

export function Btn({
  variant = "default",
  size,
  block,
  icon,
  busyLabel,
  onClick,
  children,
  className,
  ...rest
}: BtnProps) {
  const [busy, setBusy] = useState(false);
  const cls = [
    "btn",
    `btn-${variant}`,
    size === "sm" && "btn-sm",
    block && "btn-block",
    busy && "is-loading",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const handle = async () => {
    if (!onClick || busy) return;
    const r = onClick();
    if (r instanceof Promise) {
      setBusy(true);
      try {
        await r;
      } finally {
        setBusy(false);
      }
    }
  };
  return (
    <button type="button" className={cls} aria-busy={busy || undefined} onClick={handle} {...rest}>
      {busy ? (
        <>
          <Icon name="sync" />
          <span>{busyLabel ?? children}</span>
        </>
      ) : (
        <>
          {icon && <Icon name={icon} />}
          {children}
        </>
      )}
    </button>
  );
}

export type Tone = "ok" | "warn" | "err" | "neutral" | "accent";

export function Pill({
  tone,
  icon,
  children,
  className,
}: {
  tone: Tone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`pill pill-${tone}${className ? ` ${className}` : ""}`}>
      {icon && <Icon name={icon} className="icon icon-12" />}
      {children}
    </span>
  );
}

export function Banner({
  tone,
  icon,
  title,
  text,
  children,
  actions,
  style,
  role = "status",
}: {
  tone: "warn" | "ok" | "danger" | "info";
  icon?: IconName;
  title: ReactNode;
  text?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  style?: React.CSSProperties;
  role?: string;
}) {
  const ico: IconName = icon ?? (tone === "ok" ? "check" : tone === "info" ? "info" : "alert");
  return (
    <div className={`banner banner-${tone}`} role={role} style={style}>
      <Icon name={ico} className="icon od-fixed" />
      <div className="od-fill od-stack" style={{ "--od-gap": "2px" } as React.CSSProperties}>
        <strong>{title}</strong>
        {text && <span className="banner-text">{text}</span>}
        {children}
      </div>
      {actions && <div className="od-cluster od-fixed">{actions}</div>}
    </div>
  );
}

export type StatusTone = "ok" | "warn" | "err" | "busy" | "muted";

export function InlineStatus({
  tone = "ok",
  icon,
  children,
  action,
}: {
  tone?: StatusTone;
  icon?: IconName;
  children: ReactNode;
  action?: ReactNode;
}) {
  const ico: IconName =
    icon ??
    (tone === "ok"
      ? "check"
      : tone === "err"
        ? "x"
        : tone === "busy"
          ? "sync"
          : tone === "muted"
            ? "info"
            : "alert");
  return (
    <div className={`inline-status${tone === "ok" ? "" : ` is-${tone}`}`}>
      <Icon name={ico} className="icon od-fixed" />
      <span className="od-fill">{children}</span>
      {action}
    </div>
  );
}

export const DraftNote = ({ children }: { children: ReactNode }) => (
  <InlineStatus tone="muted" icon="info">
    {children}
  </InlineStatus>
);

export function Empty({
  icon,
  title,
  text,
  children,
}: {
  icon: IconName;
  title: string;
  text: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name={icon} className="icon icon-24" />
      <span className="empty-title">{title}</span>
      <span className="empty-text">{text}</span>
      {children}
    </div>
  );
}

export function Field({
  id,
  label,
  req,
  opt,
  help,
  err,
  children,
}: {
  id?: string;
  label: ReactNode;
  req?: boolean;
  opt?: boolean;
  help?: ReactNode;
  err?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="od-field" style={{ "--od-gap": "6px" } as React.CSSProperties}>
      {id ? (
        <label htmlFor={id}>
          {label}
          {req && (
            <span className="req" title={i18n.t("common.required")}>
              <span aria-hidden="true">*</span>
              <span className="sr-only">({i18n.t("common.requiredLower")})</span>
            </span>
          )}
          {opt && (
            <>
              {" "}
              <span className="opt">{i18n.t("common.optional")}</span>
            </>
          )}
        </label>
      ) : (
        <span className="label-like">{label}</span>
      )}
      {children}
      {err && (
        <span className="field-err" id={id ? `${id}-err` : undefined}>
          {err}
        </span>
      )}
      {help && (
        <span className="field-help" id={id ? `${id}-help` : undefined}>
          {help}
        </span>
      )}
    </div>
  );
}

export function Seg<T extends string>({
  name,
  value,
  options,
  onChange,
  labelledBy,
}: {
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  labelledBy?: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <label className="seg-item" key={o.value}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function Choice({
  name,
  value,
  checked,
  onChange,
  title,
  tag,
  tagNeutral,
  help,
  disabled,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: ReactNode;
  tag?: string;
  tagNeutral?: boolean;
  help: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="choice">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="choice-body">
        <span className="choice-title">
          {title}
          {tag && (
            <>
              {" "}
              <span className={`tag${tagNeutral ? " tag-neutral" : ""}`}>{tag}</span>
            </>
          )}
        </span>
        <span className="choice-help">{help}</span>
      </span>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="choice">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="choice-body">
        <span className="choice-help" style={{ fontSize: "var(--text-sm)", color: "var(--fg)" }}>
          {children}
        </span>
      </span>
    </label>
  );
}

export const Code = ({ children, wrap }: { children: ReactNode; wrap?: boolean }) => (
  <pre className={`code${wrap ? " code-wrap" : ""}`}>{children}</pre>
);

export const gap = (px: number) => ({ "--od-gap": `${px}px` }) as React.CSSProperties;
