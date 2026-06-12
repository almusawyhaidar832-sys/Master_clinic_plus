"use client";

import { ClinicProfileProvider } from "@/contexts/ClinicProfileContext";
import { ClinicModulesProvider } from "@/contexts/ClinicModulesContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AudioAlertsProvider } from "@/contexts/AudioAlertsContext";
import { PortalAuthGuard } from "@/components/auth/PortalAuthGuard";

/**
 * AppProviders — portal layouts (LanguageProvider lives in root layout).
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AudioAlertsProvider>
          <ClinicProfileProvider>
            <ClinicModulesProvider>
              <PortalAuthGuard>{children}</PortalAuthGuard>
            </ClinicModulesProvider>
          </ClinicProfileProvider>
      </AudioAlertsProvider>
    </ThemeProvider>
  );
}
