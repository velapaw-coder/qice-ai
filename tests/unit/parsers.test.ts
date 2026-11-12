import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProfile } from "@shared/profile";
import { textFromPdfItems } from "@shared/parsers/pdfText";
import { assertNoSecrets, makeChineseId, parseMatrices, parseSsText, parseVatText, type SheetMatrix } from "@shared/parsers/tabular";
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

  it("只有社保时不把缺税写成 0 或小微", () => {
    const ss = parseMatrices(book("爱华-社保清单-合成.xlsx"), "爱华-社保清单-合成.xlsx");
    const built = buildProfile({ registeredName: "深圳爱华国际教育科技有限公司", files: [ss] });
    expect(built.profile.revenue_12m).toBeNull();
    expect(built.profile.tax_paid_12m).toBeNull();
    expect(built.profile.vat_paid_12m).toBeNull();
    expect(built.profile.tax_normal).toBeNull();
    expect(built.profile.size_class).toBeNull();
    expect(built.profile.headcount).toBe(43);
    expect(built.warnings.join("")).toContain("部分条件缺少依据，由顾问核实");
    expect(built.warnings.join("")).not.toContain("未提供增值税申报表");
    expect(built.profile.ss_total_month).not.toBe(built.profile.tax_paid_12m);
    expect(built.profile.tax_paid_12m).toBeNull();
  });

  it("四种证件表头、前置标题、空格、BOM 和缺金额都能按社保清单解析", () => {
    const id = makeChineseId("440300", "19900101", "001");
    for (const header of ["证件号码", "证件号", "身份证号", "身份证"]) {
      const parsed = parseMatrices([{
        name: "s",
        rows: [
          ["单位职工缴费人员明细"],
          ["单位名称", "合成表头企业"],
          [` ${header} `, "险种", "个人缴纳", "单位缴纳"],
          [id, "养老保险", "800", "1200"],
        ],
      }], "社保清单.csv");
      expect(parsed.parse_status, header).not.toBe("failed");
      expect(parsed.headcount, header).toBe(1);
      expect(parsed.ss_personal_month, header).toBe(800);
      expect(assertNoSecrets(parsed)).toBeNull();
    }
    const bom = parseMatrices([{
      name: "s",
      rows: [["\uFEFF身份证号", "险种"], [id, "养老保险"]],
    }], "清单.xlsx");
    expect(bom.parse_status).not.toBe("failed");
    expect(bom.headcount).toBe(1);
    const noPay = parseMatrices([{
      name: "s",
      rows: [["身份证", "姓名"], [id, "甲"]],
    }], "社保.csv");
    expect(noPay.parse_status).not.toBe("failed");
    expect(noPay.headcount).toBe(1);
    expect(noPay.ss_total_month).toBeUndefined();
    expect(noPay.parse_note).toContain("缴费合计待顾问核实");
    const built = buildProfile({ registeredName: "合成表头企业", files: [noPay] });
    expect(built.profile.tax_paid_12m).toBeNull();
    expect(built.profile.revenue_12m).toBeNull();
    expect(built.profile.vat_paid_12m).toBeNull();
    expect(built.profile.ss_total_month).toBeNull();
    expect(parseMatrices([{ name: "s", rows: [] }], "社保.csv").parse_status).toBe("failed");
    expect(parseMatrices([{ name: "s", rows: [["身份证号", "险种"]] }], "社保.csv").parse_status).toBe("failed");
  });

  it("文字版 PDF 能还原社保人员明细", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const fontkit = await import("@pdf-lib/fontkit");
    const id = makeChineseId("440300", "19900101", "001");
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit.default);
    const font = await pdf.embedFont(readFileSync("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"));
    const latin = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([640, 400]);
    page.drawText("单位名称  合成文字社保企业", { x: 40, y: 340, size: 12, font });
    page.drawText("身份证号  险种  个人缴纳  单位缴纳", { x: 40, y: 312, size: 12, font });
    page.drawText(`${id}  `, { x: 40, y: 284, size: 12, font: latin });
    page.drawText("养老保险  ", { x: 180, y: 284, size: 12, font });
    page.drawText("800  1200", { x: 280, y: 284, size: 12, font: latin });
    const data = await pdf.save();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data, disableWorker: true, isEvalSupported: false } as Parameters<typeof pdfjs.getDocument>[0]).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const text = textFromPdfItems(content.items as { str?: string; transform?: number[] }[]);
    const parsed = parseSsText(text);
    expect(text).toContain("身份证号");
    expect(parsed.parse_status).not.toBe("failed");
    expect(parsed.headcount).toBe(1);
    expect(parsed.ss_personal_month).toBe(800);
    expect(assertNoSecrets(parsed)).toBeNull();
  });
});
