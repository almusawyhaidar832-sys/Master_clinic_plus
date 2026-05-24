"use client";

import type { ClinicProfile } from "@/types/clinic-profile";
import { getClinicDisplayName } from "@/lib/services/clinic-profile";
import { cn } from "@/lib/utils";

interface ClinicBrandingHeaderProps {
  profile: ClinicProfile | null | undefined;
  title?: string;
  subtitle?: string;
  meta?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  showPlatformFallback?: boolean;
}

export function ClinicBrandingHeader({
  profile,
  title,
  subtitle,
  meta,
  size = "md",
  className,
}: ClinicBrandingHeaderProps) {
  const displayName = getClinicDisplayName(profile);

  const logoSizes = {
    sm: "h-10 w-10",
    md: "h-14 w-14",
    lg: "h-20 w-20",
  };

  const titleSizes = {
    sm: "text-base",
    md: "text-lg sm:text-xl",
    lg: "text-xl sm:text-2xl",
  };

  return (
    <header
      className={cn(
        "border-b border-slate-border pb-4 text-center",
        className
      )}
    >
      {profile?.logo_url && (
        <div className="mb-3 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={profile.logo_url}
            alt={`شعار ${displayName}`}
            className={cn(
              "rounded-xl border border-slate-border bg-white object-contain p-1",
              logoSizes[size]
            )}
          />
        </div>
      )}
      <h1
        className={cn("font-bold text-primary", titleSizes[size])}
      >
        {displayName}
      </h1>
      {profile?.address && (
        <p className="mt-1 text-xs text-slate-muted sm:text-sm">
          {profile.address}
        </p>
      )}
      {profile?.phone && (
        <p className="text-xs text-slate-muted" dir="ltr">
          {profile.phone}
        </p>
      )}
      {title && (
        <h2 className="mt-2 text-sm font-semibold text-slate-text sm:text-base">
          {title}
        </h2>
      )}
      {subtitle && (
        <p className="mt-0.5 text-xs text-slate-muted">{subtitle}</p>
      )}
      {meta && (
        <p className="mt-2 text-xs text-slate-muted">{meta}</p>
      )}
    </header>
  );
}
