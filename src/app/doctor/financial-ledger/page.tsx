"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { useClinicSync } from "@/hooks/useClinicSync";
import { DoctorLedgerInvoicesTab } from "@/components/doctor/DoctorLedgerInvoicesTab";
import { DoctorLedgerPatientsTab } from "@/components/doctor/DoctorLedgerPatientsTab";
import { DoctorLedgerOperationsTab } from "@/components/doctor/DoctorLedgerOperationsTab";
import { DoctorFinancialReportPanel } from "@/components/doctor/DoctorFinancialReportPanel";
import { cn, formatCurrency } from "@/lib/utils";
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
  label: string;
  icon: typeof FileText;
}[] = [
  { id: "invoices", label: "الفواتير", icon: FileText },
  { id: "patients", label: "المراجعون", icon: Users },
  { id: "operations", label: "العمليات المالية", icon: ArrowDownToLine },
];

export default function DoctorFinancialLedgerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [salaryDoctor, setSalaryDoctor] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [earnings, setEarnings] = useState<number | null>(null);
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
    setEarnings(stats.totalEarnings);
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
          السجل المالي
        </h1>
        <p className="text-sm text-slate-muted">
          فواتير معتمدة · دفعات المراجعين · سحوباتك
        </p>
      </div>

      {balance !== null && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-gradient-to-br from-primary to-primary-700 p-4 text-white">
            <p className="text-xs opacity-90">
              {salaryDoctor ? "المتبقي من الراتب" : "الرصيد القابل للسحب"}
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {formatCurrency(Math.abs(balance))}
              {balance < 0 && (
                <span className="mr-1 text-xs">(مدين)</span>
              )}
            </p>
          </div>
          <div className="rounded-xl border border-slate-border bg-surface-card p-4">
            <p className="text-xs text-slate-muted">
              {salaryDoctor ? "الراتب المستحق" : "إجمالي الأرباح"}
            </p>
            <p className="mt-1 text-xl font-bold text-emerald-600 tabular-nums">
              {formatCurrency(earnings ?? 0)}
            </p>
          </div>
        </div>
      )}

      <DoctorFinancialReportPanel />

      <div className="flex gap-1 rounded-xl border border-slate-border bg-surface-card p-1">
        {TAB_ITEMS.map(({ id, label, icon: Icon }) => (
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
            {label}
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
