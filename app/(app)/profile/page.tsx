import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NewPasswordForm } from "@/components/auth/sign-in-form";
import { DetailsForm, SessionList, SignInHistory } from "@/components/auth/profile-forms";
import { PageHeader } from "@/components/common/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { changePassword } from "@/lib/actions/session";
import { getProfile } from "@/lib/profile-data";
import { OwnPinForm, ThisDeviceForm } from "@/components/floor/device-forms";

/** Reads who is signed in (and stops with forbidden() when they may not see it), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <div>
      <PageHeader title="Profile" description="Your details, your password, and the devices you're signed in on." />
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <Body />
      </Suspense>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border bg-card p-4 sm:p-6">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

async function Body() {
  const p = await getProfile();
  if (!p) redirect("/sign-in");
  const { me } = p;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Your details">
        <DetailsForm name={me.name} mobile={me.mobile ?? ""} email={me.email} />
      </Card>
      <Card title="Change password">
        <NewPasswordForm action={changePassword} needCurrent submitLabel="Change password" />
      </Card>
      <Card title="Signed in on">
        <SessionList sessions={p.sessions.map((s) => ({ id: s.id, current: s.current, ip: s.ip, userAgent: s.userAgent, lastUsed: s.updatedAt.toISOString() }))} />
      </Card>
      <Card title="Recent sign-ins">
        <SignInHistory items={p.signIns} />
      </Card>
      {p.pin.canOperate || p.pin.hasPin ? (
        <Card title="Shop-floor PIN">
          <OwnPinForm hasPin={p.pin.hasPin} />
        </Card>
      ) : null}
      {p.device ? (
        <Card title="This device">
          <ThisDeviceForm current={p.device.current} departments={p.allDepartments} />
        </Card>
      ) : null}
      <Card title="Your roles and departments">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-3 text-sm">
          <dt className="text-muted-foreground">Roles</dt>
          <dd className="flex flex-wrap gap-1.5">
            {me.roles.length ? me.roles.map((r) => <span key={r.id} className="rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium">{r.name}</span>) : <span className="text-muted-foreground">None yet</span>}
          </dd>
          <dt className="text-muted-foreground">Departments</dt>
          <dd>{me.allDepartments ? "All departments" : p.departments.map((d) => `${d.code}: ${d.name}`).join(", ") || "None"}</dd>
        </dl>
        <p className="mt-4 text-sm text-muted-foreground">Only an admin can change these.</p>
      </Card>
    </div>
  );
}
