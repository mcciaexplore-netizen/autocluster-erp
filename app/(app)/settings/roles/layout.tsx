import { AreaGate } from "@/components/auth/area-gate";

/** Users and Roles: only people who may manage users. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm="users.manage" area="Users and roles">
      {children}
    </AreaGate>
  );
}
