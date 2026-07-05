"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Copy, Check } from "lucide-react";

const DOCKER_IMAGE = "evoapicloud/evolution-api:2.4.0-rc2";
const PHONE_VERSION = "2.3000.1039700148";

function buildHandoffText(serverUrl: string | null): string {
  const url =
    serverUrl?.trim() ||
    "https://evolution-api-production-3797.up.railway.app";
  return [
    "=== إصلاح واتسapp عيادة الحلو (Railway) ===",
    "",
    "1) Docker Image:",
    DOCKER_IMAGE,
    "",
    "2) Variables (Evolution API service):",
    `WPP_LID_MODE=false`,
    `CONFIG_SESSION_PHONE_VERSION=${PHONE_VERSION}`,
    `SERVER_URL=${url}`,
    "DATABASE_ENABLED=true",
    "DATABASE_PROVIDER=postgresql",
    "",
    "3) Redeploy ثم instance واحد فقط — QR من /dashboard/whatsapp",
    "",
    "المشكلة: Baileys يقبل الرسالة PENDING لكن لا يُسلّم للجوال.",
  ].join("\n");
}

export function WhatsAppRailwayHandoff({
  serverUrl,
}: {
  serverUrl?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copyBlock() {
    try {
      await navigator.clipboard.writeText(buildHandoffText(serverUrl ?? null));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* ignore */
    }
  }

  return (
    <Card className="border-slate-border bg-surface/60">
      <CardHeader>
        <CardTitle className="text-base">للمطوّr — انسخ وأرسل</CardTitle>
        <p className="text-sm text-slate-muted">
          التطبيق والربط سليم — السيرفر على Railway يحتاج تحديث (5 دقائق).
          انسخ النص وارسله لمن يدير Railway.
        </p>
      </CardHeader>
      <div className="space-y-3 px-4 pb-4">
        <Alert variant="warning">
          رسالة الاختبار تعني: Evolution قبل الطلب لكن التسليم فشل على
          السيرفر — لا يُحل من التطبيق أو QR فقط.
        </Alert>
        <pre
          dir="ltr"
          className="max-h-48 overflow-auto rounded-lg border border-slate-border bg-white p-3 text-left text-xs text-slate-text"
        >
          {buildHandoffText(serverUrl ?? null)}
        </pre>
        <Button type="button" variant="outline" size="sm" onClick={copyBlock}>
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              تم النسخ
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              نسخ تعليمات Railway
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
