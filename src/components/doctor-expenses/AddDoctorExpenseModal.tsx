"use client";

import { useState } from "react";
import { X, Upload, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { authPortalHeaders } from "@/lib/auth/api-portal";
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

const BUCKET = "doctor-expense-invoices";
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

    setSaving(true);
    const supabase = createClient();

    let storagePath: string | null = null;
    let fileName: string | null = null;
    let mimeType: string | null = null;

    try {
      if (file && file.size > 0) {
        if (file.size > MAX_BYTES) {
          setError("حجم الملف أكبر من 10 ميجابايت");
          setSaving(false);
          return;
        }
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        storagePath = `${clinicId}/${doctorId}/${crypto.randomUUID()}.${ext}`;
        fileName = file.name;
        mimeType = file.type || null;

        const { error: uploadErr } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, file, {
            contentType: file.type || "image/jpeg",
            upsert: false,
          });

        if (uploadErr) {
          setError(
            uploadErr.message.includes("Bucket not found")
              ? "أنشئ bucket باسم doctor-expense-invoices في Storage"
              : uploadErr.message
          );
          setSaving(false);
          return;
        }
      }

      const res = await fetch("/api/doctor-expenses", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders("accountant"),
        },
        body: JSON.stringify({
          doctor_id: doctorId,
          amount: amt,
          percentage_split: split,
          description_ar: description.trim() || null,
          invoice_storage_path: storagePath,
          invoice_file_name: fileName,
          invoice_mime_type: mimeType,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (storagePath) {
          await supabase.storage.from(BUCKET).remove([storagePath]);
        }
        setError((json as { error?: string }).error ?? "تعذر حفظ الفاتورة");
        setSaving(false);
        return;
      }

      notifyClinicProfitRefresh();
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">إضافة فاتورة صرفية</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">الطبيب</label>
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name_ar}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">المبلغ (د.ع)</label>
            <input
              type="number"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              dir="ltr"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
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
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
            />
            {Number(amount) > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                على الطبيب: {doctorShare.toLocaleString("en-US")} د.ع ·
                على العيادة: {clinicShare.toLocaleString("en-US")} د.ع
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">وصف / ملاحظة</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">صورة الفاتورة</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <Upload className="h-4 w-4 text-slate-400" />
              {file ? file.name : "رفع صورة أو PDF"}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              حفظ الفاتورة
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
