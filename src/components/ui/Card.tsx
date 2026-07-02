import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Use the deeper elevated shadow instead of the default flat shadow. */
  elevated?: boolean;
  /** Lift + shadow on hover — for clickable/interactive cards. */
  hoverable?: boolean;
  /** Gold top-accent treatment for VIP/owner-facing highlight cards. */
  premium?: boolean;
}

export function Card({
  className,
  children,
  elevated = false,
  hoverable = false,
  premium = false,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "p-6",
        premium
          ? "mc-card-premium"
          : cn(
              "rounded-xl border border-slate-border bg-surface-card",
              elevated ? "shadow-elevated" : "shadow-card"
            ),
        hoverable && "mc-hover-lift",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-4 flex flex-col gap-1", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "mc-section-title text-lg font-semibold text-slate-text",
        className
      )}
      {...props}
    >
      {children}
    </h3>
  );
}
