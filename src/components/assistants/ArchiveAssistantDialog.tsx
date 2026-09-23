"use client";

import { useState } from "react";
import { Archive, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
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
    <Modal
      onClose={onClose}
      title="أرشفة مساعد"
      icon={Archive}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="mc-btn-soft flex-1 py-2.5"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleArchive}
            disabled={saving}
            className="mc-btn-navy flex-1 py-2.5"
          >
            {saving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            أرشفة
          </button>
        </>
      }
    >
        <p className="rounded-2xl border border-warning-border bg-warning px-4 py-3 text-sm leading-relaxed text-warning-text">
          أرشفة <strong>{assistant.full_name_ar}</strong>؟ لن يظهر في توليد رواتب
          الأشهر القادمة. سجلات الرواتب السابقة تبقى محفوظة في التاريخ.
        </p>

        {error && (
          <p className="mt-3 rounded-xl border border-debt-border bg-debt px-3 py-2 text-sm text-debt-text">
            {error}
          </p>
        )}
    </Modal>
  );
}
