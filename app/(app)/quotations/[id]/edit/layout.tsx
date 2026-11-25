import { AreaGate } from "@/components/auth/area-gate";

/** Checks who is signed in and what they may see (forbidden() otherwise), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

/** Only people who may change quotations get this form. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={"quotes.edit"} area="changing quotations">
      {children}
    </AreaGate>
  );
}
