"use client";

import { ClinicProfileProvider } from "@/contexts/ClinicProfileContext";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <ClinicProfileProvider>{children}</ClinicProfileProvider>;
}
