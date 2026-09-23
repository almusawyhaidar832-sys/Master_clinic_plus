"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { DoctorPaymentFields } from "@/components/doctors/DoctorPaymentFields";
import type { Doctor, DoctorPaymentType } from "@/types";
import { normalizeDoctorPaymentType } from "@/lib/services/doctor-payment";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  normalizeDoctorPercentage,
  normalizeMaterialsShare,
} from "@/lib/constants";
import {
  CheckCircle2,
  IdCard,
  UserCog,
  Eye,
  EyeOff,
  KeyRound,
  Phone,
  Save,
  Trash2,
} from "lucide-react";

export default function EditDoctorPage() {
  const params = useParams();
  const router = useRouter();
  const { bi } = useLanguage();
  const doctorId = String(params.id ?? "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [fullName, setFullName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [phone, setPhone] = useState("");
  const [percentage, setPercentage] = useState("50");
  const [materialsShare, setMaterialsShare] = useState("0");
  const [paymentType, setPaymentType] = useState<DoctorPaymentType>("percentage");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [hasLogin, setHasLogin] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/admin/doctors/${doctorId}`, {
          credentials: "include",
          headers: authPortalHeaders("accountant"),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "تعذر تحميل بيانات الطبيب");
          return;
        }
        const doc = json.doctor as Doctor;
        setFullName(doc.full_name_ar ?? "");
        setSpecialty(doc.specialty_ar ?? "");
        setPhone(doc.phone ?? "");
        setPercentage(normalizeDoctorPercentage(doc.percentage));
        setMaterialsShare(normalizeMaterialsShare(doc.materials_share));
        setPaymentType(normalizeDoctorPaymentType(doc.payment_type));
        setSalaryAmount(
          doc.salary_amount != null && doc.salary_amount > 0
            ? String(doc.salary_amount)
            : ""
        );
        setUsername(json.username ?? "");
        setHasLogin(Boolean(json.hasLogin));
      } catch {
        setError("تعذر الاتصال بالخادم");
      } finally {
        setLoading(false);
      }
    }
    if (doctorId) void load();
  }, [doctorId]);

  async function handleDelete() {
    if (
      !confirm(
        `هل تريد إيقاف الطبيب «${fullName || "هذا الطبيب"}»؟ لن يظهر في القائمة النشطة.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/doctors/${doctorId}`, {
        method: "DELETE",
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "تعذر إيقاف الطبيب");
        return;
      }
      router.push("/dashboard/doctors");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!fullName.trim()) {
      setError("يرجى إدخال اسم الطبيب");
      return;
    }
    if (paymentType === "salary" && !(Number(salaryAmount) > 0)) {
      setError("أدخل قيمة الراتب الثابت");
      return;
    }

    if (!hasLogin && username.trim() && !password) {
      setError("لإنشاء حساب دخول جديد أدخل كلمة المرور أيضاً");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/doctors/${doctorId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders("accountant"),
        },
        body: JSON.stringify({
          full_name_ar: fullName.trim(),
          specialty_ar: specialty.trim(),
          phone: phone.trim(),
          percentage,
          materials_share: materialsShare,
          payment_type: paymentType,
          salary_amount: paymentType === "salary" ? Number(salaryAmount) : 0,
          username: username.trim() || undefined,
          password: password || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "تعذر حفظ التعديلات");
        return;
      }

      const extra =
        json.refresh_warning && !json.treatment_cases_refreshed
          ? ` — تنبيه: ${json.refresh_warning}`
          : "";
      setSuccess((json.message ?? "تم الحفظ بنجاح") + extra);
      setHasLogin(Boolean(json.hasLogin));
      if (json.username) setUsername(json.username);
      setPassword("");
      setTimeout(() => router.push("/dashboard/doctors"), 1800);
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        eyebrow={bi("إدارة العيادة", "Clinic management")}
        title={fullName ? `تعديل: ${fullName}` : "تعديل بيانات الطبيب"}
        subtitle="عدّل الاسم، الهاتف، نسبة الطبيب، وحساب الدخول"
        icon={UserCog}
        backHref="/dashboard/doctors"
        backLabel="العودة للأطباء"
        className="mb-0"
      />

      <section className="mc-panel">
        {loading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="mc-skeleton h-11 rounded-xl" />
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="mc-panel-head">
              <h2 className="mc-panel-title">
                <IdCard />
                {bi("بيانات الطبيب", "Doctor details")}
              </h2>
              {fullName && (
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-mc-pearl text-sm font-extrabold text-[#0b1f3a] ring-1 ring-inset ring-premium-300/60">
                  {fullName.trim().charAt(0)}
                </span>
              )}
            </div>
            <div className="mc-panel-body space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            {success && (
              <div className="flex items-center gap-2 rounded-xl border border-success-border bg-success px-4 py-3 text-sm font-medium text-success-text">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {success}
              </div>
            )}

            <Input
              label="اسم الطبيب *"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />

            <Input
              label="التخصص"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="مثال: أسنان عام"
            />

            <div className="space-y-2 rounded-2xl border border-slate-border bg-surface p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-text">
                <Phone className="h-4 w-4 text-premium-500" />
                رقم واتساب الطبيب
              </div>
              <p className="text-xs text-slate-muted">
                يُستخدم لإرسال تنبيهات الدفعات والجلسات — مثال: 07701234567
              </p>
              <Input
                label="رقم الهاتف"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
                className="text-left"
                placeholder="07xxxxxxxx"
              />
            </div>

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
              {hasLogin ? (
                <p className="inline-flex rounded-lg bg-success px-2.5 py-1 text-xs font-semibold text-success-text ring-1 ring-inset ring-success-border">
                  ✓ الطبيب لديه حساب دخول — يمكنك تغيير اسم المستخدم أو كلمة
                  المرور
                </p>
              ) : (
                <p className="inline-flex rounded-lg bg-warning px-2.5 py-1 text-xs font-semibold text-warning-text ring-1 ring-inset ring-warning-border">
                  لا يوجد حساب دخول — أدخل اسم مستخدم وكلمة مرور لإنشاء واحد
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
                    اسم المستخدم
                  </label>
                  <input
                    value={username}
                    onChange={(e) =>
                      setUsername(
                        e.target.value.toLowerCase().replace(/\s/g, "")
                      )
                    }
                    placeholder="dr_ahmed"
                    minLength={3}
                    dir="ltr"
                    className="mc-field text-left font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-muted">
                    {hasLogin ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور *"}
                  </label>
                  <div className="relative">
                    <input
                      type={showPass ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={hasLogin ? "اتركه فارغاً إن لم تُغيّر" : "6 أحرف+"}
                      minLength={hasLogin ? 0 : 6}
                      dir="ltr"
                      className="mc-field pl-9 text-left"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-muted hover:text-slate-text"
                    >
                      {showPass ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-border bg-surface px-5 py-4 sm:flex-row-reverse">
            <Button type="submit" size="lg" className="w-full sm:flex-1" disabled={saving || deleting}>
              <Save className="h-4 w-4" />
              {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full text-debt-text hover:border-debt-border hover:bg-debt sm:w-auto"
              disabled={saving || deleting || loading}
              onClick={() => void handleDelete()}
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "جاري الإيقاف..." : "إيقاف الطبيب (حذف من النشطين)"}
            </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
