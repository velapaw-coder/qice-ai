import { describe, expect, it } from "vitest";
import { parseApiPayload, shouldRetryGet } from "../../src/client/lib/api";
import { readWarnings } from "../../src/worker/routes/enterprise";

describe("接口暂时失败", () => {
  it("GET 的 502 只重试一次", () => {
    expect(shouldRetryGet(undefined, 502, 0)).toBe(true);
    expect(shouldRetryGet("GET", 502, 1)).toBe(false);
    expect(shouldRetryGet("POST", 502, 0)).toBe(false);
    expect(shouldRetryGet("GET", 500, 0)).toBe(false);
    expect(shouldRetryGet("GET", 503, 0)).toBe(false);
  });

  it("502 的非 JSON 正文不会把解析错误抛出去", () => {
    expect(parseApiPayload("<html>bad gateway</html>", 502).error).toContain("暂时不可用");
    expect(parseApiPayload("", 502)).toEqual({});
    expect(parseApiPayload('{"error":"请先登录"}', 401).error).toBe("请先登录");
  });
});

describe("/api/me", () => {
  it("坏掉的 warnings 不会抛异常", () => {
    expect(readWarnings(null)).toEqual([]);
    expect(readWarnings("{")).toEqual([]);
    expect(readWarnings('["重复企业"]')).toEqual(["重复企业"]);
  });
});