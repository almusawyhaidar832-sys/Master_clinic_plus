"use client";

/**
 * useModuleNav — returns a filtered navigation array
 * based on the currently enabled modules for the clinic.
 *
 * Usage:
 *   const nav = useModuleNav(accountantModuleNav);
 *   // Only items whose requiredModule is enabled (or have no requirement) are returned
 */

import { useMemo } from "react";
import { useClinicModules } from "@/contexts/ClinicModulesContext";
import type { ClinicModuleKey } from "@/types/modules";
import type { UserRole } from "@/types";

import type { TranslationKey } from "@/i18n/translations";

export interface ModuleNavItem {
  href: string;
  labelKey: TranslationKey;
  icon: string;
  descKey?: TranslationKey;
  /** If set, this nav item is hidden when the module is disabled */
  requiredModule?: ClinicModuleKey;
  /** Restrict to specific roles */
  roles?: UserRole[];
}

export function useModuleNav(items: ModuleNavItem[]): ModuleNavItem[] {
  const { hasModule, loading } = useClinicModules();

  return useMemo(() => {
    if (loading) return items.filter((item) => !item.requiredModule);

    return items.filter((item) => {
      if (!item.requiredModule) return true;
      return hasModule(item.requiredModule);
    });
  }, [items, hasModule, loading]);
}
