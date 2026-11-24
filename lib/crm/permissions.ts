/** Who may change the CRM pipeline stages: anyone with "crm.stages" (Admin and Manager by default). */
import "server-only";
import { can } from "@/lib/auth/can";
import { signedInUser } from "@/lib/auth/guard";

export async function canManagePipeline(): Promise<boolean> {
  return can(await signedInUser(), "crm.stages");
}
