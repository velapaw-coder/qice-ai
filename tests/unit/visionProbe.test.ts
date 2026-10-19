import { describe, expect, it } from "vitest";
import { assistantMessageText, makeVisionProbe, VISION_PROBE_PROMPT, visionProbeFailure, visionProbePassed } from "@shared/visionProbe";

describe("视觉连通测试图", () => {
  it("图里的数字不出现在提示词里，回复必须正好是这串数字", () => {
    const probe = makeVisionProbe("246813");
    expect(probe.code).toBe("246813");
    expect(probe.prompt).toBe(VISION_PROBE_PROMPT);
    expect(probe.prompt.includes("246813")).toBe(false);
    const bytes = Buffer.from(probe.pngBase64, "base64");
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(visionProbePassed("246813", probe.code)).toBe(true);
    expect(visionProbePassed(" 246813\n", probe.code)).toBe(true);
    expect(visionProbePassed("", probe.code)).toBe(false);
    expect(visionProbePassed("我看到的是 246813", probe.code)).toBe(false);
    expect(visionProbePassed("我看到的是 135790", probe.code)).toBe(false);
    expect(visionProbeFailure("", probe.code, 200)).toContain("没有返回内容");
    expect(visionProbeFailure("", probe.code, 200)).toContain("图中的数字");
    expect(visionProbeFailure("ok", probe.code, 200)).toContain("只返回 HTTP 200 不能说明模型能看图");
  });

  it("空 content 不能把整段响应体里的数字当成看图成功", () => {
    const raw = JSON.stringify({
      choices: [{ message: { content: "" } }],
      echo: "图片里的数字是 246813",
    });
    expect(assistantMessageText(raw)).toBe("");
    expect(visionProbePassed(assistantMessageText(raw), "246813")).toBe(false);
    expect(assistantMessageText(JSON.stringify({ choices: [{ message: { content: null } }] }))).toBe("");
    expect(assistantMessageText("246813")).toBe("246813");
  });

  it("未指定时生成六位数字，且不写进提示词", () => {
    const probe = makeVisionProbe();
    expect(probe.code).toMatch(/^\d{6}$/);
    expect(probe.prompt.includes(probe.code)).toBe(false);
  });
});
