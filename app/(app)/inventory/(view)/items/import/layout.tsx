import { AreaGate } from "@/components/auth/area-gate";

/** Only people who may import items get this form. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"inventory.items"} area="importing items">
      {children}
    </AreaGate>
  );
}
