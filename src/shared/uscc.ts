/** GB 32100-2015 统一社会信用代码校验。字符集不含 I、O、S、V、Z。 */
export const USCC_CHARSET = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

export function usccCheckChar(body17: string): string {
  if (body17.length !== 17) throw new Error("统一社会信用代码本体须为 17 位");
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const idx = USCC_CHARSET.indexOf(body17[i]!);
    if (idx < 0) throw new Error("统一社会信用代码含非法字符");
    sum += idx * WEIGHTS[i]!;
  }
  let check = 31 - (sum % 31);
  if (check === 31) check = 0;
  return USCC_CHARSET[check]!;
}

export function makeUscc(body17: string): string {
  return body17 + usccCheckChar(body17);
}

export function isValidUscc(code: string | null | undefined): boolean {
  if (!code) return false;
  const v = code.trim().toUpperCase();
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(v)) return false;
  try {
    return usccCheckChar(v.slice(0, 17)) === v[17];
  } catch {
    return false;
  }
}

export type EntityKind = "enterprise" | "individual" | "other" | "unknown";

/** 91 企业，92 个体工商户，其他已知代码为其他主体，校验失败为未知。 */
export function entityFromUscc(uscc: string | null | undefined, textHint?: string | null): EntityKind {
  if (textHint && /个体工商户|个体户/.test(textHint)) return "individual";
  if (!uscc || !isValidUscc(uscc)) return "unknown";
  const two = uscc.trim().toUpperCase().slice(0, 2);
  if (two === "91") return "enterprise";
  if (two === "92") return "individual";
  return "other";
}

export function isUnsupportedEntity(kind: EntityKind): boolean {
  return kind === "individual" || kind === "other";
}

/** 第 3–8 位是登记管理部门行政区划。 */
export function regionFromUscc(uscc: string | null | undefined): string | null {
  if (!uscc || !isValidUscc(uscc)) return null;
  return uscc.trim().toUpperCase().slice(2, 8);
}

export function cityFromRegion(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code.startsWith("4403")) return "深圳";
  if (code.startsWith("4419")) return "东莞";
  if (code.startsWith("4401")) return "广州";
  if (code.startsWith("44")) return "广东";
  return null;
}

export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const n = (s: string) =>
    s
      .normalize("NFKC")
      .replace(/\s+/g, "")
      .replace(/[（）()【】]/g, "")
      .toLowerCase();
  return n(a) === n(b);
}
