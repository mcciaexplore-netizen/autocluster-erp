import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listRoles } from "@/lib/users-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Roles" };

export default function RolesPage() {
  return (
    <div>
      <PageHeader
        title="Roles"
        description="What each role can do. People can have more than one role; what they can do adds up."
        actions={
          <Button asChild size="lg">
            <Link href="/settings/roles/new">
              <Plus aria-hidden /> New role
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const roles = await listRoles();
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {roles.map((r) => (
        <li key={r.id}>
          <Link href={`/settings/roles/${r.id}`} className="flex h-full flex-col rounded-2xl border bg-card p-4 hover:border-primary/40">
            <span className="flex items-start justify-between gap-2">
              <span className="font-semibold text-primary">{r.name}</span>
              <span className="rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium whitespace-nowrap">
                {r.users} {r.users === 1 ? "person" : "people"}
              </span>
            </span>
            <span className="mt-1 text-sm text-muted-foreground">{r.description || "No description."}</span>
            <span className="mt-2 text-xs text-muted-foreground">
              {r.permissions} {r.permissions === 1 ? "permission" : "permissions"}
              {r.scopeOwnDepartments ? " · own departments only" : ""}
              {r.isSystem ? " · default role" : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
