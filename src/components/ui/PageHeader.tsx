import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Small champagne label above the title (section / portal name). */
  eyebrow?: string;
  icon?: LucideIcon;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  icon: Icon,
  backHref,
  backLabel = "رجوع",
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mc-page-hero", className)}>
      <div className="flex min-w-0 items-center gap-4">
        {Icon && (
          <span className="mc-page-hero__icon" aria-hidden>
            <Icon className="h-6 w-6" strokeWidth={1.75} />
          </span>
        )}
        <div className="min-w-0">
          {backHref && (
            <Link
              href={backHref}
              className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-800"
            >
              <ChevronRight className="h-3.5 w-3.5 rtl:rotate-0 ltr:rotate-180" />
              {backLabel}
            </Link>
          )}
          {eyebrow && <p className="mc-page-hero__eyebrow">{eyebrow}</p>}
          <h1 className="mc-page-hero__title no-accent truncate">{title}</h1>
          {subtitle && <div className="mc-page-hero__subtitle">{subtitle}</div>}
        </div>
      </div>
      {actions && (
        <div className="relative flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
