import { describe, expect, it } from "vitest";
import { parseRule } from "@shared/rules/schema";
import { applyModelSuggestion, POLICY_EXTRACTION_PROMPT } from "@shared/rules/suggest";

const mockedModel = {
  relevant: true,
  name: "合成岗位补贴",
  confidence: 0.4,
  policy_type: "subsidy",
  subsidy_amount: 3000,
  hard: ["正常经营"],
  definition_json: {
    code: "MOCK_JOB",
    name: "合成岗位补贴",
    category: "就业补贴",
    regions: ["4403"],
    entity_types: ["enterprise"],
    policy_type: "subsidy",
    subsidy_amount: 8000,
    conditions: [
      { field: "tax_normal", op: "eq", value: true, level: "hard", text: "正常经营" },
      { field: "not_a_field", op: "eq", value: 1, level: "hard", text: "模型发明的字段" },
      { field: "headcount", op: "between", value: 10, level: "hard", text: "人数区间" },
    ],
    estimate: { type: "flat", amount: 8000 },
  },
};

describe("政策抽取建议规则", () => {
  it("模型回复里的自造字段会被丢掉，可用条件仍能通过规则引擎", () => {
    expect(POLICY_EXTRACTION_PROMPT).toContain("per_head_capped");
    expect(POLICY_EXTRACTION_PROMPT).toContain("不要");
    expect(POLICY_EXTRACTION_PROMPT).not.toContain("hard(string");
    const applied = applyModelSuggestion(mockedModel);
    expect(applied.suggested_definition_json).toBeTruthy();
    const stored = JSON.parse(applied.suggested_definition_json!);
    expect(stored.policy_type).toBeUndefined();
    expect(stored.subsidy_amount).toBeUndefined();
    expect(stored.conditions).toEqual([{ field: "tax_normal", op: "eq", value: true, level: "hard", text: "正常经营" }]);
    expect(stored.estimate).toBeNull();
    expect(parseRule(stored).rule?.code).toBe("MOCK_JOB");
    expect(applied.dropped).toEqual(expect.arrayContaining(["policy_type", "subsidy_amount", "hard", "estimate.amount"]));
    expect(applied.flags.join(" ")).toContain("not_a_field");
    expect(applied.flags.join(" ")).toContain("between");
    expect(applied.extracted.invalid_fields).toEqual(applied.dropped);
    expect(applied.confidence.flags).toEqual(applied.flags);
  });

  it("整段都不可用时不保存建议规则，只留下标记", () => {
    const applied = applyModelSuggestion({
      relevant: true,
      policy_type: "grant",
      subsidy_amount: 1,
      definition_json: { policy_type: "grant", subsidy_amount: 1, hard: ["看情况"] },
    });
    expect(applied.rule).toBeNull();
    expect(applied.suggested_definition_json).toBeNull();
    expect(applied.flags.length).toBeGreaterThan(0);
    expect(applied.dropped).toEqual(expect.arrayContaining(["policy_type", "subsidy_amount"]));
    expect(JSON.stringify(applied.extracted)).not.toContain("看情况");
  });
});
