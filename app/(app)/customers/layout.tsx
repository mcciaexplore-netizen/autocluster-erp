import { AreaGate } from "@/components/auth/area-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"customers.view"} area="Customers">
      {children}
    </AreaGate>
  );
}
