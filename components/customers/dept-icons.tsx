import { Cog, FlaskConical, Printer, Ruler, Thermometer, type LucideIcon } from "lucide-react";

export const DEPT_ICONS: Record<string, LucideIcon> = {
  RPT: Printer,
  PPF: Cog,
  ENV: Thermometer,
  RPL: FlaskConical,
  MET: Ruler,
};

export function DeptIcon({ code, className }: { code: string; className?: string }) {
  const Icon = DEPT_ICONS[code] ?? Cog;
  return <Icon className={className} aria-hidden />;
}
