"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { usePatientSearch } from "@/hooks/usePatientSearch";
import {
  PATIENT_SEARCH_MIN_LENGTH,
  type PatientSearchResult,
  type PatientSearchScope,
} from "@/lib/services/patient-search";
import { getPatientDisplayPhone } from "@/lib/phone";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { cn } from "@/lib/utils";

interface PatientSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (patient: PatientSearchResult) => void;
  portal: AuthPortalId;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  showIcon?: boolean;
  autoFocus?: boolean;
  required?: boolean;
  /** Hide dropdown when a patient is already chosen */
  selectedPatientId?: string | null;
  /** clinic = كل العيادة؛ doctor = مراجعو طبيب محدد فقط */
  searchScope?: PatientSearchScope;
  /** فلترة مراجعي طبيب معيّن (للمحاسب عند اختيار الطبيب) */
  doctorId?: string | null;
  clinicId?: string | null;
}

export function PatientSearchField({
  value,
  onChange,
  onSelect,
  portal,
  placeholder = "اكتب اسم المراجع...",
  disabled = false,
  className,
  inputClassName,
  showIcon = true,
  autoFocus = false,
  required = false,
  selectedPatientId = null,
  searchScope,
  doctorId = null,
  clinicId = null,
}: PatientSearchFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const enabled = !disabled && !selectedPatientId;
  const { results, loading, error } = usePatientSearch(value, {
    portal,
    enabled,
    scope: searchScope,
    doctorId,
    clinicId,
  });

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    if (value.trim().length >= PATIENT_SEARCH_MIN_LENGTH && results.length > 0) {
      setOpen(true);
    } else if (value.trim().length < PATIENT_SEARCH_MIN_LENGTH) {
      setOpen(false);
    }
  }, [value, results.length, enabled]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {showIcon && (
        <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-premium-500" />
      )}
      <input
        type="search"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        required={required}
        onChange={(e) => {
          onChange(e.target.value);
          if (e.target.value.trim().length >= PATIENT_SEARCH_MIN_LENGTH) {
            setOpen(true);
          }
        }}
        onFocus={() => {
          if (results.length > 0 && value.trim().length >= PATIENT_SEARCH_MIN_LENGTH) {
            setOpen(true);
          }
        }}
        placeholder={placeholder}
        className={cn(
          "mc-field disabled:cursor-not-allowed disabled:opacity-60",
          showIcon && "ps-10",
          inputClassName
        )}
      />

      {loading && value.trim().length >= PATIENT_SEARCH_MIN_LENGTH && (
        <p className="mt-1 text-xs text-slate-muted">جاري البحث...</p>
      )}

      {error && (
        <p className="mt-1 text-xs text-debt-text">{error}</p>
      )}

      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1.5 max-h-64 w-full overflow-y-auto rounded-2xl border border-slate-border bg-surface-card p-1.5 shadow-premium animate-fade-in">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3.5 py-2.5 text-start text-sm transition-colors hover:bg-primary-50 dark:hover:bg-primary-900/30"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(p);
                setOpen(false);
              }}
            >
              <span className="flex w-full flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-text">{p.full_name_ar}</span>
                {getPatientDisplayPhone(p) && (
                  <span className="text-xs text-slate-muted tabular-nums" dir="ltr">
                    {getPatientDisplayPhone(p)}
                  </span>
                )}
              </span>
              {p.primary_doctor_name && (
                <span className="text-xs font-medium text-premium-600">
                  {formatDoctorDisplayName(p.primary_doctor_name)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {open &&
        !loading &&
        !error &&
        value.trim().length >= PATIENT_SEARCH_MIN_LENGTH &&
        results.length === 0 && (
          <div className="absolute z-50 mt-1.5 w-full rounded-2xl border border-slate-border bg-surface-card px-4 py-3 text-center text-sm text-slate-muted shadow-premium">
            لا يوجد مراجع بهذا الاسم
          </div>
        )}
    </div>
  );
}
