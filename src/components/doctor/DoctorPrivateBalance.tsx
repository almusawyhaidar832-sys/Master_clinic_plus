"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

const HIDDEN_BALANCE = "**********";

interface DoctorPrivateBalanceProps {
  amount: number | null;
  className?: string;
  loadingClassName?: string;
  isDebtor?: boolean;
  showDebtLabel?: boolean;
  iconClassName?: string;
}

export function DoctorPrivateBalance({
  amount,
  className,
  loadingClassName,
  isDebtor = false,
  showDebtLabel = false,
  iconClassName,
}: DoctorPrivateBalanceProps) {
  const { t, formatMoney, bi } = useLanguage();
  const [isBalanceVisible, setIsBalanceVisible] = useState(false);

  const toggleLabel = isBalanceVisible
    ? bi("إخفاء الرصيد", "Hide balance")
    : bi("إظهار الرصيد", "Show balance");

  return (
    <div className="flex items-center gap-2">
      <p className={cn("tabular-nums", className)}>
        {amount === null ? (
          <span className={loadingClassName}>…</span>
        ) : isBalanceVisible ? (
          <>
            {isDebtor ? "−" : ""}
            {formatMoney(Math.abs(amount))}
            {isDebtor && showDebtLabel && (
              <span className="mr-2 text-base font-bold">{t("debtLabel")}</span>
            )}
          </>
        ) : (
          HIDDEN_BALANCE
        )}
      </p>
      <button
        type="button"
        onClick={() => setIsBalanceVisible((visible) => !visible)}
        className={cn(
          "touch-target inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 opacity-90 transition hover:bg-white/15",
          iconClassName
        )}
        aria-label={toggleLabel}
        aria-pressed={isBalanceVisible}
      >
        {isBalanceVisible ? (
          <EyeOff className="h-5 w-5" aria-hidden />
        ) : (
          <Eye className="h-5 w-5" aria-hidden />
        )}
      </button>
    </div>
  );
}
