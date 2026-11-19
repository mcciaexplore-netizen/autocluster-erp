/**
 * Default CRM stages and lists. Safe to run any number of times: each list is
 * only filled when it is empty, so nothing staff have changed is overwritten.
 * Kept free of Next.js imports so scripts can use it.
 */
import { eq, sql } from "drizzle-orm";
import { DEFAULT_LOST_REASONS, DEFAULT_QUOTE_MOVE_STAGE, DEFAULT_SOURCES, DEFAULT_STAGES, DEFAULT_TAGS } from "../lib/crm/stages";
import type { DB, Tx } from "./client";
import { crmLostReasons, crmSources, crmStages, crmTags, settings } from "./schema";

const count = async (db: DB | Tx, table: "crm_stages" | "crm_sources" | "crm_lost_reasons" | "crm_tags") =>
  Number((await db.execute<{ n: string }>(sql`select count(*) as n from ${sql.identifier(table)}`)).rows[0].n);

/** Fills any empty CRM list with its defaults. Returns what it added. */
export async function ensureCrmDefaults(db: DB | Tx): Promise<string[]> {
  const run = async (tx: DB | Tx) => {
    // Only one caller at a time, so two first visits can't both add the defaults.
    await tx.execute(sql`select pg_advisory_xact_lock(4242001)`);
    const added: string[] = [];
    if ((await count(tx, "crm_stages")) === 0) {
      const rows = await tx
        .insert(crmStages)
        .values(DEFAULT_STAGES.map((s, i) => ({ ...s, sortOrder: i + 1 })))
        .returning({ id: crmStages.id, name: crmStages.name });
      const move = rows.find((r) => r.name === DEFAULT_QUOTE_MOVE_STAGE);
      if (move) await tx.update(settings).set({ quoteCreatedMoveToStageId: move.id }).where(eq(settings.id, 1));
      added.push("stages");
    }
    const lists = [
      ["crm_sources", crmSources, DEFAULT_SOURCES, "sources"],
      ["crm_lost_reasons", crmLostReasons, DEFAULT_LOST_REASONS, "lost reasons"],
      ["crm_tags", crmTags, DEFAULT_TAGS, "tags"],
    ] as const;
    for (const [name, table, values, label] of lists) {
      if ((await count(tx, name)) === 0) {
        await tx.insert(table).values(values.map((v, i) => ({ name: v, sortOrder: i + 1 })));
        added.push(label);
      }
    }
    return added;
  };
  // Inside a caller's transaction, a nested transaction becomes a savepoint.
  return db.transaction(run);
}
