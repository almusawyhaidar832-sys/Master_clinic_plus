"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { parseFormattedNumber, formatNumberInput } from "@/lib/utils";

export interface CurrencyInputProps {
  label?: string;
  value: string;
  onChange: (rawValue: string) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
  min?: number;
}

/**
 * Amount input that displays commas while typing: 500000 → 500,000
 * onChange receives the raw numeric string without commas.
 */
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput(
    { label, value, onChange, required, placeholder, className, min = 0 },
    ref
  ) {
    const displayValue = value ? formatNumberInput(value) : "";

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label className="block text-sm font-medium text-slate-text">
            {label}
          </label>
        )}
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          dir="ltr"
          required={required}
          placeholder={placeholder}
          value={displayValue}
          onChange={(e) => {
            const raw = parseFormattedNumber(e.target.value);
            if (raw === "" || !isNaN(Number(raw))) {
              onChange(raw);
            }
          }}
          className={cn(
            "flex h-10 w-full rounded-lg border border-slate-border bg-surface-card px-3 py-2 text-sm text-slate-text text-left placeholder:text-slate-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
            className
          )}
        />
        {min > 0 && value && Number(value) < min && (
          <p className="text-xs text-debt-text">الحد الأدنى {min}</p>
        )}
      </div>
    );
  }
);
