import type { EvalItem, EvalResult, PolicyRule, Profile, RuleCondition, StaffMap, Tier } from "./types";

const FUND_CATEGORY = "资金补贴（提示）";

export function roundEstimate(low: number, high: number): { low: number; high: number } {
  const l = !Number.isFinite(low) || low <= 0 ? 0 : Math.floor(low / 1000) * 1000;
  const h = !Number.isFinite(high) || high <= 0 ? 0 : Math.ceil(high / 1000) * 1000;
  return { low: l, high: Math.max(l, h) };
}

export function formatYuan(n: number): string {
  if (n === 0) return "0 元";
  if (n >= 10000) {
    const wan = n / 10000;
    const text = Number.isInteger(wan) ? String(wan) : wan.toFixed(1).replace(/\.0$/, "");
    return `${text} 万元`;
  }
  return `${Math.round(n).toLocaleString("zh-CN")} 元`;
}

export function formatRange(low: number, high: number): string {
  return `预计可享受政策优惠约 ${formatYuan(low)}–${formatYuan(high)}/年`;
}

export const DISCLAIMER =
  "此为系统初步预估，不构成任何承诺；实际能否享受及金额，以资料核实和主管部门审核为准。税费优惠多表现为少缴税费，并非现金到账。";

function regionMatches(profileRegion: string, ruleRegions: string[]): boolean {
  if (!ruleRegions.length) return true;
  if (ruleRegions.some((r) => r === "CN" || r === "全国" || r === "*")) return true;
  return ruleRegions.some((r) => profileRegion.startsWith(r));
}

