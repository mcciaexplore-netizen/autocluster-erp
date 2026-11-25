import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PermissionsProvider } from "@/components/auth/permissions-provider";
import { FloorPicker } from "@/components/floor/floor-picker";
import { FloorDoneButton, FloorProvider } from "@/components/floor/floor-context";
import { TodayBoard } from "@/components/planning/today";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEVICE_COOKIE, findDevice, floorPeople } from "@/lib/auth/floor-core";
import { getToday } from "@/lib/planning-data";

export const metadata: Metadata = { title: "Shop floor" };

/** A shared shop-floor device (section 7): the names, a PIN, then that person's Today. */
export default function FloorPage() {
  return (
    <div className="min-h-dvh bg-page px-4 py-6 md:px-8">
      <div className="mx-auto max-w-3xl">
        <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
          <Body />
        </Suspense>
      </div>
    </div>
  );
}

function Header({ title, device, right }: { title: string; device: string; right?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm text-muted-foreground">Shop floor · {device}</p>
        <h1 className="font-title text-3xl text-primary">{title}</h1>
      </div>
      {right}
    </header>
  );
}

async function Body() {
  await connection();
  const device = await findDevice(db, (await cookies()).get(DEVICE_COOKIE)?.value);
  if (!device) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center">
        <h1 className="mb-2 font-title text-2xl text-primary">Shop floor</h1>
        <p className="text-muted-foreground">This device isn&apos;t set up as a shared shop-floor device. Ask your admin.</p>
        <Link href="/sign-in" className="mt-4 inline-block font-medium text-primary underline-offset-4 hover:underline">
          Sign in with email instead
        </Link>
      </div>
    );
  }
  const me = await getCurrentUser();
  if (me?.floor) {
    const data = await getToday();
    return (
      <PermissionsProvider grants={me.grants} name={me.name} teamMemberId={me.teamMemberId} mayRecordForOthers={false}>
        <FloorProvider name={me.name}>
          <Header title="Today" device={device.name} right={<FloorDoneButton />} />
          <TodayBoard data={data} />
        </FloorProvider>
      </PermissionsProvider>
    );
  }
  if (me) {
    return (
      <div className="rounded-2xl border bg-card p-6">
        <Header title="Shop floor" device={device.name} />
        <p>
          You&apos;re signed in as {me.name}. Sign out (account menu, top right of any page) so operators can use their PINs here.{" "}
          <Link href="/planning/today" className="font-medium text-primary underline-offset-4 hover:underline">
            Go to Today
          </Link>
        </p>
      </div>
    );
  }
  return (
    <>
      <Header
        title="Who's working?"
        device={device.name}
        right={
          <Link href="/sign-in" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Staff sign in
          </Link>
        }
      />
      <FloorPicker people={await floorPeople(db, device.deptCodes)} />
    </>
  );
}
