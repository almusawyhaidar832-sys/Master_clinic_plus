"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import {
  cacheRecentPatients,
  getCachedRecentPatients,
} from "@/lib/offline-cache";
import { createClient } from "@/lib/supabase/client";
import { fetchPatientsForCurrentDoctor } from "@/lib/services/doctor-patients";
import type { Patient } from "@/types";

export default function DoctorPatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!navigator.onLine) {
        setPatients(getCachedRecentPatients<Patient>() || []);
        setLoading(false);
        return;
      }
      const supabase = createClient();
      const list = await fetchPatientsForCurrentDoctor(supabase);
      setPatients(list);
      cacheRecentPatients(list);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = patients.filter((p) =>
    p.full_name_ar.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-text">رعاية المرضى</h2>
      <p className="text-xs text-slate-muted">
        مراجعوك فقط — حسب الجلسات والحالات المسجّلة باسمك
      </p>
      <Input
        label="بحث"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="اسم المريض..."
      />
      {loading ? (
        <p className="text-sm text-slate-muted">جاري التحميل...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-muted">لا يوجد مراجعون مسجّلون لك</p>
      ) : (
        filtered.map((p) => (
          <Link
            key={p.id}
            href={`/doctor/patients/${p.id}`}
            className="block rounded-xl border border-slate-border bg-surface-card p-4 shadow-card"
          >
            <p className="font-semibold text-slate-text">{p.full_name_ar}</p>
            {p.phone && (
              <p className="text-sm text-slate-muted" dir="ltr">
                {p.phone}
              </p>
            )}
          </Link>
        ))
      )}
    </div>
  );
}
