"use client";

import { useState } from "react";
import { Upload, RefreshCw, Receipt } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { notifyFinancialMutation } from "@/lib/sync/mutation-notify";
import { notifyClinicProfitRefresh } from "@/lib/services/clinic-profit";

interface DoctorOption {
  id: string;
  full_name_ar: string;
}

interface AddDoctorExpenseModalProps {
  clinicId: string;
  doctors: DoctorOption[];
  onClose: () => void;
  onSaved: () => void;
}

const MAX_BYTES = 10 * 1024 * 1024;

export function AddDoctorExpenseModal({
  clinicId,
  doctors,
  onClose,
  onSaved,
}: AddDoctorExpenseModalProps) {
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [percentageSplit, setPercentageSplit] = useState("50");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const amt = Number(amount);
    const split = Number(percentageSplit);
    if (!doctorId) {
      setError("اختر الطبيب");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("المبلغ غير صالح");
      return;
    }
    if (!Number.isFinite(split) || split < 0 || split > 100) {
      setError("نسبة تحمل الطبيب بين 0 و 100");
      return;
    }

    if (file && file.size > MAX_BYTES) {
      setError("حجم الملف أكبر من 10 ميجابايت");
      return;
    }

    setSaving(true);

    try {
      const form = new FormData();
      form.append("doctor_id", doctorId);
      form.append("amount", String(amt));
      form.append("percentage_split", String(split));
      if (description.trim()) {
        form.append("description_ar", description.trim());
      }
      if (file && file.size > 0) {
        form.append("file", file);
      }

      const res = await fetch("/api/doctor-expenses", {
        method: "POST",
        credentials: "include",
        headers: authPortalHeaders("accountant"),
        body: form,
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError((json as { error?: string }).error ?? "تعذر حفظ الفاتورة");
        setSaving(false);
        return;
      }

      notifyClinicProfitRefresh(clinicId);
      notifyFinancialMutation({ clinicId, doctorId });
      onSaved();
      onClose();
    } catch {
      setError("خطأ غير متوقع");
    } finally {
      setSaving(false);
    }
  }

  const split = Number(percentageSplit) || 0;
  const doctorShare = (Number(amount) || 0) * (split / 100);
  const clinicShare = (Number(amount) || 0) - doctorShare;

  return (
    <Modal
      onClose={onClose}
      title="إضافة فاتورة صرفية"
      icon={Receipt}
      size="lg"
      closeOnBackdrop={false}
    >
      {error && (
        <p className="mb-4 rounded-xl border border-debt-border bg-debt px-3.5 py-2.5 text-sm text-debt-text">{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mc-label mb-1.5">الطبيب</label>
          <select
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            required
            className="mc-field"
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name_ar}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mc-label mb-1.5">المبلغ (د.ع)</label>
            <input
              type="number"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              dir="ltr"
              className="mc-field font-semibold tabular-nums"
            />
          </div>

          <div>
            <label className="mc-label mb-1.5">
              نسبة تحمل الطبيب (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={percentageSplit}
              onChange={(e) => setPercentageSplit(e.target.value)}
              required
              dir="ltr"
              className="mc-field font-semibold tabular-nums"
            />
          </div>
        </div>
        {Number(amount) > 0 && (
          <p className="rounded-xl border border-slate-border bg-surface px-3.5 py-2.5 text-xs tabular-nums text-slate-muted">
            على الطبيب: <strong className="text-debt-text">{doctorShare.toLocaleString("en-US")} د.ع</strong> ·
            على العيادة: <strong className="text-slate-text">{clinicShare.toLocaleString("en-US")} د.ع</strong>
          </p>
        )}

        <div>
          <label className="mc-label mb-1.5">وصف / ملاحظة</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mc-field"
          />
        </div>

        <div>
          <label className="mc-label mb-1.5">صورة الفاتورة</label>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-border bg-surface px-4 py-3.5 text-sm text-slate-text transition-colors hover:border-premium-300">
            <span className="mc-kpi__icon mc-tone-gold h-9 w-9">
              <Upload className="h-4 w-4" />
            </span>
            {file ? file.name : "رفع صورة أو PDF"}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <div className="flex gap-2 border-t border-slate-border pt-4">
          <button
            type="submit"
            disabled={saving}
            className="mc-btn-navy flex-1 py-3"
          >
            {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
            حفظ الفاتورة
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mc-btn-soft px-5 py-3"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
}
