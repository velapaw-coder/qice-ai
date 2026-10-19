import { describe, expect, it } from "vitest";
import { emptyModelSlotRejection } from "@shared/modelSlots";

const assigned = {
  llm_text_primary: "text-1",
  llm_text_fallback: "",
  llm_vision_primary: "vision-1",
  llm_vision_fallback: "",
};

describe("模型槽分配", () => {
  it("已有分配时，一次提交四个空槽会被拒绝", () => {
    const incoming = {
      llm_text_primary: "",
      llm_text_fallback: "",
      llm_vision_primary: "",
      llm_vision_fallback: "",
    };
    expect(emptyModelSlotRejection(incoming, assigned, false)).toContain("不能一次清空");
  });

  it("明确确认后可以清空", () => {
    const incoming = {
      llm_text_primary: "",
      llm_text_fallback: "",
      llm_vision_primary: "",
      llm_vision_fallback: "",
    };
    expect(emptyModelSlotRejection(incoming, assigned, true)).toBeNull();
  });

  it("保留任意一个槽，或本来就是空的，都可以保存", () => {
    expect(emptyModelSlotRejection({ llm_vision_primary: "vision-1" }, assigned, false)).toBeNull();
    expect(emptyModelSlotRejection({ llm_text_primary: "", llm_text_fallback: "", llm_vision_primary: "", llm_vision_fallback: "" }, {}, false)).toBeNull();
    expect(emptyModelSlotRejection({ consultant_phone: "13800138000" }, assigned, false)).toBeNull();
  });
});
