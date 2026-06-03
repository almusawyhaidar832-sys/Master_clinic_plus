"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { createClient } from "@/lib/supabase/client";
import { fetchClinicProfile, updateClinicProfile } from "@/lib/services/clinic-profile";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { Building2, RefreshCw } from "lucide-react";
import type { ClinicProfile } from "@/types/clinic-profile";

export default function ClinicSettingsPage() {
  const router = useRouter();
  const { refresh: refreshContext } = useClinicProfile();
  const { clinicId, loading: clinicLoading, missingClinic } = useActiveClinicId();

  const [profile, setProfile] = useState<ClinicProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Form state
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [reviewFeeEnabled, setReviewFeeEnabled] = useState(false);
  const [reviewFeeAmount, setReviewFeeAmount] = useState("0");
  const [hasOptionalCols, setHasOptionalCols] = useState(true);

  const [message, setMessage] = useState<{
    type: "success" | "error" | "warn";
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // Load clinic profile when clinicId is resolved
  useEffect(() => {
    if (!clinicId) return;
    async function load() {
      setProfileLoading(true);
      const supabase = createClient();
      const data = await fetchClinicProfile(supabase, clinicId);
      if (data) {
        setProfile(data);
        setNameAr(data.name_ar ?? "");
        setNameEn(data.name);
        setAddress(data.address ?? "");
        setPhone(data.phone ?? "");
        setLogoUrl(data.logo_url ?? "");
        setReviewFeeEnabled(data.review_fee_enabled ?? false);
        setReviewFeeAmount(String(data.review_fee_amount ?? 0));
        setHasOptionalCols(
          "review_fee_enabled" in data && data.review_fee_enabled !== undefined
        );
      }
      setProfileLoading(false);
    }
    load();
  }, [clinicId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const supabase = createClient();
    const result = await updateClinicProfile(supabase, {
      name_ar: nameAr || undefined,
      name: nameEn,
      address: address || undefined,
      phone: phone || undefined,
      logo_url: logoUrl || null,
      review_fee_enabled: hasOptionalCols ? reviewFeeEnabled : undefined,
      review_fee_amount: hasOptionalCols ? parseFloat(reviewFeeAmount) || 0 : undefined,
    });

    setSaving(false);

    if (result.ok) {
      // Partial success: core saved but optional cols had an issue
      if (result.error) {
        setMessage({ type: "warn", text: result.error });
      } else {
        setMessage({
          type: "success",
          text: "✓ تم حفظ بيانات العيادة — تظهر في التقارير والواتساب",
        });
      }
      // Refresh clinic profile context
      await refreshContext();
      // Reload local profile
      const supabase2 = createClient();
      const fresh = await fetchClinicProfile(supabase2, clinicId);
      if (fresh) setProfile(fresh);
      // Trigger Next.js page refresh for layouts
      router.refresh();
    } else {
      setMessage({ type: "error", text: result.error ?? "تعذر الحفظ" });
    }
  }

  const loading = clinicLoading || profileLoading;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">ملف العيادة</h2>
        <p className="text-slate-muted">
          الاسم والعنوان والشعار يظهران تلقائياً في التقارير والرسائل
        </p>
      </div>

      {missingClinic && (
        <Alert variant="error">
          لا توجد عيادة في قاعدة البيانات. أنشئ عيادة أولاً ثم أعد تحميل الصفحة.
        </Alert>
      )}

      {/* Live preview */}
      {profile && (
        <Card>
          <ClinicBrandingHeader
            profile={{
              ...profile,
              name_ar: nameAr || profile.name_ar,
              name: nameEn || profile.name,
              address: address || profile.address,
              logo_url: logoUrl || profile.logo_url,
            }}
            title="معاينة"
            size="sm"
          />
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <CardTitle>بيانات العيادة</CardTitle>
            </div>
            {clinicId && (
              <span className="text-[10px] text-slate-muted font-mono">
                {clinicId.slice(0, 8)}...
              </span>
            )}
          </div>
        </CardHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-muted py-4">
            <RefreshCw className="h-4 w-4 animate-spin" />
            جاري التحميل...
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            {message && (
              <Alert
                variant={
                  message.type === "success"
                    ? "success"
                    : message.type === "warn"
                    ? "info"
                    : "error"
                }
              >
                {message.text}
              </Alert>
            )}

            <Input
              label="اسم العيادة (عربي) — يظهر في التقارير"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              placeholder="مثال: عيادة الأمل للأسنان"
              required
            />

            <Input
              label="اسم العيادة (إنجليزي / للسجلات)"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="Clinic name in English"
              required
            />

            <Input
              label="العنوان"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="العنوان الكامل للعيادة"
            />

            <Input
              label="هاتف العيادة"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              className="text-left"
              placeholder="+201xxxxxxxxx"
            />

            <Input
              label="رابط الشعار (URL)"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              dir="ltr"
              className="text-left"
            />

            {/* Review fee — only shown when optional columns exist */}
            {hasOptionalCols && (
              <div className="rounded-lg border border-slate-border p-4 space-y-3">
                <p className="text-sm font-semibold text-slate-text">كشفية المراجع</p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reviewFeeEnabled}
                    onChange={(e) => setReviewFeeEnabled(e.target.checked)}
                    className="h-4 w-4 rounded text-primary"
                  />
                  تفعيل رسوم كشفية المراجع على مستوى العيادة
                </label>
                {reviewFeeEnabled && (
                  <Input
                    label="مبلغ الكشفية الافتراضي (د.ع)"
                    type="number"
                    min="0"
                    value={reviewFeeAmount}
                    onChange={(e) => setReviewFeeAmount(e.target.value)}
                    dir="ltr"
                    className="text-left"
                  />
                )}
              </div>
            )}

            {!hasOptionalCols && (
              <p className="text-xs text-slate-muted rounded-lg bg-slate-50 p-3">
                ملاحظة: أعمدة كشفية المراجع غير موجودة بعد في الـ schema cache.{" "}
                <span className="font-mono">شغّل reload-schema-cache.sql في Supabase</span>
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={saving || !clinicId}
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                "حفظ ملف العيادة"
              )}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
