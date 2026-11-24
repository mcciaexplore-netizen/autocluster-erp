import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UsersList } from "@/components/users/users-list";
import { getUserFormOptions, listUsers, userFiltersFromParams } from "@/lib/users-data";

export const metadata: Metadata = { title: "Users" };

type Sp = Promise<Record<string, string | string[] | undefined>>;

export default function UsersPage({ searchParams }: { searchParams: Sp }) {
  return (
    <div>
      <PageHeader
        title="Users"
        description="Everyone who works here: who can sign in, their roles and their departments."
        actions={
          <Button asChild size="lg">
            <Link href="/settings/users/new">
              <Plus aria-hidden /> Add user
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: { searchParams: Sp }) {
  const [users, options] = await Promise.all([listUsers(userFiltersFromParams(await searchParams)), getUserFormOptions()]);
  return <UsersList users={users} roles={options.roles} departments={options.departments} />;
}
