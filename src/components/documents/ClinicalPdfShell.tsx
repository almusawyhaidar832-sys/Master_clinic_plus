"use client";

import type { ReactNode } from "react";
import type { ClinicProfile } from "@/types/clinic-profile";
import { getClinicDisplayName } from "@/lib/services/clinic-profile";
import { cn } from "@/lib/utils";

export type ClinicalPdfVariant = "invoice" | "prescription";

const VARIANT_STYLE: Record<
  ClinicalPdfVariant,
  { gradient: string; accent: string; accentRgb: string; badgeLabel: string }
> = {
  invoice: {
    gradient: "linear-gradient(135deg, #003875 0%, #0056b3 42%, #2563eb 100%)",
    accent: "#0056b3",
    accentRgb: "0, 86, 179",
    badgeLabel: "إيصال دفع",
  },
  prescription: {
    gradient: "linear-gradient(135deg, #065f46 0%, #059669 42%, #14b8a6 100%)",
    accent: "#059669",
    accentRgb: "5, 150, 105",
    badgeLabel: "وصفة طبية",
  },
};

interface ClinicalPdfShellProps {
  id: string;
  variant: ClinicalPdfVariant;
  clinic: ClinicProfile | null | undefined;
  headline: string;
  subline?: string;
  metaLine?: string;
  badgeExtra?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function ClinicalPdfShell({
  id,
  variant,
  clinic,
  headline,
  subline,
  metaLine,
  badgeExtra,
  children,
  footer,
  className,
}: ClinicalPdfShellProps) {
  const style = VARIANT_STYLE[variant];
  const clinicName = getClinicDisplayName(clinic);

  return (
    <div
      id={id}
      dir="rtl"
      lang="ar"
      className={cn("mc-pdf-doc mx-auto overflow-hidden bg-white", className)}
      style={{
        width: "720px",
        maxWidth: "100%",
        fontFamily: "var(--font-noto-arabic), 'Noto Sans Arabic', Tahoma, sans-serif",
        color: "#0f172a",
        boxShadow: "0 24px 48px rgba(15, 23, 42, 0.12)",
        borderRadius: "16px",
        border: "1px solid #e2e8f0",
      }}
    >
      <div
        style={{
          background: style.gradient,
          padding: "28px 32px 24px",
          color: "#ffffff",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <span
              className="inline-block rounded-full px-3 py-1 text-xs font-black"
              style={{
                backgroundColor: "rgba(255,255,255,0.28)",
                border: "1px solid rgba(255,255,255,0.4)",
              }}
            >
              {style.badgeLabel}
            </span>
            <h1
              className="mt-3 font-black leading-tight"
              style={{ fontSize: "26px" }}
            >
              {clinicName}
            </h1>
            {clinic?.address && (
              <p className="mt-1.5 text-sm leading-relaxed opacity-90">{clinic.address}</p>
            )}
            {clinic?.phone && (
              <p className="mt-0.5 text-sm font-semibold opacity-95" dir="ltr">
                {clinic.phone}
              </p>
            )}
          </div>

          {clinic?.logo_url ? (
            <div
              className="shrink-0 rounded-2xl bg-white p-2"
              style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={clinic.logo_url}
                alt=""
                crossOrigin="anonymous"
                className="h-16 w-16 object-contain"
              />
            </div>
          ) : (
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-2xl font-black"
              style={{
                backgroundColor: "rgba(255,255,255,0.18)",
                border: "2px solid rgba(255,255,255,0.3)",
              }}
            >
              {variant === "prescription" ? "Rx" : "₯"}
            </div>
          )}
        </div>

        <div
          className="mt-5 rounded-xl px-4 py-3"
          style={{
            backgroundColor: "rgba(255,255,255,0.12)",
            border: "1px solid rgba(255,255,255,0.22)",
          }}
        >
          <p className="text-lg font-bold">{headline}</p>
          {subline && (
            <p className="mt-1 text-sm font-semibold opacity-95">{subline}</p>
          )}
          {metaLine && <p className="mt-1 text-xs opacity-85">{metaLine}</p>}
        </div>

        {badgeExtra && (
          <div className="mt-3 flex justify-end">
            <span
              className="rounded-lg px-3 py-1.5 font-mono text-sm font-bold"
              style={{
                backgroundColor: "#fef3c7",
                color: "#92400e",
                boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
              }}
              dir="ltr"
            >
              {badgeExtra}
            </span>
          </div>
        )}
      </div>

      <div className="px-8 py-7" style={{ backgroundColor: "#fafbfc" }}>
        {children}
      </div>

      {footer !== undefined ? (
        footer
      ) : (
        <div
          className="px-8 py-5 text-center"
          style={{
            borderTop: "2px solid #e2e8f0",
            backgroundColor: "#ffffff",
          }}
        >
          <p className="text-sm font-semibold" style={{ color: style.accent }}>
            شكراً لثقتكم — نتمنى لكم دوام الصحة والعافية
          </p>
          <p className="mt-1 text-xs" style={{ color: "#64748b" }}>
            مستند إلكتروني صادر من {clinicName}
          </p>
        </div>
      )}
    </div>
  );
}

interface PdfInfoCardProps {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  accentColor?: string;
  dir?: "ltr" | "rtl";
  hintDir?: "ltr" | "rtl";
}

export function PdfInfoCard({
  label,
  value,
  hint,
  accent,
  accentColor = "#0056b3",
  dir = "rtl",
  hintDir,
}: PdfInfoCardProps) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        backgroundColor: "#ffffff",
        border: accent ? `2px solid ${accentColor}` : "1px solid #e2e8f0",
        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.04)",
      }}
    >
      <p
        className="text-xs font-bold"
        style={{ color: accent ? accentColor : "#64748b" }}
      >
        {label}
      </p>
      <p
        className="mt-1 font-black leading-snug"
        style={{
          fontSize: "17px",
          color: accent ? accentColor : "#0f172a",
        }}
        dir={dir}
      >
        {value}
      </p>
      {hint && (
        <p
          className="mt-0.5 text-xs font-semibold"
          style={{ color: "#64748b" }}
          dir={hintDir ?? dir}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

interface PdfSectionTitleProps {
  children: ReactNode;
  color?: string;
}

export function PdfSectionTitle({ children, color = "#0056b3" }: PdfSectionTitleProps) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span
        className="h-6 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <h3 className="text-base font-black" style={{ color: "#0f172a" }}>
        {children}
      </h3>
    </div>
  );
}

interface PdfTableProps {
  variant: ClinicalPdfVariant;
  headers: string[];
  children: ReactNode;
  colAlign?: ("right" | "left" | "center")[];
}

export function PdfTable({
  variant,
  headers,
  children,
  colAlign,
}: PdfTableProps) {
  const headerBg = variant === "prescription" ? "#059669" : "#0056b3";

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        border: "1px solid #e2e8f0",
        boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
      }}
    >
      <table className="w-full border-collapse" style={{ fontSize: "14px" }}>
        <thead>
          <tr style={{ backgroundColor: headerBg, color: "#ffffff" }}>
            {headers.map((h, i) => (
              <th
                key={h}
                className="px-3 py-3 text-right font-bold"
                style={{
                  fontSize: "13px",
                  textAlign: colAlign?.[i] ?? "right",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody style={{ backgroundColor: "#ffffff" }}>{children}</tbody>
      </table>
    </div>
  );
}
