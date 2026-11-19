import { customerDetailsSchema, EMPTY_CUSTOMER_DETAILS } from "@/lib/validation/customer";
import { it, expect } from "vitest";
it("shows cross-field errors alongside others", () => {
  const r = customerDetailsSchema.safeParse({ ...EMPTY_CUSTOMER_DETAILS, isMcciaMember: "yes", gstin: "27AB" });
  const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]);
  expect(paths).toContain("mcciaMembershipId");
  expect(paths).toContain("gstin");
});
