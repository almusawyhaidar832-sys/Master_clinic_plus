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
import { useLanguage } from "@/contexts/LanguageContext";
import type { Patient } from "@/types";

export default function DoctorPatientsPage() {
  const { t } = useLanguage();
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
      <h2 className="text-lg font-bold text-slate-text">{t("docPatientCareTitle")}</h2>
      <p className="text-xs text-slate-muted">{t("docPatientCareSubtitle")}</p>
      <Input
        label={t("search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("docSearchPatientPlaceholder")}
      />
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-muted">{t("docNoPatientsRegistered")}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Link
              key={p.id}
              href={`/doctor/patients/${p.id}`}
              className="mc-hover-lift flex items-center gap-3 rounded-xl border border-slate-border bg-surface-card p-3.5 shadow-card"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-700 text-sm font-bold text-white shadow-sm">
                {p.full_name_ar.slice(0, 2)}
              </div>
              <div>
                <p className="font-semibold text-slate-text">{p.full_name_ar}</p>
                {p.phone && (
                  <p className="text-sm text-slate-muted" dir="ltr">
                    {p.phone}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
