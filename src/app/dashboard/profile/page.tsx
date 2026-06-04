"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile } from "@/lib/clinic-context";
import { canRoleChangeOwnPassword } from "@/lib/auth/portal-access";

/** تغيير كلمة المرور للمالك (super_admin) على بوابة المحاسب — المحاسب ممنوع */
export default function OwnerProfilePage() {
  const router = useRouter();
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
    return <p className="text-slate-muted">جاري التحقق...</p>;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>الملف الشخصي</CardTitle>
        </CardHeader>
        <div className="px-5 pb-5">
          <ChangePasswordForm
            backHref="/dashboard"
            backLabel="العودة للوحة التحكم"
          />
        </div>
      </Card>
    </div>
  );
}
