"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { getActiveClinicId } from "@/lib/clinic-context";
import {
  getPatientDisplayPhone,
  patientPhoneColumns,
  sanitizePatientPhoneInput,
  validatePatientPhone,
} from "@/lib/phone";
import { suggestSpeechName } from "@/lib/queue/arabic-name-pronunciation";
import {
  ADD_PATIENT_DRAFT_KEY,
  hasAddPatientDraftContent,
  type AddPatientFormDraft,
} from "@/lib/forms/portal-form-drafts";
import { useSessionFormDraft } from "@/hooks/useSessionFormDraft";
import { tryEnqueueAddPatientOffline } from "@/lib/offline/add-patient/enqueue";
import { getCachedOfflineReference } from "@/lib/offline/reference-cache";
import { isNetworkFailure } from "@/lib/offline/network";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import type { PatientSearchResult } from "@/lib/services/patient-search";
import { UserPlus } from "lucide-react";

export function AddPatientForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const applyDraft = useCallback((draft: AddPatientFormDraft) => {
    setName(draft.name);
    setPhone(draft.phone);
    setNotes(draft.notes);
  }, []);

  const draftSnapshot = useMemo(
    () => ({ name, phone, notes }),
    [name, phone, notes]
  );

  const { draftRestored, dismissDraftNotice, clearDraft } = useSessionFormDraft(
    ADD_PATIENT_DRAFT_KEY,
    draftSnapshot,
    applyDraft,
    { hasContent: hasAddPatientDraftContent }
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (selectedPatientId) {
      router.push(`/dashboard/patients/${selectedPatientId}`);
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("أدخل اسم المراجع");
      return;
    }

    const phoneCheck = validatePatientPhone(phone);
    if (!phoneCheck.ok) {
      setError(phoneCheck.message);
      return;
    }

    setLoading(true);

    const offlineInput = {
      clinicId: getCachedOfflineReference()?.clinicId ?? null,
      name: trimmedName,
      phone,
      notes,
    };

    const offlineAttempt = await tryEnqueueAddPatientOffline(offlineInput);
    if (offlineAttempt.handled) {
      setLoading(false);
      if (offlineAttempt.ok) {
        setSuccess(offlineAttempt.message);
        clearDraft();
        setName("");
        setPhone("");
        setNotes("");
      } else {
        setError(offlineAttempt.message);
      }
      return;
    }

    try {
    const supabase = createClient();
    const activeClinic = await getActiveClinicId(supabase);
    if (!activeClinic) {
      setError("لا توجد عيادة نشطة");
      setLoading(false);
      return;
    }

    const { data, error: insertErr } = await supabase
      .from("patients")
      .insert({
        full_name_ar: trimmedName,
        speech_name_ar: suggestSpeechName(trimmedName),
        clinic_id: activeClinic.clinicId,
        notes: notes.trim() || null,
        ...patientPhoneColumns(phoneCheck.normalized),
      })
      .select("id")
      .single();

    if (insertErr || !data) {
      const msg = insertErr?.message ?? "";
      if (msg.includes("phone_number")) {
        setError(
          "عمود phone_number غير موجود — شغّل supabase/scripts/fix-patient-phone-number.sql في Supabase"
        );
      } else if (msg.includes("speech_name_ar")) {
        const retry = await supabase
          .from("patients")
          .insert({
            full_name_ar: trimmedName,
            clinic_id: activeClinic.clinicId,
            notes: notes.trim() || null,
            ...patientPhoneColumns(phoneCheck.normalized),
          })
          .select("id")
          .single();
        if (retry.error || !retry.data) {
          setError(retry.error?.message ?? "تعذر حفظ المراجع");
          return;
        }
        clearDraft();
        router.push(`/dashboard/patients/${retry.data.id}`);
        return;
      } else {
        const fallback = await tryEnqueueAddPatientOffline(offlineInput, {
          force: true,
        });
        if (fallback.handled && fallback.ok) {
          setSuccess(fallback.message);
          clearDraft();
          setName("");
          setPhone("");
          setNotes("");
          return;
        }
        setError(insertErr?.message ?? "تعذر حفظ المراجع");
      }
      return;
    }

    clearDraft();
    router.push(`/dashboard/patients/${data.id}`);
    } catch (err) {
      const fallback = await tryEnqueueAddPatientOffline(offlineInput, {
        force: isNetworkFailure(err),
      });
      if (fallback.handled && fallback.ok) {
        setSuccess(fallback.message);
        clearDraft();
        setName("");
        setPhone("");
        setNotes("");
      } else {
        setError(
          err instanceof Error ? err.message : "تعذر حفظ المراجع — تحقق من الاتصال"
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-text">
        <UserPlus className="h-5 w-5 text-primary" />
        إضافة مراجع جديد
      </h3>
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
        {draftRestored && (
          <div className="sm:col-span-2">
            <Alert variant="info">
              تم استعادة بيانات المراجع التي كتبتها.
              <button
                type="button"
                className="mr-2 underline"
                onClick={dismissDraftNotice}
              >
                إخفاء
              </button>
            </Alert>
          </div>
        )}
        {error && (
          <div className="sm:col-span-2">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        {success && (
          <div className="sm:col-span-2">
            <Alert variant="success">{success}</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-text">
            اسم المراجع
          </label>
          <PatientSearchField
            portal="accountant"
            value={name}
            selectedPatientId={selectedPatientId}
            searchScope="clinic"
            placeholder="اكتب حرفين — تظهر الأسماء مع الطبيب السابق"
            onChange={(value) => {
              setName(value);
              setSelectedPatientId(null);
            }}
            onSelect={(patient: PatientSearchResult) => {
              setSelectedPatientId(patient.id);
              setName(patient.full_name_ar);
              setPhone(getPatientDisplayPhone(patient) ?? "");
            }}
          />
          <p className="mt-1 text-xs text-slate-muted">
            اكتب حرفين على الأقل — إن كان المراجع موجوداً اختره من القائمة
          </p>
          {selectedPatientId && (
            <Alert variant="info" className="mt-2">
              هذا المراجع مسجّل مسبقاً —{" "}
              <Link
                href={`/dashboard/patients/${selectedPatientId}`}
                className="font-semibold underline"
              >
                افتح ملفه
              </Link>{" "}
              أو عدّل اسمه/هاتفه من هناك.
            </Alert>
          )}
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-text">
            رقم هاتف المراجع
          </label>
          <input
            type="tel"
            dir="ltr"
            className="w-full rounded-lg border border-slate-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            value={phone}
            onChange={(e) => setPhone(sanitizePatientPhoneInput(e.target.value))}
            placeholder="07XX XXX XXXX أو +964..."
            required={!selectedPatientId}
            disabled={!!selectedPatientId}
          />
          <p className="mt-1 text-xs text-slate-muted">
            يُحفظ تلقائياً بصيغة +964 — يُستخدم لإشعارات الواتساب
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-text">
            ملاحظات (اختياري)
          </label>
          <input
            type="text"
            className="w-full rounded-lg border border-slate-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={loading}>
            {loading
              ? "جاري الحفظ..."
              : selectedPatientId
                ? "فتح ملف المراجع"
                : "حفظ المراجع"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
