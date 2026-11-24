import { describe, expect, it } from "vitest";
import { passwordProblem, temporaryPassword } from "./password-rules";

describe("password rules", () => {
  it("needs at least 10 characters and refuses common passwords", () => {
    expect(passwordProblem("short")).toBe("Use at least 10 characters.");
    expect(passwordProblem("Password123")).toMatch(/too common/);
    expect(passwordProblem("1234567890")).toMatch(/too common/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/too common/);
    expect(passwordProblem("monsoon kites over pune")).toBeNull();
  });
  it("refuses the person's own name or email", () => {
    expect(passwordProblem("meera.iyer", { email: "meera.iyer@x.com" })).toMatch(/name or email/);
    expect(passwordProblem("vikramshah", { name: "Vikram Shah", email: "vikramshah@x.com" })).toMatch(/name or email/);
  });
  it("makes temporary passwords that pass the rules", () => {
    let n = 7;
    const rand = (max: number) => (n = (n * 31 + 11) % 1000) % max;
    for (let i = 0; i < 20; i++) expect(passwordProblem(temporaryPassword(rand))).toBeNull();
  });
});
