"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  getPatientDisplayPhone,
  normalizeOptionalPatientPhone,
  patientPhoneColumns,
  phoneToLocalDisplay,
  sanitizePatientPhoneInput,
} from "@/lib/phone";
import { suggestSpeechName } from "@/lib/queue/arabic-name-pronunciation";
import { Pencil, Save } from "lucide-react";
import type { Patient } from "@/types";

interface PatientBasicInfoEditorProps {
  patient: Patient;
  onSaved: (updates: Pick<Patient, "full_name_ar" | "phone" | "notes" | "speech_name_ar">) => void;
}

export function PatientBasicInfoEditor({
  patient,
  onSaved,
}: PatientBasicInfoEditorProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(patient.full_name_ar);
  const [phone, setPhone] = useState(phoneToLocalDisplay(getPatientDisplayPhone(patient)));
  const [notes, setNotes] = useState(patient.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!editing) {
      setName(patient.full_name_ar);
      setPhone(phoneToLocalDisplay(getPatientDisplayPhone(patient)));
      setNotes(patient.notes ?? "");
    }
  }, [patient, editing]);

  function resetForm() {
    setName(patient.full_name_ar);
    setPhone(phoneToLocalDisplay(getPatientDisplayPhone(patient)));
    setNotes(patient.notes ?? "");
    setError(null);
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaving(false);
      setError("أدخل اسم المراجع");
      return;
    }

    const phoneCheck = normalizeOptionalPatientPhone(phone);
    if (!phoneCheck.ok) {
      setSaving(false);
      setError(phoneCheck.message);
      return;
    }

    const payload: Record<string, unknown> = {
      full_name_ar: trimmedName,
      notes: notes.trim() || null,
    };

    if (phoneCheck.phone) {
      Object.assign(payload, patientPhoneColumns(phoneCheck.phone));
    } else {
      payload.phone = null;
      payload.phone_number = null;
    }

    if (trimmedName !== patient.full_name_ar.trim()) {
      payload.speech_name_ar = suggestSpeechName(trimmedName);
    }

    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from("patients")
      .update(payload)
      .eq("id", patient.id);

    setSaving(false);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setSaved(true);
    setEditing(false);
    onSaved({
      full_name_ar: trimmedName,
      phone: phoneCheck.phone,
      notes: notes.trim() || null,
      speech_name_ar:
        trimmedName !== patient.full_name_ar.trim()
          ? suggestSpeechName(trimmedName)
          : patient.speech_name_ar,
    });
  }

  if (!editing) {
    return (
      <div className="mt-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            resetForm();
            setEditing(true);
          }}
        >
          <Pencil className="h-4 w-4" />
          تعديل الاسم أو الهاتف
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSave}
      className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3"
    >
      <p className="text-sm font-semibold text-slate-text">تعديل بيانات المراجع</p>
      {error && <Alert variant="error">{error}</Alert>}
      {saved && (
        <Alert variant="success">تم حفظ التعديلات</Alert>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-muted">
          اسم المراجع
        </label>
        <input
          type="text"
          className="w-full rounded-lg border border-slate-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-muted">
          رقم هاتف المراجع
        </label>
        <input
          type="tel"
          dir="ltr"
          className="w-full rounded-lg border border-slate-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          value={phone}
          onChange={(e) => setPhone(sanitizePatientPhoneInput(e.target.value))}
          placeholder="07XX XXX XXXX"
        />
        <p className="mt-1 text-xs text-slate-muted">
          يُستخدم لإشعارات الواتساب — صحّح الرقم إذا كان خاطئاً
        </p>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-muted">
          ملاحظات
        </label>
        <input
          type="text"
          className="w-full rounded-lg border border-slate-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          <Save className="h-4 w-4" />
          {saving ? "جارٍ الحفظ..." : "حفظ التعديلات"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => {
            resetForm();
            setEditing(false);
          }}
        >
          إلغاء
        </Button>
      </div>
    </form>
  );
}
