"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile } from "@/lib/clinic-context";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import Link from "next/link";
import {
  NOTIFICATION_SELECT,
  notificationActionHref,
  type NotificationRow,
} from "@/lib/notifications/client";

export default function DashboardNotificationsPage() {
  const [items, setItems] = useState<NotificationRow[]>([]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const profile = await getAuthProfile(supabase);
    if (!profile) return;

    const { data, error } = await supabase
      .from("notifications")
      .select(NOTIFICATION_SELECT)
      .eq("recipient_profile_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) {
      setItems(data as NotificationRow[]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id: string) {
    const supabase = createClient();
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    load();
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-slate-text">الإشعارات</h2>
      {items.length === 0 ? (
        <Alert variant="info">لا توجد إشعارات</Alert>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const href = notificationActionHref(n.title_ar);
            return (
              <Card
                key={n.id}
                className={n.is_read ? "opacity-70" : "border-primary/30"}
                onClick={() => markRead(n.id)}
              >
                <p className="font-semibold text-slate-text">{n.title_ar}</p>
                <p className="text-sm text-slate-muted">{n.body_ar}</p>
                <p className="mt-1 text-[10px] text-slate-muted">
                  {new Date(n.created_at).toLocaleString("ar-EG")}
                </p>
                {href && (
                  <Link href={href} className="mt-2 inline-block text-xs text-primary">
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
