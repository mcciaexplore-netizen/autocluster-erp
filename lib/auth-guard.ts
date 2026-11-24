import "server-only";
import { getCurrentUser } from "./auth/current-user";

/**
 * Checks the signed-in person inside server actions and route handlers (not just at the front
 * door). Someone who still has to choose a new password can't do anything else yet.
 */
export async function isSignedIn(): Promise<boolean> {
  const u = await getCurrentUser();
  return !!u && !u.mustChangePassword;
}

export class NotSignedInError extends Error {
  constructor() {
    super("Please sign in again.");
  }
}

export async function requireSignedIn() {
  if (!(await isSignedIn())) throw new NotSignedInError();
}
