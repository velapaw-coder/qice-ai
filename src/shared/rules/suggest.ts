import { parseRule } from "./schema";
import type { Estimate, PerHeadEstimate, PolicyRule, RuleCondition, RuleOp, SsRatioEstimate } from "./types";

/** Fields the rules engine can read from a company profile or staff map. */
export const PROFILE_FIELDS = new Set([
  "tax_normal",
  "headcount",
  "staff.poverty",
  "staff.unemployed",
  "staff.key_group",
  "staff.veteran",
  "staff.disabled",
  "staff.graduate",
  "prior_unclaimed",
  "prior_unclaimed_vet",
  "internship_ready",
  "size_class",
  "dishonest",
  "skill_cert",
  "apprentice_partner",
  "entity_type",
  "fund_project",
  "established",
  "startup_eligible",
  "revenue_12m",
  "scale_up_first",
  "srdi_first",
  "young_candidates",
  "ss_personal_month",
  "ss_total_month",
  "tax_paid_12m",
  "vat_paid_12m",
  "surtax_paid_12m",
  "taxpayer_type",
  "region_code",
  "city",
  "operating",
  "name_match",
  "uscc",
]);

const OPS = new Set<RuleOp>(["eq", "neq", "gte", "lte", "in", "not_in", "contains_any", "years_since_gte", "years_since_lte", "exists"]);

const TOP_LEVEL = new Set(["code", "name", "category", "regions", "entity_types", "conditions", "estimate", "cap_tier", "basis", "url", "show_when_rejected"]);

const CONDITION_KEYS = new Set(["field", "op", "value", "level", "text", "verify"]);

const WRAPPER_KEYS = new Set([
  "relevant",
  "ignore_reason",
  "name",
  "doc_no",
  "issuer",
  "region",
  "entity",
  "category",
  "effective_from",
  "effective_to",
  "confidence",
  "definition_json",
]);

export function isAllowedField(field: string): boolean {
  if (PROFILE_FIELDS.has(field)) return true;
  return /^staff\.[a-z][a-z0-9_]{0,32}$/.test(field);
}

export const POLICY_EXTRACTION_PROMPT = `你是政策规则抽取器。只输出一个 JSON 对象，不要 Markdown。
外层只允许这些键：relevant(boolean), ignore_reason(string), name, doc_no, issuer, region, entity, category, effective_from, effective_to, confidence(0到1的数字), definition_json。
definition_json 必须是规则引擎的条件格式，不能发明字段。禁止出现 policy_type、subsidy_amount、amount、hard、soft 或任何未列出的键。
definition_json 的形状：
{
  "code": "大写字母数字下划线，3到40位",
  "name": "政策名称",
  "category": "类别",
  "regions": ["4403"],
  "entity_types": ["enterprise"],
  "conditions": [
    {"field":"画像字段","op":"eq|neq|gte|lte|in|not_in|contains_any|years_since_gte|years_since_lte|exists","value":null,"level":"hard|soft","text":"给人看的一句条件","verify":"可选的核实说明"}
  ],
  "estimate": null,
  "cap_tier": null,
  "basis": "依据原文标题",
  "url": "",
  "show_when_rejected": false
}
field 只能是：tax_normal, headcount, staff.poverty, staff.unemployed, staff.key_group, staff.veteran, staff.disabled, staff.graduate, staff.其他小写分组, prior_unclaimed, prior_unclaimed_vet, internship_ready, size_class, dishonest, skill_cert, apprentice_partner, entity_type, fund_project, established, startup_eligible, revenue_12m, scale_up_first, srdi_first, young_candidates, ss_personal_month, ss_total_month, tax_paid_12m, vat_paid_12m, surtax_paid_12m, taxpayer_type, region_code, city, operating, name_match, uscc。
estimate 只能是 null，或 {"type":"per_head_capped","count_field":"staff.xxx","rate":数字,"candidate_field":null,"cap_field":null}，或 {"type":"ss_ratio","count_field":"staff.xxx","ratio":数字,"months":数字,"personal_field":"ss_personal_month","headcount_field":"headcount","candidate_field":null}。
cap_tier 只能是 "verify" 或 null。无法确定的条件不要编造，放到 verify 文本里。`;

export interface SuggestedRuleResult {
  rule: PolicyRule | null;
  flags: string[];
  dropped: string[];
}

export function normalizeSuggestedRule(input: unknown): SuggestedRuleResult {
  if (input && typeof input === "object" && !Array.isArray(input) && "definition_json" in input) {
    const wrap = input as Record<string, unknown>;
    const inner = normalizeSuggestedRule(wrap.definition_json);
    for (const key of Object.keys(wrap)) {
      if (!WRAPPER_KEYS.has(key)) inner.dropped.push(key);
    }
    return inner;
  }
  const flags: string[] = [];
  const dropped: string[] = [];
  let raw: unknown = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { rule: null, flags: ["建议规则不是合法 JSON"], dropped };
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { rule: null, flags: ["建议规则不是对象，不能作为可用规则"], dropped };
  }
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    if (!TOP_LEVEL.has(key)) dropped.push(key);
  }
  const conditions = sanitizeConditions(src.conditions, flags);
  const estimate = src.estimate == null ? null : sanitizeEstimate(src.estimate, flags, dropped);
  let cap_tier: "verify" | null = null;
  if (src.cap_tier != null && src.cap_tier !== "verify") {
    dropped.push("cap_tier");
    flags.push("cap_tier 只能是 verify，已丢弃");
  } else if (src.cap_tier === "verify") cap_tier = "verify";
  const regions = Array.isArray(src.regions) ? src.regions.filter((item): item is string => typeof item === "string") : [];
  const entity_types = Array.isArray(src.entity_types) ? src.entity_types.filter((item): item is string => typeof item === "string") : ["enterprise"];
  if (!conditions.length) {
    flags.push("没有可用条件，建议规则未保存");
    return { rule: null, flags, dropped };
  }
  const clean: Record<string, unknown> = {
    code: src.code,
    name: src.name,
    category: src.category,
    regions,
    entity_types,
    conditions,
    estimate,
    cap_tier,
  };
  if (typeof src.basis === "string") clean.basis = src.basis;
  if (typeof src.url === "string") clean.url = src.url;
  if (typeof src.show_when_rejected === "boolean") clean.show_when_rejected = src.show_when_rejected;
  const parsed = parseRule(clean);
  if (!parsed.rule) {
    flags.push(parsed.error || "规则未通过校验");
    return { rule: null, flags, dropped };
  }
  return { rule: parsed.rule, flags, dropped };
}

