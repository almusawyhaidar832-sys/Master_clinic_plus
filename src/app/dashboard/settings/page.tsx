"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { createClient } from "@/lib/supabase/client";
import { fetchClinicProfile, updateClinicProfile } from "@/lib/services/clinic-profile";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import Link from "next/link";
import {
  Building2,
  Eye,
  Image as ImageIcon,
  Lock,
  MapPin,
  QrCode,
  Receipt,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { getAuthProfile } from "@/lib/clinic-context";
import { useClinicModules } from "@/contexts/ClinicModulesContext";
import type { ClinicProfile } from "@/types/clinic-profile";

export default function ClinicSettingsPage() {
  const router = useRouter();
  const { bi } = useLanguage();
  const { refresh: refreshContext } = useClinicProfile();
  const { clinicId, loading: clinicLoading, missingClinic } = useActiveClinicId();
  const { hasModule } = useClinicModules();

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
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [userRole, setUserRole] = useState<string>("accountant");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const canEditClinic =
    userRole === "super_admin" || userRole === "accountant";

  useEffect(() => {
    async function loadRole() {
      const supabase = createClient();
      const auth = await getAuthProfile(supabase);
      if (auth?.role) setUserRole(String(auth.role));
    }
    void loadRole();
  }, []);

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

  async function handleLogoUpload(file: File) {
    if (!canEditClinic) return;
    setUploadingLogo(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/clinic/logo-upload", {
        method: "POST",
        credentials: "include",
        headers: authPortalHeaders("accountant"),
        body: form,
      });
      const data = (await res.json()) as { logo_url?: string; error?: string };
      if (!res.ok || data.error) {
        setMessage({ type: "error", text: data.error ?? "تعذر رفع الشعار" });
        return;
      }
      if (data.logo_url) {
        setLogoUrl(data.logo_url);
        setMessage({ type: "success", text: "✓ تم رفع الشعار بنجاح" });
        await refreshContext();
      }
    } catch {
      setMessage({ type: "error", text: "تعذر الاتصال بالسيرفر" });
    } finally {
      setUploadingLogo(false);
    }
  }

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
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow={bi("الإعدادات", "Settings")}
        title="ملف العيادة"
        icon={Building2}
        className="mb-0"
        subtitle={
          <>
            الاسم والعنوان والشعار يظهران تلقائياً في التقارير وفواتير PDF
            {!canEditClinic && !loading && (
              <span className="mt-2 flex w-fit items-center gap-1.5 rounded-lg bg-warning px-2.5 py-1 text-xs font-medium text-warning-text ring-1 ring-inset ring-warning-border">
                <Lock className="h-3.5 w-3.5" />
                التعديل متاح للمحاسب أو مالك العيادة فقط — أنت تعرض الإعدادات للقراءة.
              </span>
            )}
          </>
        }
      />

      {missingClinic && (
        <Alert variant="error">
          لا توجد عيادة في قاعدة البيانات. أنشئ عيادة أولاً ثم أعد تحميل الصفحة.
        </Alert>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-5">
        {loading ? (
          <section className="mc-panel">
            <div className="space-y-3 p-5">
              <p className="flex items-center gap-2 text-sm text-slate-muted">
                <RefreshCw className="h-4 w-4 animate-spin" />
                جاري التحميل...
              </p>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="mc-skeleton h-11 rounded-xl" />
              ))}
            </div>
          </section>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
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

            <section className="mc-panel">
              <div className="mc-panel-head">
                <h3 className="mc-panel-title">
                  <Building2 />
                  بيانات العيادة
                </h3>
                {clinicId && (
                  <span className="rounded-md bg-surface px-2 py-0.5 font-mono text-[10px] text-slate-muted ring-1 ring-inset ring-slate-border" dir="ltr">
                    {clinicId.slice(0, 8)}...
                  </span>
                )}
              </div>
              <div className="mc-panel-body grid gap-4 sm:grid-cols-2">
            <Input
              label="اسم العيادة (عربي) — يظهر في التقارير"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              placeholder="مثال: عيادة الأمل للأسنان"
              required
              disabled={!canEditClinic}
            />

            <Input
              label="اسم العيادة (إنجليزي / للسجلات)"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="Clinic name in English"
              required
              disabled={!canEditClinic}
            />
              </div>
            </section>

            <section className="mc-panel">
              <div className="mc-panel-head">
                <h3 className="mc-panel-title">
                  <MapPin />
                  {bi("العنوان والتواصل", "Address & contact")}
                </h3>
              </div>
              <div className="mc-panel-body grid gap-4 sm:grid-cols-2">
            <Input
              label="العنوان"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="العنوان الكامل للعيادة"
              disabled={!canEditClinic}
            />

            <Input
              label="هاتف العيادة"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              className="text-left"
              placeholder="+201xxxxxxxxx"
              disabled={!canEditClinic}
            />
              </div>
            </section>

            <section className="mc-panel">
              <div className="mc-panel-head">
                <h3 className="mc-panel-title">
                  <ImageIcon />
                  شعار العيادة
                </h3>
              </div>
            <div className="mc-panel-body space-y-3">
              {logoUrl && (
                <div className="flex justify-center rounded-2xl border border-dashed border-slate-border bg-surface p-5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoUrl}
                    alt="شعار العيادة"
                    className="max-h-20 object-contain"
                  />
                </div>
              )}
              {canEditClinic ? (
                <>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleLogoUpload(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={uploadingLogo}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {uploadingLogo ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        جاري الرفع...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        رفع شعار من الجهاز
                      </>
                    )}
                  </Button>
                  <Input
                    label="أو رابط الشعار (URL)"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://..."
                    dir="ltr"
                    className="text-left"
                  />
                </>
              ) : (
                logoUrl ? null : (
                  <p className="text-xs text-slate-muted">لم يُرفع شعار بعد</p>
                )
              )}
            </div>
            </section>

            {/* Review fee — only shown when optional columns exist */}
            {hasOptionalCols && (
              <section className="mc-panel">
                <div className="mc-panel-head">
                  <h3 className="mc-panel-title">
                    <Receipt />
                    كشفية المراجع
                  </h3>
                </div>
                <div className="mc-panel-body space-y-3">
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-border bg-surface px-3.5 py-3 text-sm font-medium text-slate-text">
                  <input
                    type="checkbox"
                    checked={reviewFeeEnabled}
                    onChange={(e) => setReviewFeeEnabled(e.target.checked)}
                    className="h-4 w-4 rounded text-primary"
                    disabled={!canEditClinic}
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
                    disabled={!canEditClinic}
                  />
                )}
                </div>
              </section>
            )}

            {!hasOptionalCols && (
              <p className="rounded-2xl border border-slate-border bg-surface p-3.5 text-xs text-slate-muted">
                ملاحظة: أعمدة كشفية المراجع غير موجودة بعد في الـ schema cache.{" "}
                <span className="font-mono">شغّل reload-schema-cache.sql في Supabase</span>
              </p>
            )}

            <div className="sticky bottom-3 z-10 rounded-2xl border border-slate-border bg-surface-card p-3 shadow-elevated">
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={saving || !clinicId || !canEditClinic}
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  حفظ ملف العيادة
                </>
              )}
            </Button>
            </div>
          </form>
        )}
      </div>

      <aside className="space-y-5 lg:sticky lg:top-4">
      {/* Live preview */}
      {profile && (
        <section className="mc-panel">
          <div className="mc-panel-head">
            <h3 className="mc-panel-title">
              <Eye />
              {bi("معاينة مباشرة", "Live preview")}
            </h3>
          </div>
          <div className="mc-panel-body">
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
          </div>
        </section>
      )}

      {hasModule("online_booking") && (
        <section className="mc-panel">
          <div className="mc-panel-head">
            <h3 className="mc-panel-title">
              <QrCode />
              بوابة الحجوزات
            </h3>
          </div>
          <div className="mc-panel-body space-y-4">
          <p className="text-sm text-slate-muted">
            باركود فريد يوجّه المرضى مباشرة لصفحة حجز عيادتك.
          </p>
            <Link href="/dashboard/booking" className="block">
              <Button type="button" variant="outline" className="w-full">
                <QrCode className="h-4 w-4" />
                عرض باركود العيادة
              </Button>
            </Link>
          </div>
        </section>
      )}
      </aside>
      </div>
    </div>
  );
}
