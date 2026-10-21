/* ═══════════════════════════════════════════════════════════════════════════
   GitProfile Manager — prototipo
   Estado, datos de ejemplo y comportamiento. Los datos son verosímiles y
   coherentes entre vistas; el prototipo no ejecuta Git.
   ═══════════════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

/* ─── utilidades ─────────────────────────────────────────────────────────── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const ico = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/* ═══ Datos ═══════════════════════════════════════════════════════════════ */

const SSH_EXE = 'C:/Windows/System32/OpenSSH/ssh.exe';

const PROFILES = [
  {
    id: 'personal', name: 'Personal', slug: 'personal',
    provider: 'GitHub', host: 'github.com',
    userName: 'Alex Romero', email: 'alex@personal.dev',
    sshKey: '~/.ssh/id_ed25519_personal', alias: 'github-personal',
    httpsUser: 'alex-romero',
    signing: { mode: 'ssh', key: '~/.ssh/id_ed25519_personal.pub', uploaded: true },
    isDefault: true, clone: 'SSH',
    caps: { ssh: 'ok', https: 'ok', sign: 'ok' },
    conn: { state: 'ok', account: 'alex-romero', when: 'hoy 09:12' },
    cred: { state: 'ok', when: 'hoy 09:12' },
    rules: []
  },
  {
    id: 'trabajo', name: 'Trabajo — Empresa A', slug: 'trabajo',
    provider: 'GitHub', host: 'github.com',
    userName: 'Alex Romero', email: 'alex.romero@empresa-a.com',
    sshKey: '~/.ssh/id_ed25519_trabajo', alias: 'github-trabajo',
    httpsUser: 'romero-empresa-a',
    signing: { mode: 'ssh', key: '~/.ssh/id_ed25519_trabajo.pub', uploaded: false },
    isDefault: false, clone: 'SSH',
    caps: { ssh: 'ok', https: 'ok', sign: 'warn' },
    conn: { state: 'ok', account: 'romero-empresa-a', when: 'ayer 18:30' },
    cred: { state: 'ok', when: 'ayer 18:30' },
    rules: [
      { type: 'folder', value: 'C:/dev/empresa-a/' },
      { type: 'org', value: 'empresa-a' }
    ]
  },
  {
    id: 'labs', name: 'Labs — Empresa A', slug: 'labs',
    provider: 'GitHub', host: 'github.com',
    userName: 'Alex Romero', email: 'labs@empresa-a.com',
    sshKey: '', alias: '',
    httpsUser: '',
    signing: { mode: 'none', key: '', uploaded: false },
    isDefault: false, clone: 'SSH',
    caps: { ssh: 'warn', https: 'warn', sign: 'off' },
    conn: { state: 'none', account: '', when: '' },
    cred: { state: 'none', when: '' },
    rules: [
      { type: 'folder', value: 'C:/dev/empresa-a/labs/' }
    ]
  },
  {
    id: 'cliente-b', name: 'Cliente B', slug: 'cliente-b',
    provider: 'GitLab', host: 'gitlab.com',
    userName: 'Alex Romero', email: 'alex@cliente-b.io',
    sshKey: '~/.ssh/id_ed25519_cliente-b', alias: 'gitlab-cliente-b',
    httpsUser: 'a.romero',
    signing: { mode: 'none', key: '', uploaded: false },
    isDefault: false, clone: 'HTTPS',
    caps: { ssh: 'ok', https: 'err', sign: 'off' },
    conn: { state: 'ok', account: 'a.romero', when: 'hace 3 días' },
    cred: { state: 'err', when: 'hoy 08:55' },
    rules: [
      { type: 'folder', value: 'C:/dev/cliente-b/' },
      { type: 'org', value: 'cliente-b' }
    ]
  }
];

const byId = (id) => PROFILES.find((p) => p.id === id);

const CAP_LABEL = {
  ssh:   { ok: 'SSH', warn: 'SSH', err: 'SSH', off: 'SSH' },
  https: { ok: 'HTTPS', warn: 'HTTPS', err: 'HTTPS', off: 'HTTPS' },
  sign:  { ok: 'Firma', warn: 'Firma', err: 'Firma', off: 'Firma' }
};
const CAP_STATE = {
  ok:   { cls: 'cap-ok',   icon: 'check', word: 'correcto' },
  warn: { cls: 'cap-warn', icon: 'alert', word: 'pendiente' },
  err:  { cls: 'cap-err',  icon: 'x',     word: 'error' },
  off:  { cls: 'cap-off',  icon: 'info',  word: 'sin configurar' }
};

/* ─── reglas derivadas (orden de evaluación) ─────────────────────────────── */
function conditionsFor(rule, profile) {
  if (rule.type === 'folder') return [`gitdir/i:${rule.value}`];
  return [
    `hasconfig:remote.*.url:git@${profile.host}:${rule.value}/**`,
    `hasconfig:remote.*.url:https://${profile.host}/${rule.value}/**`
  ];
}

function buildRuleRows() {
  const rows = [];
  const def = PROFILES.find((p) => p.isDefault);
  if (def) rows.push({ kind: 'default', profile: def, conditions: ['[include] sin condición'] });

  PROFILES.forEach((p) => p.rules.filter((r) => r.type === 'folder')
    .forEach((r) => rows.push({ kind: 'folder', profile: p, rule: r, conditions: conditionsFor(r, p) })));
  PROFILES.forEach((p) => p.rules.filter((r) => r.type === 'org')
    .forEach((r) => rows.push({ kind: 'org', profile: p, rule: r, conditions: conditionsFor(r, p) })));

  /* Conflicto: dos carpetas que se solapan con emails distintos. */
  const folders = rows.filter((r) => r.kind === 'folder');
  folders.forEach((a, i) => folders.forEach((b, j) => {
    if (i >= j) return;
    const [x, y] = [a.rule.value.toLowerCase(), b.rule.value.toLowerCase()];
    const overlap = x.startsWith(y) || y.startsWith(x);
    if (overlap && a.profile.email !== b.profile.email) {
      const winner = rows.indexOf(a) > rows.indexOf(b) ? a : b;
      a.conflict = b.conflict = {
        id: `${a.profile.id}|${b.profile.id}`,
        winner: winner.profile,
        reason: 'Carpetas solapadas con emails distintos'
      };
    }
  }));
  return rows;
}
let RULE_ROWS = buildRuleRows();

/* ─── repositorios y diagnóstico ─────────────────────────────────────────── */
const REPOS = [
  {
    path: 'C:\\dev\\empresa-a\\labs\\api-gateway', profile: 'Labs — Empresa A (con conflicto)',
    values: [
      { k: 'user.name',  v: 'Alex Romero', scope: 'local',  origin: '.git/config', bad: true },
      { k: 'user.email', v: 'alex@antiguo.com', scope: 'local',  origin: '.git/config', bad: true },
      { k: 'core.sshCommand', v: `${SSH_EXE} -i ~/.ssh/id_ed25519_trabajo -o IdentitiesOnly=yes`, scope: 'global', origin: '~/.gitprofiles/trabajo.gitconfig', profileFile: true },
      { k: 'credential.https://github.com.username', v: 'romero-empresa-a', scope: 'global', origin: '~/.gitprofiles/trabajo.gitconfig', profileFile: true },
      { k: 'gpg.format', v: 'ssh', scope: 'global', origin: '~/.gitprofiles/trabajo.gitconfig', profileFile: true },
      { k: 'user.signingkey', v: '~/.ssh/id_ed25519_trabajo.pub', scope: 'global', origin: '~/.gitprofiles/trabajo.gitconfig', profileFile: true },
      { k: 'commit.gpgsign', v: 'no definido', scope: 'none', origin: '—' }
    ],
    problems: [
      { id: 'local-identity', sev: 'err', title: 'Configuración local que pisa el perfil',
        text: '<code>user.name</code> y <code>user.email</code> están fijados en el ámbito <strong>local</strong> con el email <code>alex@antiguo.com</code>. Ningún perfil puede sobrescribirlos.',
        how: 'Detectado porque el ámbito de esas claves es <code>local</code>, no <code>global</code>.',
        action: 'Eliminar claves locales', diff: 'rm-local-identity' },
      { id: 'multi-profile', sev: 'warn', title: 'Varios perfiles coinciden',
        text: 'Los valores proceden de <code>trabajo.gitconfig</code> y <code>labs.gitconfig</code>. Gana <strong>Labs — Empresa A</strong> para <code>user.*</code> por ser la última regla que coincide; la clave SSH sigue viniendo de Trabajo porque Labs no define ninguna.',
        how: 'Detectado por más de un fichero de perfil entre los orígenes.',
        action: 'Ver reglas', go: 'reglas' },
      { id: 'alias-remote', sev: 'warn', title: 'El remoto usa un alias SSH',
        text: '<code>remote.origin.url = github-trabajo:empresa-a/api-gateway.git</code>. Las reglas por remoto no coincidirán con la URL canónica.',
        how: 'Detectado por el patrón de <code>remote.*.url</code> y <code>remote.*.pushurl</code>.',
        action: 'Normalizar URL', diff: 'normalize-remote' },
      { id: 'foreign-commits', sev: 'info', title: '2 commits locales con un email ajeno',
        text: 'Los commits <code>a71c3f0</code> y <code>5e9bb12</code> (sin subir) llevan <code>alex@antiguo.com</code>.',
        how: 'Detectado con <code>git log @{u}..HEAD --format=%ae</code>.',
        action: null, note: 'Solo aviso: reescribir la historia queda fuera del alcance.' },
      { id: 'submodule', sev: 'info', title: '1 submódulo detectado',
        text: '<code>vendor/shared-protos</code> se analiza de forma recursiva y hereda la identidad por su propia ruta.',
        how: 'Detectado con <code>git submodule status</code>.',
        action: 'Diagnosticar submódulo', go: 'diagnostico' }
    ]
  },
  {
    path: 'C:\\dev\\empresa-a\\web-portal', profile: 'Trabajo — Empresa A',
    values: [
      { k: 'user.name',  v: 'Alex Romero', scope: 'global', origin: '~/.gitprofiles/trabajo.gitconfig', profileFile: true },
      { k: 'user.email', v: 'alex.romero@empresa-a.com', scope: 'global', origin: '~/.gitprofiles/trabajo.gitconfig', profileFile: true },
      { k: 'core.sshCommand', v: `${SSH_EXE} -i ~/.ssh/id_ed25519_trabajo -o IdentitiesOnly=yes`, scope: 'global', origin: '~/.gitprofiles/trabajo.gitconfig', profileFile: true },
      { k: 'credential.https://github.com.username', v: 'romero-empresa-a', scope: 'global', origin: '~/.gitprofiles/trabajo.gitconfig', profileFile: true },
      { k: 'gpg.format', v: 'ssh', scope: 'global', origin: '~/.gitprofiles/trabajo.gitconfig', profileFile: true },
      { k: 'user.signingkey', v: '~/.ssh/id_ed25519_trabajo.pub', scope: 'global', origin: '~/.gitprofiles/trabajo.gitconfig', profileFile: true },
      { k: 'commit.gpgsign', v: 'true', scope: 'global', origin: '~/.gitprofiles/trabajo.gitconfig', profileFile: true }
    ],
    problems: []
  },
  {
    path: 'C:\\dev\\cliente-b\\mobile-app', profile: 'Cliente B',
    values: [
      { k: 'user.name',  v: 'Alex Romero', scope: 'global', origin: '~/.gitprofiles/cliente-b.gitconfig', profileFile: true },
      { k: 'user.email', v: 'alex@cliente-b.io', scope: 'global', origin: '~/.gitprofiles/cliente-b.gitconfig', profileFile: true },
      { k: 'core.sshCommand', v: `${SSH_EXE} -i ~/.ssh/id_ed25519_cliente-b -o IdentitiesOnly=yes`, scope: 'global', origin: '~/.gitprofiles/cliente-b.gitconfig', profileFile: true },
      { k: 'credential.https://gitlab.com.username', v: 'a.romero', scope: 'global', origin: '~/.gitprofiles/cliente-b.gitconfig', profileFile: true },
      { k: 'gpg.format', v: 'no definido', scope: 'none', origin: '—' },
      { k: 'user.signingkey', v: 'no definido', scope: 'none', origin: '—' },
      { k: 'commit.gpgsign', v: 'no definido', scope: 'none', origin: '—' }
    ],
    problems: [
      { id: 'bad-cred', sev: 'err', title: 'Credencial HTTPS no válida',
        text: 'La comprobación contra <code>gitlab.com</code> con el usuario <code>a.romero</code> ha fallado. El token puede haber caducado.',
        how: 'Detectado con <code>git ls-remote</code> usando <code>GCM_INTERACTIVE=never</code>.',
        action: 'Dar de alta de nuevo', go: 'perfiles', focusProfile: 'cliente-b', focusTab: 'https' }
    ]
  },
  {
    path: 'C:\\proyectos\\sandbox', profile: 'Perfil por defecto (Personal)',
    values: [
      { k: 'user.name',  v: 'Alex Romero', scope: 'global', origin: '~/.gitprofiles/personal.gitconfig', profileFile: true },
      { k: 'user.email', v: 'alex@personal.dev', scope: 'global', origin: '~/.gitprofiles/personal.gitconfig', profileFile: true },
      { k: 'core.sshCommand', v: `${SSH_EXE} -i ~/.ssh/id_ed25519_personal -o IdentitiesOnly=yes`, scope: 'global', origin: '~/.gitprofiles/personal.gitconfig', profileFile: true },
      { k: 'credential.https://github.com.username', v: 'alex-romero', scope: 'global', origin: '~/.gitprofiles/personal.gitconfig', profileFile: true },
      { k: 'gpg.format', v: 'ssh', scope: 'global', origin: '~/.gitprofiles/personal.gitconfig', profileFile: true },
      { k: 'user.signingkey', v: '~/.ssh/id_ed25519_personal.pub', scope: 'global', origin: '~/.gitprofiles/personal.gitconfig', profileFile: true },
      { k: 'commit.gpgsign', v: 'true', scope: 'global', origin: '~/.gitprofiles/personal.gitconfig', profileFile: true }
    ],
    problems: [
      { id: 'no-rule', sev: 'info', title: 'Ninguna regla específica cubre este repo',
        text: 'Se aplica el <strong>perfil por defecto</strong> (Personal). Si este repo es de trabajo, commitearás con el email personal.',
        how: 'Detectado porque todos los valores vienen del include sin condición.',
        action: 'Crear regla de carpeta', diff: 'create-rule' }
    ]
  }
];

