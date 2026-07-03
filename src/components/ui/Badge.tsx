import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

export type BadgeVariant =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "error"
  | "premium";

const variants: Record<BadgeVariant, string> = {
  default: "border-slate-border bg-surface text-slate-muted",
  primary: "border-primary/20 bg-primary-50 text-primary-700",
  success: "border-success-border bg-success text-success-text",
  warning: "border-warning-border bg-warning text-warning-text",
  error: "border-debt-border bg-debt text-debt-text",
  premium: "border-premium-300/40 bg-premium-50 text-premium-700 shadow-gold",
};

export function Badge({
  variant = "default",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
