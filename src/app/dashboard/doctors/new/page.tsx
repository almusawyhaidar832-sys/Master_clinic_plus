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
import { getClinicIdFromProfile } from "@/lib/clinic-context";
import { ArrowRight } from "lucide-react";

export default function NewDoctorPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [phone, setPhone] = useState("");
  const [percentage, setPercentage] = useState("50");
  const [materialsShare, setMaterialsShare] = useState("0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const clinicId = await getClinicIdFromProfile(supabase);
    const { error: insertError } = await supabase.from("doctors").insert({
      clinic_id: clinicId,
      full_name_ar: fullName,
      specialty_ar: specialty || null,
      phone: phone || null,
      percentage,
      materials_share: materialsShare,
    });

    setLoading(false);

    if (insertError) {
      setError("تعذر حفظ الطبيب. تحقق من الصلاحيات وقاعدة البيانات.");
      return;
    }

    router.push("/dashboard/doctors");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link href="/dashboard/doctors">
        <Button variant="ghost" size="sm">
          <ArrowRight className="h-4 w-4" />
          العودة
        </Button>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>إضافة طبيب جديد</CardTitle>
          <p className="text-sm text-debt-text/80">
            ⚠️ يجب اختيار النسب من القوائم الثابتة فقط — لا يُسمح بالكتابة اليدوية
          </p>
        </CardHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}

          <Input
            label="اسم الطبيب"
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

          <Input
            label="رقم الهاتف"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            dir="ltr"
            className="text-left"
          />

          <Select
            label="نسبة الطبيب من العملية"
            name="percentage"
            value={percentage}
            onChange={(e) => setPercentage(e.target.value)}
            options={[...DOCTOR_PERCENTAGE_OPTIONS]}
            required
          />

          <Select
            label="تكلفة المواد / المعمل"
            name="materials_share"
            value={materialsShare}
            onChange={(e) => setMaterialsShare(e.target.value)}
            options={[...MATERIALS_SHARE_OPTIONS]}
            required
          />

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "جاري الحفظ..." : "حفظ الطبيب"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
