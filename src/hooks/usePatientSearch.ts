"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import {
  PATIENT_SEARCH_DEBOUNCE_MS,
  PATIENT_SEARCH_MIN_LENGTH,
  searchPatientsViaApi,
  type PatientSearchResult,
  type PatientSearchScope,
} from "@/lib/services/patient-search";
import { isBrowserOffline } from "@/lib/offline/network";
import {
  mergeRecentPatients,
  searchRecentPatients,
} from "@/lib/offline/recent-patients-index";
import type { PatientProfilePortal } from "@/lib/offline/patient-profile-cache";

export function usePatientSearch(
  query: string,
  opts: {
    portal: AuthPortalId;
    enabled?: boolean;
    limit?: number;
    debounceMs?: number;
    minLength?: number;
    scope?: PatientSearchScope;
    doctorId?: string | null;
    clinicId?: string | null;
    offlinePortal?: PatientProfilePortal;
  }
) {
  const {
    portal,
    enabled = true,
    limit = 12,
    debounceMs = PATIENT_SEARCH_DEBOUNCE_MS,
    minLength = PATIENT_SEARCH_MIN_LENGTH,
    scope,
    doctorId,
    clinicId,
    offlinePortal,
  } = opts;

  const [results, setResults] = useState<PatientSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < minLength) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);

      const offlinePortalResolved =
        offlinePortal ?? (portal === "doctor" ? "doctor" : portal === "accountant" || portal === "admin" ? "accountant" : null);

      if (isBrowserOffline()) {
        if (!clinicId || !offlinePortalResolved) {
          setResults([]);
          setError("لا يوجد اتصال — افتح ملفات المرضى مرة مع النت أولاً.");
          setLoading(false);
          return;
        }

        const recent = searchRecentPatients(
          offlinePortalResolved,
          clinicId,
          trimmed,
          limit
        );
        const patients: PatientSearchResult[] = recent.map((p) => ({
          id: p.id,
          clinic_id: clinicId,
          full_name_ar: p.full_name_ar,
          phone: p.phone ?? null,
          notes: null,
        }));
        if (id !== requestId.current) return;
        setResults(patients);
        setError(patients.length === 0 ? "لا توجد نتائج محفوظة لهذا البحث." : null);
        setLoading(false);
        return;
      }

      const { patients, error: searchError } = await searchPatientsViaApi(
        trimmed,
        {
          portal,
          limit,
          minLength,
          scope,
          doctorId,
          signal: controller.signal,
        }
      );

      if (id !== requestId.current) return;

      setResults(patients);
      if (clinicId && offlinePortalResolved && patients.length > 0) {
        mergeRecentPatients(
          offlinePortalResolved,
          clinicId,
          patients.map((p) => ({
            id: p.id,
            full_name_ar: p.full_name_ar,
            phone: p.phone ?? p.phone_number ?? null,
          }))
        );
      }
      setError(searchError ?? null);
      setLoading(false);
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, portal, enabled, limit, debounceMs, minLength, scope, doctorId, clinicId, offlinePortal]);

  return { results, loading, error };
}
