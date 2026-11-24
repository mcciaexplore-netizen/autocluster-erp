/** Better Auth's own endpoints (session checks, sign out). Sign-in itself goes through our server action. */
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";

export const { GET, POST } = toNextJsHandler(auth);
