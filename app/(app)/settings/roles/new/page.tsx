import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { RoleForm } from "@/components/users/role-form";
import { need } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "New role" };

export default function NewRolePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/settings/roles">
          <ArrowLeft aria-hidden /> All roles
        </Link>
      </Button>
      <PageHeader title="New role" description="Tip: it's often quicker to open a similar role and use Copy role." />
      <Suspense fallback={<FormSkeleton />}>
        <Form />
      </Suspense>
    </div>
  );
}

async function Form() {
  await connection();
  await need(["users.manage"]);
  return <RoleForm id={null} initial={{ name: "", description: "", scopeOwnDepartments: false, permissions: [] }} />;
}
