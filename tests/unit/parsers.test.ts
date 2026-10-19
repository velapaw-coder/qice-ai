import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProfile } from "@shared/profile";
import { textFromPdfItems } from "@shared/parsers/pdfText";
import { assertNoSecrets, makeChineseId, parseMatrices, parseVatText, type SheetMatrix } from "@shared/parsers/tabular";
import { isValidUscc, makeUscc } from "@shared/uscc";
import * as XLSX from "xlsx";

const uscc = makeUscc("91440300MA5QCEA01");
const sole = makeUscc("92441900MA5QCEA01");

function book(file: string): SheetMatrix[] {
  const wb = XLSX.read(readFileSync(new URL(`../../fixtures/fake/${file}`, import.meta.url)));
  return wb.SheetNames.map((name) => ({
    name,
    rows: (XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, raw: false, defval: "" }) as unknown[][]).map((row) =>
      row.map((cell) => String(cell ?? "")),
    ),
  }));
}

describe("表格解析", () => {
  it("爱华增值税表读出 4 个季度、信用代码和一般纳税人", () => {
    const vat = parseMatrices(book("爱华-增值税申报表-合成.xlsx"), "爱华-增值税申报表-合成.xlsx");
    expect(vat.detected_type).toBe("vat");
    expect(vat.parse_status).toBe("success");
    expect(vat.uscc).toBe(uscc);
    expect(isValidUscc(vat.uscc)).toBe(true);
    expect(vat.company_name).toBe("深圳爱华国际教育科技有限公司");
    expect(vat.taxpayer_type).toBe("general");
    expect(vat.periods).toHaveLength(4);
    expect(vat.periods?.reduce((sum, period) => sum + (period.sales || 0), 0)).toBe(2_400_000);
    expect(assertNoSecrets(vat)).toBeNull();
  });

  it("爱华社保清单 43 人、4 名青年候选，结果不含证件号和姓名", () => {
    const ss = parseMatrices(book("爱华-社保清单-合成.xlsx"), "爱华-社保清单-合成.xlsx");
    expect(ss.detected_type).toBe("social_security");
    expect(ss.headcount).toBe(43);
    expect(ss.young_candidates).toBe(4);
    expect(ss.ss_personal_month).toBe(43 * 800);
    expect(ss.uscc).toBe(uscc);
    const json = JSON.stringify(ss);
    expect(json).not.toContain(makeChineseId("440300", "20040115", "001"));
    expect(json).not.toContain("合成员工");
    expect(assertNoSecrets(ss)).toBeNull();
  });

  it("PDF 文本层可以还原增值税期间", () => {
    const text = [
      "增值税及附加税费申报表（一般纳税人适用）",
      "合成测试数据，非真实申报",
      "纳税人名称：深圳爱华国际教育科技有限公司",
      `纳税人识别号：${uscc}`,
      "增值税纳税人类型：一般纳税人",
      "所属期起    所属期止    销售额    应纳税额    附加税费",
      "2025-10-01    2025-12-31    600000    18000    2160",
      "2026-01-01    2026-03-31    600000    18000    2160",
      "2026-04-01    2026-06-30    600000    18000    2160",
      "2026-07-01    2026-09-30    600000    18000    2160",
    ].join("\n");
    const vat = parseVatText(text);
    expect(vat.periods).toHaveLength(4);
    expect(vat.uscc).toBe(uscc);
    expect(vat.company_name).toContain("爱华");
  });

  it("单空格、同一行和中文所属期也能读到期次", () => {
    const spaced = parseVatText([
      "纳税人名称：深圳爱华国际教育科技有限公司",
      `纳税人识别号：${uscc}`,
      "所属期起 所属期止 销售额 应纳税额 附加税费",
      "2025-10-01 2025-12-31 600000 18000 2160",
    ].join("\n"));
    expect(spaced.periods?.[0]).toMatchObject({ start: "2025-10-01", end: "2025-12-31", sales: 600000, vat_payable: 18000, surtax: 2160 });
    expect(spaced.parse_note).not.toContain("没有读到期次数据");

    const pipes = parseVatText("所属期起|所属期止|销售额|应纳税额|附加税费\n2026-01-01|2026-03-31|1200|36|4");
    expect(pipes.periods?.[0]?.sales).toBe(1200);

    const flat = parseVatText(`纳税人名称：深圳爱华国际教育科技有限公司 纳税人识别号：${uscc} 所属期起 所属期止 销售额 2025-04-01 2025-06-30 800 24`);
    expect(flat.periods?.some((period) => period.start === "2025-04-01" && period.sales === 800)).toBe(true);

    const chinese = parseVatText("税款所属期起：2025年10月1日 税款所属期止：2025年12月31日\n2025年10月1日至2025年12月31日 销售额：600,000.00 应纳税额：18,000");
    expect(chinese.periods?.some((period) => period.start === "2025-10-01" && period.end === "2025-12-31")).toBe(true);
    expect(chinese.uscc).toBeUndefined();
    expect(parseVatText(`纳税人识别号：${uscc}`).uscc).toBe(uscc);
  });

  it("合成增值税 PDF 文本层能还原四个所属期", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(readFileSync(new URL("../../fixtures/fake/爱华-增值税申报表-合成.pdf", import.meta.url)));
    const doc = await pdfjs.getDocument({ data, disableWorker: true, isEvalSupported: false } as Parameters<typeof pdfjs.getDocument>[0]).promise;
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const text = textFromPdfItems(content.items as { str?: string; transform?: number[] }[]);
    const vat = parseVatText(text);
    expect(text).toContain(uscc);
    expect(text).toContain("2025-10-01");
    expect(vat.periods).toHaveLength(4);
    expect(vat.periods?.reduce((sum, period) => sum + (period.sales || 0), 0)).toBe(2_400_000);
    expect(vat.parse_note).not.toContain("没有读到期次数据");
    expect(vat.uscc).toBe(uscc);
  });

  it("个体户资料进入暂不支持画像", () => {
    const vat = parseMatrices(book("个体户-增值税申报表-合成.xlsx"), "个体户-增值税申报表-合成.xlsx");
    const ss = parseMatrices(book("个体户-社保清单-合成.xlsx"), "个体户-社保清单-合成.xlsx");
    expect(vat.uscc).toBe(sole);
    const built = buildProfile({ registeredName: "东莞市测试纸品厂（合成）", files: [vat, ss] });
    expect(built.entity).toBe("individual");
    expect(built.unsupported).toBe(true);
  });

  it("爱华两份资料汇总为小微、正常纳税", () => {
    const built = buildProfile({
      registeredName: "深圳爱华国际教育科技有限公司",
      files: [parseMatrices(book("爱华-增值税申报表-合成.xlsx")), parseMatrices(book("爱华-社保清单-合成.xlsx"))],
    });
    expect(built.profile.size_class).toBe("small");
    expect(built.profile.tax_normal).toBe(true);
    expect(built.profile.headcount).toBe(43);
    expect(built.profile.young_candidates).toBe(4);
    expect(built.region_code).toBe("440300");
    expect(built.name_match).toBe(true);
  });
});
