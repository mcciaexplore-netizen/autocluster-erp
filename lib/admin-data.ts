/** Admin pages (Settings, Users, Roles, Activity log): who may open them, checked on the server. */
import "server-only";
import { connection } from "next/server";
import { need } from "@/lib/auth/guard";

/** Settings (organisation, lists, working hours): "settings.edit". */
export async function settingsAccess() {
  await connection();
  const me = await need(["settings.edit"]);
  return me;
}

/** Users, Roles and the Activity log: "users.manage". */
export async function adminAccess() {
  await connection();
  const me = await need(["users.manage"]);
  return me;
}
