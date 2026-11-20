import { Suspense } from "react";
import { InventoryAutoRefresh } from "@/components/inventory/auto-refresh";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <Suspense fallback={<div className="mb-6 h-12 rounded-xl bg-secondary" />}>
        <InventoryTabs />
      </Suspense>
      <InventoryAutoRefresh />
      {children}
    </div>
  );
}
