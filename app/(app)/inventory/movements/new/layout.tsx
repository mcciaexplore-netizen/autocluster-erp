import { AreaGate } from "@/components/auth/area-gate";

/** Checks who is signed in and what they may see (forbidden() otherwise), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

/** Only people who may record stock get this form. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={["inventory.receive", "inventory.use", "inventory.use_own_jobs", "inventory.adjust"]} area="recording stock">
      {children}
    </AreaGate>
  );
}
