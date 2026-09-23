"use client";

import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { ShieldCheck, Stethoscope, UserRound } from "lucide-react";

export default function DoctorProfilePage() {
  const { t, bi } = useLanguage();

  return (
    <div className="mx-auto max-w-md space-y-5 animate-fade-in">
      <PageHeader
        title={t("docProfilePageTitle")}
        eyebrow={bi("بوابة الطبيب", "Doctor portal")}
        icon={UserRound}
        className="!mb-0"
      />

      <section className="mc-panel">
        <div className="mc-hero rounded-none px-5 pb-10 pt-6">
          <div className="pointer-events-none absolute -end-14 -top-16 h-44 w-44 rounded-full border border-white/[0.07]" />
          <div className="pointer-events-none absolute -end-2 -top-6 h-28 w-28 rounded-full border border-white/[0.09]" />
          <div className="relative flex items-center gap-4">
            <span className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-mc-pearl text-[#0b1f3a] shadow-[0_12px_26px_-10px_rgba(220,194,154,0.75)]">
              <Stethoscope className="h-7 w-7" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#dcc29a]">
                {bi("حساب الطبيب", "Doctor account")}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-white/70">
                <ShieldCheck className="h-4 w-4 text-[#dcc29a]" />
                {bi("الأمان وكلمة المرور", "Security & password")}
              </p>
            </div>
          </div>
        </div>
        <div className="relative -mt-5 rounded-t-[22px] bg-surface-card p-5">
          <ChangePasswordForm backHref="/doctor" backLabel={t("docBackHome")} />
        </div>
      </section>
    </div>
  );
}
