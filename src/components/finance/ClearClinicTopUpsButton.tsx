"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Trash2,
  Loader2,
  X,
  Building2,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { notifyClinicSync } from "@/lib/sync/clinic-events";
import { createClient } from "@/lib/supabase/client";
import {
  clearAllPendingClinicTopUps,
  resetClinicProfitClientCache,
} from "@/lib/services/clinic-profit-pending";
import {
  clearClinicProfitBroadcast,
  publishClinicProfitReset,
} from "@/lib/services/clinic-profit-broadcast";
import { defaultClinicProfitPeriod } from "@/lib/services/clinic-profit-loader";
import type {
  BalanceTopUpListItem,
  BalanceTopUpTarget,
} from "@/lib/services/balance-topup";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

interface ClearClinicTopUpsButtonProps {
  portal?: AuthPortalId;
  size?: "sm" | "md";
  variant?: "outline" | "danger" | "ghost";
  onCleared?: () => void;
}

type DoctorOption = { id: string; name: string };

function topupOptionLabel(item: BalanceTopUpListItem): string {
  return `${formatCurrency(item.amount)} — ${formatDate(item.transactionDate)} — ${item.label}`;
}

export function ClearClinicTopUpsButton({
  portal = "admin",
  size = "sm",
  variant = "outline",
  onCleared,
}: ClearClinicTopUpsButtonProps) {
  const { clinicId } = useActiveClinicId();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"choose" | "pick">("choose");
  const [target, setTarget] = useState<BalanceTopUpTarget | null>(null);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [items, setItems] = useState<BalanceTopUpListItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("choose");
    setTarget(null);
    setDoctorId("");
    setItems([]);
    setSelectedId("");
    setError(null);
    setMessage(null);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
  }, [open, reset]);

  useEffect(() => {
    if (!open || !clinicId) return;

    async function loadDoctors() {
      setLoadingDoctors(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("doctors")
        .select("id, full_name_ar")
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .order("full_name_ar");

      setDoctors(
        (data ?? []).map((d) => ({
          id: d.id as string,
          name: (d.full_name_ar as string) || "طبيب",
        }))
      );
      setLoadingDoctors(false);
    }

    void loadDoctors();
  }, [open, clinicId]);

  const loadTopUpList = useCallback(
    async (nextTarget: BalanceTopUpTarget, nextDoctorId?: string) => {
      if (!clinicId) return;
      setLoadingItems(true);
      setError(null);
      setItems([]);
      setSelectedId("");

      try {
        const params = new URLSearchParams({ target: nextTarget });
        if (nextTarget === "doctor" && nextDoctorId) {
          params.set("doctor_id", nextDoctorId);
        }

        const res = await fetch(`/api/admin/balance-topups?${params.toString()}`, {
          credentials: "include",
          headers: {
            ...authPortalHeaders(portal),
            "X-Clinic-Id": clinicId,
          },
          cache: "no-store",
        });

        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          items?: BalanceTopUpListItem[];
        };

        if (!res.ok) {
          setError(json.error ?? "تعذر تحميل الشحنات");
          return;
        }

        setItems(json.items ?? []);
        if ((json.items ?? []).length === 0) {
          setError("لا توجد شحنات مسجّلة لهذا الاختيار");
        }
      } catch {
        setError("تعذر الاتصال بالسيرفر");
      } finally {
        setLoadingItems(false);
      }
    },
    [clinicId, portal]
  );

  function handleChoose(next: BalanceTopUpTarget) {
    setTarget(next);
    setStep("pick");
    setError(null);
    if (next === "clinic") {
      void loadTopUpList("clinic");
    }
  }

  useEffect(() => {
    if (!open || target !== "doctor" || !doctorId) return;
    void loadTopUpList("doctor", doctorId);
  }, [open, target, doctorId, loadTopUpList]);

  async function handleDelete() {
    if (!clinicId || !selectedId) {
      setError("اختر الشحنة من القائمة");
      return;
    }

    const selected = items.find((i) => i.id === selectedId);
    if (!selected) return;

    const ok = window.confirm(
      `حذف هذه الشحنة؟\n${topupOptionLabel(selected)}\n\nلا يمكن التراجع.${
        selected.target === "clinic"
          ? "\nسيُخصم المبلغ من صافي ربح العيادة."
          : "\nسيُخصم من رصيد الطبيب."
      }`
    );
    if (!ok) return;

    setDeleting(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/balance-topups", {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders(portal),
          "X-Clinic-Id": clinicId,
        },
        body: JSON.stringify({ transaction_id: selectedId }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        target?: BalanceTopUpTarget;
        netProfit?: number;
        balanceTopupsTotal?: number;
        period?: { from: string; to: string };
      };

      if (!res.ok) {
        setError(json.error ?? "تعذر الحذف");
        return;
      }

      if (json.target === "clinic") {
        resetClinicProfitClientCache(clinicId);
        clearAllPendingClinicTopUps();
        clearClinicProfitBroadcast();

        const period = json.period ?? defaultClinicProfitPeriod();
        if (typeof json.netProfit === "number") {
          publishClinicProfitReset({
            clinicId,
            periodFrom: period.from,
            periodTo: period.to,
            netProfit: json.netProfit,
            balanceTopupsTotal: json.balanceTopupsTotal ?? 0,
          });
        }
      }

      notifyClinicSync({
        topic: ["profit", "financial", "audit", "sessions"],
        clinicId,
        source: "mutation",
        force: true,
      });

      setMessage(json.message ?? "تم حذف الشحنة");
      onCleared?.();
      setOpen(false);
    } catch {
      setError("تعذر الاتصال بالسيرفر");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="space-y-2">
        <Button
          type="button"
          size={size}
          variant={
            variant === "ghost"
              ? "ghost"
              : variant === "danger"
                ? "danger"
                : "outline"
          }
          disabled={!clinicId}
          onClick={() => setOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          حذف شحن رصيد
        </Button>
        {message && !open && (
          <p className="text-xs text-emerald-700">{message}</p>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-topup-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleting) setOpen(false);
          }}
        >
          <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-surface-card shadow-elevated sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-border px-4 py-3">
              <h2
                id="delete-topup-title"
                className="text-base font-bold text-slate-text"
              >
                حذف شحن رصيد
              </h2>
              <button
                type="button"
                onClick={() => !deleting && setOpen(false)}
                className="rounded-lg p-1.5 text-slate-muted hover:bg-surface"
                aria-label="إغلاق"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {step === "choose" && (
                <>
                  <p className="text-sm text-slate-muted">
                    اختر نوع الرصيد — ثم اختر الشحنة بالتاريخ (لا يُحذف الكل دفعة
                    واحدة).
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => handleChoose("clinic")}
                      className="flex flex-col items-center gap-2 rounded-xl border border-slate-border bg-surface p-4 transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      <Building2 className="h-8 w-8 text-primary" />
                      <span className="font-semibold text-slate-text">
                        رصيد العيادة
                      </span>
                      <span className="text-xs text-slate-muted text-center">
                        يُخصم من صافي الربح
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChoose("doctor")}
                      className="flex flex-col items-center gap-2 rounded-xl border border-slate-border bg-surface p-4 transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      <Stethoscope className="h-8 w-8 text-primary" />
                      <span className="font-semibold text-slate-text">
                        رصيد طبيب
                      </span>
                      <span className="text-xs text-slate-muted text-center">
                        يُخصم من محفظة الطبيب
                      </span>
                    </button>
                  </div>
                </>
              )}

              {step === "pick" && target && (
                <>
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => {
                      setStep("choose");
                      setTarget(null);
                      setDoctorId("");
                      setItems([]);
                      setSelectedId("");
                      setError(null);
                    }}
                  >
                    ← رجوع لاختيار النوع
                  </button>

                  {target === "doctor" && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-text">
                        الطبيب
                      </label>
                      <select
                        className="w-full rounded-xl border border-slate-border bg-surface-card px-3 py-2.5 text-sm"
                        value={doctorId}
                        onChange={(e) => setDoctorId(e.target.value)}
                        disabled={loadingDoctors || deleting}
                      >
                        <option value="">— اختر الطبيب —</option>
                        {doctors.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(target === "clinic" ||
                    (target === "doctor" && doctorId)) && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-text">
                        الشحنة المراد حذفها
                      </label>
                      {loadingItems ? (
                        <div className="flex items-center gap-2 py-6 text-slate-muted">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span className="text-sm">جاري تحميل الشحنات...</span>
                        </div>
                      ) : (
                        <select
                          className={cn(
                            "w-full rounded-xl border border-slate-border bg-surface-card px-3 py-2.5 text-sm",
                            items.length === 0 && "opacity-60"
                          )}
                          value={selectedId}
                          onChange={(e) => setSelectedId(e.target.value)}
                          disabled={items.length === 0 || deleting}
                        >
                          <option value="">— اختر من القائمة —</option>
                          {items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {topupOptionLabel(item)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  {error && <Alert variant="error">{error}</Alert>}
                </>
              )}
            </div>

            {step === "pick" && (
              <div className="shrink-0 border-t border-slate-border p-4 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={deleting}
                  onClick={() => !deleting && setOpen(false)}
                >
                  إلغاء
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="flex-1"
                  disabled={
                    deleting ||
                    !selectedId ||
                    loadingItems ||
                    (target === "doctor" && !doctorId)
                  }
                  onClick={() => void handleDelete()}
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      حذف
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
