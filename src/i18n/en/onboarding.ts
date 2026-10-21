import type { onboarding as es } from "../es/onboarding";
import type { Messages } from "../types";

export const onboarding: Messages<typeof es> = {
  title: "First run",
  defaultName: "Personal",
  steps: {
    env: "Environment",
    identity: "Global identity",
    activate: "Turn on",
  },
  notes: {
    env: "Nothing is written in this step.",
    identity: "The global identity is saved before it's removed.",
    activate: "Last step: this is where files are written, with a prior backup.",
  },
  errName: "Give the profile a display name.",
  errUser: "user.name is missing.",
  errEmail: "The email isn't valid: use name@domain.",
  keptGlobal:
    "The global identity still applies. Create profiles and turn on the integration whenever you want.",
  enabled: "Integration on · 2 user files modified, with a prior backup",
  back: "Back",
  activating: "Turning on…",
  finish: "Finish",
  activate: "Turn on the integration",
  next: "Continue",
  envIntro: "Environment check before turning anything on.",
  notFound: "not found",
  compatible: "Compatible",
  blocked: "Blocked",
  gcmMissing: "not installed: HTTPS won't be available",
  ready: "Ready",
  notHelper: "Not the helper",
  absent: "Missing",
  winSsh: "Windows OpenSSH",
  gitSsh: "Git for Windows SSH",
  agent: "ssh-agent service · {{state}}",
  running: "running",
  stopped: "stopped",
  useGitSsh: "Windows OpenSSH isn't available: Git's SSH will be used",
  noSsh: "no SSH client found",
  review: "Review",
  requirements: "Requirements not met",
  blockedText: "{{error}} The app can't turn on the integration until this is resolved.",
  needGit: "Git 2.36 or later is required",
  needGitText:
    "Remote rules use <code>hasconfig</code>, available since 2.36. With an older version the wizard stops here.",
  hasProfiles_one: "You already have {{count}} profile: the wizard won't create another one.",
  hasProfiles_other: "You already have {{count}} profiles: the wizard won't create another one.",
  decideGlobal: " Decide what to do with the global identity when turning on the integration.",
  foundGlobal: "A global identity was found in <code>~/.gitconfig</code>.",
  noGlobal:
    "There's no global identity. Create the default profile: it will apply to every repo without a rule.",
  legend: "What to do with the global identity",
  removeOnActivate: "Remove it when turning on",
  convert: "Turn it into the default profile",
  createDefault: "Create the default profile",
  recommended: "Recommended",
  helpRemove:
    "<code>user.name</code> and <code>user.email</code> are removed from the global scope, saving their values so they can be restored.",
  helpCreateRemove:
    "Profile <strong>{{name}}</strong> is created and <code>user.name</code> and <code>user.email</code> are removed from the global scope, saving their values so they can be restored.",
  helpCreate: "Profile <strong>{{name}}</strong> is created. It will apply to every repo without a rule.",
  keep: "Leave it as is",
  skip: "Skip for now",
  keepHelp: "The global identity will keep applying to repos without a rule, outside the app's control.",
  skipHelp:
    "Create profiles from the Profiles view and turn on the integration in Settings whenever you want.",
  reviewProfile: "Review the profile",
  nothingToActivate:
    "Without a default profile there's nothing to turn on yet. Create a profile from the Profiles view and turn on the integration in Settings.",
  changes: "These are the only two changes to your files, one line in each.",
  changesCreate:
    "These are the only two changes to your files, one line in each; also, <code>{{file}}</code> is created, owned by the app.",
};
