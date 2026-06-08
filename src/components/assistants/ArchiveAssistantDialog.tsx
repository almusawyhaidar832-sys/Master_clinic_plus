"use client";

import { useState } from "react";
import { Archive, RefreshCw, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface ArchiveAssistantDialogProps {
  assistant: {
    id: string;
    profile_id: string | null;
    full_name_ar: string;
  };
  onClose: () => void;
  onArchived: () => void;
}

export function ArchiveAssistantDialog({
  assistant,
  onClose,
  onArchived,
}: ArchiveAssistantDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleArchive() {
    setSaving(true);
    setError("");
    const supabase = createClient();

    if (assistant.profile_id) {
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ is_active: false })
        .eq("id", assistant.profile_id);
      if (profileErr) {
        setSaving(false);
        setError(profileErr.message);
        return;
      }
    }

    const { error: asstErr } = await supabase
      .from("assistants")
      .update({ is_active: false })
      .eq("id", assistant.id);

    setSaving(false);
    if (asstErr) {
      setError(asstErr.message);
      return;
    }

    onArchived();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">أرشفة مساعد</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-600">
          أرشفة <strong>{assistant.full_name_ar}</strong>؟ لن يظهر في توليد رواتب
          الأشهر القادمة. سجلات الرواتب السابقة تبقى محفوظة في التاريخ.
        </p>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium hover:bg-slate-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleArchive}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {saving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            أرشفة
          </button>
        </div>
      </div>
    </div>
  );
}
