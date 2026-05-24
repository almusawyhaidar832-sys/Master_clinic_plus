"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { createClient } from "@/lib/supabase/client";
import { updateClinicProfile } from "@/lib/services/clinic-profile";
import { Building2 } from "lucide-react";

export default function ClinicSettingsPage() {
  const { profile, refresh, loading } = useClinicProfile();
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!profile) return;
    setNameAr(profile.name_ar ?? "");
    setNameEn(profile.name);
    setAddress(profile.address ?? "");
    setPhone(profile.phone ?? "");
    setLogoUrl(profile.logo_url ?? "");
  }, [profile]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const supabase = createClient();
    const result = await updateClinicProfile(supabase, {
      name_ar: nameAr,
      name: nameEn,
      address,
      phone,
      logo_url: logoUrl || null,
    });
    setSaving(false);
    if (result.ok) {
      setMessage({ type: "success", text: "تم حفظ بيانات العيادة — تظهر في التقارير والواتساب" });
      await refresh();
    } else {
      setMessage({ type: "error", text: result.error ?? "تعذر الحفظ" });
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">ملف العيادة</h2>
        <p className="text-slate-muted">
          الاسم والعنوان والشعار يظهران تلقائياً في كل التقارير والرسائل
        </p>
      </div>

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
            title="معاينة الهوية"
            size="sm"
          />
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <CardTitle>بيانات العيادة (متعدد المستأجرين)</CardTitle>
          </div>
        </CardHeader>

        {loading ? (
          <p className="text-sm text-slate-muted">جاري التحميل...</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            {message && (
              <Alert variant={message.type === "success" ? "success" : "error"}>
                {message.text}
              </Alert>
            )}

            <Input
              label="اسم العيادة (عربي) — يظهر في التقارير"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              placeholder="مثال: عيادة الأمل"
              required
            />

            <Input
              label="اسم العيادة (إنجليزي / داخلي)"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
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
            />

            <Input
              label="رابط الشعار (URL)"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              dir="ltr"
              className="text-left"
            />

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? "جاري الحفظ..." : "حفظ ملف العيادة"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
