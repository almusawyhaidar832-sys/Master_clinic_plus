/**
 * تصدير PDF من عنصر HTML — يعتمد على خطوط المتصفح (Noto Sans Arabic)
 * بدلاً من jsPDF + TTF الذي يفشل في Next.js / jsPDF 4.
 */
async function renderElementToPdf(elementId: string) {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error("تعذر العثور على محتوى المستند للتصدير");
  }

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  element.querySelectorAll(".statement-case-body").forEach((panel) => {
    panel.classList.remove("hidden");
  });

  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    onclone: (doc) => {
      const cloned = doc.getElementById(elementId);
      if (cloned) {
        cloned.style.direction = "rtl";
        cloned.style.fontFamily =
          "var(--font-noto-arabic), 'Noto Sans Arabic', sans-serif";
      }
    },
  });

  const imgData = canvas.toDataURL("image/png", 1.0);
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

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  return pdf;
}

export async function generateElementPdfBase64(
  elementId: string
): Promise<string> {
  const pdf = await renderElementToPdf(elementId);
  const dataUri = pdf.output("datauristring");
  const comma = dataUri.indexOf(",");
  return comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
}

export async function downloadElementAsPdf(
  elementId: string,
  filename: string
): Promise<void> {
  const pdf = await renderElementToPdf(elementId);
  const safeName = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  pdf.save(safeName);
}
