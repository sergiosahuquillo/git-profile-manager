# GitProfile Manager

Windows desktop app that manages several Git identities (name, email, SSH key, HTTPS account and signing) and makes Git apply the right one in each repository through standard configuration (`includeIf`, `core.sshCommand`, `~/.ssh/config`).

Built with **Tauri 2 + Rust + React**, with the interface from the design in `design/` (prototype, specification v2 and handoff). The interface is in Spanish and English.

This is the **developer README**. If you only want to use the app, the project page has screenshots, features and install instructions: [.github/README.md](.github/README.md), or download the [latest release](https://github.com/sergiosahuquillo/git-profile-manager/releases/latest).

## Requirements

- Windows 10 22H2 or Windows 11 (WebView2 ships with the system)
- Git for Windows ≥ 2.36 with Git Credential Manager
- To build: stable Rust (MSVC), Node 20+ and pnpm

## Layout

| Folder | Contents |
| --- | --- |
| `crates/gpm-core` | Rust core with no UI dependencies: `models`, `profile_store`, `profile_validator`, `rule_matcher`, `config` (`.gitconfig` generator and escaping), `files` (atomic writes, backups, drift, diff), `git` (runner, URLs), `ssh`, `credentials` (GCM and Windows Credential Manager), `integration`, `diagnostics` (diagnostics and Smart Clone), `environment`, `updates` (Git for Windows: release check, verified download, silent install) and `workspace` (save pipeline) |
| `crates/gpm-core/tests` | Unit tests, integration tests with real Git on a temporary HOME, isolation tests between profiles, and tests of the generated files, compared byte by byte with `fixtures/generated` |
| `src-tauri` | Tauri app: commands that delegate to the core, frameless window (the title bar is drawn by the design) |
| `src` | React + TypeScript frontend: `styles/styles.css` is the design's CSS unchanged; `styles/app.css` only adds real states the prototype doesn't show |
| `src/api/bindings` | TypeScript types generated from Rust with `ts-rs` (`pnpm bindings`) |
| `design` | Reference design (HTML prototype, specification v2, handoff) |

## Build and run

```bash
pnpm install
```

```bash
pnpm tauri dev
```

```bash
cargo test --workspace
```

```bash
pnpm tauri build
```

`pnpm tauri build` produces the NSIS installer (per user, with the app icon) in `target/release/bundle/nsis`.

`pnpm dev` (Vite only, in a browser) starts the interface with a mock backend holding the prototype's data; it's for reviewing the design and doesn't run Git.

### Trying it without touching your real configuration

The app writes to `~/.gitconfig` and `~/.ssh/config` (always after a preview and a backup). To try it in isolation:

```powershell
$env:HOME = "C:\temp\gpm-sandbox\home"; $env:GIT_CONFIG_GLOBAL = "C:\temp\gpm-sandbox\home\.gitconfig"; $env:GITPROFILEMANAGER_APPDATA = "C:\temp\gpm-sandbox\appdata"; pnpm tauri dev
```

Windows OpenSSH keeps using `%USERPROFILE%\.ssh`, so the SSH connection test isn't isolated.

### Updates

On startup the app checks the latest Git for Windows release on GitHub (`updates::git`) and its own `latest.json` (`tauri-plugin-updater`), according to `Settings.UpdateMode` (`Auto`, `Manual`, `Off`).

- **Git's installer** is checked twice before running: its SHA-256 against the `digest` GitHub publishes, and its Authenticode signature. It runs silently (`/VERYSILENT`) over the existing install.
- **Elevation:** Git for Windows has no flag for "all users" or "just me": that depends on whether it runs elevated. Updates keep the existing scope, using `runas` when Git is in Program Files.
- **Fresh installs** (Git missing) run elevated for all users, or unelevated with `/DIR` for the current user. In both cases `/o:` forces GCM and Git on the PATH.
- **When the update waits:** in `Auto` it installs on its own unless a UAC prompt would actually appear (`updates::win::elevation_prompts`). Then it stays downloaded in `%LOCALAPPDATA%\GitProfileManager\updates` until the user clicks Install.

In debug builds two variables help to try it:

```powershell
$env:GITPROFILEMANAGER_FAKE_GIT_VERSION = "2.40.0.windows.1"; $env:GITPROFILEMANAGER_FORCE_UAC_PROMPT = "1"; pnpm tauri dev
```

The first pretends an older Git is installed, so the latest one is offered (and reinstalled). The second forces the "waits for Install" flow. In `pnpm dev`, the mock backend simulates updates; `?uac` simulates the UAC prompt and `?nogit` (`&uac`, `&std`) a PC without Git.

### Generated files

`tests/generated.rs` compares what the app generates, byte by byte, with `crates/gpm-core/tests/fixtures/generated`. If you change the generator on purpose, regenerate the expected files and review the diff before committing:

```powershell
$env:GPM_BLESS = "1"; cargo test -p gpm-core --test generated
```

## App data

- `%APPDATA%\GitProfileManager\profiles.json` (PascalCase, enums as text, `SchemaVersion: 1`) is the source of truth: profiles, rules, settings (including the language) and hashes of the generated files. `GITPROFILEMANAGER_APPDATA` changes the folder.
- Generated files in `~/.gitprofiles` and `~/.ssh/gitprofile.conf`, always in English so that switching language doesn't rewrite them.
- Backups in `backups\<date>\NN_<file>` with a `manifest.json`. The reason is stored as a code (`enable-integration`, `disable-integration`, `before-restore:<id>`) and translated when shown.

## Languages

- Interface: i18next with typed catalogs in `src/i18n/es` and `src/i18n/en`. `pnpm typecheck` fails if an English key is missing.
- Core: user-facing messages are written with `tr!("texto", "text")` (`crates/gpm-core/src/i18n.rs`).

## Decisions relative to the design

- **Fidelity**: the markup and classes are the prototype's; the sample data is replaced with real data and the previews show the real generated content (with tabs, like `git config`).
- **Saving with a preview**: every action (saving a profile, creating or deleting a rule, changing a setting, fixing a problem, turning the integration on or off, restoring a backup) opens the proposed-change dialog with the exact diff or command, and only writes on confirmation.
- **Features the design doesn't show** that the app includes, with the design's styles: editable key path, passphrase when creating a key, "Add to agent…", output and hint of the connection test, HTTPS check repo, accounts saved in GCM with re-login, "Sign in again…", GPG key ID, "Use the authentication key", optional host on organization rules, rule editing, full detected environment, host aliases, SourceTree, "Open folder" for backups, "Remove the app", manual path in Diagnostics, "Open in Explorer/SourceTree", folder name and the three coverage options in Smart Clone, and the confirmation when closing with unsaved changes.
- **Added on top of the design**: the "No specific rule covers this repo" warning with "Create folder rule…", and "Invalid HTTPS credential" in Diagnostics.
- The Profiles list and detail stack below 1100 px (the prototype does it at 1012 px) so there's no horizontal scrolling.

## SourceTree and the SSH agent

With the OpenSSH client, SourceTree always starts its own `ssh-agent` (Git Bash's) and passes it in `SSH_AUTH_SOCK` to everything it launches; the checkbox that turns it off is disabled. With that, Windows' `ssh` and `ssh-keygen` stop seeing the keys in the Windows agent. Commits signed with a passphrase-protected key hang on "Committing" waiting for the passphrase, and SSH pushes fail.

That's why, with Windows OpenSSH, the app always pins the Windows agent:

- `core.sshCommand` starts with `SSH_AUTH_SOCK='\\.\pipe\openssh-ssh-agent'` (Git runs it with `sh`).
- `gpg.ssh.program` points to `~/.gitprofiles/ssh-keygen.cmd`, a wrapper that sets that variable and calls `ssh-keygen`. It's needed because Git runs the signing program without a shell.

`tests/generated.rs` includes `ssh-keygen.cmd` among the expected files.

## Azure DevOps

Azure uses different hosts and paths per method (`git@ssh.dev.azure.com:v3/org/project/repo` and `https://[org@]dev.azure.com/org/project/_git/repo`, plus the legacy `visualstudio.com` variants). What the app does:

- **Profile:** *Azure DevOps* provider with host `dev.azure.com`. URLs are normalized to `org/project/repo` and converted between SSH and HTTPS. Names with `%20` are supported.
- **Organization rules:** `org` or `org/project` generates five `includeIf`: SSH, HTTPS with and without `org@`, and the two legacy ones. `hasconfig` compares the literal URL, so the app's matcher does too (`rule_matcher::matching_condition`); the tests check it with real Git.
- **SSH:** the connection test and the alias use `ssh.dev.azure.com` (or `vs-ssh.visualstudio.com`). The `Shell access is not supported` response is recognized as success, even though Azure doesn't return the account. New keys are RSA 4096 by default, because Azure doesn't document ed25519 support.
- **GCM:** accounts are listed with `git credential-manager azure-repos list`. Re-login uses `git credential reject` followed by the provider flow, because GCM has no `login` for Azure.
- **Diagnostics:** the `org@` that Azure adds to HTTPS URLs isn't flagged as a problem.
- **To bind an account to an organization** (multi-account), use `git credential-manager azure-repos bind <org> <user>` or the profile's HTTPS username.

## Not validated yet

These flows work against Git but haven't been tried with real accounts: OAuth and token sign-up in GCM, re-login, the SSH test against the provider (including Azure DevOps) and the ACL fix on a real key. The four open items in section 15 of the specification are still open.

## Website

[sergiosahuquillo.github.io/git-profile-manager](https://sergiosahuquillo.github.io/git-profile-manager/) is plain HTML, CSS and JavaScript in `site/`, with no build step. [`pages.yml`](.github/workflows/pages.yml) publishes it on every push to `main` that touches it; the screenshots aren't duplicated: they're copied from `.github/assets/` to `shots/` when publishing.

- **Texts** live in `site/i18n/en.json` and `site/i18n/es.json`. The HTML only names the key (`data-i18n`, `data-i18n-html` for texts with markup, `data-i18n-attr` for attributes) and `app.js` fills it in. The language comes from `?lang=`, the visitor's last choice or the browser.
- **Download button**: it points to the latest release and, through the GitHub API, straight to its installer with the version and size.
- **Locally**: `node scripts/site/serve.mjs` serves it at http://localhost:4321 laid out exactly as published.
- **Check**: `node scripts/site/check-i18n.mjs` fails if a key is missing in one language, the `{{placeholders}}` differ, or a key is used without text or defined without use. CI runs it before publishing.

Changes to the website don't produce a release of the app.

## Releases

Every push to `main` is a release: [`build.yml`](.github/workflows/build.yml) runs Biome, `tsc`, `cargo test --workspace` and the `src/api/bindings` check, packages the installer and publishes "GitProfile Manager X.Y.Z" with the commits since the previous one as the description. GitHub attaches the source from the tag.

**The version number is never edited by hand.** Only MAJOR.MINOR of `version` in `src-tauri/tauri.conf.json` counts; CI sets the patch to the next one after the latest `vMAJOR.MINOR.*` tag and passes it to `tauri build` with `--config`, so the installer, *Installed apps*, the executable, the tag and the release all agree. To move to 1.1 or 2.0, change that `version` and nothing else: the next release comes out as 1.1.0 or 2.0.0. The versions in `package.json` and `Cargo.toml` aren't read by anything; you can bump them too to keep them in step, but if you touch `Cargo.toml`, run `cargo check` to refresh `Cargo.lock`, because CI builds with `--locked` and fails otherwise. On other branches and in pull requests the version carries `-dev.<run>` and the installer is left as a workflow artifact, so you can try it before merging. A commit with `[skip ci]` doesn't produce a release, and neither does a push that only touches documentation (both READMEs, `.github/assets/`, `design/` and the website).

The installer is **not code-signed** yet, so SmartScreen warns the first time: the workflow has the spot marked for the signing step.

**App self-update.** The updater checks `releases/latest/download/latest.json` and only installs what is signed with the updater key. Its public key is in `plugins.updater.pubkey` in `tauri.conf.json`, and the private key goes in the `TAURI_SIGNING_PRIVATE_KEY` repository secret (plus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if it has one). With the secret, releases from `main` include the installer's `.sig` and a `latest.json`. Without it they're still published, but the app doesn't offer them as updates. Keep a copy of the private key: if it's lost, installed versions won't accept updates signed with a new one.

## License

[GNU General Public License v3.0](LICENSE).
