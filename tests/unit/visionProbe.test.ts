import { describe, expect, it } from "vitest";
import { makeVisionProbe, VISION_PROBE_PROMPT, visionProbeFailure, visionProbePassed } from "@shared/visionProbe";

describe("视觉连通测试图", () => {
  it("图里的数字不出现在提示词里，回复必须包含它才算通过", () => {
    const probe = makeVisionProbe("246813");
    expect(probe.prompt).toBe(VISION_PROBE_PROMPT);
    expect(probe.prompt.includes("246813")).toBe(false);
    const bytes = Buffer.from(probe.pngBase64, "base64");
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(visionProbePassed("246813", probe.code)).toBe(true);
    expect(visionProbePassed("我看到的是 135790", probe.code)).toBe(false);
    expect(visionProbeFailure("ok", probe.code, 200)).toContain("246813");
    expect(visionProbeFailure("ok", probe.code, 200)).toContain("只返回 HTTP 200 不能说明模型能看图");
  });
});
