"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchClinicProfile,
  getClinicDisplayName,
} from "@/lib/services/clinic-profile";
import type { ClinicProfile } from "@/types/clinic-profile";

interface ClinicProfileContextValue {
  profile: ClinicProfile | null;
  displayName: string;
  loading: boolean;
  refresh: () => Promise<void>;
}

const ClinicProfileContext = createContext<ClinicProfileContextValue | null>(
  null
);

export function ClinicProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<ClinicProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const data = await fetchClinicProfile(supabase);
    setProfile(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      profile,
      displayName: getClinicDisplayName(profile),
      loading,
      refresh,
    }),
    [profile, loading, refresh]
  );

  return (
    <ClinicProfileContext.Provider value={value}>
      {children}
    </ClinicProfileContext.Provider>
  );
}

export function useClinicProfile(): ClinicProfileContextValue {
  const ctx = useContext(ClinicProfileContext);
  if (!ctx) {
    return {
      profile: null,
      displayName: "العيادة",
      loading: false,
      refresh: async () => {},
    };
  }
  return ctx;
}
