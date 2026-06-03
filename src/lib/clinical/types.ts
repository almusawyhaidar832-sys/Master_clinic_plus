import type { ToothRecordInput } from "@/lib/clinical/constants";

export interface ClinicalXrayImage {
  id: string;
  url: string;
  file_name?: string | null;
  mime_type?: string | null;
}

export interface OperationClinicalData {
  teeth: ToothRecordInput[];
  xrays: ClinicalXrayImage[];
}

export type ClinicalByOperationId = Record<string, OperationClinicalData>;

export function teethArrayToMap(
  teeth: ToothRecordInput[]
): Record<number, ToothRecordInput> {
  const map: Record<number, ToothRecordInput> = {};
  for (const t of teeth) {
    map[t.tooth_number] = t;
  }
  return map;
}

export function hasClinicalData(data?: OperationClinicalData | null): boolean {
  if (!data) return false;
  return data.teeth.length > 0 || data.xrays.length > 0;
}
