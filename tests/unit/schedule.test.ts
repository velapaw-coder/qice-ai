import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRON_TRIGGERS, DAILY_HOUSEKEEPING_CRON, MONTHLY_CRAWL_CRON, SOURCE_SCHEDULE_TEXT, cronEnqueuesCrawl } from "@shared/schedule";

describe("抓取日程", () => {
  it("只有每月 1 日 02:00 的 cron 会抓取已启用来源", () => {
    expect(CRON_TRIGGERS).toEqual(["0 18 * * *", "0 18 1 * *"]);
    expect(DAILY_HOUSEKEEPING_CRON).toBe("0 18 * * *");
    expect(MONTHLY_CRAWL_CRON).toBe("0 18 1 * *");
    expect(cronEnqueuesCrawl(MONTHLY_CRAWL_CRON)).toBe(true);
    expect(cronEnqueuesCrawl(DAILY_HOUSEKEEPING_CRON)).toBe(false);
    expect(cronEnqueuesCrawl("0 18 * * 1")).toBe(false);
    expect(cronEnqueuesCrawl("")).toBe(false);
    expect(SOURCE_SCHEDULE_TEXT).toBe("每月 1 日 02:00 自动抓取");
  });

  it("wrangler 的两个触发器与代码一致，每日那个不抓取", () => {
    const raw = readFileSync("wrangler.jsonc", "utf8");
    const block = raw.match(/"crons"\s*:\s*\[([\s\S]*?)\]/);
    expect(block).toBeTruthy();
    const crons = [...block![1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(crons).toEqual([...CRON_TRIGGERS]);
    expect(crons.filter((cron) => cronEnqueuesCrawl(cron))).toEqual([MONTHLY_CRAWL_CRON]);
  });
});
