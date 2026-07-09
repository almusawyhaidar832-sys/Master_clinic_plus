"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import {
  cacheRecentPatients,
  getCachedRecentPatients,
} from "@/lib/offline-cache";
import { mergeRecentPatients, searchRecentPatients, listRecentPatients } from "@/lib/offline/recent-patients-index";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { createClient } from "@/lib/supabase/client";
import { fetchPatientsForCurrentDoctor } from "@/lib/services/doctor-patients";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Patient } from "@/types";

export default function DoctorPatientsPage() {
  const { t } = useLanguage();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [offlineList, setOfflineList] = useState(false);

  useEffect(() => {
    async function load() {
      if (!navigator.onLine) {
        const doctor = await getDoctorForCurrentUser(createClient());
        const cid = doctor?.clinic_id ?? null;
        setClinicId(cid);
        const fromIndex = cid ? listRecentPatients("doctor", cid, 80) : [];
        const fromLegacy = getCachedRecentPatients<Patient>() ?? [];
        const merged = new Map<string, Patient>();
        for (const p of fromLegacy) merged.set(p.id, p);
        for (const p of fromIndex) {
          if (!merged.has(p.id)) {
            merged.set(p.id, {
              id: p.id,
              full_name_ar: p.full_name_ar,
              phone: p.phone ?? null,
              clinic_id: cid ?? "",
            } as Patient);
          }
        }
        setPatients([...merged.values()]);
        setOfflineList(true);
        setLoading(false);
        return;
      }
      const supabase = createClient();
      const doctor = await getDoctorForCurrentUser(supabase);
      setClinicId(doctor?.clinic_id ?? null);
      setOfflineList(false);
      const list = await fetchPatientsForCurrentDoctor(supabase);
      setPatients(list);
      cacheRecentPatients(list);
      if (doctor?.clinic_id) {
        mergeRecentPatients(
          "doctor",
          doctor.clinic_id,
          list.map((p) => ({
            id: p.id,
            full_name_ar: p.full_name_ar,
            phone: p.phone ?? null,
          }))
        );
      }
      setLoading(false);
    }
    load();
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = (() => {
    if (!q) return patients;
    if (offlineList && clinicId) {
      return searchRecentPatients("doctor", clinicId, q, 80).map(
        (p) =>
          patients.find((row) => row.id === p.id) ??
          ({
            id: p.id,
            full_name_ar: p.full_name_ar,
            phone: p.phone ?? null,
            clinic_id: clinicId,
          } as Patient)
      );
    }
    return patients.filter((p) => p.full_name_ar.toLowerCase().includes(q));
  })();

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-slate-text">{t("docPatientCareTitle")}</h2>
      <p className="text-xs text-slate-muted">{t("docPatientCareSubtitle")}</p>
      {offlineList && (
        <p className="text-xs text-amber-700">{t("offlineModeHint")}</p>
      )}
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
