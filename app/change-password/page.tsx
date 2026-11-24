import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { NewPasswordForm } from "@/components/auth/sign-in-form";
import { chooseNewPassword } from "@/lib/actions/session";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeNextPath } from "@/lib/auth/demo-gate";

export const metadata: Metadata = { title: "Choose your new password" };

export default function ChangePasswordPage({ searchParams }: PageProps<"/change-password">) {
  return (
    <AuthCard title="Choose your new password" intro="You signed in with a temporary password. Choose your own before you carry on.">
      <Suspense fallback={null}>
        <Form searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<"/change-password">["searchParams"] }) {
  const sp = await searchParams;
  const next = safeNextPath(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  const me = await getCurrentUser();
  if (!me) redirect("/sign-in");
  if (!me.mustChangePassword) redirect(next);
  return <NewPasswordForm next={next} action={chooseNewPassword} submitLabel="Save and continue" />;
}
