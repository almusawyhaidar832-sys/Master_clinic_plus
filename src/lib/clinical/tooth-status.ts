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

/** ألوان مشبعة وواضحة — تظهر على الطبيب والمساعد بنفس الشكل */
export const TOOTH_STATUS_COLORS: Record<
  ToothStatus,
  { fill: string; stroke: string; text: string }
> = {
  healthy: { fill: "#f8fafc", stroke: "#64748b", text: "#475569" },
  caries: { fill: "#fbbf24", stroke: "#b45309", text: "#78350f" },
  filled: { fill: "#3b82f6", stroke: "#1e3a8a", text: "#ffffff" },
  crowned: { fill: "#fde047", stroke: "#a16207", text: "#713f12" },
  missing: { fill: "#94a3b8", stroke: "#334155", text: "#f8fafc" },
  root_canal: { fill: "#c084fc", stroke: "#6b21a8", text: "#ffffff" },
  implant: { fill: "#2dd4bf", stroke: "#0f766e", text: "#ffffff" },
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
function resolveToothStatus(
  statusRaw: string | undefined | null,
  procedure: string
): ToothStatus {
  if (statusRaw && isToothStatus(statusRaw)) return statusRaw;
  if (procedure) return procedureToStatus(procedure);
  return "healthy";
}

function shouldShowToothOnChart(
  status: ToothStatus,
  procedure: string
): boolean {
  if (status !== "healthy") return true;
  return Boolean(procedure);
}

/** تحويل مخطط الجلسة (operation_tooth_records) لعرض odontogram */
export function sessionTeethToChartMap(
  teeth: Record<number, ToothRecordInput>
): PatientToothChartMap {
  const map: PatientToothChartMap = {};
  for (const rec of Object.values(teeth)) {
    const procedure = String(rec.procedure_ar ?? "").trim();
    const status = resolveToothStatus(rec.status, procedure);
    if (!shouldShowToothOnChart(status, procedure)) continue;
    map[rec.tooth_number] = {
      tooth_number: rec.tooth_number,
      status,
      procedure_ar: procedure || null,
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
  const status = update.status && isToothStatus(update.status)
    ? update.status
    : procedureToStatus(procedure);
  return {
    tooth_number: update.tooth_number,
    procedure_ar: procedure,
    status,
    note: update.note?.trim() || undefined,
  };
}

export function buildOdontogramTeethConditions(
  value: PatientToothChartMap,
  activeTooth?: number | null
): OdontogramConditionGroup[] {
  const byStatus = new Map<ToothStatus, string[]>();

  for (const row of Object.values(value)) {
    const procedure = String(row.procedure_ar ?? "").trim();
    if (!shouldShowToothOnChart(row.status, procedure)) continue;
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
      host.outlineColor = "#1d4ed8";
    } else {
      conditions.push({
        label: "active",
        teeth: [activeId],
        fillColor: "#e0e7ff",
        outlineColor: "#1d4ed8",
      });
    }
  }

  return conditions;
}
