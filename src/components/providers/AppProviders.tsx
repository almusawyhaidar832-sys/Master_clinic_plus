"use client";

import { ClinicProfileProvider } from "@/contexts/ClinicProfileContext";
import { ClinicModulesProvider } from "@/contexts/ClinicModulesContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AudioAlertsProvider } from "@/contexts/AudioAlertsContext";
import { PortalAuthGuard } from "@/components/auth/PortalAuthGuard";

/**
 * AppProviders — wraps the app with all global contexts.
 * Layer order (outer → inner):
 *   ThemeProvider → AudioAlertsProvider → LanguageProvider → … → PortalAuthGuard
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AudioAlertsProvider>
        <LanguageProvider>
          <ClinicProfileProvider>
            <ClinicModulesProvider>
              <PortalAuthGuard>{children}</PortalAuthGuard>
            </ClinicModulesProvider>
          </ClinicProfileProvider>
        </LanguageProvider>
      </AudioAlertsProvider>
    </ThemeProvider>
  );
}
