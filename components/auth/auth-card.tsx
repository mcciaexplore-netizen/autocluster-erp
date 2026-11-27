import { BrandHero } from "@/components/brand/brand";

/** The centred card used by the sign-in pages, under the ERPOne logo and name. */
export function AuthCard({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <BrandHero />
        <div className="rounded-2xl border bg-card p-6 shadow-[0_1px_3px_rgba(11,31,58,0.06),0_4px_16px_rgba(11,31,58,0.04)] md:p-8">
          <h2 className="mb-1 text-xl font-semibold text-primary">{title}</h2>
          {intro ? <div className="mb-6 text-muted-foreground">{intro}</div> : null}
          {children}
        </div>
      </div>
    </main>
  );
}
