import { AreaGate } from "@/components/auth/area-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"crm.view"} area="CRM">
      {children}
    </AreaGate>
  );
}
