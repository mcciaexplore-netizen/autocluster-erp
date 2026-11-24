/**
 * "Done by" (section 4): it is always the signed-in person, unless their role has
 * "Record work on behalf of others" (on for Admin and Manager by default). The same permission
 * shows "Who's working?" on Today. Pure, so the screens and the server use the same rule.
 */
import { can, type Grants } from "./can";

export function mayRecordForOthers(who: { grants: Grants } | null | undefined): boolean {
  return can(who, "actions.on_behalf");
}
