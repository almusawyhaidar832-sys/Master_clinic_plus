"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { SessionClinicalRecord } from "@/components/clinical/SessionClinicalRecord";
import {
  EMPTY_CLINICAL_DRAFT,
  type SessionClinicalDraft,
} from "@/lib/clinical/constants";
import { saveSessionClinicalRecords } from "@/lib/clinical/session-records";
import { hasClinicalData, type OperationClinicalData } from "@/lib/clinical/types";

interface AddSessionClinicalPanelProps {
  operationId: string;
  existing?: OperationClinicalData | null;
  onSaved: () => void;
}

export function AddSessionClinicalPanel({
  operationId,
  existing,
  onSaved,
}: AddSessionClinicalPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SessionClinicalDraft>(EMPTY_CLINICAL_DRAFT);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleSave() {
    const hasNew =
      draft.xrayFiles.length > 0 || Object.keys(draft.teeth).length > 0;
    if (!hasNew) {
      setMessage({ type: "error", text: "أضف صورة أشعة أو حدّد سنّاً على المخطط" });
      return;
    }
    setLoading(true);
    setMessage(null);
    const res = await saveSessionClinicalRecords(operationId, draft);
    setLoading(false);
    if (!res.ok) {
      setMessage({ type: "error", text: res.error ?? "تعذر الحفظ" });
      return;
    }
    setMessage({ type: "success", text: "✓ تم حفظ السجل البصري لهذه الجلسة" });
    setDraft(EMPTY_CLINICAL_DRAFT);
    setOpen(false);
    onSaved();
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 w-full text-teal-800 border-teal-300"
        onClick={() => setOpen(true)}
      >
        {hasClinicalData(existing)
          ? "إضافة أشعة / أسنان لهذه الجلسة"
          : "+ إضافة سجل طبي بصري (أشعة / مخطط أسنان)"}
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
      <SessionClinicalRecord
        value={draft}
        onChange={setDraft}
        disabled={loading}
      />
      {message && <Alert variant={message.type}>{message.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={handleSave} disabled={loading}>
          {loading ? "جاري الحفظ..." : "حفظ على هذه الجلسة"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setDraft(EMPTY_CLINICAL_DRAFT);
            setMessage(null);
          }}
        >
          إلغاء
        </Button>
      </div>
    </div>
  );
}
