import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed bg-card px-6 py-14 text-center">
      <span className="mb-4 grid size-14 place-items-center rounded-2xl bg-secondary text-primary">
        <Icon className="size-7" aria-hidden />
      </span>
      <h2 className="text-xl font-semibold text-primary">{title}</h2>
      {description ? <p className="mt-1.5 max-w-md text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
