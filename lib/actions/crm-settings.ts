"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { addListItem, deleteListItem, moveListItem, setListItemActive, updateListItem, type CrmListKey, type ListItemInput } from "@/db/crm-lists-writer";
import { UserFacingError } from "@/db/quote-writer";
import { allow } from "@/lib/auth/guard";
import type { Permission } from "@/lib/auth/permissions";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const listKey = z.enum(["sources", "lostReasons", "tags", "team", "invCategories", "invUnits", "invPurposes", "invReasons"]);
const id = z.string().uuid();
const item = z.object({ name: z.string().max(200), phone: z.string().max(30).nullish(), email: z.string().max(200).nullish() });

async function run<T>(perm: Permission | Permission[], fn: () => Promise<T>): Promise<Result<T>> {
  const g = await allow(perm);
  if (!g.ok) return { ok: false, message: g.message };
  try {
    const data = await fn();
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Please check the details." };
    console.error(e);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function addCrmListItem(key: CrmListKey, input: ListItemInput) {
  return run("settings.edit", () => addListItem(db, listKey.parse(key), item.parse(input)));
}
export async function updateCrmListItem(key: CrmListKey, itemId: string, input: ListItemInput) {
  return run("settings.edit", () => updateListItem(db, listKey.parse(key), id.parse(itemId), item.parse(input)));
}
export async function setCrmListItemActive(key: CrmListKey, itemId: string, active: boolean) {
  return run("settings.edit", () => setListItemActive(db, listKey.parse(key), id.parse(itemId), z.boolean().parse(active)));
}
export async function moveCrmListItem(key: CrmListKey, itemId: string, dir: -1 | 1) {
  return run("settings.edit", () => moveListItem(db, listKey.parse(key), id.parse(itemId), z.union([z.literal(-1), z.literal(1)]).parse(dir)));
}
export async function deleteCrmListItem(key: CrmListKey, itemId: string) {
  return run("settings.edit", () => deleteListItem(db, listKey.parse(key), id.parse(itemId)));
}
