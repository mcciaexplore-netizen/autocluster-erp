"use client";

import { Delete, Loader2, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pinSignInAction } from "@/lib/actions/floor";
import { cn } from "@/lib/utils";

/** The names on a shared device; tap yours and type your PIN. */
export function FloorPicker({ people }: { people: { id: string; name: string }[] }) {
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  return (
    <>
      {people.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {people.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setWho(p)} className="flex h-24 w-full items-center justify-center rounded-2xl border-2 bg-card px-3 text-center text-lg font-semibold text-primary transition hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring">
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border bg-card p-6 text-center text-muted-foreground">Nobody here has a shop-floor PIN yet. Operators set one on their Profile, or an admin sets it on the Users page.</p>
      )}
      {who ? <PinDialog key={who.id} who={who} onClose={() => setWho(null)} /> : null}
    </>
  );
}

function PinDialog({ who, onClose }: { who: { id: string; name: string }; onClose: () => void }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const press = (d: string) => {
    setError(null);
    setPin((p) => (p.length < 6 ? p + d : p));
  };
  const submit = () =>
    start(async () => {
      const r = await pinSignInAction(who.id, pin);
      if (!r.ok) {
        setPin("");
        return void setError(r.message);
      }
      router.refresh();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hello, {who.name.split(" ")[0]}</DialogTitle>
          <DialogDescription>Type your PIN (4 to 6 digits).</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pin.length >= 4) submit();
          }}
        >
          <label className="sr-only" htmlFor="pin">
            PIN
          </label>
          <input
            id="pin"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="off"
            type="password"
            autoFocus
            className="h-14 w-full rounded-xl border bg-card text-center font-mono text-3xl tracking-[0.5em]"
            aria-invalid={!!error}
            aria-describedby="pin-error"
          />
          <p id="pin-error" aria-live="polite" className="mt-2 min-h-5 text-center text-sm font-medium text-destructive">
            {error}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Key key={d} onClick={() => press(d)}>
                {d}
              </Key>
            ))}
            <Key onClick={() => setPin((p) => p.slice(0, -1))} label="Remove last digit">
              <Delete aria-hidden />
            </Key>
            <Key onClick={() => press("0")}>0</Key>
            <Button type="submit" className="h-16 text-lg" disabled={pending || pin.length < 4}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />} Go
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Key({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn("grid h-16 place-items-center rounded-xl border bg-secondary text-2xl font-semibold transition active:scale-95")}>
      {children}
    </button>
  );
}
