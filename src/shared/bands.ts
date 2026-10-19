export interface EstimateBand {
  id: string;
  low: number;
  high: number | null;
  label: string;
}

export const DEFAULT_BANDS: EstimateBand[] = [
  { id: "1-3", low: 10_000, high: 30_000, label: "1–3万" },
  { id: "3-8", low: 30_000, high: 80_000, label: "3–8万" },
  { id: "8-15", low: 80_000, high: 150_000, label: "8–15万" },
  { id: "15-30", low: 150_000, high: 300_000, label: "15–30万" },
  { id: "30-50", low: 300_000, high: 500_000, label: "30–50万" },
  { id: "50+", low: 500_000, high: null, label: "50万以上" },
];

function wanNumber(yuan: number): string {
  const wan = yuan / 10_000;
  return Number.isInteger(wan) ? String(wan) : String(Math.round(wan * 10) / 10);
}

export function formatPublicBand(band: EstimateBand): string {
  if (band.high == null) return `预计可申请：${wanNumber(band.low)} 万元以上`;
  return `预计可申请：${wanNumber(band.low)}–${wanNumber(band.high)} 万元`;
}

export function suggestBand(amountYuan: number, bands: EstimateBand[] = DEFAULT_BANDS): EstimateBand {
  const sorted = [...bands].sort((a, b) => a.low - b.low);
  const first = sorted[0];
  if (!first) return DEFAULT_BANDS[0]!;
  const amount = Number.isFinite(amountYuan) ? amountYuan : 0;
  if (amount < first.low) return first;
  for (const band of sorted) {
    if (band.high == null || amount < band.high) return band;
  }
  return sorted[sorted.length - 1]!;
}

export function parseBands(raw: string | null | undefined): EstimateBand[] {
  if (!raw?.trim()) return DEFAULT_BANDS;
  try {
    const checked = validateBands(JSON.parse(raw));
    return checked.ok ? checked.bands : DEFAULT_BANDS;
  } catch {
    return DEFAULT_BANDS;
  }
}

export function validateBands(input: unknown): { ok: true; bands: EstimateBand[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0 || input.length > 12) {
    return { ok: false, error: "请保留 1 到 12 个预估档" };
  }
  const bands: EstimateBand[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") return { ok: false, error: "预估档格式不正确" };
    const item = row as Record<string, unknown>;
    const low = Number(item.low);
    const high = item.high === null || item.high === undefined || item.high === "" ? null : Number(item.high);
    const label = String(item.label || "").trim();
    if (!Number.isFinite(low) || low < 0) return { ok: false, error: "档位下限需要是大于等于 0 的金额" };
    if (high !== null && (!Number.isFinite(high) || high <= low)) return { ok: false, error: "档位上限需要高于下限" };
    if (!label || label.length > 20) return { ok: false, error: "每个档位需要 20 字以内的名称" };
    const idRaw = String(item.id || "").trim();
    const id = /^[A-Za-z0-9_+-]{1,32}$/.test(idRaw) ? idRaw : `${Math.round(low)}-${high == null ? "up" : Math.round(high)}`;
    bands.push({ id, low: Math.round(low), high: high == null ? null : Math.round(high), label });
  }
  bands.sort((a, b) => a.low - b.low);
  const ids = new Set<string>();
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    if (ids.has(band.id)) return { ok: false, error: "档位编号不能重复" };
    ids.add(band.id);
    if (band.high == null && i !== bands.length - 1) return { ok: false, error: "只有最后一档可以不设上限" };
    const next = bands[i + 1];
    if (next && band.high != null && next.low < band.high) return { ok: false, error: "档位之间不能重叠" };
  }
  return { ok: true, bands };
}
