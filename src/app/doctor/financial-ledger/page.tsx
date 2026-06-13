"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/i18n/translations";
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
} from "lucide-react";

const VALID_TABS = ["invoices", "patients", "operations"] as const;
type LedgerTab = (typeof VALID_TABS)[number];

function parseTab(value: string | null): LedgerTab {
  if (value && (VALID_TABS as readonly string[]).includes(value)) {
    return value as LedgerTab;
  }
  return "invoices";
}

const TAB_ITEMS: {
  id: LedgerTab;
  labelKey: TranslationKey;
  icon: typeof FileText;
}[] = [
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

    const stats = await fetchDoctorWalletStats(supabase, doctor.id);
    setBalance(stats.availableBalance);
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
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-text">
          <ScrollText className="h-5 w-5 text-primary" />
          {t("docFinancialLedgerTitle")}
        </h1>
        <p className="text-sm text-slate-muted">{t("docFinancialLedgerSubtitle")}</p>
      </div>

      {balance !== null && (
        <div className="rounded-xl bg-gradient-to-br from-primary to-primary-700 p-4 text-white">
          <p className="text-xs opacity-90">
            {salaryDoctor ? t("docRemainingSalary") : t("docWithdrawableBalanceLabel")}
          </p>
          <DoctorPrivateBalance
            amount={balance}
            className="mt-1 text-xl font-bold"
            isDebtor={balance < 0}
            showDebtLabel
          />
        </div>
      )}

      <DoctorFinancialReportPanel />

      <div className="flex gap-1 rounded-xl border border-slate-border bg-surface-card p-1">
        {TAB_ITEMS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => selectTab(id)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[10px] font-medium transition-colors sm:flex-row sm:gap-1.5 sm:px-2 sm:text-xs",
              activeTab === id
                ? "bg-white text-primary shadow-sm"
                : "text-slate-muted hover:text-slate-text"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {t(labelKey)}
          </button>
        ))}
      </div>

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
