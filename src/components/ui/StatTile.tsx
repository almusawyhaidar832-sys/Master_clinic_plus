import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type StatTone = "navy" | "gold" | "royal" | "success" | "warning" | "danger" | "muted";

const TONES: Record<StatTone, string> = {
  navy: "mc-tone-navy",
  gold: "mc-tone-gold",
  royal: "mc-tone-royal",
  success: "mc-tone-success",
  warning: "mc-tone-warning",
  danger: "mc-tone-danger",
  muted: "mc-tone-muted",
};

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  icon: LucideIcon;
  tone?: StatTone;
  hint?: ReactNode;
  className?: string;
}

export function StatTile({ label, value, icon: Icon, tone = "navy", hint, className }: StatTileProps) {
  return (
    <div className={cn("mc-kpi", className)}>
      <span className={cn("mc-kpi__icon", TONES[tone])} aria-hidden>
        <Icon className="h-5 w-5" strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <p className="mc-kpi__value">{value}</p>
        <p className="mc-kpi__label truncate">{label}</p>
        {hint && <p className="mt-0.5 truncate text-[11px] text-slate-muted">{hint}</p>}
      </div>
    </div>
  );
}
