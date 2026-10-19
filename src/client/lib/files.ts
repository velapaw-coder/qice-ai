import type { Extraction } from "@shared/parsers/tabular";
import { parseSsText, parseVatText } from "@shared/parsers/tabular";
import { textFromPdfItems } from "@shared/parsers/pdfText";

export function parseSpreadsheet(file: File): Promise<Extraction> {
  return new Promise(async (resolve, reject) => {
    const buf = await file.arrayBuffer();
    const worker = new Worker(new URL("./sheetWorker.ts", import.meta.url), { type: "module" });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("表格解析超时，建议改用电脑上传"));
    }, 60_000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; extraction?: Extraction; error?: string }>) => {
      window.clearTimeout(timer);
      worker.terminate();
      if (!event.data.ok || !event.data.extraction) reject(new Error(event.data.error || "解析失败"));
      else resolve(event.data.extraction);
    };
    worker.onerror = () => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(new Error("浏览器无法解析这个表格"));
    };
    worker.postMessage({ buf, filename: file.name }, [buf]);
  });
}

export async function compressImage(file: Blob, maxBytes = 3 * 1024 * 1024): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxEdge = 3000;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不能压缩图片");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let quality = 0.85;
  let blob = await toJpeg(canvas, quality);
  while (blob.size > maxBytes && quality > 0.45) {
    quality -= 0.1;
    blob = await toJpeg(canvas, quality);
  }
  return blob;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("压缩失败"))), "image/jpeg", quality));
}

export async function maybeConvertHeic(file: File): Promise<File | Blob> {
  if (!/\.heic$/i.test(file.name) && file.type !== "image/heic") return file;
  const mod = await import("heic2any");
  const converted = await mod.default({ blob: file, toType: "image/jpeg", quality: 0.85 });
  return Array.isArray(converted) ? converted[0]! : converted;
}

export async function readPdf(file: File): Promise<{ text: string; pages: Blob[]; renderPages: () => Promise<Blob[]> }> {
  const pdfjs = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  let text = "";
  const limit = Math.min(doc.numPages, 20);
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += `${textFromPdfItems(content.items as { str?: string; transform?: number[] }[])}\n`;
  }
  const renderPages = async () => {
    const rendered: Blob[] = [];
    for (let i = 1; i <= limit; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = document.createElement("canvas");
      const maxEdge = 3000;
      const scaleDown = Math.min(1, maxEdge / Math.max(viewport.width, viewport.height));
      canvas.width = Math.round(viewport.width * scaleDown);
      canvas.height = Math.round(viewport.height * scaleDown);
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: 1.4 * scaleDown }) }).promise;
      rendered.push(await toJpeg(canvas, 0.8));
    }
    return rendered;
  };
  const pages = text.replace(/\s/g, "").length < 20 ? await renderPages() : [];
  return { text, pages, renderPages };
}

export function textExtractionUseful(kind: "vat" | "social_security", extraction: Extraction | null): boolean {
  if (!extraction) return false;
  if (kind === "social_security") return typeof extraction.headcount === "number";
  return (extraction.periods || []).some((period) => Boolean(period.start) || period.sales !== undefined || period.vat_payable !== undefined);
}

export function extractionFromPdfText(text: string, filename: string): Extraction {
  return filename.includes("社保") || text.includes("险种") ? parseSsText(text) : parseVatText(text);
}
