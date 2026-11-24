/**
 * "Done by" (section 4): it is always the signed-in person, except that Managers and Admins may
 * record work on someone else's behalf. Pure, so the screens and the server use the same rule.
 */
import { can, type Grants } from "./can";

export function mayRecordForOthers(who: { roles: { name: string }[]; grants: Grants } | null | undefined): boolean {
  if (!who) return false;
  return who.roles.some((r) => r.name === "Admin" || r.name === "Manager") || can(who, "users.manage");
}
