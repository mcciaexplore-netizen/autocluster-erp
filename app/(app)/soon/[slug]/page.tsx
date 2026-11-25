import type { Metadata } from "next";
import { Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Sketch } from "@/components/soon/sketch";
import { COMING_SOON, comingSoonBySlug } from "@/lib/coming-soon";

/** Like every page in the app (each sits in the signed-in frame), it blocks on the server: no instant-navigation validation. */
export const instant = false;

/** The same pages for everyone, made at build time. */
export function generateStaticParams() {
  return COMING_SOON.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: PageProps<"/soon/[slug]">): Promise<Metadata> {
  const m = comingSoonBySlug((await params).slug);
  return { title: m ? `${m.name} (coming soon)` : "Coming soon" };
}

/** A coming-soon module: what it will do, what it works with, and a sketch. Nothing on it does anything. */
export default async function ComingSoonPage({ params }: PageProps<"/soon/[slug]">) {
  const m = comingSoonBySlug((await params).slug);
  if (!m) notFound();
  const Icon = m.icon;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-secondary text-primary">
          <Icon className="size-7" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-title text-3xl text-primary md:text-4xl">{m.name}</h1>
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900">Coming soon</span>
          </div>
          <p className="mt-1 text-base text-muted-foreground">{m.summary}</p>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <section className="rounded-2xl border bg-card p-4 sm:p-6">
          <h2 className="mb-3 text-lg font-semibold">What it will do</h2>
          <ul className="flex flex-col gap-2.5">
            {m.bullets.map((b) => (
              <li key={b} className="flex gap-2.5">
                <Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-2xl border bg-card p-4 sm:p-6">
          <h2 className="mb-3 text-lg font-semibold">Works with</h2>
          <ul className="flex flex-wrap gap-2">
            {m.worksWith.map((w) => (
              <li key={w.label}>
                <Link href={w.href} className="inline-block rounded-full border bg-secondary px-3 py-1 text-sm font-medium hover:border-primary/40">
                  {w.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <h2 className="mb-1 text-lg font-semibold">How it could look</h2>
        <p className="mb-3 text-sm text-muted-foreground">A sketch only, not a working screen.</p>
        <Sketch kind={m.sketch} />
      </section>
    </div>
  );
}
