"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  doctorSharesRepairKey,
  markSharesRepairDone,
  needsSharesRepair,
} from "@/lib/finance/doctor-shares-repair-session";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/i18n/translations";
import { DoctorDailyCollectionsPanel } from "@/components/doctor/DoctorDailyCollectionsPanel";
import { DoctorLedgerInvoicesTab } from "@/components/doctor/DoctorLedgerInvoicesTab";
import { DoctorLedgerPatientsTab } from "@/components/doctor/DoctorLedgerPatientsTab";
import { DoctorLedgerOperationsTab } from "@/components/doctor/DoctorLedgerOperationsTab";
import { DoctorFinancialReportPanel } from "@/components/doctor/DoctorFinancialReportPanel";
import { DoctorPrivateBalance } from "@/components/doctor/DoctorPrivateBalance";
import { cn } from "@/lib/utils";
import {
  FileText,
  Users,
  ArrowDownToLine,
  ScrollText,
  Calendar,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

const VALID_TABS = ["statement", "invoices", "patients", "operations"] as const;
type LedgerTab = (typeof VALID_TABS)[number];

function parseTab(value: string | null): LedgerTab {
  if (value && (VALID_TABS as readonly string[]).includes(value)) {
    return value as LedgerTab;
  }
  return "statement";
}

const TAB_ITEMS: {
  id: LedgerTab;
  labelKey: TranslationKey;
  icon: typeof FileText;
}[] = [
  { id: "statement", labelKey: "docTabDailyStatement", icon: Calendar },
  { id: "invoices", labelKey: "docTabInvoices", icon: FileText },
  { id: "patients", labelKey: "docTabLedgerPatients", icon: Users },
  { id: "operations", labelKey: "docTabFinancialOps", icon: ArrowDownToLine },
];

export default function DoctorFinancialLedgerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, bi } = useLanguage();

  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [salaryDoctor, setSalaryDoctor] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<LedgerTab>(() =>
    parseTab(searchParams.get("tab"))
  );
  const [refreshKey, setRefreshKey] = useState(0);

  const selectTab = useCallback(
    (tab: LedgerTab) => {
      setActiveTab(tab);
      router.replace(`/doctor/financial-ledger?tab=${tab}`, { scroll: false });
    },
    [router]
  );

  useEffect(() => {
    setActiveTab(parseTab(searchParams.get("tab")));
  }, [searchParams]);

  const loadSummary = useCallback(async () => {
    const supabase = createClient();
    const doctor = await getDoctorForCurrentUser(supabase);
    if (!doctor) {
      setDoctorId(null);
      return;
    }

    setDoctorId(doctor.id);
    setSalaryDoctor(isSalaryDoctor(doctor));

    const repairKey = doctorSharesRepairKey(doctor.id);
    const needSync = needsSharesRepair(repairKey);
    const walletUrl = needSync
      ? "/api/doctor/wallet-stats?sync_shares=1"
      : "/api/doctor/wallet-stats";

    try {
      const res = await fetch(walletUrl, {
        credentials: "include",
        headers: authPortalHeaders("doctor"),
      });
      if (res.ok) {
        const stats = (await res.json()) as { availableBalance: number };
        setBalance(stats.availableBalance);
        if (needSync) {
          markSharesRepairDone({
            doctorId: doctor.id,
            clinicId: (doctor as { clinic_id?: string }).clinic_id ?? null,
          });
        }
        return;
      }
    } catch {
      /* fallback */
    }

    setBalance(0);
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useClinicSync({
    topics: ["financial", "sessions", "refunds"],
    doctorId,
    onRefresh: () => {
      void loadSummary();
      setRefreshKey((k) => k + 1);
    },
    enabled: !!doctorId,
  });

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title={t("docFinancialLedgerTitle")}
        subtitle={t("docFinancialLedgerSubtitleFull")}
        eyebrow={bi("بوابة الطبيب", "Doctor portal")}
        icon={ScrollText}
        className="!mb-0"
      />

      {balance !== null && (
        <section className="mc-hero rounded-[24px] px-5 py-4">
          <div className="pointer-events-none absolute -end-10 -top-12 h-36 w-36 rounded-full border border-white/[0.08]" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.08] text-[#dcc29a] backdrop-blur">
              <Wallet className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/65">
                {salaryDoctor ? t("docRemainingSalary") : t("docWithdrawableBalanceLabel")}
              </p>
              <DoctorPrivateBalance
                amount={balance}
                className={cn(
                  "mt-1 text-2xl font-black leading-none tracking-tight",
                  balance < 0 ? "text-red-200" : "mc-text-champagne"
                )}
                isDebtor={balance < 0}
                showDebtLabel
                iconClassName="text-white/70 hover:text-white"
              />
            </div>
          </div>
        </section>
      )}

      <DoctorFinancialReportPanel />

      <div className="mc-tab-group">
        {TAB_ITEMS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => selectTab(id)}
            className={cn(
              "mc-tab",
              activeTab === id && "mc-tab--active"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {activeTab === "statement" && (
        <DoctorDailyCollectionsPanel refreshKey={refreshKey} />
      )}
      {activeTab === "invoices" && (
        <DoctorLedgerInvoicesTab refreshKey={refreshKey} />
      )}
      {activeTab === "patients" && (
        <DoctorLedgerPatientsTab refreshKey={refreshKey} />
      )}
      {activeTab === "operations" && (
        <DoctorLedgerOperationsTab refreshKey={refreshKey} />
      )}
    </div>
  );
}
