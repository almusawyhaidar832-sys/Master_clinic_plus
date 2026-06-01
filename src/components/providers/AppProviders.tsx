"use client";

import { ClinicProfileProvider } from "@/contexts/ClinicProfileContext";
import { ClinicModulesProvider } from "@/contexts/ClinicModulesContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";

/**
 * AppProviders — wraps the app with all global contexts.
 * Layer order (outer → inner):
 *   ThemeProvider → LanguageProvider → ClinicProfileProvider → ClinicModulesProvider
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ClinicProfileProvider>
          <ClinicModulesProvider>
            {children}
          </ClinicModulesProvider>
        </ClinicProfileProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
