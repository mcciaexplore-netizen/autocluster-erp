"use client";

import { useAutoRefresh } from "@/hooks/use-auto-refresh";

/** Keeps the Inventory pages up to date (same rules as the boards). */
export function InventoryAutoRefresh() {
  useAutoRefresh("inventory");
  return null;
}
