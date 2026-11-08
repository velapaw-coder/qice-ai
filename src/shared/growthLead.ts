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

/** 去掉空格、短横线和 +86，只保留 1 开头的 11 位手机号，便于同一号码去重。 */
export function normalizeMobile(input: unknown): string | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  const local = digits.startsWith("86") && digits.length === 13 ? digits.slice(2) : digits;
  if (!/^1\d{10}$/.test(local)) return null;
  return local;
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
  const phone = normalizeMobile(input.phone) || "";
  const industry = collapse(input.industry);
  const pain = collapse(input.pain);
  const intent = collapse(input.intent);
  const companyError = lengthError(company_name, "企业名称", 2, 60);
  if (companyError) return { ok: false, error: companyError };
  const contactError = lengthError(contact_name, "联系人", 2, 20);
  if (contactError) return { ok: false, error: contactError };
  if (!phone) return { ok: false, error: "请填写 11 位、1 开头的手机号" };
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

export type GrowthLeadTodoKind = "待联系" | "到期跟进";

/**
 * 待联系一直留在待办。已联系只在下次跟进时间已到时出现。
 * 搁置不进入待办。未填下次跟进的已联系也不催。
 * nowIso 与 next_follow_up_at 都用 UTC ISO，字符串可直接比较。
 */
export function growthLeadTodoKind(
  status: string,
  nextFollowUpAt: string | null | undefined,
  nowIso: string,
): GrowthLeadTodoKind | null {
  if (status === "待联系") return "待联系";
  if (status === "已联系" && nextFollowUpAt && nextFollowUpAt <= nowIso) return "到期跟进";
  return null;
}

/** 把 datetime-local 的北京时间换成 UTC ISO。空值表示清空。 */
export function parseShanghaiDateTime(input: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input == null || input === "") return { ok: true, value: null };
  const text = String(input).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return { ok: false, error: "下次跟进时间请用北京时间，精确到分钟" };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (year < 2024 || year > 2100) return { ok: false, error: "下次跟进时间超出可记录范围" };
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return { ok: false, error: "下次跟进时间不正确" };
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0));
  if (Number.isNaN(utc.getTime())) return { ok: false, error: "下次跟进时间不正确" };
  const back = shanghaiLocalInput(utc.toISOString());
  if (back !== text) return { ok: false, error: "下次跟进时间不正确" };
  return { ok: true, value: utc.toISOString() };
}

/** UTC ISO 转成 datetime-local 需要的北京时间。 */
export function shanghaiLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  if (!pick("year")) return "";
  const hour = pick("hour") === "24" ? "00" : pick("hour").padStart(2, "0");
  return `${pick("year")}-${pick("month")}-${pick("day")}T${hour}:${pick("minute")}`;
}

export function growthNoteError(body: unknown): string | null {
  const text = String(body ?? "").trim();
  if (!text) return "请填写跟进备注";
  if (text.length > 1000) return "跟进备注最多 1000 字";
  return null;
}