function yearsSince(value: unknown, now: Date): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  const yearOnly = /^(\d{4})$/.exec(raw);
  const d = yearOnly ? new Date(Date.UTC(Number(yearOnly[1]), 0, 1)) : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function readField(field: string, profile: Profile, staff: StaffMap): { known: boolean; value: unknown } {
  if (field.startsWith("staff.")) {
    const group = field.slice(6);
    if (group === "key_group") {
      const poverty = staff.poverty;
      const unemployed = staff.unemployed;
      if (poverty === undefined && unemployed === undefined) return { known: false, value: null };
      return { known: true, value: (poverty ?? 0) + (unemployed ?? 0) };
    }
    if (staff[group] === undefined) return { known: false, value: null };
    return { known: true, value: staff[group] };
  }
  const value = profile[field];
  if (value === undefined || value === null || value === "") return { known: false, value: null };
  return { known: true, value };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function containsAny(hay: unknown, needles: unknown): boolean {
  const list = Array.isArray(needles) ? needles.map(String) : [String(needles)];
  const blob = Array.isArray(hay) ? hay.map(String).join("\n") : String(hay ?? "");
  return list.some((n) => n && blob.includes(n));
}

export function evalCondition(cond: RuleCondition, profile: Profile, staff: StaffMap, now: Date): "true" | "false" | "unknown" {
  if (cond.op === "exists") {
    return readField(cond.field, profile, staff).known ? "true" : "false";
  }
  const got = readField(cond.field, profile, staff);
  if (!got.known) return "unknown";
  const value = got.value;
  switch (cond.op) {
    case "eq":
      return value === cond.value || String(value) === String(cond.value) ? "true" : "false";
    case "neq":
      return value === cond.value || String(value) === String(cond.value) ? "false" : "true";
    case "gte": {
      const n = asNumber(value);
      const t = asNumber(cond.value);
      if (n === null || t === null) return "unknown";
      return n >= t ? "true" : "false";
    }
    case "lte": {
      const n = asNumber(value);
      const t = asNumber(cond.value);
      if (n === null || t === null) return "unknown";
      return n <= t ? "true" : "false";
    }
    case "in": {
      const arr = Array.isArray(cond.value) ? cond.value.map(String) : [];
      return arr.includes(String(value)) ? "true" : "false";
    }
    case "not_in": {
      const arr = Array.isArray(cond.value) ? cond.value.map(String) : [];
      return arr.includes(String(value)) ? "false" : "true";
    }
    case "contains_any":
      return containsAny(value, cond.value) ? "true" : "false";
    case "years_since_gte":
    case "years_since_lte": {
      const years = yearsSince(value, now);
      const t = asNumber(cond.value);
      if (years === null || t === null) return "unknown";
      return cond.op === "years_since_gte" ? (years >= t ? "true" : "false") : years <= t ? "true" : "false";
    }
    default:
      return "unknown";
  }
}

function isFund(rule: PolicyRule): boolean {
  return rule.category.includes("资金补贴") || rule.cap_tier === "verify" && rule.code.startsWith("FUND_HINT");
}

function estimateOf(rule: PolicyRule, profile: Profile, staff: StaffMap): { low: number; high: number } | null {
  const est = rule.estimate;
  if (!est) return null;
  if (rule.category.includes("资金补贴")) return null;
  if (est.type === "per_head_capped") {
    const count = readField(est.count_field, profile, staff);
    const verified = count.known ? asNumber(count.value) ?? 0 : 0;
    let cand = 0;
    if (est.candidate_field) {
      const c = readField(est.candidate_field, profile, staff);
      if (c.known) cand = asNumber(c.value) ?? 0;
    }
    let low = Math.max(0, verified) * est.rate;
    let high = Math.max(0, verified + cand) * est.rate;
    if (est.cap_field) {
      const cap = readField(est.cap_field, profile, staff);
      if (cap.known) {
        const capN = Math.max(0, asNumber(cap.value) ?? 0);
        low = Math.min(low, capN);
        high = Math.min(high, capN);
      }
    }
    return { low, high };
  }
  const personal = asNumber(profile[est.personal_field || "ss_personal_month"]);
  const headcount = asNumber(profile[est.headcount_field || "headcount"]);
  if (personal === null || headcount === null || headcount <= 0) return null;
  const per = personal / headcount;
  const count = readField(est.count_field, profile, staff);
  const verified = count.known ? asNumber(count.value) ?? 0 : 0;
  let cand = 0;
  if (est.candidate_field) {
    const c = readField(est.candidate_field, profile, staff);
    if (c.known) cand = asNumber(c.value) ?? 0;
  }
  const factor = per * est.ratio * est.months;
  return { low: Math.max(0, verified) * factor, high: Math.max(0, verified + cand) * factor };
}

function coveredRegion(code: string | null): boolean {
  if (!code) return true;
  return code.startsWith("4403") || code.startsWith("4419");
}

export function evaluate(profile: Profile, staff: StaffMap, rules: PolicyRule[], opts?: { now?: Date }): EvalResult {
  const now = opts?.now ?? new Date();
  const region = typeof profile.region_code === "string" ? profile.region_code : "";
  const entity = typeof profile.entity_type === "string" ? profile.entity_type : "";
  const regionUnknown = !region;
  const entityUnknown = !entity || entity === "unknown";
  const items: EvalItem[] = [];

  for (const rule of rules) {
    const regionKnown = !regionUnknown;
    const entityKnown = !entityUnknown;
    if (regionKnown && !regionMatches(region, rule.regions)) {
      if (rule.show_when_rejected) {
        items.push(item(rule, "reject", "", "", "地区不在本政策适用范围", null));
      }
      continue;
    }
    if (entityKnown && rule.entity_types.length && !rule.entity_types.includes(entity)) {
      if (rule.show_when_rejected) {
        items.push(item(rule, "reject", "", "", "主体类型不适用", null));
      }
      continue;
    }

    let tier: Tier = "go";
    const verify: string[] = [];
    const reasons: string[] = [];
    const hard = rule.conditions.filter((c) => c.level === "hard");
    const soft = rule.conditions.filter((c) => c.level === "soft");

    for (const cond of hard) {
      const result = evalCondition(cond, profile, staff, now);
      if (result === "false") {
        tier = "reject";
        reasons.push(cond.text);
      } else if (result === "unknown" && tier !== "reject") {
        tier = "verify";
        verify.push(cond.verify || cond.text);
      }
    }

    if (tier !== "reject" && soft.length) {
      const softResults = soft.map((cond) => ({ cond, result: evalCondition(cond, profile, staff, now) }));
      if (softResults.every((s) => s.result === "false")) {
        tier = "reject";
        reasons.push("待核实事项已确认不符合");
      } else {
        for (const s of softResults) {
          if (s.result === "unknown") verify.push(s.cond.verify || s.cond.text);
        }
      }
    }

    if ((rule.cap_tier === "verify" || isFund(rule)) && tier === "go") tier = "verify";
    if ((regionUnknown || entityUnknown) && tier === "go") {
      tier = "verify";
      verify.unshift("待确认企业所在地区或主体类型");
    }

    const est = tier === "reject" ? null : estimateOf(rule, profile, staff);
    items.push(
      item(
        rule,
        tier,
        rule.conditions.map((c) => c.text).join("；"),
        unique(verify).join("；"),
        reasons.join("；"),
        est,
      ),
    );
  }

  const order: Record<Tier, number> = { go: 0, verify: 1, reject: 2 };
  items.sort((a, b) => order[a.tier] - order[b.tier]);
  const sumLow = items.reduce((s, it) => s + (it.in_estimate ? it.estimate_low : 0), 0);
  const sumHigh = items.reduce((s, it) => s + (it.in_estimate ? it.estimate_high : 0), 0);
  const rounded = roundEstimate(sumLow, sumHigh);
  return {
    items,
    estimate_low: rounded.low,
    estimate_high: rounded.high,
    region_uncovered: Boolean(region) && !coveredRegion(region),
  };
}

function unique(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

function item(
  rule: PolicyRule,
  tier: Tier,
  conditions: string,
  verify: string,
  reason: string,
  est: { low: number; high: number } | null,
): EvalItem {
  const inEstimate = Boolean(est) && tier !== "reject" && !rule.category.includes("资金补贴");
  return {
    code: rule.code,
    name: rule.name,
    category: rule.category,
    tier,
    conditions_text: conditions,
    verify_text: verify,
    reason,
    basis: rule.basis,
    url: rule.url,
    policy_version_id: rule.policy_version_id,
    in_estimate: inEstimate,
    estimate_low: est?.low ?? 0,
    estimate_high: est?.high ?? 0,
    cap_tier: rule.cap_tier ?? null,
  };
}
