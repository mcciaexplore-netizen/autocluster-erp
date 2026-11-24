import { AreaGate } from "@/components/auth/area-gate";

/** Only people who may add or change customers get this form. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"customers.edit"} area="adding customers">
      {children}
    </AreaGate>
  );
}
