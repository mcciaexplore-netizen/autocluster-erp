/** The centred card used by the sign-in pages, with the ACDRI name. */
export function AuthCard({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span aria-hidden className="mb-4 grid size-16 place-items-center rounded-2xl bg-primary font-title text-2xl text-primary-foreground">
            AC
          </span>
          <h1 className="font-title text-3xl text-primary md:text-4xl">AutoCluster</h1>
          <p className="mt-1.5 text-muted-foreground">Auto Cluster Development and Research Institute (ACDRI)</p>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-[0_1px_3px_rgba(11,31,58,0.06),0_4px_16px_rgba(11,31,58,0.04)] md:p-8">
          <h2 className="mb-1 text-xl font-semibold text-primary">{title}</h2>
          {intro ? <div className="mb-6 text-muted-foreground">{intro}</div> : null}
          {children}
        </div>
      </div>
    </main>
  );
}
