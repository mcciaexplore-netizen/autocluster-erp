import "server-only";
import { cookies } from "next/headers";
import { authEnabled, SESSION_COOKIE, verifySessionToken } from "./auth";

/** Checks the session inside server actions and route handlers (not just at the front door). */
export async function isSignedIn(): Promise<boolean> {
  if (!authEnabled()) return true;
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export class NotSignedInError extends Error {
  constructor() {
    super("Please sign in again.");
  }
}

export async function requireSignedIn() {
  if (!(await isSignedIn())) throw new NotSignedInError();
}
