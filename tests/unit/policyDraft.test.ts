import { describe, expect, it } from "vitest";
import { adoptBlockedReason } from "@shared/policyDraft";

describe("采纳草稿", () => {
  it("已采纳、已驳回和重复不能再次采纳", () => {
    expect(adoptBlockedReason("已采纳")).toContain("已经采纳过");
    expect(adoptBlockedReason("已驳回")).toContain("已经驳回");
    expect(adoptBlockedReason("重复")).toContain("重复");
    expect(adoptBlockedReason("待审核")).toBeNull();
  });
});
