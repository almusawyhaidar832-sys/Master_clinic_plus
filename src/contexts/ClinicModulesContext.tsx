"use client";

/**
 * ClinicModulesContext
 * ---
 * Single source of truth for the current clinic's specialty & enabled modules.
 * Loaded once at login, cached in memory for the session.
 *
 * Usage:
 *   const { hasModule, specialty, settings } = useClinicModules();
 *   if (hasModule("dental_chart")) { ... }
 */

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
  type ClinicModuleKey,
  type ClinicSettings,
  type ClinicSpecialty,
  SPECIALTY_DEFAULT_MODULES,
  SPECIALTY_LABELS,
} from "@/types/modules";

// =============================================================================
// Context shape
// =============================================================================
interface ClinicModulesContextValue {
  /** True while fetching from DB */
  loading: boolean;
  /** Raw settings row from DB (null before loaded) */
  settings: ClinicSettings | null;
  /** Current clinic specialty */
  specialty: ClinicSpecialty;
  /** Human-readable specialty label (Arabic) */
  specialtyLabel: string;
  /** Check if a module is enabled for this clinic */
  hasModule: (key: ClinicModuleKey) => boolean;
  /** All enabled module keys */
  enabledModules: ClinicModuleKey[];
  /** Force re-fetch (after settings update) */
  refresh: () => Promise<void>;
}

const ClinicModulesContext = createContext<ClinicModulesContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================
export function ClinicModulesProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();

      // Fetch the current user's clinic_id via profile
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setSettings(null);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("clinic_id, role")
        .eq("id", user.id)
        .single();

      if (!profile?.clinic_id) {
        setSettings(null);
        return;
      }

      const { data: row, error } = await supabase
        .from("clinic_settings")
        .select("id, clinic_id, specialty, enabled_modules, module_config")
        .eq("clinic_id", profile.clinic_id)
        .single();

      if (error || !row) {
        // Settings row doesn't exist yet — use defaults for 'dental'
        const fallback: ClinicSettings = {
          id: "",
          clinic_id: profile.clinic_id,
          specialty: "dental",
          enabled_modules: SPECIALTY_DEFAULT_MODULES.dental,
          module_config: {},
        };
        setSettings(fallback);
        return;
      }

      setSettings({
        ...row,
        specialty: row.specialty as ClinicSpecialty,
        enabled_modules: (row.enabled_modules as ClinicModuleKey[]) ?? [],
        module_config: (row.module_config as Record<string, unknown>) ?? {},
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const specialty = settings?.specialty ?? "dental";
  const enabledModules = settings?.enabled_modules ?? SPECIALTY_DEFAULT_MODULES.dental;

  const hasModule = useCallback(
    (key: ClinicModuleKey): boolean => enabledModules.includes(key),
    [enabledModules]
  );

  const value = useMemo<ClinicModulesContextValue>(
    () => ({
      loading,
      settings,
      specialty,
      specialtyLabel: SPECIALTY_LABELS[specialty],
      hasModule,
      enabledModules,
      refresh,
    }),
    [loading, settings, specialty, hasModule, enabledModules, refresh]
  );

  return (
    <ClinicModulesContext.Provider value={value}>
      {children}
    </ClinicModulesContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================
export function useClinicModules(): ClinicModulesContextValue {
  const ctx = useContext(ClinicModulesContext);
  if (!ctx) {
    // Safe fallback outside provider (e.g., in storybook or tests)
    return {
      loading: false,
      settings: null,
      specialty: "dental",
      specialtyLabel: SPECIALTY_LABELS.dental,
      hasModule: () => false,
      enabledModules: [],
      refresh: async () => {},
    };
  }
  return ctx;
}
