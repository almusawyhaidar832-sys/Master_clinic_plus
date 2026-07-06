import { formatCurrency } from "@/lib/utils";

const FINANCIAL_KEYS = new Set([
  "total_amount",
  "paid_amount",
  "remaining_debt",
  "doctor_share_amount",
  "clinic_share_amount",
]);

const APPOINTMENT_KEYS = new Set([
  "patient_name_ar",
  "patient_phone",
  "appointment_date",
  "start_time",
  "end_time",
  "status",
  "notes",
]);

function formatVal(key: string, val: unknown): string {
  if (val == null || val === "") return "—";
  if (FINANCIAL_KEYS.has(key)) {
    const n = Number(val);
    if (Number.isFinite(n)) return formatCurrency(n);
  }
  return String(val);
}

const KEY_LABELS: Record<string, string> = {
  total_amount: "الإجمالي",
  paid_amount: "المدفوع",
  remaining_debt: "المتبقي",
  patient_name_ar: "اسم المراجع",
  patient_phone: "الهاتف",
  appointment_date: "التاريخ",
  start_time: "من",
  end_time: "إلى",
  status: "الحالة",
  operation_name_ar: "الإجراء",
  doctor_share_amount: "حصة الطبيب",
  clinic_share_amount: "حصة العيادة",
};

/** استخراج سطور diff للعرض في سجل المراقبة */
export function buildAuditChangeLines(
  entityType: string,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): string[] {
  if (!before && !after) return [];

  const keys =
    entityType === "appointment"
      ? APPOINTMENT_KEYS
      : entityType === "patient_operation"
        ? new Set([...FINANCIAL_KEYS, "operation_name_ar", "operation_date", "notes"])
        : FINANCIAL_KEYS;

  const lines: string[] = [];
  const b = before ?? {};
  const a = after ?? {};

  for (const key of keys) {
    const bv = b[key];
    const av = a[key];
    if (bv === av) continue;
    if (bv === undefined && av === undefined) continue;
    const label = KEY_LABELS[key] ?? key;
    lines.push(`${label}: ${formatVal(key, bv)} → ${formatVal(key, av)}`);
  }

  return lines;
}
