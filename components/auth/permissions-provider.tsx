"use client";

import { createContext, useContext } from "react";
import { can, type Grants } from "@/lib/auth/can";
import type { Permission } from "@/lib/auth/permissions";

type Ctx = { grants: Grants; name: string | null };
const PermissionsContext = createContext<Ctx>({ grants: {}, name: null });

/** What the signed-in person may do, for showing or hiding buttons. The server always checks again. */
export function PermissionsProvider({ grants, name, children }: Ctx & { children: React.ReactNode }) {
  return <PermissionsContext value={{ grants, name }}>{children}</PermissionsContext>;
}

export function useCan() {
  const ctx = useContext(PermissionsContext);
  return (perm: Permission, opts: { dept?: string | null | string[] } = {}) => can(ctx, perm, opts);
}

/** Shows its children only to people with (any of) these permissions. The server checks again. */
export function Can({ perm, dept, children }: { perm: Permission | Permission[]; dept?: string | null; children: React.ReactNode }) {
  const can = useCan();
  const perms = Array.isArray(perm) ? perm : [perm];
  return perms.some((p) => can(p, dept !== undefined ? { dept } : {})) ? children : null;
}
