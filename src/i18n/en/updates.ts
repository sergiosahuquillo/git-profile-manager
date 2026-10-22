import type { updates as es } from "../es/updates";
import type { Messages } from "../types";

export const updates: Messages<typeof es> = {
  title: "Updates",
  legend: "Update mode",
  recommended: "Recommended",
  auto: {
    title: "Automatic",
    help: "Checks when the app opens, then downloads and installs on its own. If Windows will ask for permission (UAC), Git stays downloaded until you click Install.",
  },
  manual: {
    title: "Notify only",
    help: "Checks when the app opens and shows a button to update whenever you want.",
  },
  off: {
    title: "Off",
    help: "Nothing is checked online. You can still check by hand from here.",
  },
  git: "Git for Windows",
  gitIncludes: "Includes Git Credential Manager and Git's SSH",
  app: "GitProfile Manager",
  installed: "Installed {{version}}",
  upToDate: "Up to date",
  newVersion: "{{version}} available",
  checking: "Checking…",
  downloading: "Downloading {{percent}}%",
  downloadingNoPct: "Downloading…",
  verifying: "Verifying…",
  installing: "Installing…",
  ready: "Downloaded, ready to install",
  update: "Update",
  updateTo: "Update {{name}} to {{version}}",
  install: "Install",
  installTo: "Install {{name}} {{version}}",
  retry: "Retry",
  retryTitle: "Retry: {{error}}",
  checkNow: "Check now",
  lastCheck: "Last checked: {{time}}",
  neverChecked: "Not checked yet",
  checkFailed: "Couldn't check: {{error}}",
  withGit: "Updated with Git",
  uacNote: "Git is installed for all users: Windows will ask for permission (UAC) to install it.",
  uacCancelled: "Installation cancelled at the Windows permission prompt.",
  gitUpdated: "Git updated to {{version}}",
  restarting: "Installing GitProfile Manager {{version}}: the app will restart",
  modeChanged: "Update mode saved",
  confirm: {
    title: "Update Git for Windows to {{version}}",
    note: "It's installed over the current version, with the same options. Git Credential Manager and Git's SSH are updated with it.",
    noteUac:
      "It's installed over the current version, with the same options. Windows will ask for administrator permission (UAC). Git Credential Manager and Git's SSH are updated with it.",
    warn: "Any open Git Bash windows will be closed.",
    apply: "Install",
  },
  fresh: {
    button: "Install Git for Windows",
    title: "Install Git for Windows {{version}}",
    legend: "Who Git is installed for",
    machine: "For all users",
    machineHelp: "In Program Files. The most compatible option with other tools and accounts on this PC.",
    machineHelpUac:
      "In Program Files. The most compatible option with other tools and accounts on this PC. Windows will ask for administrator permission (UAC).",
    user: "Just for me",
    userHelp:
      "In %LOCALAPPDATA%\\Programs\\Git, without administrator permission. Other accounts on this PC won't see it.",
    noteChoose: "Git isn't installed and the app needs it.",
    noteMachine:
      "Git isn't installed and the app needs it. It will be installed for all users, in Program Files.",
    noteMachineUac:
      "Git isn't installed and the app needs it. It will be installed for all users, in Program Files: Windows will ask for administrator permission (UAC).",
    noteUser:
      "Git isn't installed and the app needs it. It will be installed just for your user, in %LOCALAPPDATA%\\Programs\\Git, without administrator permission.",
    options: "Git's default options are used, with Git Credential Manager turned on and Git on the PATH.",
    apply: "Install",
    done: "Git {{version}} installed",
  },
  onboarding: {
    intro: "The app can keep Git for Windows and itself up to date. How do you want to do it?",
    what: "What gets updated",
    later: "You can change this any time in Settings.",
  },
};
