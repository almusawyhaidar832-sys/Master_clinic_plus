"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Playfair_Display } from "next/font/google";
import {
  BarChart3,
  CalendarClock,
  FileHeart,
  Globe2,
  Languages,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UsersRound,
  Wallet,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { DeveloperLogoMark } from "@/components/layout/DeveloperLogoMark";
import { useLanguage } from "@/contexts/LanguageContext";
import { APP_NAME_EN, DEVELOPER } from "@/lib/constants";
import { cn } from "@/lib/utils";

const display = Playfair_Display({
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
});

type Bi = { ar: string; en: string };

const COPY = {
  eyebrow: { ar: "حول النظام", en: "About the system" },
  tagline: {
    ar: "نظام متكامل لإدارة عيادات الأسنان",
    en: "The complete dental clinic management system",
  },
  intro: {
    ar: "Pearl Clinic يجمع كل شغل العيادة بمكان واحد: من لحظة حجز المريض، إلى جلسة العلاج عند الطبيب، إلى الدفع والحسابات والتقارير. كل موظف يدخل بحسابه ويشوف الشغل الخاص بيه فقط، بدون أوراق وبدون تعقيد.",
    en: "Pearl Clinic brings the whole clinic into one place: from booking a patient, to the treatment session with the doctor, to payments, accounting and reports. Every team member signs in with their own account and sees only their own work — no paperwork, no complexity.",
  },
  featuresTitle: { ar: "ماذا يقدّم النظام؟", en: "What it does" },
  stepsTitle: { ar: "كيف يعمل؟", en: "How it works" },
  contactTitle: { ar: "تواصل معنا", en: "Get in touch" },
  contactSub: {
    ar: "للاشتراك، الدعم الفني، أو طلب نسخة لعيادتك",
    en: "For subscriptions, technical support, or a setup for your clinic",
  },
  email: { ar: "البريد الإلكتروني", en: "Email" },
  phone: { ar: "الهاتف", en: "Phone" },
  whatsapp: { ar: "واتساب", en: "WhatsApp" },
  close: { ar: "إغلاق", en: "Close" },
} satisfies Record<string, Bi>;

const FEATURES: { icon: LucideIcon; title: Bi; body: Bi }[] = [
  {
    icon: CalendarClock,
    title: { ar: "المواعيد والطابور", en: "Appointments & queue" },
    body: {
      ar: "حجز المراجعين، شاشة انتظار تنادي على المريض، وإشعار فوري يوصل للطبيب.",
      en: "Book patients, a waiting-room screen that calls them in, and instant alerts to the doctor.",
    },
  },
  {
    icon: FileHeart,
    title: { ar: "ملف المريض", en: "Patient records" },
    body: {
      ar: "بيانات المريض، مخطط الأسنان، الجلسات والعلاجات — كلها بملف واحد.",
      en: "Patient details, dental chart, sessions and treatments — all in one file.",
    },
  },
  {
    icon: Wallet,
    title: { ar: "الحسابات والدفعات", en: "Billing & accounting" },
    body: {
      ar: "الفواتير، الدفعات والأقساط، الديون، المصاريف والرواتب بدقة كاملة.",
      en: "Invoices, payments and instalments, debts, expenses and payroll — precisely tracked.",
    },
  },
  {
    icon: UsersRound,
    title: { ar: "تطبيق لكل دور", en: "An app for every role" },
    body: {
      ar: "واجهة خاصة للطبيب والمحاسب والمساعد والمالك، كل واحد يشوف شغله فقط.",
      en: "Dedicated workspaces for doctor, accountant, assistant and owner — each sees only their work.",
    },
  },
  {
    icon: MessageCircle,
    title: { ar: "واتساب تلقائي", en: "WhatsApp automation" },
    body: {
      ar: "تذكير المرضى بمواعيدهم ورسائل تلقائية بدون أي مجهود.",
      en: "Automatic appointment reminders and patient messages, effortlessly.",
    },
  },
  {
    icon: BarChart3,
    title: { ar: "تقارير ذكية", en: "Smart reports" },
    body: {
      ar: "تقارير يومية وشهرية للأرباح والتحصيلات وأداء كل طبيب.",
      en: "Daily and monthly reports on profit, collections and each doctor's performance.",
    },
  },
];

const HIGHLIGHTS: { icon: LucideIcon; label: Bi }[] = [
  { icon: Smartphone, label: { ar: "يشتغل كتطبيق على الموبايل والكمبيوتر", en: "Installs as an app on phone & desktop" } },
  { icon: WifiOff, label: { ar: "يكمل الشغل حتى لو انقطع النت", en: "Keeps working when the internet drops" } },
  { icon: ShieldCheck, label: { ar: "بيانات آمنة ومشفّرة", en: "Secure, encrypted data" } },
  { icon: Globe2, label: { ar: "عربي وإنكليزي", en: "Arabic & English" } },
];

const STEPS: { title: Bi; body: Bi }[] = [
  {
    title: { ar: "سجّل دخولك", en: "Sign in" },
    body: {
      ar: "باسم المستخدم وكلمة المرور، والنظام يعرف دورك ويفتحلك واجهتك تلقائياً.",
      en: "With your username and password — the system recognises your role and opens your workspace.",
    },
  },
  {
    title: { ar: "استقبل المريض", en: "Receive the patient" },
    body: {
      ar: "المحاسب يسجّل المريض ويحجزله دور، والطبيب يوصله إشعار مباشرةً.",
      en: "The accountant registers the patient and books a slot; the doctor is notified instantly.",
    },
  },
  {
    title: { ar: "كل شي يتحدّث وحده", en: "Everything updates itself" },
    body: {
      ar: "الطبيب يكمل الجلسة، والحسابات والتقارير تتحدّث تلقائياً بدون أي حساب يدوي.",
      en: "The doctor completes the session; accounts and reports update automatically — no manual math.",
    },
  },
];

function ContactCard({
  href,
  icon: Icon,
  label,
  value,
  accent,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel="noreferrer"
      className="group relative flex items-center gap-3.5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.08]"
    >
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-lg ring-1 ring-white/20",
          accent
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium text-white/45">{label}</span>
        <span dir="ltr" className="block truncate text-sm font-semibold text-white">
          {value}
        </span>
      </span>
    </a>
  );
}

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang, toggleLang, isRTL } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const pick = (b: Bi) => (lang === "ar" ? b.ar : b.en);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    const raf = requestAnimationFrame(() => setVisible(true));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const waNumber = DEVELOPER.phoneIntl.replace(/\D/g, "");

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center sm:p-6"
      dir={isRTL ? "rtl" : "ltr"}
      role="dialog"
      aria-modal="true"
      aria-label={pick(COPY.eyebrow)}
    >
      <div
        className={cn(
          "absolute inset-0 bg-[#020710]/75 backdrop-blur-md transition-opacity duration-300",
          visible ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
      />

      <div
        className={cn(
          "relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] border border-white/10 text-white shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)] transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] sm:rounded-[28px]",
          visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-8 scale-[0.98] opacity-0"
        )}
        style={{
          background:
            "radial-gradient(900px 400px at 100% 0%, rgba(14,76,110,0.55), transparent 60%), radial-gradient(700px 400px at 0% 100%, rgba(201,168,106,0.12), transparent 60%), linear-gradient(160deg, #0b1f3a 0%, #050d1c 100%)",
        }}
      >
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#e6d3b3]/60 to-transparent" />

        <div className="absolute end-4 top-4 z-10 flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLang}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-[#0b1f3a]/85 px-3 text-xs font-semibold text-white/80 shadow-lg backdrop-blur-md transition-colors hover:bg-[#12294a] hover:text-white"
          >
            <Languages className="h-3.5 w-3.5" />
            {lang === "ar" ? "English" : "العربية"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={pick(COPY.close)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#0b1f3a]/85 text-white/70 shadow-lg backdrop-blur-md transition-colors hover:bg-[#12294a] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain">
          <header className="relative px-6 pb-8 pt-14 text-center sm:px-10 sm:pt-12">
            <div className="relative mx-auto h-24 w-24">
              <div className="absolute -inset-4 rounded-full bg-[conic-gradient(from_0deg,transparent,rgba(230,211,179,0.5),rgba(190,215,255,0.4),transparent)] opacity-70 blur-xl" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/pearl-192.png"
                alt={APP_NAME_EN}
                className="relative h-full w-full rounded-[26px] object-cover shadow-2xl ring-1 ring-white/15"
              />
            </div>
            <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#e6d3b3]/80">
              {pick(COPY.eyebrow)}
            </p>
            <h2
              dir="ltr"
              className={cn(
                display.className,
                "mt-2 bg-gradient-to-b from-white via-[#f1ebe1] to-[#cfb88f] bg-clip-text text-4xl font-semibold text-transparent sm:text-5xl"
              )}
            >
              Pearl Clinic
            </h2>
            <p className="mt-2 text-base font-semibold text-white/85">{pick(COPY.tagline)}</p>
            <p className="mx-auto mt-4 max-w-xl text-[14px] leading-7 text-white/60">
              {pick(COPY.intro)}
            </p>

            <ul className="mx-auto mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
              {HIGHLIGHTS.map(({ icon: Icon, label }) => (
                <li
                  key={label.en}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[12px] text-white/75"
                >
                  <Icon className="h-3.5 w-3.5 text-[#e6d3b3]" />
                  {pick(label)}
                </li>
              ))}
            </ul>
          </header>

          <section className="px-6 pb-8 sm:px-10">
            <SectionTitle icon={Sparkles}>{pick(COPY.featuresTitle)}</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div
                  key={title.en}
                  className="group rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 transition-colors duration-300 hover:border-[#e6d3b3]/30 hover:bg-white/[0.06]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#f6f3ee] to-[#d9c29a] text-[#0b1f3a] shadow-md">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-3 text-[15px] font-bold text-white">{pick(title)}</h3>
                  <p className="mt-1 text-[13px] leading-6 text-white/55">{pick(body)}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="px-6 pb-8 sm:px-10">
            <SectionTitle icon={ShieldCheck}>{pick(COPY.stepsTitle)}</SectionTitle>
            <ol className="grid gap-3 sm:grid-cols-3">
              {STEPS.map(({ title, body }, i) => (
                <li
                  key={title.en}
                  className="relative rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-transparent p-4"
                >
                  <span className={cn(display.className, "text-3xl font-semibold text-[#e6d3b3]/80")} dir="ltr">
                    0{i + 1}
                  </span>
                  <h3 className="mt-1 text-[15px] font-bold text-white">{pick(title)}</h3>
                  <p className="mt-1 text-[13px] leading-6 text-white/55">{pick(body)}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="px-6 pb-8 sm:px-10">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <h3 className="text-lg font-bold text-white">{pick(COPY.contactTitle)}</h3>
              <p className="mt-1 text-[13px] text-white/50">{pick(COPY.contactSub)}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <ContactCard
                  href={`mailto:${DEVELOPER.email}`}
                  icon={Mail}
                  label={pick(COPY.email)}
                  value={DEVELOPER.email}
                  accent="bg-gradient-to-br from-indigo-500 to-violet-600"
                />
                <ContactCard
                  href={`tel:${DEVELOPER.phoneIntl}`}
                  icon={Phone}
                  label={pick(COPY.phone)}
                  value={DEVELOPER.phone}
                  accent="bg-gradient-to-br from-sky-500 to-cyan-600"
                />
                <ContactCard
                  href={`https://wa.me/${waNumber}`}
                  icon={MessageCircle}
                  label={pick(COPY.whatsapp)}
                  value={DEVELOPER.phone}
                  accent="bg-gradient-to-br from-emerald-500 to-green-600"
                />
              </div>
            </div>
          </section>

          <footer className="border-t border-white/[0.08] bg-black/20 px-6 py-5 sm:px-10">
            <NexuraSignature />
          </footer>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <Icon className="h-4 w-4 text-[#e6d3b3]" />
      <h3 className="text-sm font-bold uppercase tracking-wide text-white/90">{children}</h3>
      <span className="h-px flex-1 bg-gradient-to-r from-white/15 to-transparent rtl:bg-gradient-to-l" />
    </div>
  );
}

/** Nexura Technologies credit line — shared by the login footer and the About dialog. */
export function NexuraSignature({ className }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:gap-3",
        className
      )}
    >
      <DeveloperLogoMark size={30} animated={false} />
      <div className="leading-tight">
        <p className="text-[11px] text-white/45">
          {t("developedBy")}{" "}
          <span
            dir="ltr"
            className="bg-gradient-to-r from-violet-300 via-white to-cyan-300 bg-clip-text font-bold tracking-wide text-transparent"
          >
            {DEVELOPER.nameEn}
          </span>
        </p>
        <p className="mt-0.5 text-[10px] text-white/35">
          <span dir="ltr">© {DEVELOPER.year}</span> · {t("allRightsReserved")}
        </p>
      </div>
    </div>
  );
}
