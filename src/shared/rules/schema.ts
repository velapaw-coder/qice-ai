import type { PolicyRule } from "./types";

const OPS = new Set(["eq", "neq", "gte", "lte", "in", "not_in", "contains_any", "years_since_gte", "years_since_lte", "exists"]);

export function parseRule(input: unknown): { rule?: PolicyRule; error?: string } {
  if (!input || typeof input !== "object") return { error: "规则必须是 JSON 对象" };
  const raw = input as Record<string, unknown>;
  if (typeof raw.code !== "string" || !/^[A-Z0-9_]{3,40}$/.test(raw.code)) return { error: "code 需为 3–40 位大写字母、数字或下划线" };
  if (typeof raw.name !== "string" || raw.name.trim().length < 2) return { error: "请填写政策名称" };
  if (typeof raw.category !== "string" || !raw.category.trim()) return { error: "请填写类别" };
  if (!Array.isArray(raw.regions) || raw.regions.some((r) => typeof r !== "string")) return { error: "regions 必须是字符串数组" };
  if (!Array.isArray(raw.entity_types) || raw.entity_types.some((r) => typeof r !== "string")) return { error: "entity_types 必须是字符串数组" };
  if (!Array.isArray(raw.conditions)) return { error: "conditions 必须是数组" };
  for (const cond of raw.conditions) {
    if (!cond || typeof cond !== "object") return { error: "条件格式不正确" };
    const c = cond as Record<string, unknown>;
    if (typeof c.field !== "string" || typeof c.op !== "string" || !OPS.has(c.op)) return { error: `不支持的运算符：${String(c.op)}` };
    if (c.level !== "hard" && c.level !== "soft") return { error: "条件 level 只能是 hard 或 soft" };
    if (typeof c.text !== "string" || !c.text.trim()) return { error: "每个条件都要有给人看的 text" };
  }
  if (raw.estimate != null) {
    const est = raw.estimate as Record<string, unknown>;
    if (est.type === "per_head_capped") {
      if (typeof est.count_field !== "string" || typeof est.rate !== "number") return { error: "per_head_capped 需要 count_field 和 rate" };
    } else if (est.type === "ss_ratio") {
      if (typeof est.count_field !== "string" || typeof est.ratio !== "number" || typeof est.months !== "number") {
        return { error: "ss_ratio 需要 count_field、ratio 和 months" };
      }
    } else return { error: "估算类型只支持 per_head_capped 和 ss_ratio" };
  }
  if (raw.cap_tier != null && raw.cap_tier !== "verify") return { error: "cap_tier 只能是 verify 或空" };
  return { rule: raw as unknown as PolicyRule };
}
