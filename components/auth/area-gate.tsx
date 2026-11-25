import { Suspense } from "react";
import { forbidden, redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { canAny } from "@/lib/auth/can";
import { signedInUser } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";
import { mayRecordForOthers } from "@/lib/auth/done-by-rule";
import { PermissionsProvider } from "./permissions-provider";

async function Gate({ perms, children }: { perms: Permission[]; children: React.ReactNode }) {
  const me = await signedInUser();
  if (!me) redirect("/sign-in");
  // Not allowed: Next.js shows the no-access page (app/(app)/forbidden.tsx) for this area.
  if (!canAny(me, perms)) forbidden();
  return (
    <PermissionsProvider grants={me.grants} name={me.name} teamMemberId={me.teamMemberId} mayRecordForOthers={mayRecordForOthers(me)}>
      {children}
    </PermissionsProvider>
  );
}

/**
 * Wraps a whole area (in its layout) or a page: shows the friendly no-access page unless the person
 * may view it. Pages' loaders check again on the server.
 */
/** `area` names the area for readers of the code; the no-access page works it out from the address (lib/areas.ts). */
export function AreaGate({ perm, children }: { perm: Permission | Permission[]; area?: string; children: React.ReactNode }) {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <Gate perms={Array.isArray(perm) ? perm : [perm]}>
        {children}
      </Gate>
    </Suspense>
  );
}
