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
      default: "border-slate-border bg-surface-card focus:border-primary",
      total: "border-primary/50 bg-primary/[0.04] focus:border-primary",
      paid: "border-success-border bg-success/50 focus:border-success-text",
    }[tone];

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            className={cn(
              "mc-label",
              isLarge && "font-bold"
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
            "tabular-nums flex w-full rounded-lg border-2 text-left text-slate-text shadow-sm outline-none transition-colors placeholder:text-slate-muted focus:ring-2",
            isLarge
              ? "h-11 px-3 text-lg font-bold focus:ring-primary/15"
              : "h-10 px-3 text-sm font-semibold focus:ring-primary/20",
            tone === "paid" && isLarge && "focus:ring-success-text/20",
            toneClasses,
            locked && "cursor-default bg-surface text-slate-muted",
            className
          )}
        />
        {hint && <p className="text-xs text-slate-muted">{hint}</p>}
        {min > 0 && value && Number(value) < min && (
          <p className="text-xs text-debt-text">الحد الأدنى {min}</p>
        )}
      </div>
    );
  }
);
