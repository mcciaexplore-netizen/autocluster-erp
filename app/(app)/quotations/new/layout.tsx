import { AreaGate } from "@/components/auth/area-gate";

/** Only people who may create quotations get this form. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"quotes.edit"} area="creating quotations">
      {children}
    </AreaGate>
  );
}
