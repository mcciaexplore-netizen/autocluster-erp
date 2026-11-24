"use client";

import { ChevronDown, CircleUserRound, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/lib/actions/session";

export function UserMenu({ name, roles }: { name: string | null; roles: string[] }) {
  const label = (
    <>
      <CircleUserRound className="size-6 text-primary" aria-hidden />
      <span className="max-w-[9rem] truncate font-medium text-foreground sm:max-w-[14rem]">{name ?? ""}</span>
    </>
  );
  if (!name) return <div className="flex h-11 items-center gap-2 text-sm">{label}</div>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-11 items-center gap-2 rounded-xl px-2 text-sm hover:bg-secondary" aria-label="Account menu">
        {label}
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block">{name}</span>
          {roles.length ? <span className="block text-xs font-normal text-muted-foreground">{roles.join(", ")}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="h-11 text-base">
          <Link href="/profile">
            <UserRound aria-hidden /> Profile
          </Link>
        </DropdownMenuItem>
        <form action={signOutAction}>
          <DropdownMenuItem asChild className="h-11 w-full text-base">
            <button type="submit">
              <LogOut aria-hidden /> Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
