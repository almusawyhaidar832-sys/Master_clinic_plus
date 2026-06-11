import { cn } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id || props.name;
    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="mc-label">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "flex h-10 w-full rounded-lg border border-slate-border bg-surface-card px-3 py-2 text-sm text-slate-text placeholder:text-slate-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
            error && "border-debt-text focus:border-debt-text focus:ring-debt-text/20",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-debt-text">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";
export { Input };
