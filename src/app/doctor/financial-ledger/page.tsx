"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { authPortalHeaders } from "@/lib/auth/api-portal";
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
} from "lucide-react";

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
  const { t } = useLanguage();

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

    const repairKey = `mc:doctor-shares-auto-repair:v8:${doctor.id}`;
    const needSync =
      typeof window !== "undefined" && !sessionStorage.getItem(repairKey);
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
        if (needSync && typeof window !== "undefined") {
          sessionStorage.setItem(repairKey, "1");
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
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-text">
          <span className="mc-icon-badge-primary">
            <ScrollText className="h-4.5 w-4.5" />
          </span>
          {t("docFinancialLedgerTitle")}
        </h1>
        <p className="mt-1 text-sm text-slate-muted">{t("docFinancialLedgerSubtitleFull")}</p>
      </div>

      {balance !== null && (
        <div className="relative overflow-hidden rounded-2xl bg-mc-navy p-4 text-white shadow-premium">
          <div className="pointer-events-none absolute -end-8 -top-10 h-32 w-32 rounded-full bg-white/5 blur-2xl" />
          <p className="relative text-xs text-white/70">
            {salaryDoctor ? t("docRemainingSalary") : t("docWithdrawableBalanceLabel")}
          </p>
          <DoctorPrivateBalance
            amount={balance}
            className="relative mt-1 text-xl font-extrabold tracking-tight"
            isDebtor={balance < 0}
            showDebtLabel
          />
        </div>
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
