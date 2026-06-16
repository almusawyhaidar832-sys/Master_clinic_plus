/** تفاصيل تكلفة المختبر المرتبطة بجلسة — للعرض فقط (لا تغيّر الحسابات المالية) */

export interface LabSessionDetails {
  materialsCost: number;
  labNotes: string | null;
}

export function parseMaterialsCost(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

export function parseLabNotes(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

export function hasLabDetails(details: LabSessionDetails): boolean {
  return details.materialsCost > 0 || !!details.labNotes;
}

export function truncateLabNotes(
  notes: string | null | undefined,
  maxLen = 48
): string {
  const s = String(notes ?? "").trim();
  if (!s) return "—";
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

export function labDetailsFromSnapshot(snapshot: unknown): LabSessionDetails {
  if (!snapshot || typeof snapshot !== "object") {
    return { materialsCost: 0, labNotes: null };
  }
  const row = snapshot as Record<string, unknown>;
  return {
    materialsCost: parseMaterialsCost(
      row.materialsCost ?? row.materials_cost
    ),
    labNotes: parseLabNotes(row.labNotes ?? row.lab_notes),
  };
}

export function labDetailsFromOperation(
  op: {
    materials_cost?: unknown;
    lab_notes?: unknown;
  } | null
  | undefined
): LabSessionDetails {
  if (!op) return { materialsCost: 0, labNotes: null };
  return {
    materialsCost: parseMaterialsCost(op.materials_cost),
    labNotes: parseLabNotes(op.lab_notes),
  };
}

/** دمج مصادر متعددة — الأولوية للقيمة الأكبر/الأوضح */
export function mergeLabDetails(
  ...sources: LabSessionDetails[]
): LabSessionDetails {
  let materialsCost = 0;
  let labNotes: string | null = null;

  for (const src of sources) {
    if (src.materialsCost > materialsCost) {
      materialsCost = src.materialsCost;
    }
    if (!labNotes && src.labNotes) {
      labNotes = src.labNotes;
    }
  }

  return { materialsCost, labNotes };
}

export function sumMaterialsCosts(
  items: Pick<LabSessionDetails, "materialsCost">[]
): number {
  const total = items.reduce((sum, item) => sum + item.materialsCost, 0);
  return Math.round(total * 100) / 100;
}
