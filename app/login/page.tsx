import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span aria-hidden className="mb-4 grid size-16 place-items-center rounded-2xl bg-primary font-title text-2xl text-primary-foreground">
            AC
          </span>
          <h1 className="font-title text-3xl text-primary md:text-4xl">ACDRI AutoCluster</h1>
          <p className="mt-1.5 text-muted-foreground">Customers and quotations</p>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-[0_1px_3px_rgba(11,31,58,0.06),0_4px_16px_rgba(11,31,58,0.04)] md:p-8">
          <h2 className="mb-1 text-xl font-semibold text-primary">Welcome</h2>
          <p className="mb-6 text-muted-foreground">Please type the password to continue.</p>
          <Suspense fallback={<LoginForm next="/" />}>
            <Form searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  return <LoginForm next={safeNextPath(Array.isArray(sp.next) ? sp.next[0] : sp.next)} />;
}
