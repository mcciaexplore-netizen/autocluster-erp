import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { canAny } from "@/lib/auth/can";
import { signedInUser } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";
import { NoAccess } from "./no-access";
import { PermissionsProvider } from "./permissions-provider";

async function Gate({ perms, area, children }: { perms: Permission[]; area: string; children: React.ReactNode }) {
  const me = await signedInUser();
  if (!me) redirect("/sign-in");
  if (!canAny(me, perms)) return <NoAccess area={area} />;
  return (
    <PermissionsProvider grants={me.grants} name={me.name}>
      {children}
    </PermissionsProvider>
  );
}

/**
 * Wraps a whole area (in its layout) or a page: shows the friendly no-access page unless the person
 * may view it. Pages' loaders check again on the server.
 */
export function AreaGate({ perm, area, children }: { perm: Permission | Permission[]; area: string; children: React.ReactNode }) {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <Gate perms={Array.isArray(perm) ? perm : [perm]} area={area}>
        {children}
      </Gate>
    </Suspense>
  );
}
