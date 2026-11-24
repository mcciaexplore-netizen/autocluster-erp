import { AreaGate } from "@/components/auth/area-gate";

/** Only people who may change enquiries get this form. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"crm.edit"} area="changing enquiries">
      {children}
    </AreaGate>
  );
}
