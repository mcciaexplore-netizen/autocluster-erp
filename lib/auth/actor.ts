/**
 * Who is doing this? Writers call actorName() for history lines ("Done by ...", created_by).
 *
 * The signed-in app registers a resolver (lib/auth/current-user.ts) that reads the current
 * request's user. Terminal scripts (db:seed, db:reset) and tests never register one, so their
 * records keep saying "Demo User". This file has no server-only imports on purpose: the db
 * writers are also used by those scripts.
 */
export const FALLBACK_ACTOR = "Demo User";

export interface Actor {
  /** app_users.id */
  userId: string;
  name: string;
  teamMemberId: string;
}

type Resolver = () => Promise<Actor | null>;
const g = globalThis as unknown as { acdriActorResolver?: Resolver };

export function setActorResolver(fn: Resolver) {
  g.acdriActorResolver = fn;
}

/** The signed-in person for this request, or null outside a request (scripts, tests). */
export async function currentActor(): Promise<Actor | null> {
  try {
    return (await g.acdriActorResolver?.()) ?? null;
  } catch {
    return null; // called outside a request
  }
}

/** "Meera Iyer", or "Demo User" in scripts and tests. */
export async function actorName(): Promise<string> {
  return (await currentActor())?.name ?? FALLBACK_ACTOR;
}

// ---- Activity log hook ---------------------------------------------------------------------------
/**
 * The db writers that keep a record's own history (enquiry, job, ticket, stock record, stages)
 * also report it here, and the signed-in app forwards it to the Activity log (lib/activity.ts).
 * Scripts and tests never register a hook, so they write no log entries.
 */
export interface WriterActivity {
  area: string;
  action: string;
  summary: string;
  entityType: string;
  entityId: string;
  data?: Record<string, unknown> | null;
}
type ActivityHook = (conn: unknown, e: WriterActivity) => Promise<void>;
const h = globalThis as unknown as { acdriActivityHook?: ActivityHook };

export function setActivityHook(fn: ActivityHook) {
  h.acdriActivityHook = fn;
}

/** Never throws: a log entry must not undo the work. */
export async function reportActivity(conn: unknown, e: WriterActivity) {
  try {
    await h.acdriActivityHook?.(conn, e);
  } catch {
    /* the Activity log is best effort */
  }
}
