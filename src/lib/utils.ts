import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { CURRENCY_SYMBOL_AR } from "@/lib/constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** English digits everywhere amounts are stored or parsed (DB-safe) */
export const NUMBER_LOCALE = "en-US";

const digitMap: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

/** Normalize Arabic/Persian numerals to ASCII 0-9 */
export function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (ch) => digitMap[ch] ?? ch);
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    numberingSystem: "latn",
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

/** Iraqi Dinar (IQD) — English digits + د.ع */
export function formatCurrency(amount: number, locale = NUMBER_LOCALE): string {
  const n = new Intl.NumberFormat(locale, {
    numberingSystem: "latn",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
  return `${n} ${CURRENCY_SYMBOL_AR}`;
}

/** Format number with comma separators: 500000 → "500,000" (English digits) */
export function formatNumberInput(value: string | number): string {
  const str = toAsciiDigits(String(value)).replace(/,/g, "");
  if (!str || str === ".") return str;
  const [intPart, decPart] = str.split(".");
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart !== undefined ? `${formatted}.${decPart}` : formatted;
}

/** Strip commas and keep ASCII digits + one decimal point */
export function parseFormattedNumber(value: string): string {
  return toAsciiDigits(value)
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "")
    .replace(/(\..*)\./g, "$1");
}

export function formatDate(
  date: Date | string | null | undefined,
  locale = "ar-EG"
): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

/** مدة الموعد الافتراضية عند حجز وقت واحد (محاسب) */
export const DEFAULT_APPOINTMENT_SLOT_MINUTES = 30;

/** HH:MM + دقائق → HH:MM (لحساب end_time من وقت واحد) */
export function addMinutesToTime(time: string, minutes: number): string {
  const ascii = toAsciiDigits(time.trim().slice(0, 5));
  const [hStr, mStr = "0"] = ascii.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time.slice(0, 5);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

export function formatTime(time: string | null | undefined): string {
  if (!time?.trim()) return "—";
  const ascii = toAsciiDigits(time.trim());
  const [h, m = "00"] = ascii.split(":");
  const hour = parseInt(h, 10);
  if (!Number.isFinite(hour)) return "—";
  const suffix = hour >= 12 ? "م" : "ص";
  const h12 = hour % 12 || 12;
  const minutes = m.padStart(2, "0").slice(0, 2);
  return `${h12}:${minutes} ${suffix}`;
}

/** Calendar date in the user's local timezone (not UTC) */
export function localDateISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return localDateISO();
}

/** Add calendar days to a YYYY-MM-DD date (local timezone). */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateISO(d);
}

/** Local calendar day(s) as UTC instants for Supabase `created_at` filters */
export function localPeriodUtcBounds(
  from: string,
  to: string
): { startIso: string; endIso: string } {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T23:59:59.999`);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function currentMonthYear(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** First and last calendar day for YYYY-MM */
export function monthDateRange(monthYear: string): { from: string; to: string } {
  const [y, m] = monthYear.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    return monthDateRange(currentMonthYear());
  }
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${monthYear}-01`,
    to: `${monthYear}-${String(last).padStart(2, "0")}`,
  };
}

export type ProfitPeriodPreset = "today" | "week" | "month";

/** نطاق الفترة لتوضيح الربح — يطابق لوحة المحاسب (الأسبوع = آخر 7 أيام) */
export function profitPeriodDateRange(
  preset: ProfitPeriodPreset
): { from: string; to: string } {
  const todayStr = todayISO();
  switch (preset) {
    case "today":
      return { from: todayStr, to: todayStr };
    case "week": {
      const w = new Date();
      w.setDate(w.getDate() - 6);
      return { from: localDateISO(w), to: todayStr };
    }
    case "month":
    default:
      return monthDateRange(currentMonthYear());
  }
}

export function profitPeriodLabelAr(preset: ProfitPeriodPreset): string {
  switch (preset) {
    case "today":
      return "اليوم";
    case "week":
      return "الأسبوع";
    case "month":
      return "الشهر";
  }
}

/** يحدد التبويب الافتراضي من نطاق التاريخ الممرَّر */
export function inferProfitPeriodFromRange(
  from: string,
  to: string
): ProfitPeriodPreset {
  const today = profitPeriodDateRange("today");
  const week = profitPeriodDateRange("week");
  if (from === today.from && to === today.to) return "today";
  if (from === week.from && to === week.to) return "week";
  return "month";
}

/** Last N months including current (YYYY-MM) */
export function listRecentMonthYears(count = 18): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

const AR_MONTHS = [
  "",
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

export function formatMonthYearAr(monthYear: string): string {
  const [y, m] = monthYear.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return monthYear;
  return `${AR_MONTHS[m]} ${y}`;
}

/** YYYY-MM → next calendar month */
export function nextMonthYear(monthYear: string): string {
  const [y, m] = monthYear.split("-").map(Number);
  if (!y || !m) return currentMonthYear();
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Latest of two YYYY-MM strings */
export function maxMonthYear(a: string, b: string): string {
  return a >= b ? a : b;
}

export function calculateRemainingDebt(total: number, paid: number): number {
  return Math.max(0, total - paid);
}

export function calculateSalaryNet(
  baseSalary: number,
  advances: number,
  deductions: number,
  bonuses = 0
): number {
  return Math.max(0, baseSalary + bonuses - advances - deductions);
}
