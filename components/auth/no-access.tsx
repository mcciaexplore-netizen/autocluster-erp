import { Home, Lock } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** "You don't have access to Inventory. Ask your admin if you need it." Never an error page. */
export function NoAccess({ area }: { area: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border bg-card px-6 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-secondary text-primary">
        <Lock className="size-7" aria-hidden />
      </span>
      <h1 className="font-title text-2xl text-primary">No access</h1>
      <p className="text-muted-foreground">
        You don&apos;t have access to {area}. Ask your admin if you need it.
      </p>
      <Button asChild size="lg">
        <Link href="/">
          <Home aria-hidden /> Home
        </Link>
      </Button>
    </div>
  );
}
