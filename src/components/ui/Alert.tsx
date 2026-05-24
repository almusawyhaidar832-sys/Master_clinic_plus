import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

type AlertVariant = "info" | "success" | "warning" | "error";

const variants: Record<AlertVariant, string> = {
  info: "bg-primary-50 border-primary-200 text-primary-800",
  success: "bg-green-50 border-green-200 text-green-800",
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  error: "bg-debt border-debt-border text-debt-text",
};

export function Alert({
  variant = "info",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: AlertVariant }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
