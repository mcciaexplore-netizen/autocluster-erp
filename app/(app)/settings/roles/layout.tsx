import { AreaGate } from "@/components/auth/area-gate";

/** Checks who is signed in and what they may see (forbidden() otherwise), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

/** Users and Roles: only people who may manage users. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm="users.manage" area="Users and roles">
      {children}
    </AreaGate>
  );
}
