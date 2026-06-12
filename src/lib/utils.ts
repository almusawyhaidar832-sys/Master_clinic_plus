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

export function formatDate(date: Date | string, locale = "ar-EG"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export function formatTime(time: string): string {
  const ascii = toAsciiDigits(time);
  const [h, m] = ascii.split(":");
  const hour = parseInt(h, 10);
  const suffix = hour >= 12 ? "م" : "ص";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${suffix}`;
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
