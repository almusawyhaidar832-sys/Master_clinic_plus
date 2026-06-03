/** FDI tooth numbering — adult permanent dentition */
export const UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11] as const;
export const UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28] as const;
export const LOWER_LEFT = [38, 37, 36, 35, 34, 33, 32, 31] as const;
export const LOWER_RIGHT = [41, 42, 43, 44, 45, 46, 47, 48] as const;

export const ALL_FDI_TEETH: number[] = [
  ...UPPER_RIGHT,
  ...UPPER_LEFT,
  ...LOWER_LEFT,
  ...LOWER_RIGHT,
];

export const TOOTH_PROCEDURES = [
  "كشف",
  "حشوة",
  "حشوة جذر",
  "خلع",
  "تاج",
  "تنظيف",
  "علاج لثة",
  "أشعة",
  "أخرى",
] as const;

export type ToothProcedure = (typeof TOOTH_PROCEDURES)[number];

export interface ToothRecordInput {
  tooth_number: number;
  procedure_ar: string;
  note?: string;
}

export interface SessionClinicalDraft {
  xrayFiles: File[];
  teeth: Record<number, ToothRecordInput>;
}

export const EMPTY_CLINICAL_DRAFT: SessionClinicalDraft = {
  xrayFiles: [],
  teeth: {},
};
