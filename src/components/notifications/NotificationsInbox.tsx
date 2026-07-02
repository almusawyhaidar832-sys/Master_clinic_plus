"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
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
}

export function NotificationsInbox({
  portal,
  title = "الإشعارات",
  resolveHref,
}: NotificationsInboxProps) {
  const router = useRouter();
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

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-slate-text">{title}</h2>
      {loading ? (
        <p className="text-sm text-slate-muted">جاري التحميل...</p>
      ) : loadError ? (
        <Alert variant="error">{loadError}</Alert>
      ) : items.length === 0 ? (
        <Alert variant="info">لا توجد إشعارات</Alert>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const href = hrefFor(n);
            return (
              <Card
                key={n.id}
                className={
                  href
                    ? n.is_read
                      ? "cursor-pointer opacity-70"
                      : "cursor-pointer border-primary/30"
                    : n.is_read
                      ? "opacity-70"
                      : "border-primary/30"
                }
                onClick={() => {
                  void markOneRead(n.id);
                  if (href) router.push(href);
                }}
              >
                <p className="font-semibold text-slate-text">{n.title_ar}</p>
                <p className="text-sm text-slate-muted">{n.body_ar}</p>
                <p className="mt-1 text-[10px] text-slate-muted">
                  {new Date(n.created_at).toLocaleString("ar-EG")}
                </p>
                {href && (
                  <Link
                    href={href}
                    className="mt-2 inline-block text-xs text-primary"
                    onClick={(e) => e.stopPropagation()}
                  >
                    عرض التفاصيل
                  </Link>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
