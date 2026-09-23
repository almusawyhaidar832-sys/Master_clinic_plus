"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Search, Users, WifiOff } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
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
  const { t, bi } = useLanguage();
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
    <div className="space-y-5">
      <PageHeader
        title={t("docPatientCareTitle")}
        subtitle={t("docPatientCareSubtitle")}
        eyebrow={bi("بوابة الطبيب", "Doctor portal")}
        icon={Users}
      />
      {offlineList && (
        <p className="flex items-center gap-2 rounded-xl border border-warning-border bg-warning px-3 py-2 text-xs font-medium text-warning-text">
          <WifiOff className="h-4 w-4 shrink-0" />
          {t("offlineModeHint")}
        </p>
      )}
      <div>
        <label className="mc-label mb-1.5 block">{t("search")}</label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-2.5">
            <span className="mc-icon-tile h-9 w-9 rounded-xl">
              <Search className="h-4 w-4" />
            </span>
          </span>
          <input
            type="text"
            className="mc-field h-14 rounded-2xl ps-14 pe-4 text-base"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("docSearchPatientPlaceholder")}
            autoComplete="off"
          />
        </div>
      </div>
      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="mc-skeleton h-[72px] rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} message={t("docNoPatientsRegistered")} className="rounded-2xl" />
      ) : (
        <div className="space-y-2.5 animate-fade-in">
          {filtered.map((p) => (
            <Link
              key={p.id}
              href={`/doctor/patients/${p.id}`}
              className="group mc-list-row mc-press"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-mc-pearl text-sm font-bold text-[#0b1f3a] shadow-gold ring-1 ring-inset ring-premium-300/60">
                {p.full_name_ar.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-slate-text">{p.full_name_ar}</p>
                {p.phone && (
                  <p className="mt-0.5 text-xs text-slate-muted tabular-nums" dir="ltr">
                    {p.phone}
                  </p>
                )}
              </div>
              <ChevronLeft className="h-5 w-5 shrink-0 text-slate-muted transition-colors group-hover:text-premium-500 ltr:rotate-180" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
