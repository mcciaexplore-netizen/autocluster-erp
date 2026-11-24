import { AreaGate } from "@/components/auth/area-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={["settings.edit", "users.manage"]} area="Settings">
      {children}
    </AreaGate>
  );
}
