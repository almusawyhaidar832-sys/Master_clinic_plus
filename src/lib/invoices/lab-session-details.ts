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

export interface LabCostSplit {
  materialsCost: number;
  doctorShare: number;
  clinicShare: number;
  materialsSharePct: number;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** تقسيم تكلفة المختبر حسب نسبة تحمّل الطبيب (materials_share) */
export function computeLabCostSplit(
  materialsCost: number,
  materialsSharePct: number
): LabCostSplit | null {
  const cost = parseMaterialsCost(materialsCost);
  if (cost <= 0) return null;

  const pct = Math.min(100, Math.max(0, Number(materialsSharePct) || 0));
  const doctorShare = roundMoney((cost * pct) / 100);
  const clinicShare = roundMoney(cost - doctorShare);

  return {
    materialsCost: cost,
    doctorShare,
    clinicShare,
    materialsSharePct: pct,
  };
}

/** من لقطة الفاتورة أو حساب من التكلفة + النسبة المحفوظة */
export function labSplitFromSnapshot(snapshot: unknown): LabCostSplit | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const row = snapshot as Record<string, unknown>;

  const materialsCost = parseMaterialsCost(
    row.materialsCost ?? row.materials_cost
  );
  if (materialsCost <= 0) return null;

  const storedDoctor = parseMaterialsCost(
    row.labDoctorShare ?? row.lab_doctor_share
  );
  const storedClinic = parseMaterialsCost(
    row.labClinicShare ?? row.lab_clinic_share
  );
  const storedPct = Number(row.materialsSharePct ?? row.materials_share_pct);

  if (storedDoctor > 0 || storedClinic > 0) {
    return {
      materialsCost,
      doctorShare: storedDoctor,
      clinicShare:
        storedClinic > 0 ? storedClinic : roundMoney(materialsCost - storedDoctor),
      materialsSharePct: Number.isFinite(storedPct) ? storedPct : 0,
    };
  }

  if (Number.isFinite(storedPct) && storedPct >= 0) {
    return computeLabCostSplit(materialsCost, storedPct);
  }

  return null;
}

/** صرفية طبيب أو جلسة — استنتاج تقسيم المختبر من صف السجل */
export function labSplitFromHistoryRow(row: {
  record_kind?: string;
  paid_amount?: number;
  doctor_share?: number;
  clinic_share?: number;
  snapshot_json?: unknown;
}): LabCostSplit | null {
  const fromSnapshot = labSplitFromSnapshot(row.snapshot_json);
  if (fromSnapshot) return fromSnapshot;

  if (row.record_kind === "doctor_expense") {
    const materialsCost = parseMaterialsCost(row.paid_amount);
    if (materialsCost <= 0) return null;
    const doctorShare = parseMaterialsCost(row.doctor_share);
    const clinicShare = parseMaterialsCost(row.clinic_share);
    if (doctorShare > 0 || clinicShare > 0) {
      const pct =
        materialsCost > 0
          ? Math.round((doctorShare / materialsCost) * 100)
          : 0;
      return {
        materialsCost,
        doctorShare,
        clinicShare:
          clinicShare > 0 ? clinicShare : roundMoney(materialsCost - doctorShare),
        materialsSharePct: pct,
      };
    }
  }

  return null;
}
