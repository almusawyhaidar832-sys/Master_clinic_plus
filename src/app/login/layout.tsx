import { ThemeProvider } from "@/contexts/ThemeContext";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
