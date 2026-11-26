/**
 * Department access in Planning: people see only their own departments' machines, jobs and
 * bookings (or everything with "All departments"). Applied on the server, in every Planning loader
 * and action, so other departments' data is never sent. Pure: the loaders, the pages and the tests
 * use the same rules.
 */
import { sql, type SQL } from "drizzle-orm";

/** null = every department. */
export type DeptScope = string[] | null;

export const PLANNING_DEPT_COOKIE = "planning_dept";

export function planningScope(me: { allDepartments: boolean; departments: string[] }): DeptScope {
  return me.allDepartments ? null : [...new Set(me.departments)];
}

export function inScope(scope: DeptScope, dept: string | null | undefined): boolean {
  return scope === null || (!!dept && scope.includes(dept));
}

/** SQL condition "this department column is one they may see". */
export function deptIn(column: SQL, scope: DeptScope): SQL {
  if (scope === null) return sql`true`;
  if (!scope.length) return sql`false`;
  return sql`coalesce(${column}, '') = any(${sql.param(scope)}::text[])`;
}

export interface DeptChoice {
  /** The departments they may pick from. */
  options: { code: string; name: string }[];
  /** "All" is offered only to people with every department. */
  allowAll: boolean;
  /** The department shown; null = all departments. */
  chosen: string | null;
  /** No picker when there's only one department to show. */
  picker: boolean;
}

/**
 * Which department a Planning page shows: the one asked for (if allowed), else the one remembered on
 * this device, else (with every department) "All" where the page allows it, else their first.
 */
export function chooseDept(
  scope: DeptScope,
  departments: { code: string; name: string }[],
  asked: string | null | undefined,
  remembered: string | null | undefined,
  opts: { allByDefault: boolean },
): DeptChoice {
  const options = scope === null ? departments : departments.filter((d) => scope.includes(d.code));
  const allowAll = scope === null;
  const valid = (v: string | null | undefined): v is string => !!v && (v === "all" ? allowAll : options.some((d) => d.code === v));
  const pick = valid(asked) ? asked : valid(remembered) ? remembered : allowAll && opts.allByDefault ? "all" : (options[0]?.code ?? null);
  return { options, allowAll, chosen: pick === "all" ? null : pick, picker: options.length > 1 };
}
