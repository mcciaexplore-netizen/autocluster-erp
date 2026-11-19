/**
 * Who may change the CRM pipeline (stages and lists).
 * The demo has one shared sign-in, so everyone signed in may. When real admin
 * roles arrive, change only this function; the screens already call it.
 */
export async function canManagePipeline(): Promise<boolean> {
  return true;
}
