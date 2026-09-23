import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "premium";
  size?: "sm" | "md" | "lg";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 ease-mc-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card disabled:pointer-events-none disabled:opacity-50 mc-press",
          {
            "bg-mc-navy text-white shadow-soft ring-1 ring-inset ring-white/10 hover:-translate-y-px hover:shadow-elevated hover:brightness-110": variant === "primary",
            "bg-slate-text text-surface-card hover:opacity-90": variant === "secondary",
            "border border-slate-border bg-surface-card text-slate-text shadow-card hover:border-premium-300 hover:bg-premium-50/40":
              variant === "outline",
            "text-slate-text hover:bg-surface": variant === "ghost",
            "bg-debt-text text-white shadow-sm hover:brightness-110": variant === "danger",
            "bg-mc-pearl text-[#0b1f3a] shadow-gold ring-1 ring-inset ring-premium-300/60 hover:brightness-[1.03]": variant === "premium",
            "h-8 px-3 text-sm": size === "sm",
            "h-10 px-4 text-sm": size === "md",
            "h-12 px-6 text-base": size === "lg",
          },
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
export { Button };
