/** UTC. 02:00 Asia/Shanghai every day. Housekeeping only: stale runs, expiry, file cleanup. */
export const DAILY_HOUSEKEEPING_CRON = "0 18 * * *";

/** UTC. 02:00 Asia/Shanghai on the 1st. Crawls enabled sources. */
export const MONTHLY_CRAWL_CRON = "0 18 1 * *";

export const CRON_TRIGGERS = [DAILY_HOUSEKEEPING_CRON, MONTHLY_CRAWL_CRON] as const;

export function cronEnqueuesCrawl(cron: string): boolean {
  return cron.trim() === MONTHLY_CRAWL_CRON;
}

export const SOURCE_SCHEDULE_TEXT = "每月 1 日 02:00 自动抓取";
