"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, UserCircle2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile } from "@/lib/clinic-context";
import { canRoleChangeOwnPassword } from "@/lib/auth/portal-access";

/** تغيير كلمة المرور للمالك (super_admin) على بوابة المحاسب — المحاسب ممنوع */
export default function OwnerProfilePage() {
  const router = useRouter();
  const { bi } = useLanguage();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    async function check() {
      const supabase = createClient();
      const profile = await getAuthProfile(supabase);
      if (!profile || !canRoleChangeOwnPassword(profile.role)) {
        router.replace("/dashboard");
        return;
      }
      setAllowed(true);
    }
    void check();
  }, [router]);

  if (allowed !== true) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="mc-skeleton h-24 rounded-3xl" />
        <p className="text-center text-sm text-slate-muted">جاري التحقق...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        eyebrow={bi("الحساب", "Account")}
        title="الملف الشخصي"
        icon={UserCircle2}
        className="mb-0"
      />
      <section className="mc-panel">
        <div className="mc-panel-head">
          <h2 className="mc-panel-title">
            <KeyRound />
            {bi("الأمان وكلمة المرور", "Security & password")}
          </h2>
        </div>
        <div className="mc-panel-body">
          <ChangePasswordForm
            backHref="/dashboard"
            backLabel="العودة للوحة التحكم"
          />
        </div>
      </section>
    </div>
  );
}
