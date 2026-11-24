import { AreaGate } from "@/components/auth/area-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"insights.planning"} area="Planning Insights">
      {children}
    </AreaGate>
  );
}
