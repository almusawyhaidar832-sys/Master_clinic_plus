"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import {
  MoreVertical,
  Pencil,
  Trash2,
  RefreshCw,
  ExternalLink,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export type DeveloperClinicRow = {
  id: string;
  name: string;
  name_ar: string | null;
  phone: string | null;
  address?: string | null;
  created_at: string;
  whatsapp_linked: boolean;
  whatsapp_session_id: string | null;
  is_active?: boolean;
  patient_count?: number;
};

type Props = {
  clinics: DeveloperClinicRow[];
  onRefresh: () => void;
  onMessage: (msg: { ok: boolean; text: string }) => void;
};

export function DeveloperClinicsTable({
  clinics,
  onRefresh,
  onMessage,
}: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);

  const [editName, setEditName] = useState("");
  const [editNameAr, setEditNameAr] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");

  function openEdit(c: DeveloperClinicRow) {
    setEditId(c.id);
    setEditName(c.name);
    setEditNameAr(c.name_ar ?? "");
    setEditPhone(c.phone ?? "");
    setEditAddress(c.address ?? "");
    setOpenMenu(null);
  }

  async function saveEdit(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/developer/clinics/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        name_ar: editNameAr || editName,
        phone: editPhone || null,
        address: editAddress || null,
      }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      onMessage({ ok: false, text: data.error ?? "فشل التعديل" });
      return;
    }
    onMessage({ ok: true, text: "تم تحديث بيانات العيادة" });
    setEditId(null);
    onRefresh();
  }

  async function toggleActive(c: DeveloperClinicRow) {
    setBusyId(c.id);
    setOpenMenu(null);
    const res = await fetch(`/api/developer/clinics/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !(c.is_active !== false) }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      onMessage({ ok: false, text: data.error ?? "فشل التحديث" });
      return;
    }
    onMessage({
      ok: true,
      text: c.is_active === false ? "تم تفعيل العيادة" : "تم تعطيل العيادة",
    });
    onRefresh();
  }

  async function resetWhatsapp(id: string) {
    if (
      !confirm(
        "إعادة تهيئة instance الواتساب؟ سيُقطع الربط الحالي ويحتاج مسح QR جديد."
      )
    ) {
      return;
    }
    setBusyId(id);
    setOpenMenu(null);
    const res = await fetch(`/api/developer/clinics/${id}/reset-whatsapp`, {
      method: "POST",
    });
    const data = await res.json();
    setBusyId(null);
    onMessage({
      ok: res.ok && data.ok,
      text: data.message ?? data.error ?? "تمت العملية",
    });
    onRefresh();
  }

  async function confirmDelete(c: DeveloperClinicRow) {
    const label = c.name_ar || c.name;
    if (
      !confirm(
        `حذف عيادة «${label}» نهائياً؟\n\nسيتم حذف المرضى والمواعيد والرسائل وجميع البيانات. لا يمكن التراجع.`
      )
    ) {
      return;
    }
    setBusyId(c.id);
    setDeleteId(null);
    setOpenMenu(null);
    const res = await fetch(`/api/developer/clinics/${c.id}`, {
      method: "DELETE",
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      onMessage({ ok: false, text: data.error ?? "فشل الحذف" });
      return;
    }
    onMessage({ ok: true, text: data.message ?? "تم حذف العيادة" });
    onRefresh();
  }

  async function impersonate(clinicId: string) {
    setEnteringId(clinicId);
    const res = await fetch("/api/developer/enter-clinic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicId, linkProfile: true }),
    });
    const data = await res.json();
    setEnteringId(null);
    if (!res.ok) {
      onMessage({ ok: false, text: data.error ?? "تعذر الدخول" });
      return;
    }
    window.location.href = data.redirect ?? "/dashboard";
  }

  function renderActionMenu(c: DeveloperClinicRow) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenMenu(openMenu === c.id ? null : c.id)}
          className="touch-target rounded-lg border border-slate-600 hover:bg-slate-800"
          aria-label="إجراءات"
        >
          <MoreVertical className="h-5 w-5" />
        </button>
        {openMenu === c.id && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setOpenMenu(null)}
            />
            <ul className="absolute left-0 z-20 mt-1 min-w-[200px] rounded-lg border border-slate-600 bg-slate-800 py-1 shadow-xl">
              <li>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-sm hover:bg-slate-700"
                  onClick={() => openEdit(c)}
                >
                  <Pencil className="h-4 w-4" />
                  تعديل البيانات
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-sm hover:bg-slate-700"
                  onClick={() => void resetWhatsapp(c.id)}
                >
                  <RefreshCw className="h-4 w-4" />
                  إعادة تعيين الربط
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-sm text-red-400 hover:bg-red-950/40"
                  onClick={() => {
                    setDeleteId(c.id);
                    setOpenMenu(null);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  حذف العيادة
                </button>
              </li>
            </ul>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60">
      {/* بطاقات — موبايل */}
      <ul className="divide-y divide-slate-800 md:hidden">
        {clinics.map((c) => (
          <li
            key={c.id}
            className={cn("p-4", c.is_active === false && "opacity-60")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-100">
                  {c.name_ar || c.name}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {format(new Date(c.created_at), "d MMM yyyy", { locale: ar })}
                  {" · "}
                  {c.patient_count ?? 0} مريض
                </p>
                {c.phone && (
                  <p className="text-xs text-slate-500" dir="ltr">
                    {c.phone}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={busyId === c.id}
                onClick={() => void toggleActive(c)}
                className={cn(
                  "relative inline-flex h-8 w-14 shrink-0 rounded-full transition-colors",
                  c.is_active !== false ? "bg-emerald-600" : "bg-slate-600"
                )}
                aria-label={c.is_active !== false ? "تعطيل" : "تفعيل"}
              >
                <span
                  className={cn(
                    "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform",
                    c.is_active !== false ? "right-1" : "right-7"
                  )}
                />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                  c.whatsapp_linked
                    ? "bg-emerald-950/60 text-emerald-400"
                    : "bg-slate-800 text-slate-500"
                )}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                {c.whatsapp_linked ? "واتساب متصل" : "غير مربوط"}
              </span>
              {c.is_active === false && (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                  معطّلة
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={enteringId === c.id || c.is_active === false}
                onClick={() => void impersonate(c.id)}
                className="touch-target min-h-11 flex-1 !bg-primary/90"
              >
                <ExternalLink className="h-4 w-4" />
                {enteringId === c.id ? "..." : "دخول نيابةً"}
              </Button>
              {renderActionMenu(c)}
            </div>
          </li>
        ))}
      </ul>

      {/* جدول — شاشات متوسطة فما فوق */}
      <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm text-right">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-800/80 text-slate-400">
            <th className="px-4 py-3 font-medium">العيادة</th>
            <th className="px-4 py-3 font-medium">تاريخ الإنشاء</th>
            <th className="px-4 py-3 font-medium">المرضى</th>
            <th className="px-4 py-3 font-medium">واتساب</th>
            <th className="px-4 py-3 font-medium">الحالة</th>
            <th className="px-4 py-3 font-medium">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {clinics.map((c) => (
            <tr
              key={c.id}
              className={cn(
                "border-b border-slate-800/80 hover:bg-slate-800/40",
                c.is_active === false && "opacity-60"
              )}
            >
              <td className="px-4 py-3">
                <p className="font-bold text-slate-100">
                  {c.name_ar || c.name}
                </p>
                <p className="text-[10px] text-slate-600" dir="ltr" title={c.id}>
                  {c.id.slice(0, 8)}…
                </p>
                {c.phone && (
                  <p className="text-xs text-slate-500" dir="ltr">
                    {c.phone}
                  </p>
                )}
              </td>
              <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                {format(new Date(c.created_at), "d MMM yyyy", { locale: ar })}
              </td>
              <td className="px-4 py-3 text-slate-300">
                {c.patient_count ?? 0}
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    c.whatsapp_linked
                      ? "bg-emerald-950/60 text-emerald-400"
                      : "bg-slate-800 text-slate-500"
                  )}
                >
                  <MessageCircle className="h-3 w-3" />
                  {c.whatsapp_linked ? "متصل" : "غير مربوط"}
                </span>
              </td>
              <td className="px-4 py-3">
                <button
                  type="button"
                  disabled={busyId === c.id}
                  onClick={() => void toggleActive(c)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors",
                    c.is_active !== false ? "bg-emerald-600" : "bg-slate-600"
                  )}
                  title={c.is_active !== false ? "تعطيل" : "تفعيل"}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                      c.is_active !== false ? "right-0.5" : "right-[1.35rem]"
                    )}
                  />
                </button>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={enteringId === c.id || c.is_active === false}
                    onClick={() => void impersonate(c.id)}
                    className="!bg-primary/90 text-xs"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {enteringId === c.id ? "..." : "دخول نيابةً"}
                  </Button>

                  {renderActionMenu(c)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-600 bg-slate-900 p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold text-amber-400">
              تعديل العيادة
            </h3>
            <div className="space-y-3">
              <input
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                placeholder="الاسم (EN)"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                placeholder="الاسم (عربي)"
                value={editNameAr}
                onChange={(e) => setEditNameAr(e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                placeholder="الهاتف"
                dir="ltr"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                placeholder="العنوان"
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
              />
            </div>
            <div className="mt-6 flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditId(null)}
                className="border-slate-600 text-slate-300"
              >
                إلغاء
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busyId === editId}
                onClick={() => void saveEdit(editId)}
              >
                {busyId === editId ? "..." : "حفظ"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-red-900/50 bg-slate-900 p-6">
            <h3 className="text-lg font-bold text-red-400">تأكيد الحذف</h3>
            <p className="mt-2 text-sm text-slate-400">
              سيتم حذف العيادة وجميع المرضى والسجلات المرتبطة. لا يمكن التراجع.
            </p>
            <div className="mt-6 flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteId(null)}
                className="border-slate-600 text-slate-300"
              >
                إلغاء
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={busyId === deleteId}
                onClick={() => {
                  const c = clinics.find((x) => x.id === deleteId);
                  if (c) void confirmDelete(c);
                }}
              >
                {busyId === deleteId ? "جاري الحذف..." : "حذف نهائي"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
