import { isValidUscc } from "../uscc";

export interface VatPeriod {
  start: string;
  end: string;
  sales?: number;
  vat_payable?: number;
  surtax?: number;
}

export interface Extraction {
  detected_type: "vat" | "social_security" | "unknown";
  parse_status: "success" | "partial" | "failed";
  parse_note: string;
  confidence: number;
  source: "client" | "client_vision";
  company_name?: string;
  uscc?: string;
  uscc_valid?: boolean;
  taxpayer_type?: "general" | "small_scale";
  region_hint?: string;
  entity_hint?: string;
  periods?: VatPeriod[];
  headcount?: number;
  ss_total_month?: number;
  ss_personal_month?: number;
  ss_by_insurance?: Record<string, { personal: number; employer: number }>;
  young_candidates?: number;
  warnings: string[];
}

export interface SheetMatrix {
  name: string;
  rows: string[][];
}

const ID_RE = /\b\d{17}[\dXx]\b/;

export function emptyExtraction(note: string): Extraction {
  return {
    detected_type: "unknown",
    parse_status: "failed",
    parse_note: note,
    confidence: 0,
    source: "client",
    warnings: [note],
  };
}

function norm(s: string): string {
  return s.replace(/\s+/g, "").replace(/[：:]/g, "").toLowerCase();
}

function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-" || trimmed === "—") return undefined;
  if (/[A-Za-z]/.test(trimmed)) return undefined;
  const compact = trimmed.replace(/[,，\s元人民币￥¥]/g, "");
  const wrapped = /^\((.*)\)$/.exec(compact);
  const source = wrapped ? `-${wrapped[1]}` : compact;
  const match = source.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : undefined;
}

function validYmd(y: string, mo: string, d: string): boolean {
  const month = Number(mo);
  const day = Number(d);
  return Number(y) >= 1990 && Number(y) <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function parseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  const full = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/.exec(s);
  if (full && validYmd(full[1]!, full[2]!, full[3]!)) return iso(full[1]!, full[2]!, full[3]!);
  if (/^\d{8}$/.test(s)) {
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (compact && validYmd(compact[1]!, compact[2]!, compact[3]!)) return iso(compact[1]!, compact[2]!, compact[3]!);
  }
  const monthOnly = /(\d{4})\s*年\s*(\d{1,2})\s*月(?!\s*\d)/.exec(s);
  if (monthOnly && Number(monthOnly[2]) >= 1 && Number(monthOnly[2]) <= 12) return iso(monthOnly[1]!, monthOnly[2]!, "1");
  return undefined;
}

function cellDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (s.length > 20) return undefined;
  return parseDate(s);
}

function parseAmount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length <= 20 && parseDate(trimmed)) return undefined;
  return parseNumber(trimmed);
}

function iso(y: string, mo: string, d: string): string {
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function valueBeside(rows: string[][], r: number, c: number): string {
  const row = rows[r] ?? [];
  for (let i = c + 1; i < row.length; i++) {
    const v = (row[i] ?? "").trim();
    if (v) return v;
  }
  const below = (rows[r + 1]?.[c] ?? "").trim();
  return below;
}

function findLabel(rows: string[][], labels: string[]): { r: number; c: number } | null {
  const wants = labels.map(norm);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < (rows[r]?.length ?? 0); c++) {
      const v = norm(rows[r]?.[c] ?? "");
      if (!v) continue;
      if (wants.some((w) => v.includes(w))) return { r, c };
    }
  }
  return null;
}

function labelValue(rows: string[][], labels: string[]): string | undefined {
  const pos = findLabel(rows, labels);
  if (!pos) return undefined;
  const self = (rows[pos.r]?.[pos.c] ?? "").trim();
  for (const label of labels) {
    const idx = self.indexOf(label);
    if (idx >= 0) {
      const rest = self.slice(idx + label.length).replace(/^[：:\s]+/, "");
      if (rest) return rest;
    }
  }
  const beside = valueBeside(rows, pos.r, pos.c);
  if (beside) return beside;
  return undefined;
}

