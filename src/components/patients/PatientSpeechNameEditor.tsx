"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { suggestSpeechName } from "@/lib/queue/arabic-name-pronunciation";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Volume2 } from "lucide-react";
import { announceArabicAsync } from "@/lib/queue/realtime-client";

interface PatientSpeechNameEditorProps {
  patientId: string;
  fullNameAr: string;
  initialSpeechName?: string | null;
}

export function PatientSpeechNameEditor({
  patientId,
  fullNameAr,
  initialSpeechName,
}: PatientSpeechNameEditorProps) {
  const [speechName, setSpeechName] = useState(
    initialSpeechName?.trim() || suggestSpeechName(fullNameAr)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!initialSpeechName?.trim()) {
      setSpeechName(suggestSpeechName(fullNameAr));
    }
  }, [fullNameAr, initialSpeechName]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const trimmed = speechName.trim();
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from("patients")
      .update({ speech_name_ar: trimmed || null })
      .eq("id", patientId);

    setSaving(false);
    if (updateErr) {
      if (updateErr.message.includes("speech_name_ar")) {
        setError("شغّل supabase/scripts/34-patient-speech-name.sql في Supabase");
      } else {
        setError(updateErr.message);
      }
      return;
    }
    setSaved(true);
  }

  return (
    <form
      onSubmit={handleSave}
      className="rounded-lg border border-slate-border bg-surface/60 p-3 space-y-2"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-text">
        <Volume2 className="h-4 w-4 text-primary" />
        نطق الاسم في النداء الصوتي
      </div>
      <p className="text-xs text-slate-muted leading-relaxed">
        اكتب الاسم مشكّلاً كما يُلفظ — مثال: <span dir="rtl">أَحْمَد</span> بدل{" "}
        <span dir="rtl">احمد</span>. يُستخدم في شاشة الانتظار ونداء الطبيب.
      </p>
      {error && <Alert variant="error">{error}</Alert>}
      {saved && (
        <Alert variant="success">تم حفظ نطق الاسم للنداء الصوتي</Alert>
      )}
      <input
        type="text"
        dir="rtl"
        className="w-full rounded-lg border border-slate-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        value={speechName}
        onChange={(e) => setSpeechName(e.target.value)}
        placeholder="أَحْمَد مُحَمَّد"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "جارٍ الحفظ..." : "حفظ النطق"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSpeechName(suggestSpeechName(fullNameAr))}
        >
          اقتراح تلقائي
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void announceArabicAsync(speechName.trim() || fullNameAr)}
        >
          تجربة الصوت
        </Button>
      </div>
    </form>
  );
}
