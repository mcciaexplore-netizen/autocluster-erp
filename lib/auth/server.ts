/** The app's Better Auth instance (server only). nextCookies() lets server actions set the session cookie. */
import "server-only";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { createAuth } from "./better-auth";

const g = globalThis as unknown as { acdriAuth?: ReturnType<typeof createAuth> };
export const auth = (g.acdriAuth ??= createAuth(db, { nextCookies: nextCookies() }));
