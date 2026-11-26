import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { UserForm } from "@/components/users/user-form";
import { getUserFormOptions } from "@/lib/users-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Add user" };

export default function NewUserPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/settings/users">
          <ArrowLeft aria-hidden /> All users
        </Link>
      </Button>
      <PageHeader title="Add user" description="If they can sign in, you'll get a temporary password to share with them privately." />
      <Suspense fallback={<FormSkeleton />}>
        <Form />
      </Suspense>
    </div>
  );
}

async function Form() {
  const o = await getUserFormOptions();
  const operator = o.roles.find((r) => r.name === "Operator");
  return <UserForm id={null} roles={o.roles} departments={o.departments} initial={{ name: "", canSignIn: true, email: "", mobile: "", roleIds: operator ? [operator.id] : [], allDepartments: false, deptCodes: [], maxMachines: "" }} />;
}
