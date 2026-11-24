import { AreaGate } from "@/components/auth/area-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"ratecard.view"} area="the Rate Card">
      {children}
    </AreaGate>
  );
}
