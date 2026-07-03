import { cn } from "@/lib/utils";
import { Inbox, LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  message: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-border bg-surface-card py-14 text-center",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface text-slate-muted">
        <Icon className="h-6 w-6 opacity-60" strokeWidth={1.5} />
      </div>
      {title && (
        <p className="text-sm font-semibold text-slate-text">{title}</p>
      )}
      <p className="max-w-xs text-sm text-slate-muted">{message}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
