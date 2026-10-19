import * as XLSX from "xlsx";
import { parseMatrices, type Extraction } from "@shared/parsers/tabular";

self.onmessage = (event: MessageEvent<{ buf: ArrayBuffer; filename: string }>) => {
  try {
    const wb = XLSX.read(event.data.buf, { type: "array" });
    const sheets = wb.SheetNames.map((name) => ({
      name,
      rows: (XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, raw: false, defval: "" }) as unknown[][]).map((row) =>
        row.map((cell) => String(cell ?? "")),
      ),
    }));
    const extraction: Extraction = parseMatrices(sheets, event.data.filename);
    self.postMessage({ ok: true, extraction });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : "表格读不了" });
  }
};
