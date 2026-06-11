import {
  LOWER_LEFT,
  LOWER_RIGHT,
  UPPER_LEFT,
  UPPER_RIGHT,
} from "@/lib/clinical/constants";

export interface ToothLayout {
  num: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function toothWidth(num: number): number {
  const pos = num % 10;
  if (pos >= 6) return 36;
  if (pos >= 4) return 30;
  if (pos === 3) return 26;
  return 24;
}

function layoutRow(
  teeth: readonly number[],
  startX: number,
  y: number
): ToothLayout[] {
  let x = startX;
  return teeth.map((num) => {
    const w = toothWidth(num);
    const item: ToothLayout = { num, x, y, w, h: 56 };
    x += w + 5;
    return item;
  });
}

/** مواقع SVG لـ 32 سناً — عرض المريض (علوي أعلى، سفلي أسفل) */
export function buildToothLayouts(): ToothLayout[] {
  return [
    ...layoutRow(UPPER_RIGHT, 8, 24),
    ...layoutRow(UPPER_LEFT, 228, 24),
    ...layoutRow(LOWER_RIGHT, 8, 168),
    ...layoutRow(LOWER_LEFT, 228, 168),
  ];
}

export const TOOTH_CHART_VIEWBOX = "0 0 440 260";
