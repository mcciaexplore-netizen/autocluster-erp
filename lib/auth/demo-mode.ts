/**
 * DEMO_MODE (section 8). The demo site (Preview and the live demo) runs in demo mode: the shared
 * demo password gate, demo accounts and "Try it as...". Real use sets DEMO_MODE=false: individual
 * sign-in only, and db:reset / db:seed refuse to run.
 * Anything other than "false" counts as demo mode, so nothing changes until it is set on purpose.
 */
export function isDemoMode(): boolean {
  return (process.env.DEMO_MODE ?? "").trim().toLowerCase() !== "false";
}
