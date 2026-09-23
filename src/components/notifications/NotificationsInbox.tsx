"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { Bell, BellOff, ChevronLeft } from "lucide-react";
import {
  markNotificationsReadViaApi,
  fetchNotificationsInboxViaApi,
  notificationActionHref,
  type NotificationRow,
} from "@/lib/notifications/client";

interface NotificationsInboxProps {
  portal: AuthPortalId;
  title?: string;
  resolveHref?: (n: NotificationRow) => string | null;
  /** Render the title as the page hero (standalone inbox pages). */
  asPage?: boolean;
}

export function NotificationsInbox({
  portal,
  title = "الإشعارات",
  resolveHref,
  asPage = false,
}: NotificationsInboxProps) {
  const router = useRouter();
  const { bi } = useLanguage();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await fetchNotificationsInboxViaApi(portal);
    if (!result.ok) {
      setLoadError(result.error ?? "تعذر تحميل الإشعارات");
      setItems([]);
      setLoading(false);
      return;
    }
    setItems(result.items ?? []);
    setLoading(false);
  }, [portal]);

  useEffect(() => {
    let cancelled = false;

    async function openInbox() {
      setLoading(true);
      const result = await fetchNotificationsInboxViaApi(portal);
      if (cancelled) return;

      if (!result.ok) {
        setLoadError(result.error ?? "تعذر تحميل الإشعارات");
        setItems([]);
        setLoading(false);
        return;
      }

      setItems(result.items ?? []);
      setLoading(false);

      await markNotificationsReadViaApi(portal, { all: true });
      if (!cancelled) {
        setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      }
    }

    void openInbox();
    return () => {
      cancelled = true;
    };
  }, [portal]);

  async function markOneRead(id: string) {
    await markNotificationsReadViaApi(portal, { id });
    await load();
  }

  function hrefFor(n: NotificationRow): string | null {
    if (resolveHref) return resolveHref(n);
    return notificationActionHref(n.title_ar, n.link_path);
  }

  const countBadge =
    !loading && !loadError && items.length > 0 ? (
      <span className="inline-flex items-center rounded-full bg-primary-50 px-3 py-1 text-xs font-bold tabular-nums text-primary-700 ring-1 ring-inset ring-primary-200">
        {items.length}
      </span>
    ) : undefined;

  return (
    <div className={cn("space-y-4", asPage && "mx-auto max-w-3xl space-y-5")}>
      {asPage ? (
        <PageHeader
          eyebrow={bi("مركز الرسائل", "Message center")}
          title={title}
          icon={Bell}
          className="mb-0"
          actions={countBadge}
        />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <h2 className="mc-panel-title text-lg">
            <Bell />
            {title}
          </h2>
          {countBadge}
        </div>
      )}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mc-skeleton h-20 rounded-2xl" />
          ))}
          <p className="text-center text-xs text-slate-muted">جاري التحميل...</p>
        </div>
      ) : loadError ? (
        <Alert variant="error">{loadError}</Alert>
      ) : items.length === 0 ? (
        <div className="mc-panel flex flex-col items-center px-6 py-14 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-slate-muted ring-1 ring-inset ring-slate-border">
            <BellOff className="h-7 w-7" strokeWidth={1.6} />
          </span>
          <p className="text-sm font-medium text-slate-muted">لا توجد إشعارات</p>
        </div>
      ) : (
        <div className="mc-panel divide-y divide-slate-border">
          {items.map((n) => {
            const href = hrefFor(n);
            return (
              <div
                key={n.id}
                className={cn(
                  "relative flex gap-3.5 px-5 py-4 transition-colors hover:bg-surface",
                  href && "cursor-pointer",
                  n.is_read && "opacity-75"
                )}
                onClick={() => {
                  void markOneRead(n.id);
                  if (href) router.push(href);
                }}
              >
                {!n.is_read && (
                  <span className="absolute inset-y-3 start-0 w-1 rounded-e-full bg-premium-400" aria-hidden />
                )}
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
                    n.is_read
                      ? "bg-surface text-slate-muted ring-slate-border"
                      : "bg-primary-50 text-primary-700 ring-primary-200"
                  )}
                >
                  <Bell className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-slate-text">{n.title_ar}</p>
                    <p className="shrink-0 text-[11px] tabular-nums text-slate-muted">
                      {new Date(n.created_at).toLocaleString("ar-EG")}
                    </p>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-muted">{n.body_ar}</p>
                  {href && (
                    <Link
                      href={href}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-900"
                      onClick={(e) => e.stopPropagation()}
                    >
                      عرض التفاصيل
                      <ChevronLeft className="h-3.5 w-3.5 ltr:rotate-180" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
