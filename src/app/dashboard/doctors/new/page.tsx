"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { DoctorPaymentFields } from "@/components/doctors/DoctorPaymentFields";
import type { DoctorPaymentType } from "@/types";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import {
  buildClientDoctorInsertRow,
  insertDoctorRowClient,
} from "@/lib/services/doctor-row-write";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  hasNewDoctorDraftContent,
  newDoctorDraftKey,
  type NewDoctorFormDraft,
} from "@/lib/forms/portal-form-drafts";
import { useSessionFormDraft } from "@/hooks/useSessionFormDraft";
import { CheckCircle2, Building2, Eye, EyeOff, KeyRound, UserPlus, IdCard } from "lucide-react";

export default function NewDoctorPage() {
  const router = useRouter();
  const { bi } = useLanguage();
  const { clinicId, clinicName, loading: clinicLoading, missingClinic } = useActiveClinicId();

  const [fullName,       setFullName]       = useState("");
  const [specialty,      setSpecialty]      = useState("");
  const [phone,          setPhone]          = useState("");
  const [percentage,     setPercentage]     = useState("50");
  const [materialsShare, setMaterialsShare] = useState("0");
  const [paymentType,      setPaymentType]      = useState<DoctorPaymentType>("percentage");
  const [salaryAmount,     setSalaryAmount]     = useState("");
  const [username,       setUsername]       = useState("");
  const [password,       setPassword]       = useState("");
  const [showPass,       setShowPass]       = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState("");
  const [createdUsername, setCreatedUsername] = useState<string | null>(null);

  const applyDoctorDraft = useCallback((draft: NewDoctorFormDraft) => {
    setFullName(draft.fullName);
    setSpecialty(draft.specialty);
    setPhone(draft.phone);
    setPercentage(draft.percentage);
    setMaterialsShare(draft.materialsShare);
    setPaymentType(draft.paymentType as DoctorPaymentType);
    setSalaryAmount(draft.salaryAmount);
    setUsername(draft.username);
  }, []);

  const doctorDraftSnapshot = useMemo(
    () => ({
      fullName,
      specialty,
      phone,
      percentage,
      materialsShare,
      paymentType,
      salaryAmount,
      username,
    }),
    [
      fullName,
      specialty,
      phone,
      percentage,
      materialsShare,
      paymentType,
      salaryAmount,
      username,
    ]
  );

  const { draftRestored, dismissDraftNotice, clearDraft } = useSessionFormDraft(
    clinicId ? newDoctorDraftKey(clinicId) : "mcp:new-doctor:pending",
    doctorDraftSnapshot,
    applyDoctorDraft,
    {
      enabled: !!clinicId,
      hasContent: hasNewDoctorDraftContent,
    }
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreatedUsername(null);

    if (!fullName.trim()) {
      setError("يرجى إدخال اسم الطبيب");
      return;
    }
    if (!clinicId) {
      setError("لا توجد عيادة في قاعدة البيانات. أنشئ عيادة أولاً.");
      return;
    }
    if (paymentType === "salary" && !(Number(salaryAmount) > 0)) {
      setError("أدخل قيمة الراتب الثابت");
      return;
    }

    setSaving(true);

    // مع username + password → حساب دخول كامل للطبيب
    if (username.trim() && password) {
      const cleanUsername = username.trim().toLowerCase().replace(/\s/g, "").replace(/[^a-z0-9._-]/g, "");

      if (cleanUsername.length < 3) {
        setError("اسم المستخدم: 3 أحرف إنجليزية على الأقل (مثل dr_ahmed)");
        setSaving(false);
        return;
      }
      if (password.length < 6) {
        setError("كلمة مرور الطبيب يجب أن تكون 6 أحرف على الأقل");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders("accountant"),
        },
        body: JSON.stringify({
          username:        cleanUsername,
          password,
          full_name:       fullName.trim(),
          role:            "doctor",
          phone:           phone.trim() || null,
          specialty_ar:    specialty.trim() || null,
          percentage,
          materials_share: materialsShare,
          payment_type:    paymentType,
          salary_amount:   paymentType === "salary" ? Number(salaryAmount) : 0,
        }),
      });

      const json = await res.json();
      setSaving(false);

      if (!res.ok) {
        setError(json.error ?? "تعذر إنشاء حساب الطبيب");
        return;
      }

      setCreatedUsername(json.username ?? cleanUsername);
      clearDraft();
      setTimeout(() => {
        router.push("/dashboard/doctors");
        router.refresh();
      }, 2500);
      return;
    }

    // بدون username → طبيب بدون حساب دخول
    const supabase = createClient();
    const { error: insertError } = await insertDoctorRowClient(
      supabase,
      buildClientDoctorInsertRow({
        clinic_id: clinicId,
        full_name_ar: fullName.trim(),
        specialty_ar: specialty.trim() || null,
        phone: phone.trim() || null,
        percentage,
        materials_share: materialsShare,
        payment_type: paymentType,
        salary_amount: paymentType === "salary" ? Number(salaryAmount) : 0,
      })
    );

    setSaving(false);

    if (insertError) {
      const msg = insertError ?? "";
      if (msg.includes("row-level security") || msg.includes("policy")) {
        setError("رُفض الحفظ: تأكد أن دورك accountant أو super_admin.");
      } else if (msg.includes("duplicate") || msg.includes("unique")) {
        setError("يوجد طبيب بهذا الاسم مسبقاً.");
      } else {
        setError(`خطأ: ${msg}`);
      }
      return;
    }

    setCreatedUsername(null);
    clearDraft();
    setTimeout(() => {
      router.push("/dashboard/doctors");
      router.refresh();
    }, 1200);
  }


  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        eyebrow={bi("إدارة العيادة", "Clinic management")}
        title="إضافة طبيب جديد"
        subtitle="أدخل بيانات الطبيب + username وكلمة مرور — يدخل فوراً من بوابة «تطبيق الطبيب»"
        icon={UserPlus}
        backHref="/dashboard/doctors"
        backLabel="العودة للأطباء"
        className="mb-0"
      />

      {clinicLoading && (
        <div className="mc-skeleton h-11 rounded-2xl" />
      )}
      {!clinicLoading && missingClinic && (
        <Alert variant="error">
          لا توجد عيادة في قاعدة البيانات. أنشئ عيادة أولاً.
        </Alert>
      )}
      {!clinicLoading && clinicId && (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-border bg-surface-card px-4 py-2.5 text-sm text-slate-muted shadow-card">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200">
            <Building2 className="h-4 w-4" />
          </span>
          <span>
            العيادة النشطة: <strong className="text-slate-text">{clinicName || clinicId}</strong>
          </span>
        </div>
      )}

      <section className="mc-panel">
        {createdUsername ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success text-success-text ring-1 ring-inset ring-success-border">
              <CheckCircle2 className="h-9 w-9" />
            </span>
            <p className="text-lg font-bold text-slate-text">تم إنشاء الطبيب بنجاح!</p>
            <div className="w-full max-w-sm space-y-1.5 rounded-2xl border border-success-border bg-success p-4 text-start text-sm text-success-text">
              <p className="font-bold">بيانات دخول الطبيب:</p>
              <p>البوابة: <strong>تطبيق الطبيب</strong></p>
              <p>اسم المستخدم: <strong dir="ltr" className="font-mono text-primary">{createdUsername}</strong></p>
              <p>كلمة المرور: <strong>نفس التي أدخلتها</strong></p>
            </div>
            <p className="text-sm text-slate-muted">جاري الانتقال لقائمة الأطباء...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="mc-panel-head">
              <h2 className="mc-panel-title">
                <IdCard />
                {bi("بيانات الطبيب", "Doctor details")}
              </h2>
            </div>
            <div className="mc-panel-body space-y-4">
            {draftRestored && (
              <Alert variant="info">
                تم استعادة بيانات الطبيب التي كتبتها (كلمة المرور لا تُحفظ لأسباب أمنية).
                <button
                  type="button"
                  className="mr-2 underline"
                  onClick={dismissDraftNotice}
                >
                  إخفاء
                </button>
              </Alert>
            )}
            {error && <Alert variant="error">{error}</Alert>}

            <Input
              label="اسم الطبيب *"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="مثال: د. أحمد محمد"
              required
              autoFocus
            />

            <Input
              label="التخصص"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="مثال: أسنان عام، تقويم..."
            />

            <Input
              label="رقم الهاتف"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              className="text-left"
              placeholder="07xxxxxxxx"
            />

            <DoctorPaymentFields
              paymentType={paymentType}
              onPaymentTypeChange={setPaymentType}
              salaryAmount={salaryAmount}
              onSalaryAmountChange={setSalaryAmount}
              percentage={percentage}
              onPercentageChange={setPercentage}
              materialsShare={materialsShare}
              onMaterialsShareChange={setMaterialsShare}
            />

            <div className="space-y-3 rounded-2xl border border-premium-200 bg-premium-50/50 p-4">
              <div className="flex items-center gap-2.5 text-sm font-bold text-slate-text">
                <span className="mc-icon-tile h-8 w-8 rounded-xl">
                  <KeyRound className="h-4 w-4" />
                </span>
                حساب دخول الطبيب
              </div>
              <p className="text-xs text-slate-muted">
                أدخل username وكلمة مرور — يُحفظان تلقائياً ويدخل الطبيب من بوابة «تطبيق الطبيب»
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
                    اسم المستخدم <span className="text-debt-text">*</span>
                  </label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                    placeholder="dr_ahmed"
                    required
                    minLength={3}
                    dir="ltr"
                    className="mc-field text-left font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
                    كلمة المرور <span className="text-debt-text">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPass ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="6 أحرف على الأقل"
                      required
                      minLength={6}
                      dir="ltr"
                      className="mc-field pl-9 text-left"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-muted hover:text-slate-text"
                    >
                      {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
              {username && password && (
                <p className="text-xs font-semibold text-success-text">
                  ✓ الطبيب سيدخل بـ <span dir="ltr">{username}</span> من بوابة «تطبيق الطبيب»
                </p>
              )}
            </div>
            </div>

            <div className="border-t border-slate-border bg-surface px-5 py-4">
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={saving || clinicLoading || missingClinic}
            >
              {saving ? "جاري الحفظ..." : "حفظ الطبيب وإنشاء حسابه"}
            </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
