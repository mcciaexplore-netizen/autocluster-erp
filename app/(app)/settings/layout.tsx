import { AreaGate } from "@/components/auth/area-gate";
import { SettingsTabs } from "@/components/users/settings-tabs";

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
