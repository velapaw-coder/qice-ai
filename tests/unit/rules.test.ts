import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_BANDS, formatPublicBand, suggestBand } from "@shared/bands";
import { DISCLAIMER, evaluate, formatRange } from "@shared/rules/evaluate";
import type { PolicyRule, Profile, StaffMap } from "@shared/rules/types";

const rules = JSON.parse(readFileSync(new URL("../../seed/policies.json", import.meta.url), "utf8")) as PolicyRule[];

const aihua: Profile = {
  entity_type: "enterprise",
  region_code: "440300",
  city: "深圳",
  tax_normal: true,
  headcount: 43,
  size_class: "small",
  ss_personal_month: 34400,
  young_candidates: 4,
  revenue_12m: 2_400_000,
  tax_paid_12m: 80_640,
  dishonest: false,
};

const GO = ["APPRENTICE_SUBSIDY", "SKILL_EVAL_SUBSIDY"];
const VERIFY = ["GRAD_SS_SUBSIDY", "KEY_HIRE_TAX", "VET_HIRE_TAX", "DISABLED_LEVY", "DISABLED_WAGE_DEDUCT", "POVERTY_JOB_SUBSIDY", "INTERNSHIP_SUBSIDY"];

function tierOf(profile: Profile, code: string, staff: StaffMap = {}) {
  return evaluate(profile, staff, rules).items.find((item) => item.code === code);
}

describe("爱华验收案例", () => {
  it("身份核实前：硬条件已满足的项目可推进，人员身份未知的项目需核实", () => {
    const result = evaluate(aihua, {}, rules);
    for (const code of GO) expect(tierOf(aihua, code)?.tier, code).toBe("go");
    for (const code of VERIFY) {
      const item = tierOf(aihua, code);
      expect(item?.tier, code).toBe("verify");
      expect(item?.verify_text, code).toBeTruthy();
    }
    expect(result.estimate_low).toBe(0);
    expect(result.estimate_high).toBe(10_000);
    expect(formatRange(result.estimate_low, result.estimate_high)).toBe("最高约 1 万元/年");
    const suggested = suggestBand(9600, DEFAULT_BANDS);
    expect(suggested.id).toBe(DEFAULT_BANDS[0]?.id);
    expect(suggestBand(result.estimate_high, DEFAULT_BANDS).id).toBe("1-3");
    expect(formatPublicBand(DEFAULT_BANDS.find((band) => band.id === "3-8")!)).toBe("预计可申请：3–8 万元");
    const grad = tierOf(aihua, "GRAD_SS_SUBSIDY");
    expect(grad?.estimate_low).toBe(0);
    expect(grad?.estimate_high).toBe(9600);
    expect(grad?.in_estimate).toBe(true);
    for (const item of result.items) {
      if (item.category.includes("资金补贴")) expect(item.in_estimate).toBe(false);
      if (item.tier === "go") expect(item.verify_text).not.toMatch(/员工中是否有|残疾|高校毕业|脱贫|退役|见习/);
    }
    expect(DISCLAIMER).toContain("不构成任何承诺");
  });

  it("顾问录入高校毕业生人数后，该项升为可推进并抬高下限", () => {
    const result = evaluate(aihua, { graduate: 4 }, rules);
    const grad = result.items.find((item) => item.code === "GRAD_SS_SUBSIDY");
    expect(grad?.tier).toBe("go");
    expect(grad?.estimate_low).toBe(9600);
    expect(result.estimate_low).toBe(9000);
    expect(result.estimate_high).toBeGreaterThanOrEqual(10_000);
    expect(result.items.find((item) => item.code === "VET_HIRE_TAX")?.tier).toBe("verify");
  });

  it("未确认失信时职业技能评价停在需核实", () => {
    const profile = { ...aihua };
    delete profile.dishonest;
    expect(tierOf(profile, "SKILL_EVAL_SUBSIDY")?.tier).toBe("verify");
  });

  it("参保 10 人时残保金为不建议", () => {
    expect(tierOf({ ...aihua, headcount: 10 }, "DISABLED_LEVY")?.tier).toBe("reject");
  });

  it("地区未知时不丢规则，但可推进降为需核实", () => {
    const profile = { ...aihua };
    delete profile.region_code;
    const result = evaluate(profile, {}, rules);
    const grad = result.items.find((item) => item.code === "GRAD_SS_SUBSIDY");
    expect(grad?.tier).toBe("verify");
    expect(grad?.verify_text).toContain("待确认企业所在地区或主体类型");
  });

  it("软条件全部确认不符合则不建议", () => {
    const rule: PolicyRule = {
      code: "SOFT_ONLY",
      name: "软条件",
      category: "测试",
      regions: ["4403"],
      entity_types: ["enterprise"],
      conditions: [{ field: "skill_cert", op: "eq", value: true, level: "soft", text: "有证书" }],
    };
    const result = evaluate(aihua, {}, [rule]);
    expect(result.items[0]?.tier).toBe("go");
    const rejected = evaluate({ ...aihua, skill_cert: false }, {}, [rule]);
    expect(rejected.items[0]?.tier).toBe("reject");
  });

  it("规则计算保持在免费版单次 CPU 预算内", () => {
    const start = performance.now();
    for (let i = 0; i < 50; i++) evaluate(aihua, {}, rules);
    const each = (performance.now() - start) / 50;
    expect(each).toBeLessThan(10);
  });
});
