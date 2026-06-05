"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import {
  DOCTOR_PERCENTAGE_OPTIONS,
  MATERIALS_SHARE_OPTIONS,
} from "@/lib/constants";
import type { Doctor } from "@/types";
import {
  ArrowRight,
  CheckCircle2,
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
        setPercentage(doc.percentage ?? "50");
        setMaterialsShare(doc.materials_share ?? "0");
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

    if (!hasLogin && username.trim() && !password) {
      setError("لإنشاء حساب دخول جديد أدخل كلمة المرور أيضاً");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/doctors/${doctorId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name_ar: fullName.trim(),
          specialty_ar: specialty.trim(),
          phone: phone.trim(),
          percentage,
          materials_share: materialsShare,
          username: username.trim() || undefined,
          password: password || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "تعذر حفظ التعديلات");
        return;
      }

      setSuccess(json.message ?? "تم الحفظ بنجاح");
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
    <div className="mx-auto max-w-lg space-y-6">
      <Link href="/dashboard/doctors">
        <Button variant="ghost" size="sm">
          <ArrowRight className="h-4 w-4" />
          العودة للأطباء
        </Button>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>
            {fullName ? `تعديل: ${fullName}` : "تعديل بيانات الطبيب"}
          </CardTitle>
          <p className="text-sm text-slate-muted">
            عدّل الاسم، الهاتف، نسبة الطبيب، وحساب الدخول
          </p>
        </CardHeader>

        {loading ? (
          <div className="space-y-3 px-4 pb-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-6">
            {error && <Alert variant="error">{error}</Alert>}
            {success && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
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

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                <Phone className="h-4 w-4" />
                رقم واتساب الطبيب
              </div>
              <p className="text-xs text-slate-500">
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

            <Select
              label="نسبة الطبيب"
              value={percentage}
              onChange={(e) => setPercentage(e.target.value)}
              options={[...DOCTOR_PERCENTAGE_OPTIONS]}
            />

            <Select
              label="نسبة تحمل المواد"
              value={materialsShare}
              onChange={(e) => setMaterialsShare(e.target.value)}
              options={[...MATERIALS_SHARE_OPTIONS]}
            />

            <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-primary">
                <KeyRound className="h-4 w-4" />
                حساب دخول الطبيب
              </div>
              {hasLogin ? (
                <p className="text-xs text-emerald-700 font-medium">
                  ✓ الطبيب لديه حساب دخول — يمكنك تغيير اسم المستخدم أو كلمة
                  المرور
                </p>
              ) : (
                <p className="text-xs text-amber-700">
                  لا يوجد حساب دخول — أدخل اسم مستخدم وكلمة مرور لإنشاء واحد
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
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
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-left focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
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
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-left focus:border-primary focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
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

            <Button type="submit" className="w-full" disabled={saving || deleting}>
              <Save className="h-4 w-4" />
              {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full border-red-200 text-red-600 hover:bg-red-50"
              disabled={saving || deleting || loading}
              onClick={() => void handleDelete()}
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "جاري الإيقاف..." : "إيقاف الطبيب (حذف من النشطين)"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
