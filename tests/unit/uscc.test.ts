import { describe, expect, it } from "vitest";
import { entityFromUscc, isValidUscc, makeUscc, regionFromUscc } from "@shared/uscc";

describe("统一社会信用代码", () => {
  it("按 GB 32100 生成并校验深圳企业代码", () => {
    const code = makeUscc("91440300MA5QCEA01");
    expect(code).toHaveLength(18);
    expect(isValidUscc(code)).toBe(true);
    expect(entityFromUscc(code)).toBe("enterprise");
    expect(regionFromUscc(code)).toBe("440300");
  });

  it("92 开头识别为个体户，正文写个体工商户时即使代码无效也按个体户", () => {
    const code = makeUscc("92441900MA5QCEA01");
    expect(entityFromUscc(code)).toBe("individual");
    expect(regionFromUscc(code)).toBe("441900");
    expect(entityFromUscc("不是代码", "个体工商户")).toBe("individual");
  });

  it("拒绝含 I、O、S、V、Z 或校验位错误的代码", () => {
    expect(isValidUscc("91440300MA5QCEA0I")).toBe(false);
    expect(isValidUscc(makeUscc("91440300MA5QCEA01") + "0")).toBe(false);
    const code = makeUscc("91440300MA5QCEA01");
    expect(isValidUscc(code.slice(0, 17) + (code[17] === "0" ? "1" : "0"))).toBe(false);
  });
});