function score(rows: string[][], words: string[]): number {
  const blob = rows.flat().join("\n");
  return words.reduce((n, w) => n + (blob.includes(w) ? 1 : 0), 0);
}

function findHeader(rows: string[][], must: string[]): number {
  for (let r = 0; r < rows.length; r++) {
    const cells = (rows[r] ?? []).map(norm);
    if (must.every((m) => cells.some((c) => c.includes(norm(m))))) return r;
  }
  return -1;
}

function colIndex(header: string[], labels: string[]): number {
  const wants = labels.map(norm);
  return header.findIndex((h) => wants.some((w) => norm(h).includes(w)));
}

export function parseMatrices(sheets: SheetMatrix[], filename = ""): Extraction {
  const rows = sheets.flatMap((s) => s.rows);
  if (!rows.length) return emptyExtraction("文件是空的");
  const vatScore = score(rows, ["纳税人识别号", "增值税", "销售额", "应纳税额", "申报表"]);
  const ssScore = score(rows, ["证件号码", "身份证", "社保", "缴费", "险种", "参保"]);
  const nameHint = filename.includes("社保") ? "ss" : filename.includes("增值税") ? "vat" : "";
  if (nameHint === "ss" || ssScore > vatScore) return parseSocial(rows);
  if (nameHint === "vat" || vatScore > 0) return parseVat(rows);
  return emptyExtraction("识别不出这是增值税申报表还是社保清单，请改传原件或交给顾问处理");
}

export function parseVatText(text: string): Extraction {
  const cleaned = text.replace(/\u0000/g, "");
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((l) => l.split(/\t|\s+|\|/));
  const single = lines.map((l) => [l]);
  const parsed = parseVat([...rows, ...single]);
  const have = (parsed.periods || []).some((period) => period.start || period.sales !== undefined || period.vat_payable !== undefined);
  if (have) return parsed;
  const extra = periodsFromTokens(cleaned);
  if (!extra.length) return parsed;
  const drop = new Set(["找到了所属期表头，但没有读到期次数据", "没有读到增值税申报表的纳税人、所属期或税额"]);
  const warnings = parsed.warnings.filter((warning) => !drop.has(warning));
  const partial = warnings.length > 0 || !parsed.uscc_valid;
  return {
    ...parsed,
    detected_type: "vat",
    periods: extra,
    warnings,
    parse_status: partial ? "partial" : "success",
    parse_note: partial ? warnings.join("；") || "部分字段缺失" : "已识别增值税申报表",
    confidence: parsed.uscc_valid ? 0.95 : Math.max(parsed.confidence, 0.6),
    source: "client",
  };
}

