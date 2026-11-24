import { AreaGate } from "@/components/auth/area-gate";

/** Only people who may add items get this form. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"inventory.items"} area="adding items">
      {children}
    </AreaGate>
  );
}