const BACKUPS = [
  { file: 'gitconfig.2026-10-17_09-41.bak', when: 'hoy 09:41 · antes de regenerar reglas' },
  { file: 'ssh-config.2026-10-17_09-41.bak', when: 'hoy 09:41 · antes de añadir el Include' },
  { file: 'gitconfig.2026-10-16_18-30.bak', when: 'ayer 18:30 · antes de activar la integración' }
];

/* ─── diffs y comandos (vista previa obligatoria) ────────────────────────── */
const DIFFS = {
  drift: {
    title: 'Regenerar personal.gitconfig',
    note: 'Se guardará una copia en backups antes de escribir.',
    warn: 'Las dos líneas añadidas a mano se perderán al regenerar.',
    blocks: [{ type: 'diff', file: '~/.gitprofiles/personal.gitconfig', lines: [
      ['ctx', '# Generado por GitProfile Manager. No editar a mano.'],
      ['ctx', '[user]'],
      ['ctx', '    name = Alex Romero'],
      ['ctx', '    email = alex@personal.dev'],
      ['del', '[alias]'],
      ['del', '    lg = log --oneline --graph --decorate'],
      ['ctx', '[core]'],
      ['ctx', `    sshCommand = ${SSH_EXE} -i ~/.ssh/id_ed25519_personal -o IdentitiesOnly=yes`]
    ] }],
    done: 'personal.gitconfig regenerado'
  },
  deactivate: {
    title: 'Desactivar la integración con Git',
    note: 'Se retiran dos líneas y se restaura la identidad global guardada. Las claves SSH no se tocan.',
    warn: 'Git dejará de resolver perfiles por reglas hasta que vuelvas a activar la integración.',
    blocks: [
      { type: 'diff', file: '~/.gitconfig', lines: [
        ['del', '[include]'],
        ['del', '    path = ~/.gitprofiles/rules.gitconfig'],
        ['add', '[user]'],
        ['add', '    name = Alex Romero'],
        ['add', '    email = alex@personal.dev']
      ] },
      { type: 'diff', file: '~/.ssh/config', lines: [
        ['del', 'Include gitprofile.conf'],
        ['ctx', ''],
        ['ctx', 'Host *'],
        ['ctx', '    AddKeysToAgent yes']
      ] }
    ],
    done: 'Integración desactivada'
  },
  'rm-local-identity': {
    title: 'Eliminar la identidad local del repositorio',
    note: 'Solo se eliminan esas dos claves del ámbito local; el resto de .git/config queda intacto.',
    blocks: [{ type: 'cmd', lines: [
      'git -C C:/dev/empresa-a/labs/api-gateway config --local --unset user.name',
      'git -C C:/dev/empresa-a/labs/api-gateway config --local --unset user.email'
    ] }],
    done: 'Identidad local eliminada · ahora manda el perfil'
  },
  'normalize-remote': {
    title: 'Normalizar la URL del remoto',
    note: 'La URL pasa a ser canónica, sin alias SSH ni usuario incrustado.',
    blocks: [{ type: 'cmd', lines: [
      'git -C C:/dev/empresa-a/labs/api-gateway remote set-url origin git@github.com:empresa-a/api-gateway.git'
    ] }, { type: 'diff', file: '.git/config', lines: [
      ['ctx', '[remote "origin"]'],
      ['del', '    url = github-trabajo:empresa-a/api-gateway.git'],
      ['add', '    url = git@github.com:empresa-a/api-gateway.git']
    ] }],
    done: 'Remoto normalizado'
  },
  'create-rule': {
    title: 'Crear una regla de carpeta',
    note: 'La regla se añade a rules.gitconfig; no se toca ningún repositorio.',
    blocks: [{ type: 'diff', file: '~/.gitprofiles/rules.gitconfig', lines: [
      ['ctx', '[includeIf "gitdir/i:C:/dev/cliente-b/"]'],
      ['ctx', '    path = cliente-b.gitconfig'],
      ['add', '[includeIf "gitdir/i:C:/proyectos/sandbox/"]'],
      ['add', '    path = personal.gitconfig']
    ] }],
    done: 'Regla creada · rules.gitconfig regenerado'
  },
  'save-profile': {
    title: 'Guardar el perfil y regenerar sus ficheros',
    note: 'Se regeneran los ficheros propios de la app. El .gitconfig del usuario no cambia.',
    blocks: [{ type: 'cmd', lines: [
      'git config --file ~/.gitprofiles/trabajo.gitconfig user.email alex.romero@empresa-a.com',
      'git config --file ~/.gitprofiles/trabajo.gitconfig core.sshCommand "…ssh.exe -i ~/.ssh/id_ed25519_trabajo -o IdentitiesOnly=yes"'
    ] }],
    done: 'Perfil guardado · 2 ficheros regenerados'
  },
  'new-key': {
    title: 'Crear una clave SSH para este perfil',
    note: 'Nunca se sobrescribe una clave existente. La clave privada no sale de ~/.ssh.',
    blocks: [{ type: 'cmd', lines: [
      'ssh-keygen -t ed25519 -C labs@empresa-a.com -f ~/.ssh/id_ed25519_labs'
    ] }],
    done: 'Clave creada · recuerda subir la pública al proveedor'
  },
  'fix-acl': {
    title: 'Corregir los permisos de la clave privada',
    note: 'OpenSSH para Windows rechaza una clave privada accesible por otros usuarios.',
    blocks: [{ type: 'cmd', lines: [
      'icacls ~/.ssh/id_ed25519_trabajo /inheritance:r',
      'icacls ~/.ssh/id_ed25519_trabajo /grant:r "%USERNAME%":F'
    ] }],
    done: 'Permisos corregidos'
  },
  'delete-rule': {
    title: 'Eliminar la regla',
    note: 'Los repositorios afectados pasarán a resolverse con el perfil por defecto.',
    blocks: [{ type: 'diff', file: '~/.gitprofiles/rules.gitconfig', lines: [
      ['del', '[includeIf "gitdir/i:C:/dev/empresa-a/labs/"]'],
      ['del', '    path = labs.gitconfig']
    ] }],
    done: 'Regla eliminada'
  },
  activate: {
    title: 'Activar la integración',
    note: 'Son los dos únicos ficheros del usuario que toca la app, con una línea cada uno.',
    blocks: [
      { type: 'diff', file: '~/.gitconfig', lines: [
        ['del', '[user]'],
        ['del', '    name = Alex Romero'],
        ['del', '    email = alex@personal.dev'],
        ['add', '[include]'],
        ['add', '    path = ~/.gitprofiles/rules.gitconfig']
      ] },
      { type: 'diff', file: '~/.ssh/config', lines: [
        ['add', 'Include gitprofile.conf'],
        ['ctx', ''],
        ['ctx', 'Host *'],
        ['ctx', '    AddKeysToAgent yes']
      ] }
    ],
    done: 'Integración activada'
  }
};

/* ═══ Estado ══════════════════════════════════════════════════════════════ */
const state = {
  view: 'perfiles',
  profile: 'trabajo',
  tab: 'identidad',
  repo: 0,
  theme: 'light',
  pendingDiff: null,
  obStep: 1
};

/* ═══ Avisos flotantes ════════════════════════════════════════════════════ */
function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast${kind === 'ok' ? '' : ' is-' + kind}`;
  el.innerHTML = `${ico(kind === 'ok' ? 'check' : kind === 'err' ? 'x' : 'alert')}<span>${msg}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('is-out'); setTimeout(() => el.remove(), 200); }, 3600);
}

/* ═══ Navegación ══════════════════════════════════════════════════════════ */
const VIEWS = ['perfiles', 'reglas', 'diagnostico', 'ajustes'];

