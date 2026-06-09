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

function ActionIcon({ action }: { action: string }) {
  const cls = "h-4 w-4 shrink-0";
  switch (action) {
    case "refund":
      return <Undo2 className={cn(cls, "text-amber-600")} />;
    case "update":
      return <Pencil className={cn(cls, "text-blue-600")} />;
    case "delete":
      return <Trash2 className={cn(cls, "text-red-600")} />;
    case "create":
      return <Plus className={cn(cls, "text-emerald-600")} />;
    default:
      return <Activity className={cn(cls, "text-slate-muted")} />;
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
    topics: ["audit", "all"],
    clinicId,
    onRefresh: load,
    enabled: !!clinicId,
  });

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex flex-wrap items-end gap-3">
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
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-slate-100"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-muted">
          لا توجد عمليات مسجّلة بعد
        </p>
      ) : (
        <ul className="space-y-2">
          {(maxItems ? items.slice(0, maxItems) : items).map((item) => (
            <li
              key={item.id}
              className={cn(
                "rounded-xl border border-slate-border bg-white p-3 shadow-sm",
                item.action === "refund" && "border-amber-200 bg-amber-50/40"
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-surface">
                  <ActionIcon action={item.action} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                      {item.actionLabel}
                    </span>
                    <span className="text-xs text-slate-muted">
                      {formatDate(item.changedAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-text">
                    {item.summary}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-muted">
                    بواسطة:{" "}
                    <span className="font-semibold text-slate-text">
                      {item.actorName}
                    </span>
                  </p>
                  {item.financialAmount != null &&
                    item.financialAmount !== 0 && (
                      <p
                        className={cn(
                          "mt-1 text-sm font-bold tabular-nums",
                          item.financialAmount < 0
                            ? "text-amber-700"
                            : "text-emerald-700"
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
