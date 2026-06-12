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
      setError(searchError ?? null);
      setLoading(false);
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, portal, enabled, limit, debounceMs, minLength, scope, doctorId]);

  return { results, loading, error };
}
