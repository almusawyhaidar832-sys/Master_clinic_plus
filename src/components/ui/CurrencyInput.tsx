"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import {
  parseFormattedNumber,
  formatNumberInput,
  toAsciiDigits,
} from "@/lib/utils";

export interface CurrencyInputProps {
  label?: string;
  value: string;
  onChange: (rawValue: string) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
  min?: number;
  readOnly?: boolean;
  disabled?: boolean;
  /** حجم أكبر لواجهة المحاسب */
  size?: "default" | "large";
  /** تمييز لوني للحقل */
  tone?: "default" | "total" | "paid";
  hint?: string;
}

/**
 * Amount input that displays commas while typing: 500000 → 500,000
 * onChange receives the raw numeric string without commas.
 */
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput(
    {
      label,
      value,
      onChange,
      required,
      placeholder,
      className,
      min = 0,
      readOnly,
      disabled,
      size = "default",
      tone = "default",
      hint,
    },
    ref
  ) {
    const displayValue = value ? formatNumberInput(value) : "";
    const locked = readOnly || disabled;
    const isLarge = size === "large";

    const toneClasses = {
      default: "border-slate-200 bg-white focus:border-primary",
      total: "border-primary/50 bg-primary/[0.04] focus:border-primary",
      paid: "border-emerald-500/50 bg-emerald-50/80 focus:border-emerald-600",
    }[tone];

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            className={cn(
              "block font-bold text-slate-800",
              isLarge ? "text-sm" : "text-sm font-medium text-slate-text"
            )}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          dir="ltr"
          data-numeric="true"
          required={required && !locked}
          readOnly={readOnly}
          disabled={disabled}
          placeholder={placeholder}
          value={displayValue}
          onPaste={(e) => {
            if (locked) return;
            e.preventDefault();
            const text = e.clipboardData.getData("text");
            const raw = parseFormattedNumber(text);
            if (raw === "" || !isNaN(Number(raw))) onChange(raw);
          }}
          onChange={(e) => {
            if (locked) return;
            const raw = parseFormattedNumber(toAsciiDigits(e.target.value));
            if (raw === "" || !isNaN(Number(raw))) {
              onChange(raw);
            }
          }}
          className={cn(
            "tabular-nums flex w-full rounded-lg border-2 text-left text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:ring-2",
            isLarge
              ? "h-11 px-3 text-lg font-bold focus:ring-primary/15"
              : "h-10 px-3 text-sm font-semibold focus:ring-primary/20",
            tone === "paid" && isLarge && "focus:ring-emerald-500/20",
            toneClasses,
            locked && "cursor-default bg-surface text-slate-muted",
            className
          )}
        />
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
        {min > 0 && value && Number(value) < min && (
          <p className="text-xs text-debt-text">الحد الأدنى {min}</p>
        )}
      </div>
    );
  }
);
