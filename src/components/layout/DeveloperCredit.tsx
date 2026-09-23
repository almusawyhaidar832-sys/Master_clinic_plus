"use client";

import { useCallback, useState } from "react";
import { Info } from "lucide-react";
import { DEVELOPER } from "@/lib/constants";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { DeveloperLogoMark } from "@/components/layout/DeveloperLogoMark";
import { AboutDialog } from "@/components/layout/AboutDialog";

interface DeveloperCreditProps {
  className?: string;
}

/** Sidebar credit card for Nexura Technologies — opens the About dialog. */
export function DeveloperCredit({ className }: DeveloperCreditProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-start transition-all hover:border-white/20 hover:bg-white/[0.08]",
          className
        )}
      >
        <DeveloperLogoMark size={34} animated={false} />
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] font-medium text-white/45">
            {t("developedBy")}
          </span>
          <span
            dir="ltr"
            className="block truncate bg-gradient-to-r from-violet-300 via-white to-cyan-300 bg-clip-text text-xs font-bold text-transparent"
          >
            {DEVELOPER.nameEn}
          </span>
          <span className="block text-[9px] text-white/35">
            <span dir="ltr">© {DEVELOPER.year}</span> · {t("allRightsReserved")}
          </span>
        </span>
        <span
          title={t("aboutSystem")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/40 transition-colors group-hover:bg-white/10 group-hover:text-white"
        >
          <Info className="h-4 w-4" />
        </span>
      </button>
      <AboutDialog open={open} onClose={close} />
    </>
  );
}