function goto(view, { push = true } = {}) {
  if (!VIEWS.includes(view)) view = 'perfiles';
  state.view = view;
  VIEWS.forEach((v) => { $(`#view-${v}`).hidden = v !== view; });
  $$('.nav-item').forEach((b) => {
    const on = b.dataset.view === view;
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (push && location.hash.slice(1) !== view) location.hash = view;
  $('#main').scrollTop = 0;
}

$$('.nav-item').forEach((b) => b.addEventListener('click', () => goto(b.dataset.view)));
window.addEventListener('hashchange', () => goto(location.hash.slice(1), { push: false }));

/* ═══ Tema ════════════════════════════════════════════════════════════════ */
function setTheme(t) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  const dark = t === 'dark';
  $('#theme-toggle').setAttribute('aria-pressed', String(dark));
  $('#theme-toggle use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  $('#theme-toggle .sr-only').textContent = dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
  $('#sel-theme').value = t;
}
$('#theme-toggle').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
$('#sel-theme').addEventListener('change', (e) => setTheme(e.target.value));

/* ═══ Superposiciones ═════════════════════════════════════════════════════ */
let lastFocus = null;

function openOverlay(id) {
  lastFocus = document.activeElement;
  const ov = $(id);
  ov.hidden = false;
  const first = ov.querySelector('input, select, button:not([data-close-overlay])') || ov.querySelector('button');
  if (first) first.focus();
}
function closeOverlay(ov) {
  ov.hidden = true;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-close-overlay]');
  if (t) closeOverlay(t.closest('.overlay'));
});
document.addEventListener('keydown', (e) => {
  const open = $$('.overlay').filter((o) => !o.hidden).pop();
  if (!open) return;
  if (e.key === 'Escape') { e.preventDefault(); closeOverlay(open); return; }
  if (e.key !== 'Tab') return;
  const f = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', open)
    .filter((el) => el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* ═══ Vista previa de cambios (diff / comando) ════════════════════════════ */
function renderDiffBlocks(def) {
  return def.blocks.map((b) => {
    if (b.type === 'cmd') {
      return `<div class="od-field" style="--od-gap:6px">
        <span class="label-like">Comando</span>
        ${b.lines.map((l) => `<div class="cmd"><span class="prompt">&gt;</span><span class="text">${esc(l)}</span></div>`).join('')}
      </div>`;
    }
    return `<div class="od-field" style="--od-gap:6px">
      <span class="label-like">Fichero</span>
      <div class="diff">
        <div class="diff-file">${esc(b.file)}</div>
        <div class="diff-body">${b.lines.map(([k, txt]) => {
          const sign = k === 'add' ? '+' : k === 'del' ? '\u2212' : ' ';
          const word = k === 'add' ? 'línea añadida' : k === 'del' ? 'línea eliminada' : 'sin cambios';
          return `<div class="diff-line${k === 'add' ? ' is-add' : k === 'del' ? ' is-del' : ''}">
            <span class="sign" aria-hidden="true">${sign}</span>
            <span class="text"><span class="sr-only">${word}: </span>${esc(txt) || '&nbsp;'}</span>
          </div>`;
        }).join('')}</div>
      </div>
    </div>`;
  }).join('');
}

function askDiff(keyOrDef, onApply) {
  const def = typeof keyOrDef === 'string' ? DIFFS[keyOrDef] : keyOrDef;
  if (!def) return;
  const key = typeof keyOrDef === 'string' ? keyOrDef : (def.id || 'dynamic');
  state.pendingDiff = { key, def, onApply };
  $('#diff-title').textContent = def.title;
  $('#diff-note').textContent = def.note;
  $('#diff-body').innerHTML =
    (def.warn ? `<div class="banner banner-warn" style="margin:0">${ico('alert')}
      <div class="od-fill"><strong>Antes de continuar</strong>
      <span class="banner-text" style="display:block">${def.warn}</span></div></div>` : '') +
    renderDiffBlocks(def);
  $('#btn-apply-diff').className = 'btn ' + (key === 'deactivate' ? 'btn-danger' : 'btn-primary');
  $('#btn-apply-diff').textContent = def.applyLabel || (key === 'deactivate' ? 'Desactivar' : 'Aplicar cambio');
  openOverlay('#overlay-diff');
}

$('#btn-apply-diff').addEventListener('click', () => {
  const p = state.pendingDiff;
  closeOverlay($('#overlay-diff'));
  if (!p) return;
  toast(p.def.done);
  $('#status-msg').textContent = `${p.def.done} · ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  if (p.onApply) p.onApply();
  state.pendingDiff = null;
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-diff]');
  if (t) askDiff(t.dataset.diff);
  const d = e.target.closest('[data-dismiss]');
  if (d) { const el = $('#' + d.dataset.dismiss); if (el) el.hidden = true; }
});

/* ═══ Vista: Perfiles ═════════════════════════════════════════════════════ */

function capPill(kind, stateKey) {
  const s = CAP_STATE[stateKey];
  return `<span class="cap ${s.cls}">${ico(s.icon)}<span>${CAP_LABEL[kind][stateKey]}</span>
    <span class="sr-only">: ${s.word}</span></span>`;
}

function profileRowHtml(p) {
  if (p.isDraft) {
    return `<li>
      <button type="button" class="profile-item is-draft" data-profile="${DRAFT_ID}"
              aria-current="${state.profile === DRAFT_ID}">
        <span>
          <span class="profile-name od-truncate">${p.name.trim() ? esc(p.name) : 'Nuevo perfil'}</span>
          <span class="profile-mail od-truncate">${p.email.trim() ? esc(p.email) : 'sin identidad todavía'}</span>
          <span class="profile-caps"><span class="cap cap-off">${ico('pen')}<span>Sin guardar</span></span></span>
        </span>
        <span></span>
      </button>
    </li>`;
  }
  return `<li>
      <button type="button" class="profile-item" data-profile="${p.id}"
              aria-current="${p.id === state.profile}">
        <span>
          <span class="profile-name od-truncate">${esc(p.name)}</span>
          <span class="profile-mail od-truncate">${esc(p.email)}</span>
          <span class="profile-caps">${capPill('ssh', p.caps.ssh)}${capPill('https', p.caps.https)}${capPill('sign', p.caps.sign)}</span>
        </span>
        ${p.isDefault ? `<span class="default-star">${ico('star')}<span class="sr-only">Perfil por defecto</span></span>` : '<span></span>'}
      </button>
    </li>`;
}

function renderProfileList() {
  const rows = PROFILES.concat(state.draft ? [state.draft] : []);
  $('#profile-list').innerHTML = rows.map(profileRowHtml).join('');
  $$('#profile-list .profile-item').forEach((b) => b.addEventListener('click', () => {
    captureDraft();
    state.profile = b.dataset.profile;
    state.tab = 'identidad';
    renderProfileList(); renderProfileDetail();
  }));
  renderCounts();
}

function renderCounts() {
  const n = PROFILES.length;
  $('.nav-item[data-view="perfiles"] .nav-count').textContent = String(n);
  $('.titlebar-sub').textContent = `${n} ${n === 1 ? 'perfil' : 'perfiles'}${state.draft ? ' · 1 sin guardar' : ''} · integración activa`;
}

const TABS = [
  { id: 'identidad', label: 'Identidad', icon: 'person' },
  { id: 'ssh', label: 'SSH', icon: 'key' },
  { id: 'https', label: 'HTTPS', icon: 'link' },
  { id: 'firma', label: 'Firma', icon: 'shield' },
  { id: 'reglas', label: 'Reglas', icon: 'rules' }
];

function profileHeadHtml(p) {
  const conn = p.conn.state === 'ok'
    ? `<span class="pill pill-ok">${ico('check', 'icon icon-12')}Conectado como ${esc(p.conn.account)}</span>`
    : `<span class="pill pill-neutral">${ico('info', 'icon icon-12')}Sin probar</span>`;
  return `<div class="detail-head">
    <div class="od-fill od-stack" style="--od-gap:6px">
      <div class="detail-title">
        <h2>${esc(p.name)}</h2>
        ${p.isDefault ? '<span class="tag">Por defecto</span>' : ''}
        <span class="tag tag-neutral">${esc(p.provider)}</span>
      </div>
      <div class="od-cluster" style="--od-gap:6px">
        <code>${esc(p.email)}</code>${conn}
        <span class="meta od-nowrap">slug <code>${esc(p.slug)}</code></span>
      </div>
    </div>
    <div class="od-cluster od-fixed">
      ${p.isDefault ? '' : `<button type="button" class="btn btn-default btn-sm" data-act="make-default">${ico('star')}<span>Marcar por defecto</span></button>`}
      <button type="button" class="btn btn-default btn-sm" data-act="duplicate">${ico('duplicate')}<span>Duplicar</span></button>
      <button type="button" class="btn btn-danger btn-sm" data-act="delete">${ico('trash')}<span>Eliminar</span></button>
    </div>
  </div>`;
}

function tabIdentidad(p) {
  return `<div class="panel"><div class="panel-body od-stack" style="--od-gap:16px">
    <div class="kv-grid">
      <div class="od-field" style="--od-gap:6px">
        <label for="f-name">Nombre visible <span class="req">obligatorio</span></label>
        <input id="f-name" class="input" value="${esc(p.name)}">
      </div>
      <div class="od-field" style="--od-gap:6px">
        <label for="f-slug">Slug <span class="req">obligatorio</span></label>
        <input id="f-slug" class="input input-mono" value="${esc(p.slug)}" aria-describedby="f-slug-help">
        <span id="f-slug-help" class="field-help">Se usa en nombres de fichero y alias SSH. Solo <code>a-z 0-9 -</code>.</span>
      </div>
      <div class="od-field" style="--od-gap:6px">
        <label for="f-user">user.name <span class="req">obligatorio</span></label>
        <input id="f-user" class="input" value="${esc(p.userName)}">
      </div>
      <div class="od-field" style="--od-gap:6px">
        <label for="f-email">user.email <span class="req">obligatorio</span></label>
        <input id="f-email" class="input" type="email" value="${esc(p.email)}" aria-describedby="f-email-err">
        <span id="f-email-err" class="field-err" hidden></span>
      </div>
      <div class="od-field" style="--od-gap:6px">
        <label for="f-provider">Proveedor</label>
        <select id="f-provider" class="input">
          ${['GitHub', 'GitLab', 'Bitbucket', 'Otro'].map((v) => `<option${v === p.provider ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="od-field" style="--od-gap:6px">
        <label for="f-host">Host</label>
        <input id="f-host" class="input input-mono" value="${esc(p.host)}" aria-describedby="f-host-help">
        <span id="f-host-help" class="field-help">Cambia este valor si el proveedor es self-hosted.</span>
      </div>
      <div class="od-field" style="--od-gap:6px">
        <span class="label-like" id="l-clone">Método de clonado preferido</span>
        <div class="seg" role="radiogroup" aria-labelledby="l-clone">
          <label class="seg-item"><input type="radio" name="pclone" value="SSH"${p.clone === 'SSH' ? ' checked' : ''}><span>SSH</span></label>
          <label class="seg-item"><input type="radio" name="pclone" value="HTTPS"${p.clone === 'HTTPS' ? ' checked' : ''}><span>HTTPS</span></label>
        </div>
        <span class="field-help">Solo es el valor por defecto en Smart Clone.</span>
      </div>
    </div>
    <div class="od-row" style="--od-gap:8px">
      <span class="od-fill meta">La app nunca cambia <code>user.*</code> global: estos valores van al fichero del perfil.</span>
      <button type="button" class="btn btn-default od-fixed" data-act="revert">Descartar</button>
      <button type="button" class="btn btn-primary od-fixed" data-diff="save-profile">Guardar cambios…</button>
    </div>
  </div></div>`;
}

function tabSsh(p) {
  const hasKey = Boolean(p.sshKey);
  const cmd = hasKey ? `${SSH_EXE} -i ${p.sshKey} -o IdentitiesOnly=yes` : '';
  return `<div class="od-stack" style="--od-gap:16px">
    ${hasKey ? '' : `<div class="empty">${ico('key', 'icon icon-24')}
      <span class="empty-title">Este perfil aún no tiene clave SSH</span>
      <span class="empty-text">Sin clave, Git usará la del perfil que coincida antes o la que ofrezca el agente. Crea una clave dedicada o importa una existente.</span>
      <span class="od-cluster" style="justify-content:center">
        <button type="button" class="btn btn-primary btn-sm" data-diff="new-key">${ico('plus')}<span>Crear clave ed25519</span></button>
        <button type="button" class="btn btn-default btn-sm" data-act="import-key">${ico('folder')}<span>Importar existente</span></button>
      </span></div>`}

    ${hasKey ? `<div class="panel">
      <div class="panel-head">Clave del perfil</div>
      <div class="panel-body od-stack" style="--od-gap:12px">
        <div class="kv-grid">
          <div class="od-stat" style="--od-gap:4px">
            <span class="kv-label">Clave privada</span>
            <code class="kv-value od-truncate">${esc(p.sshKey)}</code>
          </div>
          <div class="od-stat" style="--od-gap:4px">
            <span class="kv-label">Clave pública</span>
            <code class="kv-value od-truncate">${esc(p.sshKey)}.pub</code>
          </div>
        </div>
        <div class="od-field" style="--od-gap:6px">
          <span class="label-like">Se materializa en <code>core.sshCommand</code></span>
          <pre class="code">${esc(cmd)}</pre>
          <span class="field-help"><code>IdentitiesOnly=yes</code> impide que se ofrezca la clave de otro perfil. La URL remota sigue siendo la canónica.</span>
        </div>
        <div class="inline-status" id="acl-status">
          ${ico('check')}<span class="od-fill">Permisos correctos: solo tu usuario tiene acceso a la clave privada.</span>
          <button type="button" class="btn btn-default btn-sm od-fixed" data-diff="fix-acl">Revisar ACL</button>
        </div>
        <div class="od-cluster">
          <button type="button" class="btn btn-default" data-act="copy-pub">${ico('copy')}<span>Copiar clave pública</span></button>
          <button type="button" class="btn btn-default" data-act="open-provider">${ico('external')}<span>Abrir claves de ${esc(p.provider)}</span></button>
        </div>
      </div>
    </div>` : ''}

    <div class="panel">
      <div class="panel-head">Prueba de conexión</div>
      <div class="panel-body od-stack" style="--od-gap:10px">
        <pre class="code">ssh -T git@${esc(p.host)}${hasKey ? ` -i ${esc(p.sshKey)} -o IdentitiesOnly=yes` : ''}</pre>
        <div class="inline-status${p.conn.state === 'ok' ? '' : ' is-warn'}" id="conn-status">
          ${ico(p.conn.state === 'ok' ? 'check' : 'alert')}
          <span class="od-fill">${p.conn.state === 'ok'
            ? `El proveedor responde con la cuenta <strong>${esc(p.conn.account)}</strong> · ${esc(p.conn.when)}`
            : 'Sin probar todavía.'}</span>
          <button type="button" class="btn btn-default btn-sm od-fixed" data-act="test-conn"${hasKey ? '' : ' disabled'}>
            ${ico('plug')}<span>Probar conexión</span>
          </button>
        </div>
        ${hasKey ? '' : '<span class="field-help">Configura una clave para poder probar la conexión.</span>'}
      </div>
    </div>

    ${hasKey ? `<div class="panel">
      <div class="panel-head">Alias de host <span class="meta">opcional</span></div>
      <div class="panel-body od-stack" style="--od-gap:10px">
        <p class="meta">Para herramientas que no leen la configuración de Git. El alias no se usa en las URLs remotas.</p>
        <pre class="code">Host ${esc(p.alias)}
    HostName ${esc(p.host)}
    User git
    IdentityFile ${esc(p.sshKey)}
    IdentitiesOnly yes</pre>
        <span class="field-help">Se escribe en <code>~/.ssh/gitprofile.conf</code>, incluido en la primera línea de <code>~/.ssh/config</code>.</span>
      </div>
    </div>` : ''}
  </div>`;
}

function tabHttps(p) {
  const st = p.cred.state;
  const cls = st === 'ok' ? '' : st === 'err' ? ' is-err' : ' is-warn';
  const msg = st === 'ok'
    ? `Credencial válida para <code>${esc(p.host)}</code> · comprobada ${esc(p.cred.when)}`
    : st === 'err'
      ? 'Credencial no válida: <code>git ls-remote</code> ha fallado. El token puede haber caducado.'
      : 'Sin credencial dada de alta para este perfil.';
  return `<div class="od-stack" style="--od-gap:16px">
    <div class="panel">
      <div class="panel-head">Cuenta por host</div>
      <div class="panel-body od-stack" style="--od-gap:12px">
        <div class="od-field" style="--od-gap:6px">
          <label for="f-https">Usuario HTTPS <span class="opt">opcional</span></label>
          <input id="f-https" class="input input-mono" value="${esc(p.httpsUser)}" placeholder="usuario-del-proveedor" aria-describedby="f-https-help">
          <span id="f-https-help" class="field-help">Con <code>username</code> fijado, GCM selecciona la cuenta correcta sin mostrar el selector.</span>
        </div>
        <div class="od-field" style="--od-gap:6px">
          <span class="label-like">Se materializa en</span>
          <pre class="code">[credential "https://${esc(p.host)}"]
    username = ${esc(p.httpsUser || '<sin fijar>')}</pre>
        </div>
        <div class="inline-status${cls}">
          ${ico(st === 'ok' ? 'check' : st === 'err' ? 'x' : 'alert')}
          <span class="od-fill">${msg}</span>
          <button type="button" class="btn btn-default btn-sm od-fixed" data-act="check-cred">${ico('sync')}<span>Comprobar</span></button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">Alta de la credencial</div>
      <div class="panel-body od-stack" style="--od-gap:12px">
        <p class="meta">El secreto lo guarda Git Credential Manager. La app no lo persiste en ningún momento.</p>
        <div class="choice-set">
          <div class="choice" style="cursor:default">
            <span>${ico('external')}</span>
            <span class="choice-body">
              <span class="choice-title">Flujo del proveedor <span class="tag">Recomendado</span></span>
              <span class="choice-help">La app lanza <code>git ls-remote</code> y GCM abre el flujo OAuth en el navegador. La credencial queda guardada por GCM.</span>
              <span style="margin-block-start:8px">
                <button type="button" class="btn btn-primary btn-sm" data-act="oauth">Iniciar el flujo de ${esc(p.provider)}</button>
              </span>
            </span>
          </div>
          <div class="choice" style="cursor:default">
            <span>${ico('key')}</span>
            <span class="choice-body">
              <span class="choice-title">Token pegado en la app</span>
              <span class="choice-help">Se entrega a <code>git credential approve</code> por stdin. No se escribe en disco ni en logs y se descarta de memoria tras la llamada.</span>
              <span class="od-row" style="--od-gap:8px;margin-block-start:8px">
                <input type="password" class="input od-fill" id="f-token" placeholder="Pegar token de acceso" autocomplete="off" aria-label="Token de acceso personal">
                <button type="button" class="btn btn-default od-fixed" data-act="save-token">Guardar en GCM</button>
              </span>
            </span>
          </div>
        </div>
        <div class="od-cluster">
          <button type="button" class="btn btn-danger btn-sm" data-act="reject-cred">${ico('trash')}<span>Eliminar credencial</span></button>
        </div>
      </div>
    </div>
  </div>`;
}

function tabFirma(p) {
  const on = p.signing.mode === 'ssh';
  return `<div class="od-stack" style="--od-gap:16px">
    <div class="panel">
      <div class="panel-head">Modo de firma</div>
      <div class="panel-body od-stack" style="--od-gap:12px">
        <fieldset class="choice-set">
          <legend class="sr-only">Modo de firma de commits</legend>
          <label class="choice"><input type="radio" name="sign" value="none"${p.signing.mode === 'none' ? ' checked' : ''}>
            <span class="choice-body"><span class="choice-title">Ninguna</span>
            <span class="choice-help">Los commits de este perfil no se firman.</span></span></label>
          <label class="choice"><input type="radio" name="sign" value="ssh"${on ? ' checked' : ''}>
            <span class="choice-body"><span class="choice-title">Firma SSH <span class="tag">Recomendado</span></span>
            <span class="choice-help">Reutiliza la clave de la pestaña SSH y el mismo agente. No necesita GPG.</span></span></label>
          <label class="choice"><input type="radio" name="sign" value="gpg"${p.signing.mode === 'gpg' ? ' checked' : ''}>
            <span class="choice-body"><span class="choice-title">GPG</span>
            <span class="choice-help">Solo se referencia el ID de clave; la app no gestiona el anillo de claves.</span></span></label>
        </fieldset>
        ${on ? `<div class="od-field" style="--od-gap:6px">
          <label for="f-signkey">Clave de firma</label>
          <input id="f-signkey" class="input input-mono" value="${esc(p.signing.key)}" aria-describedby="f-signkey-help">
          <span id="f-signkey-help" class="field-help">Puede ser la misma de autenticación o una dedicada.</span>
        </div>` : ''}
      </div>
    </div>

    ${on ? `<div class="panel">
      <div class="panel-head">Se materializa en <code>${esc(p.slug)}.gitconfig</code></div>
      <div class="panel-body od-stack" style="--od-gap:10px">
        <pre class="code">[gpg]
    format = ssh
[gpg "ssh"]
    program = C:/Windows/System32/OpenSSH/ssh-keygen.exe
    allowedSignersFile = ~/.gitprofiles/allowed_signers
[user]
    signingkey = ${esc(p.signing.key)}
[commit]
    gpgsign = true</pre>
        <span class="field-help"><code>allowed_signers</code> se genera con el email y la clave pública de cada perfil, para que <code>git log --show-signature</code> verifique en local.</span>
      </div>
    </div>

    <div class="inline-status${p.signing.uploaded ? '' : ' is-warn'}">
      ${ico(p.signing.uploaded ? 'check' : 'alert')}
      <span class="od-fill">${p.signing.uploaded
        ? `La clave ya está subida a ${esc(p.provider)} como <em>signing key</em>.`
        : `Falta subir la clave a ${esc(p.provider)} como <em>signing key</em>: es un alta distinta de la de autenticación.`}</span>
      ${p.signing.uploaded ? '' : `<button type="button" class="btn btn-default btn-sm od-fixed" data-act="open-provider">${ico('external')}<span>Abrir</span></button>`}
    </div>` : ''}
  </div>`;
}

function tabReglas(p) {
  const rows = p.rules.length ? p.rules.map((r, i) => {
    const conds = conditionsFor(r, p);
    return `<tr>
      <td data-label="Tipo">${r.type === 'folder'
        ? `<span class="pill pill-neutral">${ico('folder', 'icon icon-12')}Carpeta</span>`
        : `<span class="pill pill-neutral">${ico('globe', 'icon icon-12')}Organización</span>`}</td>
      <td data-label="Condición generada"><span class="cond-list">${conds.map((c) => `<span>${esc(c)}</span>`).join('')}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button type="button" class="btn btn-default btn-sm" data-act="edit-rule" data-i="${i}">${ico('pen')}<span class="sr-only">Editar regla</span></button>
        <button type="button" class="btn btn-danger btn-sm" data-diff="delete-rule">${ico('trash')}<span class="sr-only">Eliminar regla</span></button>
      </div></td>
    </tr>`;
  }).join('') : '';

  return `<div class="od-stack" style="--od-gap:16px">
    <div class="panel">
      <div class="panel-head od-row">
        <span class="od-fill">Reglas de este perfil</span>
        <button type="button" class="btn btn-default btn-sm od-fixed" data-act="add-rule">${ico('plus')}<span>Añadir</span></button>
      </div>
      ${p.rules.length ? `<div class="table-wrap"><table class="table">
        <caption class="sr-only">Reglas del perfil ${esc(p.name)}</caption>
        <thead><tr><th scope="col">Tipo</th><th scope="col">Condición generada</th><th scope="col" class="col-act"><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
        : `<div class="panel-body"><div class="empty">${ico('rules', 'icon icon-24')}
            <span class="empty-title">Sin reglas propias</span>
            <span class="empty-text">${p.isDefault
              ? 'Como perfil por defecto, se aplica a todo repo que no coincida con ninguna regla.'
              : 'Este perfil no se aplicará a ningún repositorio hasta que añadas una regla de carpeta o de organización.'}</span>
            <button type="button" class="btn btn-primary btn-sm" data-act="add-rule">${ico('plus')}<span>Añadir regla</span></button>
          </div></div>`}
    </div>

    <div class="panel">
      <div class="panel-head">Vista previa de <code>~/.gitprofiles/${esc(p.slug)}.gitconfig</code></div>
      <div class="panel-body"><pre class="code">${esc(profileFileText(p))}</pre></div>
    </div>
  </div>`;
}

function profileFileText(p) {
  let t = `# Generado por GitProfile Manager. No editar a mano.\n[user]\n    name = ${p.userName}\n    email = ${p.email}\n`;
  if (p.sshKey) t += `[core]\n    sshCommand = ${SSH_EXE} -i ${p.sshKey} -o IdentitiesOnly=yes\n`;
  if (p.httpsUser) t += `[credential "https://${p.host}"]\n    username = ${p.httpsUser}\n`;
  if (p.signing.mode === 'ssh') {
    t += `[gpg]\n    format = ssh\n[gpg "ssh"]\n    program = C:/Windows/System32/OpenSSH/ssh-keygen.exe\n` +
         `    allowedSignersFile = ~/.gitprofiles/allowed_signers\n[user]\n    signingkey = ${p.signing.key}\n[commit]\n    gpgsign = true\n`;
  }
  return t.trimEnd();
}

function rulesFileText() {
  const def = PROFILES.find((p) => p.isDefault);
  let t = '# Generado por GitProfile Manager. No editar a mano.\n';
  t += '# Perfil por defecto: se aplica a todo repo sin regla.\n[include]\n';
  t += `    path = ${def.slug}.gitconfig\n\n`;
  t += '# Reglas: se evalúan después y sobrescriben al perfil por defecto.\n';
  RULE_ROWS.filter((r) => r.kind !== 'default').forEach((r) => {
    r.conditions.forEach((c) => { t += `[includeIf "${c}"]\n    path = ${r.profile.slug}.gitconfig\n`; });
  });
  return t.trimEnd();
}

function renderProfileDetail() {
  const p = currentProfile();
  const tabsHtml = TABS.map((t) => `
    <button type="button" class="tab" role="tab" id="tab-${t.id}" data-tab="${t.id}"
            aria-selected="${t.id === state.tab}" aria-controls="panel-${t.id}"
            tabindex="${t.id === state.tab ? '0' : '-1'}">
      ${ico(t.icon)}<span>${t.label}</span>
      ${t.id === 'reglas' && p.rules.length ? `<span class="meta">${p.rules.length}</span>` : ''}
    </button>`).join('');

  const body = p.isDraft
    ? DRAFT_TABS[state.tab](p)
    : { identidad: tabIdentidad, ssh: tabSsh, https: tabHttps, firma: tabFirma, reglas: tabReglas }[state.tab](p);

  $('#profile-detail').innerHTML = `
    ${p.isDraft ? draftHeadHtml(p) : profileHeadHtml(p)}
    <div>
      <div class="tabs" role="tablist" aria-label="Secciones del perfil">${tabsHtml}</div>
      <div class="tabpanel" role="tabpanel" id="panel-${state.tab}" aria-labelledby="tab-${state.tab}" tabindex="0">${body}</div>
    </div>`;

  $$('#profile-detail .tab').forEach((b) => {
    b.addEventListener('click', () => {
      captureDraft();
      state.tab = b.dataset.tab; renderProfileDetail(); $('#tab-' + state.tab).focus();
    });
    b.addEventListener('keydown', (e) => {
      const i = TABS.findIndex((t) => t.id === state.tab);
      let n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
      if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
      if (e.key === 'Home') n = 0;
      if (e.key === 'End') n = TABS.length - 1;
      if (n === null) return;
      e.preventDefault();
      captureDraft();
      state.tab = TABS[n].id; renderProfileDetail(); $('#tab-' + state.tab).focus();
    });
  });

  if (p.isDraft) wireDraftActions(p); else wireDetailActions(p);
}

/* ─── acciones del detalle ───────────────────────────────────────────────── */
function wireDetailActions(p) {
  const act = (name, fn) => $$(`#profile-detail [data-act="${name}"]`).forEach((b) => b.addEventListener('click', () => fn(b)));

  act('make-default', () => {
    PROFILES.forEach((x) => { x.isDefault = x.id === p.id; });
    RULE_ROWS = buildRuleRows();
    renderProfileList(); renderProfileDetail(); renderRules();
    toast(`${p.name} es ahora el perfil por defecto`);
  });
  act('duplicate', () => toast(`Perfil duplicado como «${p.name} (copia)»`, 'warn'));
  act('delete', () => toast('Eliminar un perfil requiere confirmación: no implementado en el prototipo', 'warn'));
  act('revert', () => { renderProfileDetail(); toast('Cambios descartados', 'warn'); });
  act('copy-pub', () => toast('Clave pública copiada al portapapeles'));
  act('open-provider', () => toast(`Abriendo la página de claves de ${p.provider} en el navegador`));
  act('import-key', () => toast('Se validará que exista el par .pub antes de importar', 'warn'));
  act('add-rule', () => { goto('reglas'); toast('Añade la regla desde la vista Reglas'); });
  act('edit-rule', () => toast('Edición de regla: usa la vista Reglas para reordenar y editar'));
  act('oauth', () => toast(`GCM abrirá el flujo OAuth de ${p.provider} en el navegador`));
  act('save-token', (b) => {
    const input = $('#f-token');
    if (!input.value.trim()) {
      input.classList.add('is-invalid'); input.focus();
      toast('Pega un token antes de guardar', 'err');
      return;
    }
    input.classList.remove('is-invalid');
    input.value = '';
    p.cred.state = 'ok'; p.cred.when = 'ahora'; p.caps.https = 'ok';
    renderProfileList(); renderProfileDetail();
    toast('Token entregado a GCM por stdin y descartado de memoria');
  });
  act('reject-cred', () => {
    p.cred.state = 'none'; p.caps.https = 'warn';
    renderProfileList(); renderProfileDetail();
    toast('git credential reject ejecutado', 'warn');
  });
  act('check-cred', (b) => {
    busy(b, 'Comprobando…');
    setTimeout(() => {
      done(b);
      const ok = p.cred.state === 'ok';
      toast(ok ? `Credencial válida para ${p.host}` : 'La credencial sigue sin ser válida', ok ? 'ok' : 'err');
    }, 1100);
  });
  act('test-conn', (b) => {
    const box = $('#conn-status');
    busy(b, 'Probando…');
    box.className = 'inline-status is-busy';
    box.querySelector('span.od-fill').innerHTML = `Ejecutando <code>ssh -T git@${esc(p.host)}</code>…`;
    setTimeout(() => {
      done(b);
      box.className = 'inline-status';
      box.querySelector('span.od-fill').innerHTML =
        `El proveedor responde con la cuenta <strong>${esc(p.conn.account)}</strong> · ahora`;
      p.conn.when = 'ahora';
      toast(`Conexión correcta como ${p.conn.account}`);
    }, 1400);
  });

  /* validación al perder el foco */
  const email = $('#f-email');
  if (email) email.addEventListener('blur', () => {
    const err = $('#f-email-err');
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value);
    email.classList.toggle('is-invalid', !ok);
    err.hidden = ok;
    if (!ok) err.textContent = 'Formato de email no válido. Git lo escribiría tal cual en cada commit: usa nombre@dominio.';
  });
  const slug = $('#f-slug');
  if (slug) slug.addEventListener('blur', () => {
    const ok = /^[a-z0-9-]+$/.test(slug.value);
    slug.classList.toggle('is-invalid', !ok);
    if (!ok) toast('El slug solo admite a-z, 0-9 y guiones', 'err');
  });
}

function busy(btn, label) {
  btn.dataset.prev = btn.innerHTML;
  btn.classList.add('is-loading');
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = `${ico('sync')}<span>${label}</span>`;
}
function done(btn) {
  btn.classList.remove('is-loading');
  btn.removeAttribute('aria-busy');
  if (btn.dataset.prev) btn.innerHTML = btn.dataset.prev;
}

/* ═══ Alta de perfil (borrador) ═══════════════════════════════════════════
   Un perfil nuevo vive como borrador hasta que se crea: las cinco pestañas
   se muestran en blanco y nada se escribe en disco hasta la confirmación.
   ═══════════════════════════════════════════════════════════════════════ */

const DRAFT_ID = '__draft';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_BY_PROVIDER = { GitHub: 'github.com', GitLab: 'gitlab.com', Bitbucket: 'bitbucket.org', Otro: '' };

state.draft = null;
state.draftErrors = [];

function makeDraft() {
  return {
    id: DRAFT_ID, isDraft: true,
    name: '', slug: '', provider: 'GitHub', host: 'github.com',
    userName: '', email: '', sshKey: '', alias: '', httpsUser: '',
    signing: { mode: 'none', key: '', uploaded: false },
    isDefault: false, clone: 'SSH',
    caps: { ssh: 'off', https: 'off', sign: 'off' },
    conn: { state: 'none', account: '', when: '' },
    cred: { state: 'none', when: '' },
    rules: [],
    slugTouched: false, hostTouched: false
  };
}

function currentProfile() {
  if (state.profile === DRAFT_ID && state.draft) return state.draft;
  return byId(state.profile) || PROFILES[0];
}

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

const defaultSigningKey = (d) => `${d.sshKey.trim() || `~/.ssh/id_ed25519_${d.slug || '<slug>'}`}.pub`;

/* Lee los campos visibles en el borrador antes de volver a pintar, para que
   nada escrito se pierda al cambiar de pestaña o de perfil. */
function captureDraft() {
  const d = state.draft;
  if (!d || state.profile !== DRAFT_ID) return;
  const val = (sel) => { const el = $(sel); return el ? el.value : null; };
  const txt = { name: '#f-name', slug: '#f-slug', userName: '#f-user', email: '#f-email', host: '#f-host', sshKey: '#f-sshkey', httpsUser: '#f-https' };
  Object.entries(txt).forEach(([k, sel]) => { const v = val(sel); if (v !== null) d[k] = v; });
  const prov = val('#f-provider'); if (prov !== null) d.provider = prov;
  const clone = $('input[name="pclone"]:checked'); if (clone) d.clone = clone.value;
  const sign = $('input[name="sign"]:checked'); if (sign) d.signing.mode = sign.value;
  const sk = val('#f-signkey'); if (sk !== null) d.signing.key = sk;
}

function validateDraft(d) {
  const errs = [];
  if (!d.name.trim()) errs.push({ id: 'f-name', field: 'Nombre visible', msg: 'Pon un nombre para reconocer el perfil en la lista, por ejemplo «Trabajo — Empresa A».' });
  if (!d.slug.trim()) errs.push({ id: 'f-slug', field: 'Slug', msg: 'El slug nombra los ficheros generados y el alias SSH. Se deriva del nombre, o escríbelo a mano.' });
  else if (!/^[a-z0-9-]+$/.test(d.slug)) errs.push({ id: 'f-slug', field: 'Slug', msg: 'Solo se admiten a-z, 0-9 y guiones: este valor acaba en nombres de fichero.' });
  else if (PROFILES.some((p) => p.slug === d.slug)) errs.push({ id: 'f-slug', field: 'Slug', msg: `Ya existe un perfil con el slug «${d.slug}». Elige otro para no sobrescribir sus ficheros.` });
  if (!d.userName.trim()) errs.push({ id: 'f-user', field: 'user.name', msg: 'Git escribe este nombre en cada commit de los repos que cubra el perfil.' });
  if (!d.email.trim()) errs.push({ id: 'f-email', field: 'user.email', msg: 'Git escribe este email en cada commit: es el campo que evita commitear con la cuenta equivocada.' });
  else if (!EMAIL_RE.test(d.email)) errs.push({ id: 'f-email', field: 'user.email', msg: 'Formato no válido. Usa la forma nombre@dominio.' });
  if (!d.host.trim()) errs.push({ id: 'f-host', field: 'Host', msg: 'Indica el host del proveedor, por ejemplo github.com, o el de tu instancia self-hosted.' });
  return errs;
}

const DRAFT_FIELDS = ['f-name', 'f-slug', 'f-user', 'f-email', 'f-host'];
const errFor = (id) => state.draftErrors.find((e) => e.id === id);

const draftNote = (text) => `<div class="inline-status is-muted">${ico('info')}<span class="od-fill">${text}</span></div>`;

/* Pinta los errores sin volver a montar la pestaña: así el foco no salta
   mientras se tabula de un campo al siguiente. */
function paintDraftErrors() {
  DRAFT_FIELDS.forEach((id) => {
    const el = $('#' + id), msg = $('#' + id + '-err');
    if (!el || !msg) return;
    const e = errFor(id);
    el.classList.toggle('is-invalid', Boolean(e));
    if (e) { el.setAttribute('aria-invalid', 'true'); msg.textContent = e.msg; msg.hidden = false; }
    else { el.removeAttribute('aria-invalid'); msg.textContent = ''; msg.hidden = true; }
  });

  const box = $('#draft-error-summary');
  if (!box) return;
  const errs = state.draftErrors;
  box.hidden = errs.length === 0;
  if (!errs.length) return;
  $('#draft-error-title').textContent = errs.length === 1
    ? 'Falta 1 dato obligatorio'
    : `Faltan ${errs.length} datos obligatorios`;
  $('#draft-error-list').innerHTML = errs.map((e) =>
    `<li><button type="button" class="linkish" data-goto-field="${e.id}">${esc(e.field)}</button></li>`).join('');
  $$('#draft-error-list [data-goto-field]').forEach((b) => b.addEventListener('click', () => {
    const el = $('#' + b.dataset.gotoField);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus(); }
  }));
}

function draftHeadHtml(d) {
  return `<div class="detail-head">
    <div class="od-fill od-stack" style="--od-gap:6px">
      <div class="detail-title">
        <h2>${d.name.trim() ? esc(d.name) : 'Nuevo perfil'}</h2>
        <span class="pill pill-neutral">${ico('pen', 'icon icon-12')}Sin guardar</span>
      </div>
      <span class="meta">Rellena la identidad y crea el perfil. El resto de pestañas se completan después, cuando el perfil ya tiene ficheros propios.</span>
    </div>
    <div class="od-cluster od-fixed">
      <button type="button" class="btn btn-default btn-sm" data-act="discard-draft">${ico('x')}<span>Descartar</span></button>
      <button type="button" class="btn btn-primary btn-sm" data-act="create-profile">${ico('check')}<span>Crear perfil…</span></button>
    </div>
  </div>`;
}

const DRAFT_TABS = {
  identidad(d) {
    return `<div class="panel"><div class="panel-body od-stack" style="--od-gap:16px">
      <div class="banner banner-danger" style="margin:0" id="draft-error-summary" role="alert" hidden>
        ${ico('alert')}
        <div class="od-fill od-stack" style="--od-gap:4px">
          <strong id="draft-error-title">Faltan datos obligatorios</strong>
          <ul class="err-list" role="list" id="draft-error-list"></ul>
        </div>
      </div>
      <div class="kv-grid">
        <div class="od-field" style="--od-gap:6px">
          <label for="f-name">Nombre visible <span class="req">obligatorio</span></label>
          <input id="f-name" class="input" value="${esc(d.name)}" placeholder="Trabajo — Empresa A" autocomplete="off" aria-describedby="f-name-err">
          <span class="field-err" id="f-name-err" hidden></span>
        </div>
        <div class="od-field" style="--od-gap:6px">
          <label for="f-slug">Slug <span class="req">obligatorio</span></label>
          <input id="f-slug" class="input input-mono" value="${esc(d.slug)}" placeholder="trabajo" autocomplete="off" aria-describedby="f-slug-err f-slug-help">
          <span class="field-err" id="f-slug-err" hidden></span>
          <span id="f-slug-help" class="field-help">Se deriva del nombre mientras no lo toques. Solo <code>a-z 0-9 -</code>.</span>
        </div>
        <div class="od-field" style="--od-gap:6px">
          <label for="f-user">user.name <span class="req">obligatorio</span></label>
          <input id="f-user" class="input" value="${esc(d.userName)}" placeholder="Alex Romero" autocomplete="off" aria-describedby="f-user-err">
          <span class="field-err" id="f-user-err" hidden></span>
        </div>
        <div class="od-field" style="--od-gap:6px">
          <label for="f-email">user.email <span class="req">obligatorio</span></label>
          <input id="f-email" class="input" type="email" value="${esc(d.email)}" placeholder="nombre@empresa.com" autocomplete="off" aria-describedby="f-email-err">
          <span class="field-err" id="f-email-err" hidden></span>
        </div>
        <div class="od-field" style="--od-gap:6px">
          <label for="f-provider">Proveedor</label>
          <select id="f-provider" class="input">
            ${['GitHub', 'GitLab', 'Bitbucket', 'Otro'].map((v) => `<option${v === d.provider ? ' selected' : ''}>${v}</option>`).join('')}
          </select>
          <span class="field-help">Fija el host por defecto y la prueba de conexión.</span>
        </div>
        <div class="od-field" style="--od-gap:6px">
          <label for="f-host">Host <span class="req">obligatorio</span></label>
          <input id="f-host" class="input input-mono" value="${esc(d.host)}" placeholder="github.com" autocomplete="off" aria-describedby="f-host-err f-host-help">
          <span class="field-err" id="f-host-err" hidden></span>
          <span id="f-host-help" class="field-help">Se rellena con el del proveedor. Cámbialo si es self-hosted.</span>
        </div>
        <div class="od-field" style="--od-gap:6px">
          <span class="label-like" id="l-clone">Método de clonado preferido</span>
          <div class="seg" role="radiogroup" aria-labelledby="l-clone">
            <label class="seg-item"><input type="radio" name="pclone" value="SSH"${d.clone === 'SSH' ? ' checked' : ''}><span>SSH</span></label>
            <label class="seg-item"><input type="radio" name="pclone" value="HTTPS"${d.clone === 'HTTPS' ? ' checked' : ''}><span>HTTPS</span></label>
          </div>
          <span class="field-help">Solo es el valor por defecto en Smart Clone.</span>
        </div>
      </div>
      ${draftNote('Al crear el perfil se escribe <strong>un fichero nuevo</strong> en <code>~/.gitprofiles</code>. Ningún fichero tuyo cambia, y verás el contenido exacto antes de confirmar.')}
    </div></div>`;
  },

  ssh(d) {
    const placeholder = `~/.ssh/id_ed25519_${d.slug || '<slug>'}`;
    return `<div class="od-stack" style="--od-gap:16px">
      <div class="panel">
        <div class="panel-head">Clave del perfil <span class="meta">opcional</span></div>
        <div class="panel-body od-stack" style="--od-gap:12px">
          <div class="od-field" style="--od-gap:6px">
            <label for="f-sshkey">Ruta de la clave privada <span class="opt">opcional</span></label>
            <input id="f-sshkey" class="input input-mono" value="${esc(d.sshKey)}" placeholder="${esc(placeholder)}" autocomplete="off" aria-describedby="f-sshkey-help">
            <span id="f-sshkey-help" class="field-help">Déjalo en blanco si vas a crear la clave después. Usa <code>~/</code> y barras <code>/</code>.</span>
          </div>
          <div class="od-field" style="--od-gap:6px">
            <span class="label-like">Se materializará en <code>core.sshCommand</code></span>
            <pre class="code code-wrap">${d.sshKey.trim()
              ? esc(`${SSH_EXE} -i ${d.sshKey} -o IdentitiesOnly=yes`)
              : 'Sin clave: este perfil no fijará core.sshCommand y Git usará lo que ofrezca el agente.'}</pre>
          </div>
          <div class="od-cluster">
            <button type="button" class="btn btn-default" disabled>${ico('plus')}<span>Crear clave ed25519</span></button>
            <button type="button" class="btn btn-default" disabled>${ico('folder')}<span>Importar existente</span></button>
            <button type="button" class="btn btn-default" disabled>${ico('plug')}<span>Probar conexión</span></button>
          </div>
          ${draftNote('Crear la clave, revisar su ACL y probar la conexión necesitan el perfil ya creado: estarán disponibles en cuanto lo guardes.')}
        </div>
      </div>
    </div>`;
  },

  https(d) {
    return `<div class="od-stack" style="--od-gap:16px">
      <div class="panel">
        <div class="panel-head">Cuenta por host</div>
        <div class="panel-body od-stack" style="--od-gap:12px">
          <div class="od-field" style="--od-gap:6px">
            <label for="f-https">Usuario HTTPS <span class="opt">opcional</span></label>
            <input id="f-https" class="input input-mono" value="${esc(d.httpsUser)}" placeholder="usuario-del-proveedor" autocomplete="off" aria-describedby="f-https-help">
            <span id="f-https-help" class="field-help">Con <code>username</code> fijado, GCM selecciona la cuenta correcta sin mostrar el selector.</span>
          </div>
          <div class="od-field" style="--od-gap:6px">
            <span class="label-like">Se materializará en</span>
            <pre class="code">${esc(`[credential "https://${d.host || '<host>'}"]\n    username = ${d.httpsUser || '<sin fijar>'}`)}</pre>
          </div>
          <div class="od-cluster">
            <button type="button" class="btn btn-default" disabled>${ico('external')}<span>Flujo del proveedor</span></button>
            <button type="button" class="btn btn-default" disabled>${ico('key')}<span>Pegar token</span></button>
          </div>
          ${draftNote('El alta de la credencial se hace una vez por perfil y la guarda Git Credential Manager. Disponible al crear el perfil; la app nunca persiste el secreto.')}
        </div>
      </div>
    </div>`;
  },

  firma(d) {
    const on = d.signing.mode === 'ssh';
    return `<div class="od-stack" style="--od-gap:16px">
      <div class="panel">
        <div class="panel-head">Modo de firma</div>
        <div class="panel-body od-stack" style="--od-gap:12px">
          <fieldset class="choice-set">
            <legend class="sr-only">Modo de firma de commits</legend>
            <label class="choice"><input type="radio" name="sign" value="none"${d.signing.mode === 'none' ? ' checked' : ''}>
              <span class="choice-body"><span class="choice-title">Ninguna <span class="tag tag-neutral">Valor inicial</span></span>
              <span class="choice-help">Los commits de este perfil no se firman.</span></span></label>
            <label class="choice"><input type="radio" name="sign" value="ssh"${on ? ' checked' : ''}>
              <span class="choice-body"><span class="choice-title">Firma SSH <span class="tag">Recomendado</span></span>
              <span class="choice-help">Reutiliza la clave de la pestaña SSH y el mismo agente. No necesita GPG.</span></span></label>
            <label class="choice"><input type="radio" name="sign" value="gpg"${d.signing.mode === 'gpg' ? ' checked' : ''}>
              <span class="choice-body"><span class="choice-title">GPG</span>
              <span class="choice-help">Solo se referencia el ID de clave; la app no gestiona el anillo de claves.</span></span></label>
          </fieldset>
          ${on ? `<div class="od-field" style="--od-gap:6px">
            <label for="f-signkey">Clave de firma</label>
            <input id="f-signkey" class="input input-mono" value="${esc(d.signing.key)}"
                   placeholder="${esc((d.sshKey || `~/.ssh/id_ed25519_${d.slug || '<slug>'}`) + '.pub')}" autocomplete="off" aria-describedby="f-signkey-help">
            <span id="f-signkey-help" class="field-help">Puede ser la misma de autenticación o una dedicada.</span>
          </div>
          ${draftNote('Recuerda: en GitHub la clave de firma es un alta distinta de la de autenticación. El asistente te lo recordará al crear el perfil.')}` : ''}
          ${d.signing.mode === 'gpg' ? draftNote('El ID de la clave GPG se pide al crear el perfil. La app solo lo referencia: no gestiona tu anillo de claves.') : ''}
        </div>
      </div>
    </div>`;
  },

  reglas(d) {
    const file = d.name.trim() || d.email.trim() || d.sshKey.trim()
      ? profileFileText({
          ...d,
          slug: d.slug || '<slug>',
          userName: d.userName || '<user.name>',
          email: d.email || '<user.email>',
          signing: { ...d.signing, key: d.signing.key || defaultSigningKey(d) }
        })
      : '# Rellena la identidad para ver el fichero que se generará.';
    return `<div class="od-stack" style="--od-gap:16px">
      <div class="panel">
        <div class="panel-head od-row">
          <span class="od-fill">Reglas de este perfil</span>
          <button type="button" class="btn btn-default btn-sm od-fixed" disabled>${ico('plus')}<span>Añadir</span></button>
        </div>
        <div class="panel-body od-stack" style="--od-gap:12px">
          <div class="empty">${ico('rules', 'icon icon-24')}
            <span class="empty-title">Todavía sin reglas</span>
            <span class="empty-text">Un perfil nuevo no se aplica a ningún repositorio hasta que tenga una regla de carpeta o de organización. Créalo primero y añade sus reglas desde la vista Reglas.</span>
          </div>
          ${draftNote('Las reglas se escriben en <code>rules.gitconfig</code>, que es un fichero compartido por todos los perfiles: se regenera cuando el perfil ya existe.')}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">Vista previa de <code>~/.gitprofiles/${esc(d.slug || '<slug>')}.gitconfig</code></div>
        <div class="panel-body"><pre class="code">${esc(file)}</pre></div>
      </div>
    </div>`;
  }
};

function startDraft() {
  if (!state.draft) {
    state.draft = makeDraft();
    state.draftErrors = [];
  }
  state.profile = DRAFT_ID;
  state.tab = 'identidad';
  goto('perfiles');
  renderProfileList();
  renderProfileDetail();
  const first = $('#f-name');
  if (first) first.focus();
}

function discardDraft(silent) {
  state.draft = null;
  state.draftErrors = [];
  state.profile = PROFILES[0].id;
  state.tab = 'identidad';
  renderProfileList();
  renderProfileDetail();
  if (!silent) toast('Borrador descartado: no se ha escrito nada', 'warn');
}

function commitDraft(d) {
  const profile = {
    id: d.slug, name: d.name.trim(), slug: d.slug, provider: d.provider, host: d.host.trim(),
    userName: d.userName.trim(), email: d.email.trim(),
    sshKey: d.sshKey.trim(), alias: d.sshKey.trim() ? `${d.provider.toLowerCase()}-${d.slug}` : '',
    httpsUser: d.httpsUser.trim(),
    signing: { mode: d.signing.mode, key: d.signing.mode === 'ssh' ? (d.signing.key.trim() || defaultSigningKey(d)) : '', uploaded: false },
    isDefault: false, clone: d.clone,
    caps: {
      ssh: d.sshKey.trim() ? 'warn' : 'off',
      https: d.httpsUser.trim() ? 'warn' : 'off',
      sign: d.signing.mode === 'none' ? 'off' : 'warn'
    },
    conn: { state: 'none', account: '', when: '' },
    cred: { state: 'none', when: '' },
    rules: []
  };
  PROFILES.push(profile);
  state.draft = null;
  state.draftErrors = [];
  state.profile = profile.id;
  state.tab = 'reglas';
  renderProfileList();
  renderProfileDetail();
  renderRules();
}

function wireDraftActions(d) {
  const act = (name, fn) => $$(`#profile-detail [data-act="${name}"]`).forEach((b) => b.addEventListener('click', () => fn(b)));

  act('discard-draft', () => discardDraft());

  act('create-profile', () => {
    captureDraft();
    state.draftErrors = validateDraft(state.draft);
    if (state.draftErrors.length) {
      const wasIdentity = state.tab === 'identidad';
      state.tab = 'identidad';
      renderProfileDetail();
      const first = $('#' + state.draftErrors[0].id);
      if (first) first.focus();
      toast(wasIdentity ? 'Revisa los campos marcados' : 'Faltan datos en la pestaña Identidad', 'err');
      return;
    }
    const nd = state.draft;
    askDiff({
      id: 'create-profile',
      title: `Crear el perfil ${nd.name.trim()}`,
      note: 'Fichero nuevo, propiedad de la app. Tu ~/.gitconfig y tu ~/.ssh/config no cambian.',
      warn: 'Sin reglas, el perfil no se aplicará a ningún repositorio todavía. Al crearlo te llevo a su pestaña Reglas.',
      applyLabel: 'Crear perfil',
      blocks: [{
        type: 'diff',
        file: `~/.gitprofiles/${nd.slug}.gitconfig`,
        lines: profileFileText({ ...nd, signing: { ...nd.signing, key: nd.signing.key.trim() || defaultSigningKey(nd) } })
          .split('\n').map((l) => ['add', l])
      }],
      done: `Perfil «${nd.name.trim()}» creado`
    }, () => commitDraft(nd));
  });

  /* Slug derivado del nombre mientras no se toque a mano */
  const name = $('#f-name'), slug = $('#f-slug');
  if (name && slug) {
    name.addEventListener('input', () => {
      d.name = name.value;
      if (!d.slugTouched) { d.slug = slugify(name.value); slug.value = d.slug; }
    });
    slug.addEventListener('input', () => { d.slugTouched = true; d.slug = slug.value; });
  }

  /* Host por defecto según el proveedor, salvo que se haya editado */
  const prov = $('#f-provider'), host = $('#f-host');
  if (prov && host) {
    prov.addEventListener('change', () => {
      d.provider = prov.value;
      if (!d.hostTouched) { d.host = HOST_BY_PROVIDER[prov.value] || ''; host.value = d.host; }
    });
    host.addEventListener('input', () => { d.hostTouched = true; d.host = host.value; });
  }

  /* El modo de firma cambia los campos visibles */
  $$('#profile-detail input[name="sign"]').forEach((r) => r.addEventListener('change', () => {
    captureDraft();
    renderProfileDetail();
    const again = $(`#profile-detail input[name="sign"][value="${d.signing.mode}"]`);
    if (again) again.focus();
  }));

  /* Validación al perder el foco: solo después del primer intento de crear,
     y actualizando el mensaje en su sitio, sin remontar la pestaña. */
  DRAFT_FIELDS.forEach((id) => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener('blur', () => {
      captureDraft();
      if (!state.draftErrors.length) return;
      state.draftErrors = validateDraft(state.draft);
      paintDraftErrors();
    });
  });

  paintDraftErrors();
}

/* ═══ Vista: Reglas ═══════════════════════════════════════════════════════ */
function renderRules() {
  RULE_ROWS = buildRuleRows();
  const conflicts = new Set(RULE_ROWS.filter((r) => r.conflict).map((r) => r.conflict.id)).size;
  $('#nav-conflicts').innerHTML = conflicts + '<span class="sr-only"> conflictos</span>';
  $('#nav-conflicts').hidden = conflicts === 0;
  $('#conflict-banner').hidden = conflicts === 0;
  if (conflicts) {
    $('#conflict-banner').querySelector('strong').textContent =
      `${conflicts === 1 ? '1 conflicto detectado' : conflicts + ' conflictos detectados'} antes de guardar`;
  }

  $('#rules-tbody').innerHTML = RULE_ROWS.map((r, i) => {
    const typePill = r.kind === 'default'
      ? `<span class="pill pill-accent">${ico('star', 'icon icon-12')}Por defecto</span>`
      : r.kind === 'folder'
        ? `<span class="pill pill-neutral">${ico('folder', 'icon icon-12')}Carpeta</span>`
        : `<span class="pill pill-neutral">${ico('globe', 'icon icon-12')}Organización</span>`;
    const conflictNote = r.conflict
      ? `<div class="meta" style="margin-block-start:4px">${ico('alert', 'icon icon-12')}
         Conflicto: ${esc(r.conflict.reason)} · gana <strong>${esc(r.conflict.winner.name)}</strong></div>`
      : '';
    return `<tr class="${r.conflict ? 'is-conflict' : ''}" id="rule-row-${i}">
      <td data-label="Orden"><span class="ord">${r.kind === 'default' ? '—' : i}</span></td>
      <td data-label="Tipo">${typePill}</td>
      <td data-label="Condición generada">
        <span class="cond-list">${r.conditions.map((c) => `<span>${esc(c)}</span>`).join('')}</span>
        ${conflictNote}
      </td>
      <td data-label="Perfil"><button type="button" class="linkish" data-goto-profile="${r.profile.id}">${esc(r.profile.name)}</button></td>
      <td data-label="Identidad resultante"><code class="od-truncate">${esc(r.profile.email)}</code></td>
      <td data-label="Acciones"><div class="row-actions">
        ${r.kind === 'default' ? '<span class="meta od-nowrap">fijo</span>' : `
          <button type="button" class="btn btn-default btn-sm" data-act="up" data-i="${i}">${ico('arrow-up')}<span class="sr-only">Subir</span></button>
          <button type="button" class="btn btn-default btn-sm" data-act="down" data-i="${i}">${ico('arrow-down')}<span class="sr-only">Bajar</span></button>
          <button type="button" class="btn btn-danger btn-sm" data-diff="delete-rule">${ico('trash')}<span class="sr-only">Eliminar</span></button>`}
      </div></td>
    </tr>`;
  }).join('');

  $$('#rules-tbody [data-goto-profile]').forEach((b) => b.addEventListener('click', () => {
    state.profile = b.dataset.gotoProfile; state.tab = 'identidad';
    renderProfileList(); renderProfileDetail(); goto('perfiles');
  }));
  $$('#rules-tbody [data-act="up"], #rules-tbody [data-act="down"]').forEach((b) =>
    b.addEventListener('click', () => toast('El orden lo fija el tipo de regla: carpeta primero, remoto después', 'warn')));
}

$('#btn-focus-conflict').addEventListener('click', () => {
  const row = $('#rules-tbody .is-conflict');
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const btn = row.querySelector('button');
  if (btn) btn.focus();
});
$('#btn-new-rule').addEventListener('click', () => toast('Alta de regla: formulario no incluido en este prototipo', 'warn'));
$('#btn-rules-preview').addEventListener('click', showRulesPreview);
$('#btn-preview-rules').addEventListener('click', showRulesPreview);

function showRulesPreview() {
  state.pendingDiff = null;
  $('#diff-title').textContent = 'Ficheros generados';
  $('#diff-note').textContent = 'Todo lo que escribe la app es configuración de Git y OpenSSH, legible y editable a mano.';
  $('#diff-body').innerHTML = `
    <div class="od-field" style="--od-gap:6px">
      <span class="label-like"><code>~/.gitprofiles/rules.gitconfig</code></span>
      <pre class="code">${esc(rulesFileText())}</pre>
    </div>
    <div class="od-field" style="--od-gap:6px">
      <span class="label-like"><code>~/.ssh/gitprofile.conf</code></span>
      <pre class="code">${esc(PROFILES.filter((p) => p.sshKey).map((p) =>
        `Host ${p.alias}\n    HostName ${p.host}\n    User git\n    IdentityFile ${p.sshKey}\n    IdentitiesOnly yes`).join('\n\n'))}</pre>
    </div>
    <div class="od-field" style="--od-gap:6px">
      <span class="label-like"><code>~/.gitprofiles/allowed_signers</code></span>
      <pre class="code">${esc(PROFILES.filter((p) => p.signing.mode === 'ssh')
        .map((p) => `${p.email} namespaces="git" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI… ${p.slug}`).join('\n'))}</pre>
    </div>`;
  $('#btn-apply-diff').className = 'btn btn-default';
  $('#btn-apply-diff').textContent = 'Cerrar';
  openOverlay('#overlay-diff');
}

/* ═══ Vista: Diagnóstico ══════════════════════════════════════════════════ */
function renderRepoList() {
  $('#repo-list').innerHTML = REPOS.map((r, i) => `
    <li><button type="button" class="repo-item" data-repo="${i}" aria-current="${i === state.repo}">
      ${ico('folder')}
      <span>
        <span class="repo-path od-truncate">${esc(r.path)}</span>
        <span class="repo-profile od-truncate">${esc(r.profile)}</span>
      </span>
      ${r.problems.length
        ? `<span class="pill pill-warn">${ico('alert', 'icon icon-12')}${r.problems.length}<span class="sr-only"> problemas</span></span>`
        : `<span class="pill pill-ok">${ico('check', 'icon icon-12')}OK</span>`}
    </button></li>`).join('');
  $$('#repo-list .repo-item').forEach((b) => b.addEventListener('click', () => {
    state.repo = Number(b.dataset.repo); renderRepoList(); renderDiag();
  }));
}

function renderDiag() {
  const r = REPOS[state.repo];
  $('#diag-repo-path').textContent = r.path;
  const head = $('.panel-current-repo .panel-head .pill');
  head.className = 'pill od-fixed ' + (r.problems.length ? 'pill-warn' : 'pill-ok');
  head.innerHTML = r.problems.length
    ? `${ico('alert', 'icon icon-12')}${r.problems.length} ${r.problems.length === 1 ? 'problema' : 'problemas'}`
    : `${ico('check', 'icon icon-12')}Sin problemas`;

  $('#diag-values').innerHTML = r.values.map((v) => `
    <tr>
      <td data-label="Clave"><code>${esc(v.k)}</code></td>
      <td data-label="Valor efectivo">${v.v === 'no definido'
        ? '<span class="meta">no definido</span>'
        : `<code class="od-truncate">${esc(v.v)}</code>`}</td>
      <td data-label="Ámbito"><span class="scope scope-${v.scope}">${v.scope === 'none' ? '—' : esc(v.scope)}</span></td>
      <td data-label="Fichero de origen"><span class="origin${v.profileFile ? ' origin-profile' : ''} od-truncate">${esc(v.origin)}</span></td>
    </tr>`).join('');

  $('#diag-problems').innerHTML = r.problems.length ? r.problems.map((pr) => `
    <li class="problem sev-${pr.sev}" id="prob-${pr.id}">
      <span class="problem-ico sev-${pr.sev}">${ico(pr.sev === 'err' ? 'x' : pr.sev === 'warn' ? 'alert' : 'info')}</span>
      <span class="problem-body">
        <span class="problem-title">${pr.title}</span>
        <span class="problem-text">${pr.text}</span>
        <span class="problem-how">${pr.how}</span>
        ${pr.note ? `<span class="problem-how"><em>${pr.note}</em></span>` : ''}
      </span>
      <span class="od-fixed">${pr.action
        ? `<button type="button" class="btn ${pr.sev === 'err' ? 'btn-accent' : 'btn-default'} btn-sm"
             ${pr.diff ? `data-diff="${pr.diff}"` : ''} data-prob="${pr.id}">${esc(pr.action)}…</button>`
        : `<span class="pill pill-neutral">${ico('info', 'icon icon-12')}Solo aviso</span>`}</span>
    </li>`).join('') : `
    <li><div class="empty">${ico('check', 'icon icon-24')}
      <span class="empty-title">Ningún problema detectado</span>
      <span class="empty-text">Todos los valores vienen del fichero de un perfil y no hay configuración local que los pise.</span>
    </div></li>`;

  $$('#diag-problems [data-prob]').forEach((b) => b.addEventListener('click', () => {
    const pr = r.problems.find((x) => x.id === b.dataset.prob);
    if (pr.go && !pr.diff) {
      if (pr.focusProfile) { state.profile = pr.focusProfile; state.tab = pr.focusTab || 'identidad'; renderProfileList(); renderProfileDetail(); }
      goto(pr.go);
    }
  }));
}

$('#btn-rediagnose').addEventListener('click', (e) => {
  const b = e.currentTarget;
  busy(b, 'Analizando…');
  $('#diag-values').innerHTML = Array.from({ length: 4 }, () =>
    '<tr><td colspan="4"><span class="skeleton"></span></td></tr>').join('');
  setTimeout(() => { done(b); renderDiag(); toast('Diagnóstico actualizado'); }, 1200);
});

const dz = $('#dropzone');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
dz.addEventListener('drop', () => toast('Carpeta recibida · analizando el repositorio'));
dz.addEventListener('click', () => toast('Se abriría el diálogo de carpetas de Windows'));
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dz.click(); } });

