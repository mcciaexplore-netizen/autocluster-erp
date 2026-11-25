import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { RoleForm } from "@/components/users/role-form";
import { getRole } from "@/lib/users-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Role" };

export default function RolePage({ params }: PageProps<"/settings/roles/[id]">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/settings/roles">
          <ArrowLeft aria-hidden /> All roles
        </Link>
      </Button>
      <Suspense fallback={<FormSkeleton />}>
        <Detail params={params} />
      </Suspense>
    </div>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const r = await getRole(Number(id));
  if (!r) notFound();
  return (
    <>
      <PageHeader title={r.name} description={r.description || undefined} />
      <RoleForm key={`${r.id}-${r.name}-${r.permissions.join(",")}-${r.scopeOwnDepartments}`} id={r.id} people={r.people} initial={{ name: r.name, description: r.description, scopeOwnDepartments: r.scopeOwnDepartments, permissions: r.permissions }} />
    </>
  );
}
