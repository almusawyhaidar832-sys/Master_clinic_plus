import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { cn } from "@/lib/utils";

interface DoctorAttributionProps {
  doctorName: string | null | undefined;
  label?: string;
  className?: string;
  variant?: "inline" | "badge" | "block";
}

export function DoctorAttribution({
  doctorName,
  label = "الطبيب المعالج",
  className,
  variant = "inline",
}: DoctorAttributionProps) {
  const formatted = formatDoctorDisplayName(doctorName);
  if (formatted === "—") return null;

  if (variant === "badge") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary",
          className
        )}
      >
        {formatted}
      </span>
    );
  }

  if (variant === "block") {
    return (
      <p className={cn("text-sm text-slate-text", className)}>
        <span className="text-slate-muted">{label}: </span>
        <strong>{formatted}</strong>
      </p>
    );
  }

  return (
    <span className={cn("text-slate-muted", className)}>
      {label}: <strong className="text-slate-text">{formatted}</strong>
    </span>
  );
}
