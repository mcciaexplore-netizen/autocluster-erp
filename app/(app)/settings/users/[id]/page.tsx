import type { Metadata } from "next";
import { ArrowLeft, History, KeyRound } from "lucide-react";
import { UserPinForm } from "@/components/floor/device-forms";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { Button } from "@/components/ui/button";
import { UserForm } from "@/components/users/user-form";
import { StatusChip } from "@/components/users/users-list";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getUser, getUserFormOptions } from "@/lib/users-data";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "User" };

const when = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

export default function UserPage({ params }: PageProps<"/settings/users/[id]">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/settings/users">
          <ArrowLeft aria-hidden /> All users
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
  const [u, o, me] = await Promise.all([getUser(id), getUserFormOptions(), getCurrentUser()]);
  if (!u) notFound();
  const status = u.deactivatedAt ? "DEACTIVATED" : !u.canSignIn ? "NAME_ONLY" : u.locked ? "LOCKED" : "ACTIVE";
  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-title text-3xl text-primary md:text-4xl">{u.name}</h1>
          <StatusChip status={status} />
        </div>
        <p className="mt-1 text-muted-foreground">
          {u.canSignIn ? (u.lastSignInAt ? `Last signed in ${when.format(new Date(u.lastSignInAt))}` : "Hasn't signed in yet") : "Name only: can't sign in"}
          {u.mustChangePassword && u.canSignIn ? " · Will choose a new password at next sign-in" : ""}
        </p>
      </header>
      <UserForm
        key={`${u.id}-${u.roleIds.join(",")}-${u.deptCodes.join(",")}-${u.canSignIn}-${u.email}`}
        id={u.id}
        roles={o.roles}
        departments={o.departments}
        initial={{ name: u.name, canSignIn: u.canSignIn, email: u.email, mobile: u.mobile, roleIds: u.roleIds, allDepartments: u.allDepartments, deptCodes: u.deptCodes }}
        status={{ deactivated: !!u.deactivatedAt, hasAccount: u.hasAccount, isSelf: me?.id === u.id }}
      />
      <section className="mt-6 rounded-2xl border bg-card p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="size-5 text-primary" aria-hidden /> Shop-floor PIN
        </h2>
        <UserPinForm id={u.id} name={u.name} hasPin={u.hasPin} />
      </section>
      <section className="mt-6 rounded-2xl border bg-card p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <History className="size-5 text-primary" aria-hidden /> History
        </h2>
        {u.history.length ? (
          <ol className="flex flex-col gap-3">
            {u.history.map((h, i) => (
              <li key={i} className="text-sm">
                <span className="block">{h.summary}</span>
                <span className="block text-xs text-muted-foreground">
                  {when.format(new Date(h.at))}
                  {h.by ? ` · by ${h.by}` : ""}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        )}
      </section>
    </>
  );
}
