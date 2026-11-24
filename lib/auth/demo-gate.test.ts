import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, passwordMatches, safeNextPath, verifySessionToken } from "./demo-gate";

describe("demo password sessions", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.DEMO_PASSWORD = "correct horse";
    process.env.AUTH_SECRET = "x".repeat(48);
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("accepts a fresh token and rejects a tampered one", () => {
    const t = createSessionToken();
    expect(verifySessionToken(t)).toBe(true);
    expect(verifySessionToken(t.slice(0, -2) + "zz")).toBe(false);
    expect(verifySessionToken("garbage")).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
  });
  it("expires after 7 days", () => {
    const t = createSessionToken(Date.now() - 8 * 24 * 3600 * 1000);
    expect(verifySessionToken(t)).toBe(false);
  });
  it("signs everyone out when the password or secret changes", () => {
    const t = createSessionToken();
    process.env.DEMO_PASSWORD = "new password";
    expect(verifySessionToken(t)).toBe(false);
    process.env.DEMO_PASSWORD = "correct horse";
    process.env.AUTH_SECRET = "y".repeat(48);
    expect(verifySessionToken(t)).toBe(false);
  });
  it("never stores the password in the token", () => {
    expect(createSessionToken()).not.toContain("correct");
    expect(Buffer.from(createSessionToken().split(".")[0], "base64url").toString()).not.toContain("horse");
  });
  it("refuses tokens when AUTH_SECRET is too short", () => {
    const t = createSessionToken();
    process.env.AUTH_SECRET = "short";
    expect(verifySessionToken(t)).toBe(false);
  });
  it("checks the password", () => {
    expect(passwordMatches("correct horse")).toBe(true);
    expect(passwordMatches("wrong")).toBe(false);
  });
  it("only redirects within the site", () => {
    expect(safeNextPath("/customers")).toBe("/customers");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
  });
});
