"use client";

import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithPassword, type FormState } from "@/lib/actions/session";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signInWithPassword, { error: null });
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email" className="text-base font-medium">
          Email
        </Label>
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoFocus required className="h-12 text-base" aria-invalid={!!state.error} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password" className="text-base font-medium">
          Password
        </Label>
        <div className="relative">
          <Input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required aria-invalid={!!state.error} aria-describedby="sign-in-error" className="h-12 pr-20 text-base" />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute top-1/2 right-1 flex h-10 -translate-y-1/2 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-primary"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            {show ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-base">
        <Checkbox name="remember" defaultChecked />
        Keep me signed in
      </label>
      <div id="sign-in-error" aria-live="polite">
        {state.error ? (
          <p className="flex items-start gap-1.5 text-sm font-medium text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {state.error}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
        Sign in
      </Button>
      <div className="text-center text-sm">
        {forgot ? (
          <p className="text-muted-foreground">Ask your admin to reset it. They will give you a temporary password.</p>
        ) : (
          <button type="button" onClick={() => setForgot(true)} className="min-h-11 font-medium text-primary underline-offset-4 hover:underline">
            Forgot password?
          </button>
        )}
      </div>
    </form>
  );
}

export function NewPasswordForm({ next, action: serverAction, needCurrent = false, submitLabel }: { next?: string; action: (prev: FormState, fd: FormData) => Promise<FormState>; needCurrent?: boolean; submitLabel: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(serverAction, { error: null });
  const [show, setShow] = useState(false);
  const field = (id: string, label: string, autoComplete: string, help?: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-base font-medium">
        {label}
      </Label>
      <Input id={id} name={id} type={show ? "text" : "password"} autoComplete={autoComplete} required className="h-12 text-base" />
      {help ? <p className="text-sm text-muted-foreground">{help}</p> : null}
    </div>
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {needCurrent ? field("current", "Current password", "current-password") : null}
      {field("password", "New password", "new-password", "At least 10 characters. A short sentence you will remember works well.")}
      {field("again", "Type the new password again", "new-password")}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <Checkbox checked={show} onCheckedChange={(v) => setShow(v === true)} />
        Show the passwords
      </label>
      <div aria-live="polite">
        {state.error ? (
          <p className="flex items-start gap-1.5 text-sm font-medium text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {state.error}
          </p>
        ) : state.ok ? (
          <p className="text-sm font-medium text-emerald-700">{state.ok}</p>
        ) : null}
      </div>
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto sm:self-start">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}
