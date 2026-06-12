"use client";

import { DEVELOPER } from "@/lib/constants";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { DeveloperLogoMark } from "@/components/layout/DeveloperLogoMark";

interface DeveloperCreditProps {
  variant?: "login" | "sidebar";
  className?: string;
}

export function DeveloperCredit({
  variant = "login",
  className,
}: DeveloperCreditProps) {
  const { t, bi } = useLanguage();
  const compact = variant === "sidebar";

  return (
    <div
      className={cn(
        "group relative overflow-hidden",
        compact
          ? "rounded-xl border border-slate-border/60 bg-gradient-to-br from-white to-teal-50/40 px-3 py-3 text-center dark:from-slate-900 dark:to-teal-950/20"
          : "rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-teal-50/40 to-cyan-50/50 px-5 py-4 shadow-[0_8px_30px_rgba(0,86,179,0.08)] backdrop-blur-sm",
        className
      )}
    >
      {!compact && (
        <>
          <div className="pointer-events-none absolute -left-8 top-0 h-24 w-24 rounded-full bg-cyan-400/10 blur-2xl transition-opacity group-hover:opacity-100" />
          <div className="pointer-events-none absolute -right-6 bottom-0 h-20 w-20 rounded-full bg-primary/10 blur-xl" />
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" />
        </>
      )}

      <div
        className={cn(
          "relative flex items-center gap-3",
          compact ? "flex-col gap-2.5" : "justify-center"
        )}
      >
        <div className="relative shrink-0">
          {/* Glow halo */}
          <div
            className={cn(
              "absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/30 via-teal-400/25 to-cyan-400/20 blur-lg transition-all duration-500 group-hover:blur-xl group-hover:opacity-100",
              compact ? "scale-110 opacity-70" : "scale-125 opacity-80"
            )}
          />
          {/* Logo pedestal */}
          <div
            className={cn(
              "relative flex items-center justify-center rounded-2xl bg-white/90 p-0.5 shadow-lg ring-1 ring-white/90 dark:bg-slate-900/90",
              compact ? "h-11 w-11" : "h-14 w-14"
            )}
          >
            <DeveloperLogoMark
              size={compact ? 40 : 52}
              animated={!compact}
            />
          </div>
        </div>

        <div className={cn("min-w-0", compact ? "w-full" : "text-right")}>
          <p
            className={cn(
              "font-semibold uppercase tracking-[0.18em] text-primary/75",
              compact ? "text-[8px]" : "text-[9px]"
            )}
          >
            {t("developedBy")}
          </p>
          <p
            className={cn(
              "bg-gradient-to-l from-slate-900 to-slate-700 bg-clip-text font-bold tracking-tight text-transparent dark:from-white dark:to-slate-200",
              compact ? "text-xs" : "text-sm"
            )}
          >
            {bi(DEVELOPER.nameAr, DEVELOPER.nameEn)}
          </p>
          <p
            className={cn(
              "text-slate-500 dark:text-slate-400",
              compact ? "text-[9px] leading-snug" : "text-[10px]"
            )}
          >
            {bi(DEVELOPER.roleAr, DEVELOPER.role)}
            <span className="mx-1.5 opacity-35">·</span>
            <span dir="ltr">© {DEVELOPER.year}</span>
          </p>
        </div>
      </div>

      {!compact && (
        <div className="relative mt-3 flex items-center justify-center gap-2">
          <div className="h-px w-10 bg-gradient-to-r from-transparent to-primary/25" />
          <div className="h-1 w-1 rounded-full bg-primary/40" />
          <div className="h-px w-10 bg-gradient-to-l from-transparent to-cyan-500/25" />
        </div>
      )}
    </div>
  );
}
