"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, MessageCircle, Users, ExternalLink } from "lucide-react";

type ClinicDetail = {
  id: string;
  name: string;
  name_ar: string | null;
  phone: string | null;
  address: string | null;
  whatsapp_linked: boolean;
  whatsapp_session_id: string | null;
};

export default function DeveloperClinicDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [clinic, setClinic] = useState<ClinicDetail | null>(null);
  const [patientCount, setPatientCount] = useState(0);
  const [staff, setStaff] = useState<
    { id: string; full_name: string | null; username: string | null; role: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [entering, setEntering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/developer/clinics/${id}`);
    if (res.status === 401) {
      router.replace("/developer/login");
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error);
      setLoading(false);
      return;
    }
    setClinic(data.clinic);
    setPatientCount(data.patientCount ?? 0);
    setStaff(data.staff ?? []);
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function provisionEvolution() {
    setProvisioning(true);
    setMsg(null);
    const res = await fetch(`/api/developer/clinics/${id}/evolution`, {
      method: "POST",
    });
    const data = await res.json();
    setProvisioning(false);
    setMsg(data.message ?? data.error);
    void load();
  }

  async function enterDashboard() {
    setEntering(true);
    const res = await fetch("/api/developer/enter-clinic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicId: id, linkProfile: true }),
    });
    const data = await res.json();
    setEntering(false);
    if (!res.ok) {
      setMsg(data.error);
      return;
    }
    window.location.href = "/dashboard/whatsapp";
  }

  if (loading) {
    return <p className="p-8 text-slate-400">جاري التحميل...</p>;
  }

  if (!clinic) {
    return (
      <div className="p-8">
        <p className="text-red-400">{msg ?? "العيادة غير موجودة"}</p>
        <Link href="/developer" className="mt-4 inline-block text-amber-400">
          العودة
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link
        href="/developer"
        className="mb-6 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
      >
        <ArrowRight className="h-4 w-4" />
        كل العيادات
      </Link>

      <h1 className="text-2xl font-bold text-amber-400">
        {clinic.name_ar || clinic.name}
      </h1>
      <p className="text-xs text-slate-500 mt-1" dir="ltr">
        {clinic.id}
      </p>

      {msg && (
        <p className="mt-4 rounded-lg bg-slate-800 px-3 py-2 text-sm">{msg}</p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-700 p-4">
          <Users className="h-5 w-5 text-slate-400 mb-2" />
          <p className="text-2xl font-bold">{patientCount}</p>
          <p className="text-xs text-slate-500">مريض</p>
        </div>
        <div className="rounded-xl border border-slate-700 p-4">
          <MessageCircle className="h-5 w-5 text-slate-400 mb-2" />
          <p className="text-sm font-mono" dir="ltr">
            {clinic.whatsapp_session_id ?? "—"}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {clinic.whatsapp_linked ? "متصل" : "غير مربوط"}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void provisionEvolution()}
          disabled={provisioning}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold hover:bg-emerald-600 disabled:opacity-60"
        >
          {provisioning ? "..." : "إنشاء/تجهيز Evolution Instance"}
        </button>
        <button
          type="button"
          onClick={() => void enterDashboard()}
          disabled={entering}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          <ExternalLink className="h-4 w-4" />
          {entering ? "..." : "ربط واتساب + لوحة العيادة"}
        </button>
      </div>

      <section className="mt-8">
        <h2 className="font-bold mb-3">الطاقم</h2>
        <ul className="space-y-2 text-sm">
          {staff.map((s) => (
            <li
              key={s.id}
              className="flex justify-between rounded-lg border border-slate-700 px-3 py-2"
            >
              <span>{s.full_name ?? "—"}</span>
              <span className="text-slate-500">
                {s.username} · {s.role}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-8 text-xs text-slate-600">
        مفاتيح Evolution مشتركة من متغيرات السيرفر — كل عيادة لها instance
        منفصل محفوظ في whatsapp_session_id.
      </p>
    </div>
  );
}
