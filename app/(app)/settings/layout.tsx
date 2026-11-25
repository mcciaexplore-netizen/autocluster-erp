import { AreaGate } from "@/components/auth/area-gate";
import { SettingsTabs } from "@/components/users/settings-tabs";

/** Checks who is signed in and what they may see (forbidden() otherwise), so it blocks on the server: no instant-navigation validation. */
export const instant = false;

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AreaGate perm={["settings.edit", "users.manage"]} area="Settings">
      <div className="mx-auto max-w-5xl">
        <SettingsTabs />
        {children}
      </div>
    </AreaGate>
  );
}
