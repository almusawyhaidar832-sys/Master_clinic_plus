import { AssistantMobileShell } from "@/components/layout/AssistantMobileShell";
import { AppProviders } from "@/components/providers/AppProviders";

export const metadata = {
  title: "بوابة المساعد",
};

export default function AssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <AssistantMobileShell>{children}</AssistantMobileShell>
    </AppProviders>
  );
}
