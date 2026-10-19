import { describe, expect, it } from "vitest";
import { DEFAULT_BANDS, formatPublicBand, parseBands, suggestBand, validateBands } from "@shared/bands";

describe("预估档", () => {
  it("低于最低档或落在 1 万时建议 1–3万", () => {
    expect(suggestBand(9600).id).toBe("1-3");
    expect(suggestBand(0).id).toBe("1-3");
    expect(suggestBand(10_000).label).toBe("1–3万");
    expect(suggestBand(29_999).id).toBe("1-3");
  });

  it("金额落在哪一档就建议哪一档，顶格进入下一档", () => {
    expect(suggestBand(30_000).id).toBe("3-8");
    expect(suggestBand(80_000).id).toBe("8-15");
    expect(suggestBand(500_000).id).toBe("50+");
    expect(suggestBand(900_000).label).toBe("50万以上");
  });

  it("企业文案始终是区间，不出现单个金额", () => {
    expect(formatPublicBand(DEFAULT_BANDS[0]!)).toBe("预计可申请：1–3 万元");
    expect(formatPublicBand(DEFAULT_BANDS[1]!)).toBe("预计可申请：3–8 万元");
    expect(formatPublicBand(DEFAULT_BANDS[5]!)).toBe("预计可申请：50 万元以上");
    expect(formatPublicBand(DEFAULT_BANDS[1]!)).not.toMatch(/最高约|元\/年/);
  });

  it("空配置回退到默认档，重叠配置会被拒绝", () => {
    expect(parseBands("").map((band) => band.id)).toEqual(DEFAULT_BANDS.map((band) => band.id));
    expect(parseBands("{").map((band) => band.id)).toEqual(DEFAULT_BANDS.map((band) => band.id));
    const overlap = validateBands([
      { id: "a", low: 0, high: 20_000, label: "甲" },
      { id: "b", low: 10_000, high: 30_000, label: "乙" },
    ]);
    expect(overlap.ok).toBe(false);
  });
});
