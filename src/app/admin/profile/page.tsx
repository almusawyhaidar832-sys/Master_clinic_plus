"use client";

import { Card } from "@/components/ui/Card";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";

export default function AdminProfilePage() {
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-bold text-slate-text">الملف الشخصي</h1>
      <p className="text-sm text-slate-muted">مدير العيادة — تغيير كلمة مرور حسابك</p>
      <Card className="p-5">
        <ChangePasswordForm backHref="/admin" backLabel="العودة للرئيسية" />
      </Card>
    </div>
  );
}
