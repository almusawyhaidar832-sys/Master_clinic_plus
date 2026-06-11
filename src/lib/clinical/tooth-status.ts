import {
  TOOTH_PROCEDURES,
  type ToothRecordInput,
} from "@/lib/clinical/constants";

/** حالة السن في المخطط التراكمي للمريض */
export const TOOTH_STATUSES = [
  "healthy",
  "caries",
  "filled",
  "crowned",
  "missing",
  "root_canal",
  "implant",
] as const;

export type ToothStatus = (typeof TOOTH_STATUSES)[number];

export interface PatientToothState {
  tooth_number: number;
  status: ToothStatus;
  procedure_ar?: string | null;
  note?: string | null;
  updated_at?: string | null;
}

export type PatientToothChartMap = Record<number, PatientToothState>;

export const TOOTH_STATUS_LABELS_AR: Record<ToothStatus, string> = {
  healthy: "سليم",
  caries: "تسوس",
  filled: "محشو",
  crowned: "تاج",
  missing: "مفقود / مخلوع",
  root_canal: "علاج جذر",
  implant: "زرعة",
};

export const TOOTH_STATUS_COLORS: Record<
  ToothStatus,
  { fill: string; stroke: string; text: string }
> = {
  healthy: { fill: "#ffffff", stroke: "#cbd5e1", text: "#64748b" },
  caries: { fill: "#fef3c7", stroke: "#f59e0b", text: "#b45309" },
  filled: { fill: "#dbeafe", stroke: "#3b82f6", text: "#1d4ed8" },
  crowned: { fill: "#fef9c3", stroke: "#ca8a04", text: "#a16207" },
  missing: { fill: "#f1f5f9", stroke: "#94a3b8", text: "#94a3b8" },
  root_canal: { fill: "#ede9fe", stroke: "#7c3aed", text: "#5b21b6" },
  implant: { fill: "#ccfbf1", stroke: "#0d9488", text: "#0f766e" },
};

/** ربط إجراء الجلسة (القائمة الحالية) بحالة بصرية */
export function procedureToStatus(procedure: string): ToothStatus {
  const p = procedure.trim();
  switch (p) {
    case "حشوة":
      return "filled";
    case "حشوة جذر":
      return "root_canal";
    case "خلع":
      return "missing";
    case "تاج":
      return "crowned";
    case "كشف":
    case "تنظيف":
      return "healthy";
    case "علاج لثة":
      return "caries";
    default:
      return "filled";
  }
}

export function isToothStatus(value: string): value is ToothStatus {
  return (TOOTH_STATUSES as readonly string[]).includes(value);
}

export function normalizePatientToothState(
  row: Partial<PatientToothState> & { tooth_number: number }
): PatientToothState {
  const status =
    row.status && isToothStatus(row.status) ? row.status : "healthy";
  return {
    tooth_number: row.tooth_number,
    status,
    procedure_ar: row.procedure_ar ?? null,
    note: row.note ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function chartMapFromRows(
  rows: PatientToothState[]
): PatientToothChartMap {
  const map: PatientToothChartMap = {};
  for (const row of rows) {
    map[row.tooth_number] = normalizePatientToothState(row);
  }
  return map;
}

export function rowsFromChartMap(
  map: PatientToothChartMap
): PatientToothState[] {
  return Object.values(map).map((row) => normalizePatientToothState(row));
}

/** إجراءات العرض في النافذة — نفس قائمة الجلسات الحالية */
export const CHART_PROCEDURE_OPTIONS = [...TOOTH_PROCEDURES];

/** معرّف السن في react-odontogram — مثال: teeth-11 */
export function odontogramToothId(fdi: number): string {
  return `teeth-${fdi}`;
}

export function fdiFromOdontogramId(id: string): number | null {
  const match = /^teeth-(\d+)$/.exec(id.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : null;
}

export function fdiFromToothDetail(detail: {
  id?: string;
  notations?: { fdi?: string };
}): number | null {
  const fromNotation = detail.notations?.fdi
    ? Number(detail.notations.fdi)
    : NaN;
  if (Number.isInteger(fromNotation)) return fromNotation;
  if (detail.id) return fdiFromOdontogramId(detail.id);
  return null;
}

export type OdontogramConditionGroup = {
  label: string;
  teeth: string[];
  outlineColor: string;
  fillColor: string;
};

/** تحويل حالات قاعدة البيانات إلى teethConditions للمكتبة */
/** تحويل مخطط الجلسة (operation_tooth_records) لعرض odontogram */
export function sessionTeethToChartMap(
  teeth: Record<number, ToothRecordInput>
): PatientToothChartMap {
  const map: PatientToothChartMap = {};
  for (const rec of Object.values(teeth)) {
    const procedure = String(rec.procedure_ar ?? "").trim();
    if (!procedure) continue;
    map[rec.tooth_number] = {
      tooth_number: rec.tooth_number,
      status: procedureToStatus(procedure),
      procedure_ar: procedure,
      note: rec.note ?? null,
    };
  }
  return map;
}

export function chartStateToSessionTooth(
  update: PatientToothState
): ToothRecordInput {
  const procedure =
    String(update.procedure_ar ?? "").trim() || TOOTH_PROCEDURES[0];
  return {
    tooth_number: update.tooth_number,
    procedure_ar: procedure,
    note: update.note?.trim() || undefined,
  };
}

export function buildOdontogramTeethConditions(
  value: PatientToothChartMap,
  activeTooth?: number | null
): OdontogramConditionGroup[] {
  const byStatus = new Map<ToothStatus, string[]>();

  for (const row of Object.values(value)) {
    if (row.status === "healthy" && !row.procedure_ar?.trim()) continue;
    const id = odontogramToothId(row.tooth_number);
    const list = byStatus.get(row.status) ?? [];
    if (!list.includes(id)) list.push(id);
    byStatus.set(row.status, list);
  }

  const conditions: OdontogramConditionGroup[] = [];

  for (const status of TOOTH_STATUSES) {
    const teeth = byStatus.get(status);
    if (!teeth?.length) continue;
    const colors = TOOTH_STATUS_COLORS[status];
    conditions.push({
      label: status,
      teeth,
      fillColor: colors.fill,
      outlineColor: colors.stroke,
    });
  }

  if (activeTooth != null) {
    const activeId = odontogramToothId(activeTooth);
    const host = conditions.find((g) => g.teeth.includes(activeId));
    if (host) {
      host.outlineColor = "#2563eb";
    } else {
      conditions.push({
        label: "active",
        teeth: [activeId],
        fillColor: "#ffffff",
        outlineColor: "#2563eb",
      });
    }
  }

  return conditions;
}
