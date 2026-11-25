import { Suspense } from "react";
import { AreaGate } from "@/components/auth/area-gate";
import { InventoryAutoRefresh } from "@/components/inventory/auto-refresh";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";

/** Checks who is signed in and what they may see (forbidden() otherwise), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

/**
 * Inventory: people who can view it, plus operators who may only record materials for their own
 * jobs (/inventory/movements/new). Every other Inventory page also needs "inventory.view"
 * (app/(app)/inventory/(view)/layout.tsx).
 */
export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={["inventory.view", "inventory.use_own_jobs"]} area="Inventory">
      <div className="min-w-0">
        <Suspense fallback={<div className="mb-6 h-12 rounded-xl bg-secondary" />}>
          <InventoryTabs />
        </Suspense>
        <InventoryAutoRefresh />
        {children}
      </div>
    </AreaGate>
  );
}