function periodsFromTokens(text: string): VatPeriod[] {
  const found: VatPeriod[] = [];
  const seen = new Set<string>();
  const push = (period: VatPeriod) => {
    if (!period.start && period.sales === undefined && period.vat_payable === undefined) return;
    const key = `${period.start}|${period.end}|${period.sales ?? ""}|${period.vat_payable ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(period);
  };
  const rangeRe = /(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)\s*[至到~—–]\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)/g;
  let match: RegExpExecArray | null;
  while ((match = rangeRe.exec(text))) {
    const start = parseDate(match[1]);
    const end = parseDate(match[2]);
    if (!start || !end) continue;
    const rest = text.slice(match.index + match[0].length, match.index + match[0].length + 80);
    let sales: number | undefined;
    let vat: number | undefined;
    let surtax: number | undefined;
    let taken = 0;
    for (const token of rest.split(/[\s|]+/).filter(Boolean)) {
      if (parseDate(token)) break;
      const n = parseNumber(token);
      if (n === undefined) break;
      if (taken === 0) sales = n;
      else if (taken === 1) vat = n;
      else surtax = n;
      taken += 1;
      if (taken === 3) break;
    }
    push({ start, end, sales, vat_payable: vat, surtax });
  }
  const tokens = text.split(/[\s|]+/).filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i++) {
    const start = parseDate(tokens[i]);
    const end = parseDate(tokens[i + 1]);
    if (!start || !end) continue;
    let j = i + 2;
    const take = () => {
      if (j >= tokens.length || parseDate(tokens[j]!)) return undefined;
      const n = parseNumber(tokens[j]!);
      if (n === undefined) return undefined;
      j += 1;
      return n;
    };
    push({ start, end, sales: take(), vat_payable: take(), surtax: take() });
    i = Math.max(i + 1, j - 1);
  }
  return found;
}

export function parseSsText(text: string): Extraction {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return parseSocial(lines.map((l) => l.split(/\t|\s{2,}|\|/)));
}

function parseVat(rows: string[][]): Extraction {
  const warnings: string[] = [];
  const company = labelValue(rows, ["纳税人名称", "企业名称", "单位名称"]);
  const usccRaw = (labelValue(rows, ["纳税人识别号", "统一社会信用代码", "社会信用代码"]) || "").toUpperCase().replace(/\s/g, "");
  const uscc = /^[0-9A-Z]{18}$/.test(usccRaw) ? usccRaw : undefined;
  const usccValid = uscc ? isValidUscc(uscc) : false;
  if (uscc && !usccValid) warnings.push("纳税人识别号校验位未通过，已标为未知");
  const typeText = labelValue(rows, ["增值税纳税人类型", "纳税人类型", "纳税人类别"]) || "";
  const blob = rows.flat().join("\n");
  let taxpayer_type: Extraction["taxpayer_type"];
  if (/小规模/.test(typeText) || /小规模纳税人/.test(blob)) taxpayer_type = "small_scale";
  else if (/一般纳税人/.test(typeText) || /一般纳税人/.test(blob)) taxpayer_type = "general";
  let entity_hint: string | undefined;
  if (/个体工商户|个体户/.test(blob)) entity_hint = "个体工商户";
  const region_hint = /深圳/.test(blob) ? "深圳" : /东莞/.test(blob) ? "东莞" : undefined;

  const periods = readVatPeriods(rows, warnings);
  if (!periods.length) {
    const start = parseDate(labelValue(rows, ["所属期起", "税款所属期起", "费款所属期起"]));
    const end = parseDate(labelValue(rows, ["所属期止", "税款所属期止", "费款所属期止"]));
    const sales = parseAmount(labelValue(rows, ["销售额", "计税销售额", "应税销售额"]));
    const vat = parseAmount(labelValue(rows, ["应纳税额", "本期应补（退）税额", "本期应补(退)税额", "应补退税额"]));
    const surtax = sumSurtax(rows);
    if (start || sales !== undefined || vat !== undefined) {
      periods.push({ start: start || "", end: end || "", sales, vat_payable: vat, surtax });
    }
  }
  if (!company && !uscc && !periods.length) {
    return { ...emptyExtraction("没有读到增值税申报表的纳税人、所属期或税额"), warnings };
  }
  const partial = warnings.length > 0 || periods.length === 0 || !usccValid;
  return {
    detected_type: "vat",
    parse_status: partial ? "partial" : "success",
    parse_note: partial ? warnings.join("；") || "部分字段缺失" : "已识别增值税申报表",
    confidence: usccValid ? 0.95 : 0.6,
    source: "client",
    company_name: company,
    uscc: usccValid ? uscc : undefined,
    uscc_valid: usccValid,
    taxpayer_type,
    region_hint,
    entity_hint,
    periods,
    warnings,
  };
}

function sumSurtax(rows: string[][]): number | undefined {
  const parts = ["城市维护建设税", "城建税", "教育费附加", "地方教育附加"].map((label) => parseNumber(labelValue(rows, [label])));
  const known = parts.filter((n): n is number => n !== undefined);
  if (!known.length) return undefined;
  return known.reduce((a, b) => a + b, 0);
}

function readVatPeriods(rows: string[][], warnings: string[]): VatPeriod[] {
  const headerAt = findHeader(rows, ["所属期"]);
  if (headerAt < 0) return [];
  const header = rows[headerAt] ?? [];
  const iStart = colIndex(header, ["所属期起", "税款所属期起"]);
  const iEnd = colIndex(header, ["所属期止", "税款所属期止"]);
  const iSales = colIndex(header, ["销售额", "计税销售额"]);
  const iVat = colIndex(header, ["应纳税额", "应补(退)税额", "应补（退）税额", "应补退"]);
  const iSurtax = colIndex(header, ["附加税费", "附加税"]);
  if (iStart < 0 && iSales < 0) return [];
  const periods: VatPeriod[] = [];
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => !String(c).trim())) continue;
    if (norm(row.join("")).includes("合计") && periods.length) continue;
    const start = cellDate(row[iStart]) || "";
    const end = cellDate(row[iEnd]) || "";
    const sales = iSales >= 0 ? parseAmount(row[iSales]) : undefined;
    const vat = iVat >= 0 ? parseAmount(row[iVat]) : undefined;
    const surtax = iSurtax >= 0 ? parseAmount(row[iSurtax]) : undefined;
    if (!start && sales === undefined && vat === undefined) continue;
    periods.push({ start, end, sales, vat_payable: vat, surtax });
  }
  if (!periods.length) warnings.push("找到了所属期表头，但没有读到期次数据");
  return periods;
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];

export function validChineseId(id: string): boolean {
  const v = id.toUpperCase();
  if (!/^\d{17}[\dX]$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(v[i]) * ID_WEIGHTS[i]!;
  return ID_CHECK[sum % 11] === v[17];
}

export function makeChineseId(area: string, birth: string, seq: string): string {
  const body = `${area}${birth}${seq}`;
  if (body.length !== 17) throw new Error("身份证本体须为 17 位");
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(body[i]) * ID_WEIGHTS[i]!;
  return body + ID_CHECK[sum % 11];
}

function ageAt(birth: string, on: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return null;
  const b = new Date(birth + "T00:00:00Z");
  const o = new Date(on + "T00:00:00Z");
  let age = o.getUTCFullYear() - b.getUTCFullYear();
  const md = o.getUTCMonth() - b.getUTCMonth();
  if (md < 0 || (md === 0 && o.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

function monthsBetween(start: string, end: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
}

function insuranceBucket(name: string): "pension" | "medical" | "unemployment" | "other" {
  if (name.includes("养老")) return "pension";
  if (name.includes("医疗")) return "medical";
  if (name.includes("失业")) return "unemployment";
  return "other";
}

function parseSocial(rows: string[][]): Extraction {
  const warnings: string[] = [];
  const company = labelValue(rows, ["单位名称", "纳税人名称", "企业名称"]);
  const usccRaw = (labelValue(rows, ["统一社会信用代码", "纳税人识别号", "单位编号"]) || "").toUpperCase().replace(/\s/g, "");
  const uscc = /^[0-9A-Z]{18}$/.test(usccRaw) ? usccRaw : undefined;
  const usccValid = Boolean(uscc && isValidUscc(uscc));
  if (uscc && !usccValid) warnings.push("统一社会信用代码校验位未通过，已标为未知");
  const blob = rows.flat().join("\n");
  const region_hint = /深圳/.test(blob) ? "深圳" : /东莞/.test(blob) ? "东莞" : undefined;
  const entity_hint = /个体工商户|个体户/.test(blob) ? "个体工商户" : undefined;
  const periodText = labelValue(rows, ["费款所属期", "所属期", "缴费月份"]) || "";
  const periodDate = parseDate(periodText) || parseDate(periodText.replace("年", "-").replace("月", "-01"));
  const asOf = periodDate || "2026-09-30";

  const headerAt = findHeader(rows, ["证件"]);
  if (headerAt < 0) {
    return {
      ...emptyExtraction("没有找到证件号码列，请上传社保清单原表"),
      detected_type: "social_security",
      company_name: company,
      warnings: ["没有找到证件号码列，请上传社保清单原表"],
    };
  }
  const header = rows[headerAt] ?? [];
  const iId = colIndex(header, ["证件号码", "身份证号", "证件号", "身份证"]);
  const iIns = colIndex(header, ["险种", "险种类型", "征收品目"]);
  const iPersonal = colIndex(header, ["个人缴纳", "个人缴费", "个人部分"]);
  const iEmployer = colIndex(header, ["单位缴纳", "单位缴费", "单位部分"]);
  const iStart = colIndex(header, ["参保开始", "本次参保", "参保时间", "参保起始"]);
  if (iId < 0) return emptyExtraction("没有找到证件号码列");

  type Person = { start?: string; personal: number; employer: number; personalCore: number; idOk: boolean };
  const people = new Map<string, Person>();
  const byIns: Record<string, { personal: number; employer: number }> = {};
  let badIds = 0;

  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const id = String(row[iId] ?? "").trim().toUpperCase();
    if (!id || /合计|小计/.test(id)) continue;
    if (!/^\d{17}[\dX]$/.test(id)) continue;
    const ok = validChineseId(id);
    if (!ok) badIds += 1;
    const insName = iIns >= 0 ? String(row[iIns] ?? "") : "";
    const personal = iPersonal >= 0 ? parseNumber(row[iPersonal]) ?? 0 : 0;
    const employer = iEmployer >= 0 ? parseNumber(row[iEmployer]) ?? 0 : 0;
    const start = iStart >= 0 ? parseDate(String(row[iStart] ?? "")) : undefined;
    const bucket = insuranceBucket(insName);
    const key = insName || bucket;
    byIns[key] = byIns[key] || { personal: 0, employer: 0 };
    byIns[key]!.personal += personal;
    byIns[key]!.employer += employer;
    const person = people.get(id) || { personal: 0, employer: 0, personalCore: 0, idOk: ok, start };
    person.personal += personal;
    person.employer += employer;
    if (bucket === "pension" || bucket === "medical" || bucket === "unemployment") person.personalCore += personal;
    if (start) person.start = start;
    person.idOk = person.idOk && ok;
    people.set(id, person);
  }

  if (badIds) warnings.push(`${badIds} 条证件号码校验未通过，未计入青年候选`);
  if (!people.size) return { ...emptyExtraction("社保清单里没有读到人员明细"), warnings };

  let young = 0;
  let missingStart = 0;
  for (const [id, person] of people) {
    if (!person.idOk) continue;
    // 出生日期只在内存里推年龄，不写入结果。
    const birth = `${id.slice(6, 10)}-${id.slice(10, 12)}-${id.slice(12, 14)}`;
    const age = ageAt(birth, asOf);
    if (age === null || age >= 26 || age < 0) continue;
    if (!person.start) {
      missingStart += 1;
      continue;
    }
    const months = monthsBetween(person.start, asOf);
    if (months !== null && months >= 0 && months <= 24) young += 1;
  }
  if (missingStart) warnings.push("部分人员缺少参保开始日期，未计入青年候选");

  let personalCore = 0;
  let total = 0;
  for (const person of people.values()) {
    personalCore += person.personalCore || person.personal;
    total += person.personal + person.employer;
  }

  return {
    detected_type: "social_security",
    parse_status: warnings.length ? "partial" : "success",
    parse_note: warnings.length ? warnings.join("；") : `已识别社保清单，参保 ${people.size} 人`,
    confidence: 0.95,
    source: "client",
    company_name: company,
    uscc: usccValid ? uscc : undefined,
    uscc_valid: usccValid,
    region_hint,
    entity_hint,
    headcount: people.size,
    ss_total_month: round2(total),
    ss_personal_month: round2(personalCore),
    ss_by_insurance: byIns,
    young_candidates: young,
    warnings,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function assertNoSecrets(extraction: Extraction): string | null {
  const text = JSON.stringify(extraction);
  if (ID_RE.test(text)) return "识别结果里不能包含证件号码";
  if (/"names?"\s*:/.test(text)) return "识别结果里不能包含姓名";
  return null;
}

export function redactText(input: string): string {
  return input
    .replace(/\d{17}[\dXx]/g, "[证件号]")
    .replace(/(姓名|名字)\s*[:：]\s*[\u4e00-\u9fa5·]{2,8}/g, "$1：[姓名]");
}
