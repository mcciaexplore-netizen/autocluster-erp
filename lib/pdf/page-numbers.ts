import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/** Writes "<label> · Page X of N" at the bottom right of every page. */
export async function stampPageNumbers(pdf: Uint8Array, label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const size = 7.5;
  pages.forEach((page, i) => {
    const text = `${label} · Page ${i + 1} of ${pages.length}`;
    const width = font.widthOfTextAtSize(text, size);
    // Matches the footer line drawn by the PDF layout: 40pt side margin, 24pt from the bottom.
    page.drawText(text, { x: page.getWidth() - 40 - width, y: 26, size, font, color: rgb(0.39, 0.45, 0.55) });
  });
  return doc.save();
}
