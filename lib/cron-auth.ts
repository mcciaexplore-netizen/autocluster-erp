/** Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". Anyone else is refused. */
import { timingSafeEqual } from "node:crypto";

export function isVercelCron(request: Request, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16) return false; // not set up: refuse everyone
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
