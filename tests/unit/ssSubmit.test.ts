import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/shared/rules/evaluate";
import type { PolicyRule, Profile } from "../../src/shared/rules/types";
import { readFileSync } from "node:fs";
import { enterpriseUploadKindError, socialSecuritySubmitError } from "../../src/shared/ssSubmit";
import { SS_DOWNLOAD_GUIDE } from "../../src/shared/ssDownloadGuide";

const rules = JSON.parse(readFileSync(new URL("../../seed/policies.json", import.meta.url), "utf8")) as PolicyRule[];

describe("只上传社保", () => {
  it("新企业没有税表也能提交，空文件和失败不能自动提交", () => {
    expect(enterpriseUploadKindError("vat")).toMatch(/不再接收/);
    expect(enterpriseUploadKindError("social_security")).toBeNull();
    expect(socialSecuritySubmitError([{ kind: "social_security", parse_status: "success" }], false)).toBeNull();
    expect(socialSecuritySubmitError([{ kind: "vat", parse_status: "success" }], false)).toMatch(/社保/);
    expect(socialSecuritySubmitError([{ kind: "social_security", parse_status: "failed" }], false)).toMatch(/重试/);
    expect(socialSecuritySubmitError([{ kind: "social_security", parse_status: "failed" }], true)).toBeNull();
    expect(socialSecuritySubmitError([], true)).toMatch(/请先上传/);
  });

  it("缺税额时相关项目待核实，不给出金额", () => {
    const profile: Profile = {
      entity_type: "enterprise",
      region_code: "440300",
      city: "深圳",
      tax_normal: null,
      revenue_12m: null,
      tax_paid_12m: null,
      headcount: 43,
      size_class: null,
      ss_personal_month: 34400,
      ss_total_month: 80000,
      young_candidates: 4,
    };
    const result = evaluate(profile, {}, rules);
    expect(result.items.find((item) => item.code === "APPRENTICE_SUBSIDY")?.tier).toBe("verify");
    expect(result.items.find((item) => item.code === "KEY_HIRE_TAX")?.estimate_low).toBe(0);
    expect(result.items.find((item) => item.code === "KEY_HIRE_TAX")?.estimate_high).toBe(0);
    expect(result.estimate_high).toBe(0);
  });

  it("下载帮助只说明单位人员明细，不写税表菜单或初始密码", () => {
    const text = JSON.stringify(SS_DOWNLOAD_GUIDE);
    expect(SS_DOWNLOAD_GUIDE.notSubstitute).toBe("个人参保证明、缴费汇总不能代替单位人员明细。");
    expect(SS_DOWNLOAD_GUIDE.formats).toContain("10MB");
    expect(SS_DOWNLOAD_GUIDE.formats).toContain("证件号码");
    expect(text).not.toContain("初始密码");
    expect(text).not.toContain("完税证明");
    expect(text).not.toContain("本说明撰写");
    expect(SS_DOWNLOAD_GUIDE.regions[0]?.link?.caveat).toContain("以官方现网为准");
    expect(SS_DOWNLOAD_GUIDE.regions[0]?.details.join("")).not.toContain("点击");
  });
});