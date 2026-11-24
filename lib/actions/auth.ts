"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authEnabled, authSetupProblem, createSessionToken, passwordMatches, safeNextPath, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/demo-gate";

export type SignInState = { error: string | null };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  if (!authEnabled()) redirect("/");
  const problem = authSetupProblem();
  if (problem) return { error: problem };

  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "Please type the password." };
  if (!passwordMatches(password)) {
    // A short pause makes guessing many passwords slow.
    await new Promise((r) => setTimeout(r, 700));
    return { error: "That password is not right. Please check it and try again." };
  }
  (await cookies()).set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions);
  redirect(safeNextPath(formData.get("next")));
}
