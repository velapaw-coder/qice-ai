import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeArticleHtml } from "../../src/shared/growthHome";
import { growthDedupeKey, growthSourceLabel, growthStatusError, normalizeMobile, parseGrowthLead } from "../../src/shared/growthLead";

const valid = {
  company_name: "合成询价贸易有限公司",
  contact_name: "合成对接人",
  phone: "13900001111",
  industry: "工业贸易",
  pain: "报价慢",
  intent: "growth_talk",
  consent: true,
};

describe("增长意向", () => {
  it("接受最小字段，并固定去重键", () => {
    const parsed = parseGrowthLead(valid);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intent).toBe("growth_talk");
    expect(growthDedupeKey(parsed.value.phone, parsed.value.intent, "20261108")).toBe("13900001111|growth_talk|homepage|20261108");
    expect(growthSourceLabel("homepage")).toBe("官网首页");
  });

  it("手机号去掉空格、短横线和 +86 后仍是同一条去重键", () => {
    for (const phone of ["139-0000-1111", "139 0000 1111", "+86 13900001111", "8613900001111"]) {
      const parsed = parseGrowthLead({ ...valid, phone });
      expect(parsed.ok, phone).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.phone).toBe("13900001111");
    }
    expect(normalizeMobile("23900001111")).toBeNull();
    expect(normalizeMobile("12345")).toBeNull();
    expect(growthDedupeKey("13900001111", "growth_talk", "20261108")).toBe(growthDedupeKey("13900001111", "growth_talk", "20261108"));
  });

  it("状态只接受待联系、已联系、已搁置", () => {
    expect(growthStatusError("待联系")).toBeNull();
    expect(growthStatusError("已联系")).toBeNull();
    expect(growthStatusError("已搁置")).toBeNull();
    expect(growthStatusError("已删除")).toMatch(/状态/);
    expect(growthStatusError("")).toMatch(/状态/);
  });

  it("拒绝缺同意、错痛点、证件号和过短企业名", () => {
    expect(parseGrowthLead({ ...valid, consent: false }).ok).toBe(false);
    expect(parseGrowthLead({ ...valid, pain: "随便写" }).ok).toBe(false);
    expect(parseGrowthLead({ ...valid, intent: "buy_now" }).ok).toBe(false);
    expect(parseGrowthLead({ ...valid, phone: "12345" }).ok).toBe(false);
    expect(parseGrowthLead({ ...valid, company_name: "企" }).ok).toBe(false);
    const numbered = parseGrowthLead({ ...valid, industry: "贸易914403001234567890" });
    expect(numbered.ok).toBe(false);
  });

  it("首页文案不把政策或旧承诺当成入口", () => {
    const article = homeArticleHtml("https://media.qicego.com/site/qiceai-android.apk?v=12");
    expect(article).toContain("预约增长交流");
    expect(article).toContain("申请AI场景体验");
    expect(article).toContain('href="/register"');
    expect(article).not.toContain("10人以上");
    expect(article).toContain("这里不承诺固定天数、免费三年，提交后也不会自动开通。");
    expect(article).not.toContain("让政策红利");
    expect(article).not.toContain("30天");
    expect(article).toContain("需要保证获客、保证利润，或要求交易决策完全无人审核的，不适合作为首期承诺。");
    expect(article).toContain("不是已经交付的结果。");
  });

  it("公开提交不建账号，也不外发通知", () => {
    const src = readFileSync("src/worker/routes/public.ts", "utf8");
    const start = src.indexOf('publicRoutes.post("/growth-leads"');
    const end = src.indexOf('publicRoutes.post("/auth/register"');
    const block = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("INSERT INTO growth_leads");
    expect(block.indexOf("hitLimit")).toBeLessThan(block.indexOf("WHERE dedupe_key = ?"));
    expect(block).not.toContain("id: existing.id");
    expect(block).not.toContain("id: raced.id");
    expect(block).not.toContain("notifyWecom");
    expect(block).not.toContain("INSERT INTO users");
    expect(block).not.toContain("INSERT INTO enterprises");
    expect(block).not.toContain("INSERT INTO sessions");
  });
});
