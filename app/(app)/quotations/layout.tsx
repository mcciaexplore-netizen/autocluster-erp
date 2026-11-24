import { AreaGate } from "@/components/auth/area-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"quotes.view"} area="Quotations">
      {children}
    </AreaGate>
  );
}
