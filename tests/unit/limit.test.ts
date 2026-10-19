import { describe, expect, it } from "vitest";
import { registerHourlyLimit, type Env } from "../../src/worker/util";

function env(limit?: string): Env {
  return { REGISTER_HOURLY_LIMIT: limit } as Env;
}

describe("注册每小时上限", () => {
  it("生产未配置时是每小时 5 次", () => {
    expect(registerHourlyLimit(env())).toBe(5);
    expect(registerHourlyLimit(env("  "))).toBe(5);
  });

  it("非法值回落到 5", () => {
    expect(registerHourlyLimit(env("0"))).toBe(5);
    expect(registerHourlyLimit(env("5.5"))).toBe(5);
    expect(registerHourlyLimit(env("101"))).toBe(5);
    expect(registerHourlyLimit(env("abc"))).toBe(5);
  });

  it("本地可以显式调高", () => {
    expect(registerHourlyLimit(env("30"))).toBe(30);
  });
});
