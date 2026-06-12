"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile } from "@/lib/clinic-context";
import type { AuthPortalId } from "@/lib/auth/api-portal";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import {
  NOTIFICATION_SELECT,
  markNotificationsReadViaApi,
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
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const profile = await getAuthProfile(supabase);
    if (!profile) {
      setItems([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("notifications")
      .select(NOTIFICATION_SELECT)
      .eq("recipient_profile_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) {
      setItems(data as NotificationRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function openInbox() {
      setLoading(true);
      await markNotificationsReadViaApi(portal, { all: true });
      if (!cancelled) {
        await load();
      }
    }

    void openInbox();
    return () => {
      cancelled = true;
    };
  }, [portal, load]);

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
      ) : items.length === 0 ? (
        <Alert variant="info">لا توجد إشعارات</Alert>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const href = hrefFor(n);
            return (
              <Card
                key={n.id}
                className={n.is_read ? "opacity-70" : "border-primary/30"}
                onClick={() => void markOneRead(n.id)}
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
