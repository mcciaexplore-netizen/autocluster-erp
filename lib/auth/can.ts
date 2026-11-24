/**
 * One check for everything: can(user, permission, { dept }). Pure and unit-tested; works the same
 * on the server and in the browser (for showing or greying out buttons). The server always checks
 * again: hiding a button is never the protection.
 */
import { ALL_PERMISSIONS, isScoped, type Permission } from "./permissions";

/** Per permission: true = everywhere, or the departments it applies to. */
export type Grants = Partial<Record<Permission, true | string[]>>;

export interface RoleGrant {
  scopeOwnDepartments: boolean;
  permissions: string[];
}

/**
 * Adds up the person's roles. A scoped permission (acting on jobs, machines, stock) from a role
 * marked "Can only act on their own departments" only covers the person's departments; viewing is
 * never limited. Any role giving it without that limit gives it everywhere.
 */
export function buildGrants(roles: RoleGrant[], person: { allDepartments: boolean; departments: string[] }): Grants {
  const grants: Grants = {};
  const known = new Set<string>(ALL_PERMISSIONS);
  for (const r of roles) {
    for (const p of r.permissions) {
      if (!known.has(p)) continue;
      const perm = p as Permission;
      const limited = r.scopeOwnDepartments && isScoped(perm) && !person.allDepartments;
      const current = grants[perm];
      if (current === true) continue;
      if (!limited) grants[perm] = true;
      else grants[perm] = [...new Set([...(current ?? []), ...person.departments])];
    }
  }
  return grants;
}

/**
 * - No dept given: "can they do this anywhere?" (e.g. to show a menu or a button).
 * - dept given (the job's, machine's or item's department, or null when it has none):
 *   a permission limited to some departments only works on those.
 * - For stock items that belong to several departments, pass them all: any one is enough.
 */
export function can(who: { grants: Grants } | null | undefined, perm: Permission, opts: { dept?: string | null | string[] } = {}): boolean {
  const g = who?.grants[perm];
  if (!g) return false;
  if (g === true || !("dept" in opts)) return true;
  const depts = Array.isArray(opts.dept) ? opts.dept : opts.dept ? [opts.dept] : [];
  return depts.some((d) => g.includes(d));
}

/** Any of these permissions (anywhere). */
export const canAny = (who: { grants: Grants } | null | undefined, perms: Permission[]) => perms.some((p) => can(who, p));
