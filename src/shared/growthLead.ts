import { phoneError } from "./password";

/** 官网首页增长意向。source 由服务端固定，调用方不能改来源。 */
export const GROWTH_SOURCE = "homepage";
export const GROWTH_SOURCE_LABEL = "官网首页";

export const GROWTH_INTENTS = [
  { id: "growth_talk", label: "预约增长交流" },
  { id: "scene_trial", label: "申请AI场景体验" },
] as const;

export type GrowthIntent = (typeof GROWTH_INTENTS)[number]["id"];

export const GROWTH_PAINS = ["询价遗漏", "报价慢", "跟进不及时", "重复录入、资料查找或数据分散", "其他经营效率问题"] as const;

export const GROWTH_LEAD_STATUSES = ["待联系", "已联系", "已搁置"] as const;
export type GrowthLeadStatus = (typeof GROWTH_LEAD_STATUSES)[number];

export type GrowthLeadInput = {
  company_name?: string;
  contact_name?: string;
  phone?: string;
  industry?: string;
  pain?: string;
  intent?: string;
  consent?: boolean;
};

export type GrowthLeadDraft = {
  company_name: string;
  contact_name: string;
  phone: string;
  industry: string;
  pain: string;
  intent: GrowthIntent;
};

function collapse(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function lengthError(value: string, label: string, min: number, max: number): string | null {
  if (value.length < min || value.length > max) return `${label}需要 ${min}–${max} 个字`;
  return null;
}

/** 姓名、企业和行业栏不收证件号、税号或一长串数字。 */
function sensitiveNumber(value: string): boolean {
  return /\d{6,}/.test(value);
}

export function growthIntentLabel(intent: string): string {
  return GROWTH_INTENTS.find((item) => item.id === intent)?.label || intent;
}

export function growthSourceLabel(source: string): string {
  return source === GROWTH_SOURCE ? GROWTH_SOURCE_LABEL : source;
}

export function parseGrowthLead(input: GrowthLeadInput): { ok: true; value: GrowthLeadDraft } | { ok: false; error: string } {
  const company_name = collapse(input.company_name);
  const contact_name = collapse(input.contact_name);
  const phone = collapse(input.phone);
  const industry = collapse(input.industry);
  const pain = collapse(input.pain);
  const intent = collapse(input.intent);
  const companyError = lengthError(company_name, "企业名称", 2, 60);
  if (companyError) return { ok: false, error: companyError };
  const contactError = lengthError(contact_name, "联系人", 2, 20);
  if (contactError) return { ok: false, error: contactError };
  const phoneMsg = phoneError(phone);
  if (phoneMsg) return { ok: false, error: phoneMsg };
  const industryError = lengthError(industry, "行业", 2, 40);
  if (industryError) return { ok: false, error: industryError };
  if (!GROWTH_PAINS.includes(pain as (typeof GROWTH_PAINS)[number])) return { ok: false, error: "请选择主要痛点" };
  if (!GROWTH_INTENTS.some((item) => item.id === intent)) return { ok: false, error: "请选择意向类型" };
  if (input.consent !== true) return { ok: false, error: "请先阅读并同意隐私政策" };
  if ([company_name, contact_name, industry].some(sensitiveNumber)) return { ok: false, error: "请不要在这些栏填写证件号、税号或长串数字" };
  return {
    ok: true,
    value: { company_name, contact_name, phone, industry, pain, intent: intent as GrowthIntent },
  };
}

export function growthStatusError(status: string): string | null {
  if (!GROWTH_LEAD_STATUSES.includes(status as GrowthLeadStatus)) return "状态不正确";
  return null;
}

/** 同一天、同一手机号、同一意向只保留一条，用来挡住连点。 */
export function growthDedupeKey(phone: string, intent: string, day: string): string {
  return `${phone}|${intent}|${GROWTH_SOURCE}|${day}`;
}
