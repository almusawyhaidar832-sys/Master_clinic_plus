import {
  ensureArabicPdfFontsReady,
  isCanvasBlankOrBlack,
  preparePdfElementForArabicCapture,
} from "@/lib/reports/pdf-arabic-prepare";

/** حد آمن لإرسال PDF عبر واتساب (أقل من حد الخادم 8MB) */
export const WHATSAPP_PDF_MAX_BYTES = 6 * 1024 * 1024;

export type PdfRenderOptions = {
  scale?: number;
  jpegQuality?: number;
};

const DEFAULT_RENDER: Required<PdfRenderOptions> = {
  scale: 2,
  jpegQuality: 0.88,
};

export function isPdfBase64TooLarge(
  base64: string,
  maxBytes = WHATSAPP_PDF_MAX_BYTES
): boolean {
  if (!base64.trim()) return true;
  return Math.ceil((base64.trim().length * 3) / 4) > maxBytes;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = "انتهت المهلة"
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function pdfOutputBase64(pdf: import("jspdf").jsPDF): string {
  const dataUri = pdf.output("datauristring");
  const comma = dataUri.indexOf(",");
  return comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
}

/**
 * تصدير PDF من عنصر HTML — يعتمد على خطوط المتصفح (Noto Sans Arabic)
 */
async function renderElementToPdf(
  elementId: string,
  opts: PdfRenderOptions = {}
) {
  const { scale, jpegQuality } = { ...DEFAULT_RENDER, ...opts };
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error("تعذر العثور على محتوى المستند للتصدير");
  }

  await ensureArabicPdfFontsReady();
  await waitForPaint();

  element.querySelectorAll(".statement-case-body").forEach((panel) => {
    panel.classList.remove("hidden");
  });

  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");

  const canvas = await html2canvas(element, {
    scale,
    useCORS: true,
    allowTaint: false,
    logging: false,
    backgroundColor: "#ffffff",
    onclone: (doc: Document) => {
      preparePdfElementForArabicCapture(doc, elementId);
    },
  });

  if (isCanvasBlankOrBlack(canvas)) {
    throw new Error("تعذر تصدير المستند — اللقطة فارغة");
  }

  const imgData = canvas.toDataURL("image/jpeg", jpegQuality);
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  return pdf;
}

export async function generateElementPdfBase64(
  elementId: string,
  opts?: { maxBytes?: number }
): Promise<string> {
  const maxBytes = opts?.maxBytes;
  const attempts: PdfRenderOptions[] = [
    { scale: 2, jpegQuality: 0.88 },
    { scale: 2, jpegQuality: 0.72 },
    { scale: 1.5, jpegQuality: 0.8 },
  ];

  let lastBase64 = "";
  for (const attempt of attempts) {
    const pdf = await renderElementToPdf(elementId, attempt);
    lastBase64 = pdfOutputBase64(pdf);
    if (!maxBytes || !isPdfBase64TooLarge(lastBase64, maxBytes)) {
      return lastBase64;
    }
  }

  throw new Error("حجم ملف PDF كبير جداً للإرسال");
}

export async function downloadElementAsPdf(
  elementId: string,
  filename: string
): Promise<void> {
  const pdf = await renderElementToPdf(elementId);
  const safeName = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  pdf.save(safeName);
}
