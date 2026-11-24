/**
 * DEMO_MODE (section 8). The demo site (Preview and the live demo) sets DEMO_MODE=true: the shared
 * demo password gate, demo accounts and "Try it as...". Anything else, including not set, is real
 * use: individual sign-in only, and db:reset / db:seed refuse to run.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

export const NOT_DEMO_MESSAGE =
  "Stopped: this is not a demo database (DEMO_MODE is not true), so demo data can't be loaded or reset here. Nothing was changed.";
