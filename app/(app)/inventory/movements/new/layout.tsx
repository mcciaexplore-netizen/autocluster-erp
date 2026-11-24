import { AreaGate } from "@/components/auth/area-gate";

/** Only people who may record stock get this form. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={["inventory.receive", "inventory.use", "inventory.use_own_jobs", "inventory.adjust"]} area="recording stock">
      {children}
    </AreaGate>
  );
}
