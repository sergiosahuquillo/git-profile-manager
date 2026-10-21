import type { es } from "../es";
import type { Messages } from "../types";
import { clone } from "./clone";
import { common } from "./common";
import { diagnostics } from "./diagnostics";
import { onboarding } from "./onboarding";
import { profiles } from "./profiles";
import { rules } from "./rules";
import { settings } from "./settings";
import { shell } from "./shell";

export const en: Messages<typeof es> = {
  clone,
  common,
  diagnostics,
  onboarding,
  profiles,
  rules,
  settings,
  shell,
};
