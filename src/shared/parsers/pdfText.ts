export interface PdfTextItem {
  str?: string;
  transform?: number[];
}

/** Rebuild visual lines from pdf.js text items. Space glyphs are already in `str`. */
export function textFromPdfItems(items: PdfTextItem[]): string {
  const lines: { y: number; parts: { x: number; str: string }[] }[] = [];
  for (const item of items) {
    const str = (item.str || "").replace(/\u0000/g, "");
    if (!str) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    let line = lines.find((entry) => Math.abs(entry.y - y) <= 2.5);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, str });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map((line) => line.parts.sort((a, b) => a.x - b.x).map((part) => part.str).join("")).join("\n");
}
