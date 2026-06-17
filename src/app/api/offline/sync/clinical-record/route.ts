import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  processClinicalRecordOfflinePayload,
  type ClinicalXrayUploadInput,
} from "@/lib/offline/server/clinical-record-processor";
import type { ClinicalRecordOfflinePayload } from "@/lib/offline/types";

/** POST — رفع سجل سريري (مخطط + أشعة) محفوظ محلياً */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile?.role ?? "").toLowerCase();
    if (
      role !== "doctor" &&
      role !== "accountant" &&
      role !== "super_admin" &&
      role !== "admin" &&
      role !== "assistant"
    ) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const contentType = req.headers.get("content-type") ?? "";
    let payload: ClinicalRecordOfflinePayload | null = null;
    const xrayFiles: ClinicalXrayUploadInput[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const raw = form.get("payload");
      if (typeof raw === "string") {
        payload = JSON.parse(raw) as ClinicalRecordOfflinePayload;
      }
      for (const entry of form.getAll("files")) {
        if (!(entry instanceof File)) continue;
        const buffer = Buffer.from(await entry.arrayBuffer());
        xrayFiles.push({
          fileName: entry.name,
          mimeType: entry.type || "application/octet-stream",
          buffer,
        });
      }
    } else {
      const body = (await req.json()) as {
        payload?: ClinicalRecordOfflinePayload;
      };
      payload = body.payload ?? null;
    }

    if (!payload || payload.version !== 1) {
      return NextResponse.json(
        { error: "بيانات المزامنة غير صالحة" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const result = await processClinicalRecordOfflinePayload(
      admin,
      profile.clinic_id as string,
      profile.id as string,
      payload,
      xrayFiles
    );

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "تعذر المزامنة" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/offline/sync/clinical-record]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "خطأ أثناء المزامنة",
      },
      { status: 500 }
    );
  }
}
