/**
 * A faded, static sketch of what a coming-soon module's main screen could look like: grey shapes
 * and a few labels only, never numbers, names or anything that could pass for real data.
 */
import type { SketchKind } from "@/lib/coming-soon";
import { cn } from "@/lib/utils";

const Bar = ({ w = "w-full", className }: { w?: string; className?: string }) => <span className={cn("block h-2.5 rounded-full bg-muted-foreground/20", w, className)} />;
const Box = ({ className, children }: { className?: string; children?: React.ReactNode }) => <div className={cn("rounded-xl border border-dashed border-muted-foreground/30 bg-card p-3", className)}>{children}</div>;
const Head = ({ children }: { children: React.ReactNode }) => <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</span>;

function Rows({ cols, rows = 5 }: { cols: string[]; rows?: number }) {
  return (
    <Box>
      <div className="grid gap-3 border-b border-dashed border-muted-foreground/30 pb-2" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
        {cols.map((c) => (
          <Head key={c}>{c}</Head>
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-3 py-2.5" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
          {cols.map((c, i) => (
            <Bar key={c} w={["w-4/5", "w-3/5", "w-2/3", "w-1/2"][(r + i) % 4]} />
          ))}
        </div>
      ))}
    </Box>
  );
}

export function Sketch({ kind }: { kind: SketchKind }) {
  const body = (() => {
    switch (kind) {
      case "register":
        return <Rows cols={["Sample", "Test", "Standard", "Status"]} />;
      case "approvals":
        return (
          <div className="grid gap-3 sm:grid-cols-3">
            {["Draft", "Waiting for approval", "Approved"].map((c) => (
              <Box key={c} className="flex flex-col gap-2">
                <Head>{c}</Head>
                {[0, 1, 2].map((i) => (
                  <Box key={i} className="flex flex-col gap-2 border-solid">
                    <Bar w="w-3/4" />
                    <Bar w="w-1/2" />
                  </Box>
                ))}
              </Box>
            ))}
          </div>
        );
      case "calendar":
        return (
          <Box>
            <div className="grid grid-cols-7 gap-1.5">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <Head key={d}>{d}</Head>
              ))}
              {Array.from({ length: 28 }, (_, i) => (
                <div key={i} className="flex h-12 flex-col gap-1 rounded-lg border border-dashed border-muted-foreground/20 p-1">
                  {i % 5 === 1 ? <Bar w="w-full" className="h-2" /> : null}
                  {i % 9 === 4 ? <Bar w="w-2/3" className="h-2" /> : null}
                </div>
              ))}
            </div>
          </Box>
        );
      case "dashboard":
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Box key={i} className="flex flex-col gap-2">
                  <Bar w="w-1/2" />
                  <Bar w="w-3/4" className="h-5" />
                </Box>
              ))}
            </div>
            <Box className="flex h-40 items-end gap-2">
              {[40, 65, 50, 80, 60, 90, 70, 55, 85, 75, 60, 95].map((h, i) => (
                <span key={i} className="flex-1 rounded-t-md bg-muted-foreground/20" style={{ height: `${h}%` }} />
              ))}
            </Box>
          </div>
        );
      case "portal":
        return (
          <Box className="p-0">
            <div className="flex items-center gap-1.5 border-b border-dashed border-muted-foreground/30 px-3 py-2">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-2.5 rounded-full bg-muted-foreground/25" />
              ))}
              <Bar w="w-1/3" className="ml-3" />
            </div>
            <div className="grid gap-3 p-3 sm:grid-cols-2">
              {["Quotations", "Purchase orders", "Job status", "Reports and invoices"].map((c) => (
                <Box key={c} className="flex flex-col gap-2">
                  <Head>{c}</Head>
                  <Bar w="w-4/5" />
                  <Bar w="w-3/5" />
                </Box>
              ))}
            </div>
          </Box>
        );
      case "sync":
        return (
          <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <Box className="flex flex-col gap-2">
              <Head>ACDRI ERP</Head>
              <Bar w="w-3/4" />
              <Bar w="w-1/2" />
              <Bar w="w-2/3" />
            </Box>
            <div className="flex justify-center text-2xl text-muted-foreground/50" aria-hidden>
              ⇄
            </div>
            <Box className="flex flex-col gap-2">
              <Head>TallyPrime</Head>
              <Bar w="w-2/3" />
              <Bar w="w-3/4" />
              <Bar w="w-1/2" />
            </Box>
          </div>
        );
      case "documents":
        return <Rows cols={["Document", "Version", "Approved by", "Read by"]} rows={4} />;
    }
  })();
  return (
    <figure className="pointer-events-none relative select-none" aria-hidden>
      <div className="opacity-60 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]">{body}</div>
    </figure>
  );
}
