import type { Extraction, VatPeriod } from "@shared/parsers/tabular";
import { isValidUscc } from "@shared/uscc";
import { ApiError, api } from "./api";

type VisionTask = "vat_image" | "ss_image";

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

function parseModelJson(content: string): Record<string, unknown> | null {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      resolve(text.includes(",") ? text.slice(text.indexOf(",") + 1) : text);
    };
    reader.onerror = () => reject(new Error("图片无法读取"));
    reader.readAsDataURL(blob);
  });
}

function toExtraction(kind: "vat" | "social_security", raw: Record<string, unknown>): Extraction {
  const usccRaw = String(raw.uscc || "").toUpperCase().replace(/\s/g, "");
  const uscc = isValidUscc(usccRaw) ? usccRaw : undefined;
  const periods = Array.isArray(raw.periods)
    ? raw.periods.map((row) => {
        const item = row as Record<string, unknown>;
        const period: VatPeriod = {
          start: String(item.start || ""),
          end: String(item.end || ""),
          sales: asNumber(item.sales),
          vat_payable: asNumber(item.vat_payable),
          surtax: asNumber(item.surtax),
        };
        return period;
      })
    : undefined;
  const warnings: string[] = [];
  if (raw.unreadable === true) warnings.push("模型标记这页读不清");
  if (!uscc && usccRaw) warnings.push("纳税人识别号校验位未通过，已标为未知");
  const partial = warnings.length > 0 || (kind === "vat" ? !periods?.length : asNumber(raw.headcount) === undefined);
  return {
    detected_type: kind,
    parse_status: partial ? "partial" : "success",
    parse_note: partial ? warnings.join("；") || "视觉识别只读到部分字段" : "视觉模型已识别",
    confidence: partial ? 0.55 : 0.8,
    source: "client_vision",
    company_name: raw.company_name ? String(raw.company_name).slice(0, 80) : undefined,
    uscc,
    uscc_valid: Boolean(uscc),
    taxpayer_type: raw.taxpayer_type === "small_scale" ? "small_scale" : raw.taxpayer_type === "general" ? "general" : undefined,
    periods: kind === "vat" ? periods : undefined,
    headcount: asNumber(raw.headcount),
    ss_total_month: asNumber(raw.ss_total_month),
    ss_personal_month: asNumber(raw.ss_personal_month),
    young_candidates: asNumber(raw.young_candidates),
    warnings,
  };
}

async function callOnce(task: VisionTask, b64: string, fallback: boolean): Promise<Extraction | "unconfigured" | "failed"> {
  try {
    const data = await api<ChatResponse>(`/api/llm/extract?task=${task}${fallback ? "&fallback=1" : ""}`, {
      method: "POST",
      body: b64,
      headers: { "content-type": "text/plain" },
    });
    const content = data.choices?.[0]?.message?.content || "";
    const json = parseModelJson(content);
    if (!json) return "failed";
    return toExtraction(task === "vat_image" ? "vat" : "social_security", json);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    const message = err instanceof Error ? err.message : "识别失败";
    if (status === 409 || status === 404 || message.includes("没有配置")) return "unconfigured";
    return "failed";
  }
}

export async function recognizeImage(task: VisionTask, blob: Blob): Promise<Extraction | "unconfigured" | string> {
  const b64 = await blobToBase64(blob);
  if (b64.length > 3_500_000) return "failed:图片过大";
  const primary = await callOnce(task, b64, false);
  if (primary === "unconfigured" || typeof primary !== "string") return primary;
  const backup = await callOnce(task, b64, true);
  if (typeof backup !== "string") return backup;
  return primary;
}

export function manualExtraction(kind: "vat" | "social_security", note: string): Extraction {
  return {
    detected_type: kind,
    parse_status: "partial",
    parse_note: note,
    confidence: 0.3,
    source: "client_vision",
    warnings: [note],
  };
}

export async function recognizePages(kind: "vat" | "social_security", pages: Blob[]): Promise<Extraction> {
  const task: VisionTask = kind === "vat" ? "vat_image" : "ss_image";
  const note = "未配置视觉模型，资料已保存。提交后进入待复核，由顾问根据原件录入。";
  const failed = "视觉识别失败，资料已保存。提交后进入待复核，由顾问手工录入。";
  let merged: Extraction | null = null;
  let sawFailure = false;
  for (const page of pages.slice(0, 5)) {
    const result = await recognizeImage(task, page);
    if (result === "unconfigured") return manualExtraction(kind, note);
    if (typeof result === "string") {
      sawFailure = true;
      continue;
    }
    merged = merged ? mergeExtraction(merged, result) : result;
  }
  if (!merged) return manualExtraction(kind, sawFailure ? failed : note);
  return merged;
}

function mergeExtraction(base: Extraction, next: Extraction): Extraction {
  const periods = [...(base.periods || [])];
  for (const period of next.periods || []) {
    if (!periods.some((item) => item.start === period.start && item.end === period.end)) periods.push(period);
  }
  return {
    ...base,
    company_name: base.company_name || next.company_name,
    uscc: base.uscc || next.uscc,
    uscc_valid: Boolean(base.uscc || next.uscc),
    taxpayer_type: base.taxpayer_type || next.taxpayer_type,
    headcount: base.headcount ?? next.headcount,
    ss_personal_month: base.ss_personal_month ?? next.ss_personal_month,
    ss_total_month: base.ss_total_month ?? next.ss_total_month,
    young_candidates: base.young_candidates ?? next.young_candidates,
    periods: periods.length ? periods : undefined,
    parse_status: base.parse_status === "success" || next.parse_status === "success" ? "success" : "partial",
    parse_note: base.parse_note,
    warnings: [...base.warnings, ...next.warnings],
  };
}
