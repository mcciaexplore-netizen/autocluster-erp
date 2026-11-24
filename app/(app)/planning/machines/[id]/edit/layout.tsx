import { AreaGate } from "@/components/auth/area-gate";

/** Only people who may change machines get this form. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"planning.machines"} area="changing machines">
      {children}
    </AreaGate>
  );
}
