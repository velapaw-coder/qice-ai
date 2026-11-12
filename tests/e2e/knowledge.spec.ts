import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const artifacts = "/opt/cursor/artifacts";

async function shot(page: Page, name: string) {
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
}

test("九篇知识文章可阅读，状态和核对日分开，站点地图只收这些地址", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("brand-line")).toHaveText("发现向往 · 连接同频 · 重构商业 · 共创增长");
  await page.getByTestId("knowledge-entry").click();
  await expect(page.getByRole("heading", { level: 1, name: "企业服务知识库" })).toBeVisible();
  await expect(page.getByTestId("knowledge-category-subsidy")).toBeVisible();
  await expect(page.getByTestId("knowledge-category-business")).toBeVisible();
  await expect(page.getByTestId("knowledge-category-ip")).toBeVisible();
  await expect(page.getByRole("link", { name: "企业招用重点群体，税收扣减怎么看条件和定额" })).toBeVisible();
  await expect(page.getByText("窗口需确认").first()).toBeVisible();
  await expect(page.getByText("待复核草稿")).toHaveCount(0);
  await expect(page.getByTestId("knowledge-cta")).toHaveAttribute("href", "/#contact");
  const hub = await page.request.get("/knowledge");
  expect(hub.status()).toBe(200);
  expect(hub.headers()["x-robots-tag"] || "").not.toContain("noindex");
  await shot(page, "knowledge_hub");

  await page.getByLabel("搜索文章").fill("加计扣除");
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByRole("link", { name: "研发费用加计扣除：全国统一的扣除口径和常见准备误区" })).toBeVisible();
  await expect(page.getByRole("link", { name: "企业招用重点群体，税收扣减怎么看条件和定额" })).toHaveCount(0);
  const search = await page.request.get("/knowledge?q=%E5%8A%A0%E8%AE%A1%E6%89%A3%E9%99%A4");
  expect(search.headers()["x-robots-tag"]).toContain("noindex");

  await page.goto("/knowledge/subsidy/enterprise-subsidy-self-check");
  await expect(page.getByTestId("knowledge-facts")).toContainText("窗口需确认");
  await expect(page.getByTestId("knowledge-facts")).toContainText("文稿核对日：2026-11-11");
  await expect(page.getByTestId("knowledge-facts")).toContainText("不是政策发布日期");
  await shot(page, "knowledge_window");

  await page.goto("/knowledge/ip/trademark-registration-basics");
  await expect(page.getByTestId("knowledge-facts")).toContainText("当前依据核实");
  await expect(page.getByText("自公告之日起三个月内")).toBeVisible();
  await expect(page.getByText("自公告之日起二个月内")).toBeVisible();
  await expect(page.getByText("不能把尚未施行的条文当成当前正在执行的流程")).toBeVisible();
  const detail = await page.request.get("/knowledge/ip/trademark-registration-basics");
  expect(detail.status()).toBe(200);
  expect(detail.headers()["x-robots-tag"] || "").not.toContain("noindex");
  const detailHtml = await detail.text();
  expect(detailHtml).toContain('rel="canonical" href="https://qicego.com/knowledge/ip/trademark-registration-basics"');
  expect(detailHtml).not.toContain('"datePublished"');
  expect(detailHtml).toContain('"@type":"BreadcrumbList"');
  await shot(page, "knowledge_article");

  await page.goto("/knowledge/business");
  await expect(page.getByRole("heading", { level: 1, name: "工商服务" })).toBeVisible();
  await expect(page.getByRole("link", { name: "企业招用重点群体，税收扣减怎么看条件和定额" })).toHaveCount(0);

  const missing = await page.request.get("/knowledge/subsidy/not-published");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["x-robots-tag"]).toContain("noindex");
  await page.goto("/knowledge/not-a-category");
  await expect(page.getByTestId("knowledge-missing")).toBeVisible();

  await page.goto("/knowledge/subsidy/one-time-expansion-employment-subsidy-2026");
  await expect(page.getByTestId("knowledge-facts")).toContainText("依据核实、受理窗口待确认");
  await expect(page.getByText("不是各地统一按1500元发放")).toBeVisible();
  await expect(page.getByText("粤人社发〔2026〕20号与粤人社规〔2026〕20号不是同一份文件")).toBeVisible();
  await expect(page.getByRole("link", { name: "粤人社发〔2026〕20号（广东省人力资源和社会保障厅）" })).toHaveAttribute("href", "https://hrss.gd.gov.cn/zwgk/xxgkml/bmwj/qtwj/shbz/content/post_4949419.html");
  await expect(page.getByTestId("knowledge-unchecked")).toContainText("访问未核");
  await shot(page, "knowledge_subsidy_batch2");
  await page.goto("/knowledge?q=灵活就业");
  await expect(page.getByRole("link", { name: "就业困难人员和毕业生灵活就业，个人社保补贴如何计算上限" })).toBeVisible();
  await page.goto("/knowledge?q=没有这回事的补贴");
  await expect(page.getByTestId("knowledge-empty")).toBeVisible();
  await expect(page.getByText("南山专区")).toHaveCount(0);

  const sitemap = await page.request.get("/sitemap.xml");
  const xml = await sitemap.text();
  expect(xml).toContain("https://qicego.com/knowledge</loc>");
  expect(xml).toContain("https://qicego.com/knowledge/subsidy/key-group-employment-tax-incentive</loc>");
  expect(xml).toContain("https://qicego.com/knowledge/ip/trademark-registration-basics</loc>");
  expect(xml).toContain("https://qicego.com/knowledge/subsidy/one-time-expansion-employment-subsidy-2026</loc>");
  expect(xml).not.toContain("/knowledge/nanshan");
  expect(xml).not.toContain("/admin");
  const verify = await page.request.get("/googled5c7c4e254bd8e0c.html");
  expect(verify.status()).toBe(200);
  const admin = await page.request.get("/admin");
  expect(admin.headers()["x-robots-tag"]).toContain("noindex");

  const contrast = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  expect(contrast.violations).toEqual([]);
});
