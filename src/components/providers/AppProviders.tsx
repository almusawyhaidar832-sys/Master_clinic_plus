"use client";

import { ClinicProfileProvider } from "@/contexts/ClinicProfileContext";
import { ClinicModulesProvider } from "@/contexts/ClinicModulesContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { PortalAuthGuard } from "@/components/auth/PortalAuthGuard";

/**
 * AppProviders — wraps the app with all global contexts.
 * Layer order (outer → inner):
 *   ThemeProvider → LanguageProvider → ClinicProfileProvider → ClinicModulesProvider → PortalAuthGuard
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ClinicProfileProvider>
          <ClinicModulesProvider>
            <PortalAuthGuard>{children}</PortalAuthGuard>
          </ClinicModulesProvider>
        </ClinicProfileProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
