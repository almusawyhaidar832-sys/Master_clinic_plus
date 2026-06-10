import { TOOTH_PROCEDURES, type ToothRecordInput } from "@/lib/clinical/constants";

export function toggleSelectedTeeth(prev: number[], toothNum: number): number[] {
  if (prev.includes(toothNum)) {
    return prev.filter((t) => t !== toothNum);
  }
  return [...prev, toothNum].sort((a, b) => a - b);
}

export function editorDefaultsForFirstSelection(
  value: Record<number, ToothRecordInput>,
  toothNum: number
): { procedure: string; note: string } {
  const existing = value[toothNum];
  return {
    procedure: existing?.procedure_ar ?? TOOTH_PROCEDURES[0],
    note: existing?.note ?? "",
  };
}

export function applyProcedureToTeeth(
  value: Record<number, ToothRecordInput>,
  selectedTeeth: number[],
  procedure: string,
  note: string
): Record<number, ToothRecordInput> {
  const next = { ...value };
  const trimmedNote = note.trim() || undefined;
  for (const toothNum of selectedTeeth) {
    next[toothNum] = {
      tooth_number: toothNum,
      procedure_ar: procedure,
      note: trimmedNote,
    };
  }
  return next;
}

export function removeTeethFromValue(
  value: Record<number, ToothRecordInput>,
  selectedTeeth: number[]
): Record<number, ToothRecordInput> {
  const next = { ...value };
  for (const toothNum of selectedTeeth) {
    delete next[toothNum];
  }
  return next;
}

export function formatTeethLabel(teeth: number[]): string {
  const sorted = [...teeth].sort((a, b) => a - b);
  if (sorted.length === 1) return `السن ${sorted[0]}`;
  return `الأسنان ${sorted.join("، ")}`;
}

export function anySelectedHasRecord(
  value: Record<number, ToothRecordInput>,
  selectedTeeth: number[]
): boolean {
  return selectedTeeth.some((t) => value[t]);
}

export function teethPayloadFromDraft(
  teeth: Record<number, ToothRecordInput>
): ToothRecordInput[] {
  return Object.values(teeth);
}
