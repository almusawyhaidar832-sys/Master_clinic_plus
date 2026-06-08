"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getActiveClinicId, type ActiveClinicResult } from "@/lib/clinic-context";

export interface UseActiveClinicIdState {
  /** undefined = still loading, null = no clinic found, string = ready */
  clinicId: string | null | undefined;
  clinicName: string;
  /** "profile" | "fallback" | null */
  source: ActiveClinicResult["source"] | null;
  loading: boolean;
  /** true only when no clinic exists at all in the DB */
  missingClinic: boolean;
}

/**
 * React hook — resolves the active clinic for the logged-in user (profiles.clinic_id only).
 */
export function useActiveClinicId(): UseActiveClinicIdState {
  const [state, setState] = useState<UseActiveClinicIdState>({
    clinicId: undefined,
    clinicName: "",
    source: null,
    loading: true,
    missingClinic: false,
  });

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      const supabase = createClient();
      const result = await getActiveClinicId(supabase);
      if (cancelled) return;

      if (!result) {
        setState({
          clinicId: null,
          clinicName: "",
          source: null,
          loading: false,
          missingClinic: true,
        });
      } else {
        setState({
          clinicId: result.clinicId,
          clinicName: result.clinicName,
          source: result.source,
          loading: false,
          missingClinic: false,
        });
      }
    }
    resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