/* ═══ Smart Clone ═════════════════════════════════════════════════════════ */
function parseUrl(raw) {
  const s = raw.trim().replace(/\.git$/, '');
  let m = s.match(/^git@([^:]+):([^/]+)\/(.+)$/);
  if (m) return { host: m[1], org: m[2], repo: m[3] };
  m = s.match(/^https?:\/\/([^/]+)\/([^/]+)\/(.+)$/);
  if (m) return { host: m[1], org: m[2], repo: m[3] };
  m = s.match(/^ssh:\/\/git@([^/]+)\/([^/]+)\/(.+)$/);
  if (m) return { host: m[1], org: m[2], repo: m[3] };
  return null;
}

function cloneMethod() { return $('input[name="clonemethod"]:checked').value; }

function refreshClone({ autoProfile = true } = {}) {
  const parsed = parseUrl($('#clone-url').value);
  const err = $('#clone-url-err');
  const input = $('#clone-url');

  if (!parsed) {
    input.classList.add('is-invalid');
    err.hidden = false;
    err.textContent = 'No se reconoce como URL de Git. Usa git@host:org/repo.git o https://host/org/repo.git.';
    $('#p-host').textContent = $('#p-org').textContent = $('#p-repo').textContent = '—';
    $('#clone-cmd').textContent = '';
    $('#btn-do-clone').disabled = true;
    return;
  }
  input.classList.remove('is-invalid');
  err.hidden = true;
  $('#btn-do-clone').disabled = false;

  $('#p-host').textContent = parsed.host;
  $('#p-org').textContent = parsed.org;
  $('#p-repo').textContent = parsed.repo;

  if (autoProfile) {
    const match = PROFILES.find((p) => p.host === parsed.host && p.rules.some((r) => r.type === 'org' && r.value === parsed.org));
    const help = $('#clone-profile-help');
    if (match) {
      $('#clone-profile').value = match.id;
      help.textContent = 'Preseleccionado: una regla de organización coincide con esta URL.';
    } else {
      help.textContent = 'Ninguna regla de organización coincide: elige el perfil a mano.';
    }
  }

  const p = byId($('#clone-profile').value);
  const method = cloneMethod();
  const url = method === 'ssh'
    ? `git@${parsed.host}:${parsed.org}/${parsed.repo}.git`
    : `https://${parsed.host}/${parsed.org}/${parsed.repo}.git`;

  const folderRule = p.rules.find((r) => r.type === 'folder');
  const dest = folderRule
    ? folderRule.value.replace(/\//g, '\\').replace(/\\$/, '') + '\\' + parsed.repo
    : `C:\\dev\\${parsed.repo}`;
  $('#clone-dest').value = dest;

  const parts = ['git'];
  if (method === 'ssh' && p.sshKey) parts.push(`-c core.sshCommand="${SSH_EXE} -i ${p.sshKey} -o IdentitiesOnly=yes"`);
  if (method === 'https' && p.httpsUser) parts.push(`-c credential.https://${parsed.host}.username=${p.httpsUser}`);
  parts.push(`clone ${url}`, `"${dest}"`);
  $('#clone-cmd').textContent = parts.join(' ');

  const covered = folderRule && dest.toLowerCase().startsWith(folderRule.value.replace(/\//g, '\\').toLowerCase());
  const cov = $('#clone-coverage');
  if (covered) {
    cov.className = 'banner banner-ok';
    cov.querySelector('.icon use').setAttribute('href', '#i-check');
    cov.querySelector('strong').textContent = 'Tras clonar, el repo quedará cubierto por una regla';
    cov.querySelector('.banner-text').innerHTML =
      `Coincide la regla de carpeta <code>gitdir/i:${esc(folderRule.value)}</code> del perfil ${esc(p.name)}.`;
  } else {
    cov.className = 'banner banner-warn';
    cov.querySelector('.icon use').setAttribute('href', '#i-alert');
    cov.querySelector('strong').textContent = 'Ninguna regla cubrirá este repo tras clonar';
    cov.querySelector('.banner-text').innerHTML =
      'Se creará una regla de carpeta para el destino (opción por defecto). Alternativa: escribir la identidad con <code>git config --local</code>.';
  }
}

function openClone() {
  $('#clone-profile').innerHTML = PROFILES.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('#clone-profile').value = 'trabajo';
  $('#clone-progress').hidden = true;
  $('#clone-done').hidden = true;
  $('#clone-coverage').hidden = false;
  $('#btn-do-clone').innerHTML = `${ico('clone')}<span>Clonar</span>`;
  $('#btn-do-clone').onclick = doClone;
  refreshClone();
  openOverlay('#overlay-clone');
  $('#clone-url').focus();
}

$$('[data-open-clone]').forEach((b) => b.addEventListener('click', openClone));
$('#clone-url').addEventListener('input', () => refreshClone());
$('#clone-profile').addEventListener('change', () => refreshClone({ autoProfile: false }));
$$('input[name="clonemethod"]').forEach((r) => r.addEventListener('change', () => refreshClone({ autoProfile: false })));

function doClone() {
  const steps = [
    'Normalizando la URL…',
    'Comprobando la cobertura de reglas…',
    'Clonando con la configuración del perfil…',
    'Ejecutando el diagnóstico del repo nuevo…'
  ];
  const btn = $('#btn-do-clone');
  btn.disabled = true;
  $('#clone-coverage').hidden = true;
  $('#clone-progress').hidden = false;
  let i = 0;
  const tick = () => {
    $('#clone-step').textContent = steps[i];
    $('#clone-bar').style.width = ((i + 1) / steps.length * 100) + '%';
    i += 1;
    if (i < steps.length) { setTimeout(tick, 700); return; }
    setTimeout(() => {
      $('#clone-progress').hidden = true;
      $('#clone-done').hidden = false;
      btn.disabled = false;
      btn.innerHTML = `${ico('pulse')}<span>Ver diagnóstico</span>`;
      btn.onclick = () => { closeOverlay($('#overlay-clone')); state.repo = 1; renderRepoList(); renderDiag(); goto('diagnostico'); };
      toast('Repositorio clonado · identidad aplicada por regla de carpeta');
    }, 700);
  };
  tick();
}

/* ═══ Primer arranque ═════════════════════════════════════════════════════ */
const OB_STEPS = [
  {
    note: 'Nada se escribe en este paso.',
    html: `<div class="od-stack" style="--od-gap:12px">
      <p>Comprobación del entorno antes de activar nada.</p>
      <ul class="check-list" role="list">
        <li class="check-item">${ico('check')}
          <span><span class="check-name">Git for Windows</span>
          <span class="check-detail">C:\\Program Files\\Git\\cmd\\git.exe · 2.47.1</span></span>
          <span class="pill pill-ok">Compatible</span></li>
        <li class="check-item">${ico('check')}
          <span><span class="check-name">Git Credential Manager</span>
          <span class="check-detail">credential.helper = manager · 2.6.1</span></span>
          <span class="pill pill-ok">Listo</span></li>
        <li class="check-item">${ico('check')}
          <span><span class="check-name">OpenSSH de Windows</span>
          <span class="check-detail">servicio ssh-agent · en ejecución</span></span>
          <span class="pill pill-ok">Listo</span></li>
      </ul>
      <div class="banner banner-info" style="margin:0">${ico('info')}
        <div class="od-fill"><strong>Se requiere Git 2.36 o superior</strong>
        <span class="banner-text" style="display:block">Las reglas por remoto usan <code>hasconfig</code>, disponible desde 2.36. Con una versión anterior el asistente se bloquea aquí.</span></div>
      </div>
    </div>`
  },
  {
    note: 'La identidad global se guarda antes de retirarla.',
    html: `<div class="od-stack" style="--od-gap:12px">
      <p>Se ha encontrado una identidad global en <code>~/.gitconfig</code>.</p>
      <pre class="code">[user]
    name = Alex Romero
    email = alex@personal.dev</pre>
      <fieldset class="choice-set">
        <legend class="sr-only">Qué hacer con la identidad global</legend>
        <label class="choice"><input type="radio" name="ob-global" value="convert" checked>
          <span class="choice-body"><span class="choice-title">Convertirla en el perfil por defecto <span class="tag">Recomendado</span></span>
          <span class="choice-help">Se crea el perfil <strong>Personal</strong> y se retiran <code>user.name</code> y <code>user.email</code> del ámbito global, guardando sus valores para poder restaurarlos.</span></span></label>
        <label class="choice"><input type="radio" name="ob-global" value="keep">
          <span class="choice-body"><span class="choice-title">Dejarla como está</span>
          <span class="choice-help">La identidad global seguirá aplicándose a los repos sin regla, fuera del control de la app.</span></span></label>
      </fieldset>
    </div>`
  },
  {
    note: 'Último paso: aquí sí se escribe, con copia de seguridad previa.',
    html: `<div class="od-stack" style="--od-gap:12px">
      <p>Estos son los dos únicos cambios en ficheros tuyos, una línea en cada uno.</p>
      ${renderDiffBlocks(DIFFS.activate)}
    </div>`
  }
];

function renderOb() {
  $$('#ob-steps .step').forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('is-current', n === state.obStep);
    li.classList.toggle('is-done', n < state.obStep);
  });
  const s = OB_STEPS[state.obStep - 1];
  $('#ob-body').innerHTML = s.html;
  $('#ob-note').textContent = s.note;
  $('#ob-back').disabled = state.obStep === 1;
  $('#ob-next').innerHTML = state.obStep === 3
    ? `${ico('check')}<span>Activar la integración</span>`
    : '<span>Continuar</span>';
  $('#ob-next').className = 'btn btn-primary';
}

$$('[data-open-onboarding]').forEach((b) => b.addEventListener('click', () => {
  state.obStep = 1; renderOb(); openOverlay('#overlay-onboarding');
}));
$('#ob-back').addEventListener('click', () => { state.obStep = Math.max(1, state.obStep - 1); renderOb(); });
$('#ob-next').addEventListener('click', () => {
  if (state.obStep < 3) { state.obStep += 1; renderOb(); return; }
  closeOverlay($('#overlay-onboarding'));
  toast('Integración activada · 2 ficheros del usuario modificados, con copia previa');
  $('#status-msg').textContent = 'Integración activada · copias en %APPDATA%\\GitProfileManager\\backups';
});

/* ═══ Ajustes ═════════════════════════════════════════════════════════════ */
$('#backup-list').innerHTML = BACKUPS.map((b) => `
  <li class="backup-item">
    ${ico('file-code')}
    <span><span class="backup-name od-truncate">${esc(b.file)}</span>
    <span class="backup-when od-truncate">${esc(b.when)}</span></span>
    <button type="button" class="btn btn-default btn-sm" data-restore="${esc(b.file)}">Restaurar…</button>
  </li>`).join('');
$$('#backup-list [data-restore]').forEach((b) => b.addEventListener('click', () =>
  toast('Restaurar una copia muestra antes el diff completo del fichero', 'warn')));

$('#btn-check-agent').addEventListener('click', (e) => {
  const b = e.currentTarget;
  busy(b, 'Comprobando…');
  setTimeout(() => { done(b); toast('Servicio ssh-agent en ejecución'); }, 900);
});
$$('input[name="sshclient"]').forEach((r) => r.addEventListener('change', (e) => {
  const win = e.target.value === 'win';
  $('#agent-status').className = 'inline-status' + (win ? '' : ' is-warn');
  $('#agent-status').querySelector('.icon use').setAttribute('href', win ? '#i-check' : '#i-alert');
  $('#agent-status').querySelector('span.od-fill').innerHTML = win
    ? 'Servicio <code>ssh-agent</code> en ejecución (automático)'
    : 'Se usará el agente de la sesión de Git Bash: las claves con passphrase se pedirán en cada sesión.';
  toast('Cliente SSH cambiado · se regenerarán los ficheros de perfil', 'warn');
}));
$$('input[name="nomode"]').forEach((r) => r.addEventListener('change', (e) =>
  toast(e.target.value === 'strict'
    ? 'Modo estricto: un repo sin regla no podrá commitear'
    : 'Los repos sin regla usarán el perfil por defecto', 'warn')));

$('#btn-new-profile').addEventListener('click', () => {
  const existing = Boolean(state.draft);
  startDraft();
  if (existing) toast('Ya tenías un perfil nuevo sin guardar: lo retomo', 'warn');
});

/* ═══ Arranque ════════════════════════════════════════════════════════════ */
setTheme(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
renderProfileList();
renderProfileDetail();
renderRules();
renderRepoList();
renderDiag();
goto(location.hash.slice(1) || 'perfiles', { push: false });

})();
