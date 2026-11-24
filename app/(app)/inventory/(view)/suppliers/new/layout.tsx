import { AreaGate } from "@/components/auth/area-gate";

/** Only people who may add suppliers get this form. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"inventory.suppliers"} area="adding suppliers">
      {children}
    </AreaGate>
  );
}
