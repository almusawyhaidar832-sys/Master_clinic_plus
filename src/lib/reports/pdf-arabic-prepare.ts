const PDF_FONT_STACK =
  "var(--font-noto-arabic), 'Noto Sans Arabic', Tahoma, Arial, sans-serif";

/** تجهيز DOM المستند قبل html2canvas — يمنع انفصال حروف العربية وعكسها */
export function preparePdfElementForArabicCapture(
  doc: Document,
  elementId: string
): void {
  if (typeof document !== "undefined") {
    doc.documentElement.className = document.documentElement.className;
    doc.documentElement.setAttribute("dir", "rtl");
    doc.documentElement.setAttribute("lang", "ar");
  }

  const root = doc.getElementById(elementId);
  if (!root) return;

  copyFontStylesIntoClone(doc);
  injectPdfArabicStyles(doc);

  root.setAttribute("dir", "rtl");
  root.setAttribute("lang", "ar");
  root.style.direction = "rtl";
  root.style.unicodeBidi = "embed";
  root.style.fontFamily = PDF_FONT_STACK;
  root.style.letterSpacing = "normal";
  root.style.wordSpacing = "normal";
  root.style.textTransform = "none";

  root.querySelectorAll("*").forEach((node) => {
    const el = node as HTMLElement;
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;

    el.style.direction = "rtl";
    el.style.letterSpacing = "normal";
    el.style.wordSpacing = "normal";
    el.style.textTransform = "none";

    // html2canvas يُنتج صفحة سوداء مع هذه الخصائص
    el.style.backdropFilter = "none";
    el.style.webkitBackdropFilter = "none";

    const font = doc.defaultView?.getComputedStyle(el).fontFamily ?? "";
    if (!font || font.includes("var(")) {
      el.style.fontFamily = PDF_FONT_STACK;
    }

    if (el.getAttribute("dir") === "ltr") {
      el.style.direction = "ltr";
      el.style.unicodeBidi = "isolate";
    }
  });
}

/** هل اللقطة سوداء بالكامل؟ — لا نفحص الزاوية العليا (قد تكون الهيدر الأزرق) */
export function isCanvasBlankOrBlack(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width < 2 || canvas.height < 2) return true;

  try {
    const regions = [
      { x: Math.floor(canvas.width * 0.35), y: Math.floor(canvas.height * 0.45) },
      { x: Math.floor(canvas.width * 0.35), y: Math.floor(canvas.height * 0.7) },
      { x: Math.floor(canvas.width * 0.1), y: Math.floor(canvas.height * 0.55) },
    ];
    const sampleSize = 24;
    let blackRegions = 0;

    for (const { x, y } of regions) {
      const sx = Math.min(x, Math.max(0, canvas.width - sampleSize));
      const sy = Math.min(y, Math.max(0, canvas.height - sampleSize));
      const sample = ctx.getImageData(sx, sy, sampleSize, sampleSize);
      let dark = 0;
      const total = sample.data.length / 4;
      for (let i = 0; i < sample.data.length; i += 4) {
        const r = sample.data[i]!;
        const g = sample.data[i + 1]!;
        const b = sample.data[i + 2]!;
        if (r < 20 && g < 20 && b < 20) dark++;
      }
      if (dark / total > 0.92) blackRegions++;
    }

    return blackRegions >= regions.length;
  } catch {
    // لوحة ملوّنة بصورة خارجية (شعار) — لا نرفض اللقطة
    return false;
  }
}

function copyFontStylesIntoClone(clonedDoc: Document): void {
  if (typeof document === "undefined") return;

  document.head.querySelectorAll("style").forEach((style) => {
    const text = style.textContent ?? "";
    if (
      text.includes("@font-face") ||
      text.includes("Noto") ||
      text.includes("--font-noto-arabic")
    ) {
      clonedDoc.head.appendChild(style.cloneNode(true));
    }
  });
}

function injectPdfArabicStyles(clonedDoc: Document): void {
  const style = clonedDoc.createElement("style");
  style.textContent = `
    .mc-pdf-doc,
    .mc-pdf-doc * {
      letter-spacing: normal !important;
      word-spacing: normal !important;
      text-transform: none !important;
      font-kerning: normal;
      font-feature-settings: "liga" 1, "calt" 1;
    }
    .mc-pdf-doc [dir="ltr"] {
      direction: ltr !important;
      unicode-bidi: isolate;
    }
  `;
  clonedDoc.head.appendChild(style);
}

export async function ensureArabicPdfFontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;

  const loads = [
    document.fonts.load('400 16px "Noto Sans Arabic"'),
    document.fonts.load('600 16px "Noto Sans Arabic"'),
    document.fonts.load('700 16px "Noto Sans Arabic"'),
    document.fonts.load('900 16px "Noto Sans Arabic"'),
  ];

  await Promise.allSettled(loads);
  await document.fonts.ready;
}
