import { AreaGate } from "@/components/auth/area-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"inventory.view"} area="Inventory">
      {children}
    </AreaGate>
  );
}
