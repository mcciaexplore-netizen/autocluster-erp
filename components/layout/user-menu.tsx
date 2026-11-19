"use client";

import { ChevronDown, CircleUserRound, LogOut } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ showSignOut }: { showSignOut: boolean }) {
  const label = (
    <>
      <CircleUserRound className="size-6 text-primary" aria-hidden />
      <span className="font-medium text-foreground">Demo User</span>
    </>
  );
  if (!showSignOut) return <div className="flex items-center gap-2 text-sm">{label}</div>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-11 items-center gap-2 rounded-xl px-2 text-sm hover:bg-secondary" aria-label="Account menu">
        {label}
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Demo User</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOut}>
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
