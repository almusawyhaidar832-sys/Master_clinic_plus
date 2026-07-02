import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Info, LucideIcon, XCircle } from "lucide-react";
import { HTMLAttributes } from "react";

type AlertVariant = "info" | "success" | "warning" | "error";

const variants: Record<AlertVariant, string> = {
  info: "bg-primary-50 border-primary-200 text-primary-800",
  success: "bg-success border-success-border text-success-text",
  warning: "bg-warning border-warning-border text-warning-text",
  error: "bg-debt border-debt-border text-debt-text",
};

const icons: Record<AlertVariant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

export function Alert({
  variant = "info",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: AlertVariant }) {
  const Icon = icons[variant];
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-sm",
        variants[variant],
        className
      )}
      {...props}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
