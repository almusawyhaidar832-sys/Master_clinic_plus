"use client";

import { Card } from "@/components/ui/Card";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";

export default function DoctorProfilePage() {
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-bold text-slate-text">الملف الشخصي</h1>
      <Card className="p-5">
        <ChangePasswordForm backHref="/doctor" backLabel="العودة للرئيسية" />
      </Card>
    </div>
  );
}