function sanitizeConditions(input: unknown, flags: string[]): RuleCondition[] {
  if (!Array.isArray(input)) {
    if (input != null) flags.push("conditions 不是数组，已丢弃");
    return [];
  }
  const kept: RuleCondition[] = [];
  for (const cond of input) {
    if (!cond || typeof cond !== "object") {
      flags.push("丢弃了格式不正确的条件");
      continue;
    }
    const row = cond as Record<string, unknown>;
    const field = String(row.field ?? "");
    const op = String(row.op ?? "");
    if (!isAllowedField(field)) {
      flags.push(`丢弃未知字段条件：${field || "空"}`);
      continue;
    }
    if (!OPS.has(op as RuleOp)) {
      flags.push(`丢弃不支持的运算符：${op || "空"}`);
      continue;
    }
    if (row.level !== "hard" && row.level !== "soft") {
      flags.push(`丢弃 level 不正确的条件：${field}`);
      continue;
    }
    if (typeof row.text !== "string" || !row.text.trim()) {
      flags.push(`丢弃缺少说明的条件：${field}`);
      continue;
    }
    const next: RuleCondition = { field, op: op as RuleOp, level: row.level, text: row.text.trim() };
    if ("value" in row && CONDITION_KEYS.has("value")) next.value = row.value;
    if (typeof row.verify === "string" && row.verify.trim()) next.verify = row.verify.trim();
    kept.push(next);
  }
  return kept;
}

function sanitizeEstimate(input: unknown, flags: string[], dropped: string[]): Estimate | null {
  if (!input || typeof input !== "object") {
    flags.push("估算不是对象，已丢弃");
    return null;
  }
  const est = input as Record<string, unknown>;
  const allowed = new Set(["type", "count_field", "candidate_field", "rate", "cap_field", "ratio", "months", "personal_field", "headcount_field"]);
  for (const key of Object.keys(est)) {
    if (!allowed.has(key)) dropped.push(`estimate.${key}`);
  }
  if (est.type === "per_head_capped") {
    if (typeof est.count_field !== "string" || !isAllowedField(est.count_field) || typeof est.rate !== "number") {
      flags.push("per_head_capped 不可用，已丢弃估算");
      return null;
    }
    const out: PerHeadEstimate = { type: "per_head_capped", count_field: est.count_field, rate: est.rate };
    if (typeof est.candidate_field === "string" && isAllowedField(est.candidate_field)) out.candidate_field = est.candidate_field;
    if (typeof est.cap_field === "string" && isAllowedField(est.cap_field)) out.cap_field = est.cap_field;
    return out;
  }
  if (est.type === "ss_ratio") {
    if (typeof est.count_field !== "string" || !isAllowedField(est.count_field) || typeof est.ratio !== "number" || typeof est.months !== "number") {
      flags.push("ss_ratio 不可用，已丢弃估算");
      return null;
    }
    const out: SsRatioEstimate = { type: "ss_ratio", count_field: est.count_field, ratio: est.ratio, months: est.months };
    if (typeof est.candidate_field === "string" && isAllowedField(est.candidate_field)) out.candidate_field = est.candidate_field;
    if (typeof est.personal_field === "string" && isAllowedField(est.personal_field)) out.personal_field = est.personal_field;
    if (typeof est.headcount_field === "string" && isAllowedField(est.headcount_field)) out.headcount_field = est.headcount_field;
    return out;
  }
  flags.push("估算类型只支持 per_head_capped 和 ss_ratio，已丢弃");
  return null;
}

export interface AppliedSuggestion {
  rule: PolicyRule | null;
  suggested_definition_json: string | null;
  extracted: Record<string, unknown>;
  confidence: Record<string, unknown>;
  flags: string[];
  dropped: string[];
}

/** Turn a model JSON payload into the columns stored on a policy draft. */
export function applyModelSuggestion(llm: Record<string, unknown> | null): AppliedSuggestion {
  if (!llm) {
    return { rule: null, suggested_definition_json: null, extracted: {}, confidence: {}, flags: [], dropped: [] };
  }
  const normalized = normalizeSuggestedRule(llm);
  const flags = normalized.flags;
  const dropped = normalized.dropped;
  return {
    rule: normalized.rule,
    suggested_definition_json: normalized.rule ? JSON.stringify(normalized.rule) : null,
    extracted: {
      relevant: llm.relevant ?? null,
      ignore_reason: llm.ignore_reason ?? "",
      name: llm.name ?? "",
      doc_no: llm.doc_no ?? "",
      issuer: llm.issuer ?? "",
      rule_flags: flags,
      invalid_fields: dropped,
    },
    confidence: {
      score: typeof llm.confidence === "number" ? llm.confidence : null,
      flags,
      dropped,
    },
    flags,
    dropped,
  };
}
