/**
 * Mobile and email checks for enquiries, shared by the forms and the server.
 */
import { MOBILE_REGEX } from "@/lib/india";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** "+91 98220 12345" -> "9822012345". Returns null when empty. */
export function normalizeMobile(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "").replace(/^(?:91|0)(?=\d{10}$)/, "");
  return d || null;
}

export const MOBILE_PROBLEM = "The mobile number should have 10 digits, starting with 6, 7, 8 or 9, e.g. 98220 12345.";
export const EMAIL_PROBLEM = "This email address doesn't look right, e.g. name@company.com.";

export function mobileProblem(v: string | null | undefined): string | null {
  const m = normalizeMobile(v);
  return m && !MOBILE_REGEX.test(m) ? MOBILE_PROBLEM : null;
}
export function emailProblem(v: string | null | undefined): string | null {
  const e = (v ?? "").trim();
  return e && !EMAIL_RE.test(e) ? EMAIL_PROBLEM : null;
}

/**
 * One "Mobile or email" box: anything with an @ is treated as an email,
 * everything else as a mobile number. Checks the format of whichever was typed.
 */
export function parseMobileOrEmail(text: string): { phone: string | null; email: string | null; problem: string | null } {
  const t = text.trim();
  if (!t) return { phone: null, email: null, problem: "Please enter a mobile number or an email address." };
  if (t.includes("@")) {
    const email = t.toLowerCase();
    return { phone: null, email, problem: EMAIL_RE.test(email) ? null : EMAIL_PROBLEM };
  }
  if (/[a-z]/i.test(t)) return { phone: null, email: null, problem: "Please enter a 10-digit mobile number or an email address (with @)." };
  const phone = normalizeMobile(t);
  return { phone, email: null, problem: mobileProblem(t) };
}
