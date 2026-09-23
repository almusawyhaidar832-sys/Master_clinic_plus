"use client";

import { useCallback, useEffect, useState } from "react";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import type { AuditFeedItem } from "@/lib/audit/audit-feed";
import { formatCurrency, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  Undo2,
  Pencil,
  Trash2,
  Plus,
  Activity,
} from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";

const ACTION_OPTIONS = [
  { value: "", label: "كل العمليات" },
  { value: "refund", label: "المرتجعات فقط" },
  { value: "update", label: "التعديلات فقط" },
  { value: "delete", label: "الحذف فقط" },
  { value: "create", label: "الإنشاء فقط" },
];

const ACTION_TONES: Record<string, string> = {
  refund: "bg-warning text-warning-text ring-warning-border",
  update: "bg-primary-50 text-primary-700 ring-primary-200",
  delete: "bg-debt text-debt-text ring-debt-border",
  create: "bg-success text-success-text ring-success-border",
};

function actionTone(action: string): string {
  return ACTION_TONES[action] ?? "bg-surface text-slate-muted ring-slate-border";
}

function ActionIcon({ action }: { action: string }) {
  const cls = "h-4 w-4 shrink-0";
  switch (action) {
    case "refund":
      return <Undo2 className={cls} />;
    case "update":
      return <Pencil className={cls} />;
    case "delete":
      return <Trash2 className={cls} />;
    case "create":
      return <Plus className={cls} />;
    default:
      return <Activity className={cls} />;
  }
}

interface ActivityFeedProps {
  authPortal?: AuthPortalId;
  pollMs?: number;
  compact?: boolean;
  maxItems?: number;
}

export function ActivityFeed({
  authPortal = "accountant",
  pollMs = 25_000,
  compact = false,
  maxItems,
}: ActivityFeedProps) {
  const { clinicId } = useActiveClinicId();
  const [items, setItems] = useState<AuditFeedItem[]>([]);
  const [actors, setActors] = useState<{ id: string; full_name: string }[]>([]);
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "80", actors: "1" });
      if (actionFilter) params.set("action", actionFilter);
      if (actorFilter) params.set("changedBy", actorFilter);

      const res = await fetch(`/api/audit-logs?${params}`, {
        credentials: "include",
        headers: authPortalHeaders(authPortal),
        cache: "no-store",
      });
      const data = (await res.json()) as {
        items?: AuditFeedItem[];
        actors?: { id: string; full_name: string }[];
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "تعذر تحميل السجل");
        return;
      }

      setItems(data.items ?? []);
      if (data.actors) setActors(data.actors);
      setError(null);
    } catch {
      setError("تعذر الاتصال بالسيرفر");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, actorFilter, authPortal]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => void load(), pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  useClinicSync({
    topics: ["audit"],
    clinicId,
    onRefresh: load,
    enabled: !!clinicId,
  });

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="mc-panel flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[140px] flex-1">
            <Select
              label="نوع العملية"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              options={ACTION_OPTIONS}
            />
          </div>
          <div className="min-w-[140px] flex-1">
            <Select
              label="المستخدم"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              placeholder="الكل"
              options={[
                { value: "", label: "كل المستخدمين" },
                ...actors.map((a) => ({
                  value: a.id,
                  label: a.full_name,
                })),
              ]}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            تحديث
          </Button>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-debt-border bg-debt px-3.5 py-2.5 text-sm text-debt-text">
          {error}
        </p>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="mc-skeleton h-20 rounded-2xl"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-slate-muted ring-1 ring-inset ring-slate-border">
            <Activity className="h-6 w-6" strokeWidth={1.6} />
          </span>
          <p className="text-sm font-medium text-slate-muted">
            لا توجد عمليات مسجّلة بعد
          </p>
        </div>
      ) : (
        <ul className="relative space-y-3 before:absolute before:inset-y-3 before:start-[19px] before:w-px before:bg-slate-border">
          {(maxItems ? items.slice(0, maxItems) : items).map((item) => (
            <li
              key={item.id}
              className="relative flex items-start gap-3"
            >
              <span
                className={cn(
                  "relative z-[1] mt-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset shadow-card",
                  actionTone(item.action)
                )}
              >
                <ActionIcon action={item.action} />
              </span>
              <div
                className={cn(
                  "min-w-0 flex-1 rounded-2xl border border-slate-border bg-surface-card p-3.5 shadow-card transition-shadow hover:shadow-soft",
                  item.action === "refund" && "border-warning-border"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset", actionTone(item.action))}>
                      {item.actionLabel}
                    </span>
                    <span className="text-[11px] tabular-nums text-slate-muted">
                      {formatDate(item.changedAt)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-slate-text">
                    {item.summary}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-muted">
                    بواسطة:{" "}
                    <span className="font-semibold text-slate-text">
                      {item.actorName}
                    </span>
                  </p>
                  {item.changes.length > 0 && (
                    <ul className="mt-2 space-y-0.5 rounded-xl border border-slate-border bg-surface px-3 py-2 text-xs text-slate-muted">
                      {item.changes.map((line) => (
                        <li
                          key={line}
                          className={cn(
                            "font-medium tabular-nums",
                            line.includes("المدفوع") || line.includes("الإجمالي")
                              ? "text-slate-text"
                              : ""
                          )}
                        >
                          {line}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.financialAmount != null &&
                    item.financialAmount !== 0 && (
                      <p
                        className={cn(
                          "mt-2 inline-flex rounded-lg px-2 py-0.5 text-sm font-bold tabular-nums ring-1 ring-inset",
                          item.financialAmount < 0
                            ? "bg-warning text-warning-text ring-warning-border"
                            : "bg-success text-success-text ring-success-border"
                        )}
                      >
                        {item.financialAmount < 0 ? "−" : "+"}
                        {formatCurrency(Math.abs(item.financialAmount))}
                      </p>
                    )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
