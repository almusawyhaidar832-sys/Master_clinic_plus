import Link from "next/link";
import { doctorQuickActions } from "@/components/layout/DoctorMobileShell";
import { cn } from "@/lib/utils";

export default function DoctorHomePage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-muted">اختر مهمة — يعمل بدون متجر تطبيقات</p>
      <div className="grid gap-3">
        {doctorQuickActions.map(({ href, label, icon: Icon, desc }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-4 rounded-xl border border-slate-border bg-surface-card p-4 shadow-card transition-shadow active:scale-[0.98]"
            )}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold text-slate-text">{label}</p>
              <p className="text-xs text-slate-muted">{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
