// Familia de iconos del diseño: trazo simple, rejilla de 16 px, trazo 1.5 (copiada de design/index.html).
const SYMBOLS = `
<symbol id="i-person" viewBox="0 0 16 16"><circle cx="8" cy="5" r="2.75"/><path d="M2.75 14c0-2.9 2.35-4.5 5.25-4.5s5.25 1.6 5.25 4.5"/></symbol>
<symbol id="i-rules" viewBox="0 0 16 16"><path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle class="f" cx="2.6" cy="4" r="1"/><circle class="f" cx="2.6" cy="8" r="1"/><circle class="f" cx="2.6" cy="12" r="1"/></symbol>
<symbol id="i-pulse" viewBox="0 0 16 16"><path d="M1.25 8h3L5.75 4.5l2.6 7 1.9-3.5h4.5"/></symbol>
<symbol id="i-sliders" viewBox="0 0 16 16"><path d="M1.75 4.5h12.5M1.75 8h12.5M1.75 11.5h12.5"/><circle class="f" cx="5" cy="4.5" r="1.6"/><circle class="f" cx="10.5" cy="8" r="1.6"/><circle class="f" cx="6.5" cy="11.5" r="1.6"/></symbol>
<symbol id="i-clone" viewBox="0 0 16 16"><path d="M8 1.75v7.5M4.75 6.5 8 9.75l3.25-3.25M2.75 10.5v2.25a.75.75 0 0 0 .75.75h9a.75.75 0 0 0 .75-.75V10.5"/></symbol>
<symbol id="i-check" viewBox="0 0 16 16"><path d="M3.25 8.5 6.5 11.75 12.75 4.75"/></symbol>
<symbol id="i-alert" viewBox="0 0 16 16"><path d="M8 2.25 14.5 13.5h-13L8 2.25Z"/><path d="M8 6.25v3"/><circle class="f" cx="8" cy="11.4" r=".95"/></symbol>
<symbol id="i-x" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8"/></symbol>
<symbol id="i-key" viewBox="0 0 16 16"><circle cx="10.5" cy="5.5" r="2.75"/><path d="M8.55 7.45 3 13v0M5.5 10.5 7 12M3.5 12.5l1.25 1.25"/></symbol>
<symbol id="i-shield" viewBox="0 0 16 16"><path d="M8 1.75l5 1.6v4.15c0 3.15-2.05 5.25-5 6.75-2.95-1.5-5-3.6-5-6.75V3.35l5-1.6Z"/><path d="M5.9 7.9 7.4 9.4l2.9-3"/></symbol>
<symbol id="i-pen" viewBox="0 0 16 16"><path d="M11.4 2.35l2.25 2.25-8.1 8.1H3.3v-2.25l8.1-8.1Z"/><path d="M2.5 14.75h11"/></symbol>
<symbol id="i-folder" viewBox="0 0 16 16"><path d="M1.75 13.25V3.75a.5.5 0 0 1 .5-.5h3.4l1.5 1.75h6.6a.5.5 0 0 1 .5.5v7.75a.5.5 0 0 1-.5.5h-12a.5.5 0 0 1-.5-.5Z"/></symbol>
<symbol id="i-globe" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25"/><path d="M1.75 8h12.5M8 1.75c2 2.1 2 10.4 0 12.5M8 1.75c-2 2.1-2 10.4 0 12.5"/></symbol>
<symbol id="i-copy" viewBox="0 0 16 16"><rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.25"/><path d="M10.25 5.75V2.5a.75.75 0 0 0-.75-.75h-7A.75.75 0 0 0 1.75 2.5v7a.75.75 0 0 0 .75.75h3.25"/></symbol>
<symbol id="i-sync" viewBox="0 0 16 16"><path d="M13.75 8a5.75 5.75 0 0 1-9.8 4.05M2.25 8a5.75 5.75 0 0 1 9.8-4.05"/><path d="M12.05 1.3v2.65H9.4M3.95 14.7v-2.65H6.6"/></symbol>
<symbol id="i-plus" viewBox="0 0 16 16"><path d="M8 2.75v10.5M2.75 8h10.5"/></symbol>
<symbol id="i-trash" viewBox="0 0 16 16"><path d="M2.75 5h10.5M6 5V3.25h4V5"/><path d="M4.25 5l.7 8.35a.5.5 0 0 0 .5.4h5.1a.5.5 0 0 0 .5-.4L11.75 5"/></symbol>
<symbol id="i-duplicate" viewBox="0 0 16 16"><rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.25"/><path d="M10.25 3.5h-7.5a.75.75 0 0 0-.75.75v7.5"/></symbol>
<symbol id="i-star" viewBox="0 0 16 16"><path d="m8 1.9 1.85 3.85 4.25.55-3.1 2.95.8 4.2L8 11.4l-3.8 2.05.8-4.2L1.9 6.3l4.25-.55L8 1.9Z"/></symbol>
<symbol id="i-chevron-right" viewBox="0 0 16 16"><path d="m6 3.5 4.75 4.5L6 12.5"/></symbol>
<symbol id="i-chevron-down" viewBox="0 0 16 16"><path d="m3.5 6 4.5 4.75L12.5 6"/></symbol>
<symbol id="i-arrow-up" viewBox="0 0 16 16"><path d="M8 13.25V3.25M4.25 7 8 3.25 11.75 7"/></symbol>
<symbol id="i-arrow-down" viewBox="0 0 16 16"><path d="M8 2.75v10M4.25 9 8 12.75 11.75 9"/></symbol>
<symbol id="i-external" viewBox="0 0 16 16"><path d="M9.25 2.75h4v4M13.25 2.75 7.5 8.5"/><path d="M12 9.75v3a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5h3"/></symbol>
<symbol id="i-info" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25"/><path d="M8 7.4v4"/><circle class="f" cx="8" cy="4.9" r=".95"/></symbol>
<symbol id="i-terminal" viewBox="0 0 16 16"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.25"/><path d="M4.75 6.5 6.6 8.35l-1.85 1.85M8.6 10.5h3.25"/></symbol>
<symbol id="i-moon" viewBox="0 0 16 16"><path d="M13.1 10.3A5.6 5.6 0 0 1 5.7 2.9a6.1 6.1 0 1 0 7.4 7.4Z"/></symbol>
<symbol id="i-sun" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.1"/><path d="M8 1.25v1.4M8 13.35v1.4M1.25 8h1.4M13.35 8h1.4M3.2 3.2l1 1M11.8 11.8l1 1M12.8 3.2l-1 1M4.2 11.8l-1 1"/></symbol>
<symbol id="i-search" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.25"/><path d="m10.2 10.2 3.55 3.55"/></symbol>
<symbol id="i-plug" viewBox="0 0 16 16"><path d="M6 1.75v3M10 1.75v3M3.75 4.75h8.5v2.4a4.25 4.25 0 0 1-8.5 0v-2.4ZM8 11.4v2.85"/></symbol>
<symbol id="i-file-code" viewBox="0 0 16 16"><path d="M3.25 1.75h5.5l3.75 3.75v8.75a.5.5 0 0 1-.5.5h-8.75a.5.5 0 0 1-.5-.5V2.25a.5.5 0 0 1 .5-.5Z"/><path d="M8.5 1.75V5.5h3.75"/><path d="M6.6 8.75 5.35 10.2 6.6 11.65M9.4 8.75l1.25 1.45-1.25 1.45"/></symbol>
<symbol id="i-branch" viewBox="0 0 16 16"><circle cx="4" cy="3.5" r="1.9"/><circle cx="4" cy="12.5" r="1.9"/><circle cx="12" cy="3.5" r="1.9"/><path d="M4 5.4v5.2M12 5.4v.85c0 2.3-1.9 3.3-4.6 3.6"/></symbol>
<symbol id="i-link" viewBox="0 0 16 16"><path d="m6.25 9.75 3.5-3.5M7.1 4.4 8.5 3a2.9 2.9 0 0 1 4.1 4.1l-1.4 1.4M8.9 11.6 7.5 13a2.9 2.9 0 0 1-4.1-4.1l1.4-1.4"/></symbol>
<symbol id="i-win-min" viewBox="0 0 16 16"><path d="M3 8h10"/></symbol>
<symbol id="i-win-max" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1"/></symbol>
`;

export type IconName =
  | "person"
  | "rules"
  | "pulse"
  | "sliders"
  | "clone"
  | "check"
  | "alert"
  | "x"
  | "key"
  | "shield"
  | "pen"
  | "folder"
  | "globe"
  | "copy"
  | "sync"
  | "plus"
  | "trash"
  | "duplicate"
  | "star"
  | "chevron-right"
  | "chevron-down"
  | "arrow-up"
  | "arrow-down"
  | "external"
  | "info"
  | "terminal"
  | "moon"
  | "sun"
  | "search"
  | "plug"
  | "file-code"
  | "branch"
  | "link"
  | "win-min"
  | "win-max";

export function IconSprite() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <defs dangerouslySetInnerHTML={{ __html: SYMBOLS }} />
    </svg>
  );
}

export function Icon({ name, className = "icon" }: { name: IconName; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
