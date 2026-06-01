"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { ArrowRight, CheckCircle2, Building2 } from "lucide-react";

export default function NewDoctorPage() {
  const router = useRouter();
  const { clinicId, clinicName, loading: clinicLoading, missingClinic } = useActiveClinicId();

  const [fullName, setFullName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [phone, setPhone] = useState("");
  const [percentage, setPercentage] = useState("50");
  const [materialsShare, setMaterialsShare] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!fullName.trim()) {
      setError("يرجى إدخال اسم الطبيب");
      return;
    }
    if (!clinicId) {
      setError("لا توجد عيادة في قاعدة البيانات. أنشئ عيادة أولاً.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const { error: insertError } = await supabase.from("doctors").insert({
      clinic_id: clinicId,
      full_name_ar: fullName.trim(),
      specialty_ar: specialty.trim() || null,
      phone: phone.trim() || null,
      percentage: percentage as "10" | "20" | "30" | "40" | "50" | "60" | "70" | "80",
      materials_share: materialsShare as "0" | "10" | "20" | "30" | "40" | "50",
    });

    setSaving(false);

    if (insertError) {
      const msg = insertError.message ?? "";
      if (msg.includes("row-level security") || msg.includes("policy") || msg.includes("violates")) {
        setError("رُفض الحفظ: تأكد أن دورك accountant أو super_admin في جدول profiles.");
      } else if (msg.includes("duplicate") || msg.includes("unique")) {
        setError("يوجد طبيب بهذا الاسم مسبقاً في العيادة.");
      } else {
        setError(`خطأ: ${msg}`);
      }
      return;
    }

    setSuccess(true);
    setTimeout(() => {
      router.push("/dashboard/doctors");
      router.refresh();
    }, 1200);
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link href="/dashboard/doctors">
        <Button variant="ghost" size="sm">
          <ArrowRight className="h-4 w-4" />
          العودة للأطباء
        </Button>
      </Link>

      {/* Clinic status — only show error when truly missing */}
      {clinicLoading && (
        <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
      )}
      {!clinicLoading && missingClinic && (
        <Alert variant="error">
          لا توجد عيادة في قاعدة البيانات. أنشئ عيادة أولاً في Supabase:
          <code className="mt-1 block text-xs font-mono bg-white/60 rounded px-2 py-1">
            INSERT INTO public.clinics (name, name_ar) VALUES ('Clinic', 'العيادة');
          </code>
        </Alert>
      )}
      {!clinicLoading && clinicId && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm text-primary">
          <Building2 className="h-4 w-4 shrink-0" />
          <span>
            العيادة النشطة: <strong>{clinicName || clinicId}</strong>
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>إضافة طبيب جديد</CardTitle>
          <p className="text-sm text-slate-muted">
            يجب اختيار النسب من القوائم — لا يُسمح بالكتابة اليدوية
          </p>
        </CardHeader>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-primary" />
            <p className="text-lg font-semibold text-slate-text">تم حفظ الطبيب بنجاح!</p>
            <p className="text-sm text-slate-muted">جاري الانتقال لقائمة الأطباء...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
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
              placeholder="مثال: أسنان عام، تقويم، أطفال..."
            />

            <Input
              label="رقم الهاتف"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              className="text-left"
              placeholder="+201xxxxxxxxx"
            />

            <Select
              label="نسبة الطبيب من كل عملية"
              name="percentage"
              value={percentage}
              onChange={(e) => setPercentage(e.target.value)}
              options={[...DOCTOR_PERCENTAGE_OPTIONS]}
              required
            />

            <Select
              label="نسبة تحمل الطبيب لتكلفة المواد"
              name="materials_share"
              value={materialsShare}
              onChange={(e) => setMaterialsShare(e.target.value)}
              options={[...MATERIALS_SHARE_OPTIONS]}
              required
            />

            <div className="rounded-lg border border-slate-border bg-surface px-4 py-3 text-xs text-slate-muted leading-relaxed">
              مثال: عملية بـ 1000 ج.م — الطبيب يأخذ {percentage}% ={" "}
              <strong className="text-primary">
                {(1000 * Number(percentage)) / 100} ج.م
              </strong>
              {Number(materialsShare) > 0 && (
                <> · يتحمل {materialsShare}% من تكلفة المواد</>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={saving || clinicLoading || missingClinic}
            >
              {saving ? "جاري الحفظ..." : "حفظ الطبيب"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
