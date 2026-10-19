import { cityFromRegion, entityFromUscc, isUnsupportedEntity, isValidUscc, namesMatch, regionFromUscc, type EntityKind } from "./uscc";
import type { Extraction, VatPeriod } from "./parsers/tabular";

export interface BuiltProfile {
  profile: Record<string, unknown>;
  entity: EntityKind;
  unsupported: boolean;
  warnings: string[];
  uscc: string | null;
  uscc_source: string | null;
  region_code: string | null;
  city: string | null;
  name_match: boolean | null;
}

function periodKey(p: VatPeriod): string {
  return `${p.start}|${p.end}`;
}

function monthsCovered(periods: VatPeriod[]): number {
  const months = new Set<string>();
  for (const p of periods) {
    if (!p.start) continue;
    const start = new Date(p.start + "T00:00:00Z");
    const end = new Date((p.end || p.start) + "T00:00:00Z");
    if (Number.isNaN(start.getTime())) continue;
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const last = Number.isNaN(end.getTime()) ? cursor : end;
    while (cursor <= last && months.size < 36) {
      months.add(`${cursor.getUTCFullYear()}-${cursor.getUTCMonth()}`);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  return months.size;
}

export function sizeClass(headcount: number | null, revenue: number | null): string | null {
  if (headcount === null && revenue === null) return null;
  const smallHead = headcount === null || headcount <= 300;
  const smallRev = revenue === null || revenue < 20_000_000;
  if (smallHead && smallRev) return "small";
  return "medium";
}

export function buildProfile(input: {
  registeredName: string;
  files: Extraction[];
  consultant?: Record<string, unknown>;
}): BuiltProfile {
  const warnings: string[] = [];
  const vat = input.files.filter((f) => f.detected_type === "vat" && f.parse_status !== "failed");
  const ss = input.files.filter((f) => f.detected_type === "social_security" && f.parse_status !== "failed");
  const usccs = [...vat, ...ss]
    .map((f) => f.uscc)
    .filter((v): v is string => Boolean(v));
  const uniqueUscc = [...new Set(usccs)];
  let uscc: string | null = null;
  if (uniqueUscc.length > 1) warnings.push("多份资料的纳税人识别号不一致");
  else if (uniqueUscc.length === 1 && isValidUscc(uniqueUscc[0])) uscc = uniqueUscc[0]!.toUpperCase();
  else if (usccs.length === 0 && input.files.some((f) => f.warnings?.some((w) => w.includes("校验位")))) {
    warnings.push("识别号校验未通过，主体和地区待顾问确认");
  }

  const textHint = input.files.map((f) => f.entity_hint || "").join(" ");
  const entity = entityFromUscc(uscc, textHint);
  if (isUnsupportedEntity(entity)) warnings.push(entity === "individual" ? "识别为个体工商户，线上不出方案" : "主体类型不在线上服务范围");

  const region = regionFromUscc(uscc);
  const city = cityFromRegion(region) || input.files.find((f) => f.region_hint)?.region_hint || null;
  if (region && !region.startsWith("4403") && !region.startsWith("4419")) warnings.push("地区未覆盖，需人工评估");

  const names = input.files.map((f) => f.company_name).filter((v): v is string => Boolean(v));
  const name_match = names.length ? names.some((n) => namesMatch(n, input.registeredName)) : null;
  if (name_match === false) warnings.push("资料上的单位名称与注册企业名称不一致");

  const periodMap = new Map<string, VatPeriod>();
  for (const file of vat) {
    for (const p of file.periods || []) {
      const key = periodKey(p);
      const prev = periodMap.get(key);
      if (!prev) periodMap.set(key, { ...p });
      else {
        periodMap.set(key, {
          start: p.start || prev.start,
          end: p.end || prev.end,
          sales: p.sales ?? prev.sales,
          vat_payable: p.vat_payable ?? prev.vat_payable,
          surtax: p.surtax ?? prev.surtax,
        });
      }
    }
  }
  const periods = [...periodMap.values()];
  let revenue = 0;
  let vatPaid = 0;
  let surtax = 0;
  let surtaxEstimated = false;
  let hasSales = false;
  let hasVat = false;
  for (const p of periods) {
    if (typeof p.sales === "number") {
      revenue += p.sales;
      hasSales = true;
    }
    if (typeof p.vat_payable === "number") {
      vatPaid += p.vat_payable;
      hasVat = true;
    }
    if (typeof p.surtax === "number") surtax += p.surtax;
    else if (typeof p.vat_payable === "number") {
      surtax += p.vat_payable * 0.12;
      surtaxEstimated = true;
    }
  }
  if (surtaxEstimated) warnings.push("附加税费按增值税的 12% 估算");
  const covered = monthsCovered(periods);
  const tax_normal = covered >= 10 || periods.length >= 4;

  const ssFile = ss[0];
  const headcount = typeof ssFile?.headcount === "number" ? ssFile.headcount : null;
  const taxpayer = vat.find((f) => f.taxpayer_type)?.taxpayer_type ?? null;
  const profile: Record<string, unknown> = {
    uscc,
    entity_type: entity === "unknown" ? null : entity,
    region_code: region,
    city,
    taxpayer_type: taxpayer,
    revenue_12m: hasSales ? round2(revenue) : null,
    vat_paid_12m: hasVat ? round2(vatPaid) : null,
    surtax_paid_12m: hasVat || surtax ? round2(surtax) : null,
    surtax_estimated: surtaxEstimated,
    tax_paid_12m: hasVat ? round2(vatPaid + surtax) : null,
    tax_normal: periods.length ? tax_normal : null,
    headcount,
    ss_total_month: ssFile?.ss_total_month ?? null,
    ss_personal_month: ssFile?.ss_personal_month ?? null,
    young_candidates: ssFile?.young_candidates ?? null,
    size_class: sizeClass(headcount, hasSales ? revenue : null),
    name_match,
    operating: periods.length ? tax_normal : null,
  };

  const consultant = input.consultant || {};
  for (const [key, value] of Object.entries(consultant)) {
    if (value !== undefined && value !== null && value !== "") profile[key] = value;
  }
  if (consultant.headcount !== undefined || consultant.revenue_12m !== undefined) {
    const hc = typeof profile.headcount === "number" ? profile.headcount : null;
    const rev = typeof profile.revenue_12m === "number" ? profile.revenue_12m : null;
    if (!consultant.size_class) profile.size_class = sizeClass(hc, rev);
  }

  return {
    profile,
    entity,
    unsupported: isUnsupportedEntity(entity),
    warnings,
    uscc,
    uscc_source: uscc ? "client" : null,
    region_code: region,
    city,
    name_match,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function extractionLooksUnsafe(json: unknown): string | null {
  const text = JSON.stringify(json);
  if (text.length > 48_000) return "识别结果过大";
  if (/\d{17}[\dXx]/.test(text)) return "识别结果包含证件号码，已被拒绝";
  return null;
}
