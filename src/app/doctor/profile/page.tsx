"use client";

import { Card } from "@/components/ui/Card";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { useLanguage } from "@/contexts/LanguageContext";

export default function DoctorProfilePage() {
  const { t } = useLanguage();

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-bold text-slate-text">{t("docProfilePageTitle")}</h1>
      <Card className="p-5">
        <ChangePasswordForm backHref="/doctor" backLabel={t("docBackHome")} />
      </Card>
    </div>
  );
}
