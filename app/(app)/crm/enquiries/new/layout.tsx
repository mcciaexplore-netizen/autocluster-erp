import { AreaGate } from "@/components/auth/area-gate";

/** Only people who may add enquiries get this form. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"crm.edit"} area="adding enquiries">
      {children}
    </AreaGate>
  );
}
