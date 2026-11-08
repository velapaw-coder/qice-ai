import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { APK_DOWNLOAD_URL } from "../../src/worker/apk";

const artifacts = "/opt/cursor/artifacts";

async function shot(page: Page, name: string, fullPage = true) {
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage });
}

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  const lines = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${label} | ${node.target.join(" ")} | ${(node.failureSummary || "").split("\n")[0]}`),
  );
  expect(lines, lines.join("\n")).toEqual([]);
}

async function fillLead(page: Page, phone: string) {
  await page.getByTestId("growth-company").fill("合成询价贸易有限公司");
  await page.getByTestId("growth-contact").fill("合成对接人");
  await page.getByTestId("growth-phone").fill(phone);
  await page.getByTestId("growth-industry").fill("工业贸易");
  await page.getByTestId("growth-pain").selectOption("报价慢");
  await page.getByTestId("growth-consent").check();
}

test("官网首页增长意向可以保存，旧入口仍在", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "企策AI增长" })).toBeVisible();
  await expect(page.getByText("让AI真正进入业务，用可验证的改善支持企业增长。").first()).toBeVisible();
  await expect(page.getByText("企业AI增长陪跑服务平台").first()).toBeVisible();
  await expect(page.getByText("让政策红利")).toHaveCount(0);
  await expect(page.getByText("10人以上")).toHaveCount(0);
  await expect(page.getByText("这里不承诺固定天数、免费三年，提交后也不会自动开通。")).toBeVisible();
  await expect(page.getByTestId("home-primary")).toHaveAttribute("href", "#contact");
  await expect(page.getByTestId("home-secondary")).toHaveAttribute("href", "#contact");
  await expect(page.locator("a[href='/register']")).toHaveCount(1);
  await expect(page.getByTestId("policy-entry")).toHaveAttribute("href", "/register");
  await expect(page.getByTestId("android-download")).toHaveAttribute("href", APK_DOWNLOAD_URL);
  await expect(page.getByTestId("home-login")).toHaveAttribute("href", "/login");
  await expect(page.locator("p", { hasText: "联系方式见登录页" })).toBeVisible();
  for (const hash of ["#services", "#value", "#pilot", "#process", "#policy", "#faq", "#contact"]) {
    await expect(page.locator(hash)).toHaveCount(1);
  }
  await axe(page, "desktop home");
  await shot(page, "homepage_after_desktop");
  await shot(page, "homepage_desktop_hero", false);

  await page.getByTestId("growth-submit").click();
  await expect(page.getByTestId("growth-error")).toBeVisible();
  await expect(page.getByTestId("growth-success")).toHaveCount(0);

  await page.getByTestId("home-secondary").click();
  await expect(page.getByTestId("growth-intent")).toHaveValue("scene_trial");
  await fillLead(page, "13900001111");
  await page.route("**/api/growth-leads", (route) => route.abort());
  await page.getByTestId("growth-submit").click();
  await expect(page.getByTestId("growth-error")).toBeVisible();
  await expect(page.getByTestId("growth-success")).toHaveCount(0);
  await page.unroute("**/api/growth-leads");

  await page.getByTestId("growth-submit").click();
  await expect(page.getByTestId("growth-success")).toContainText("已保存");
  const id = await page.getByTestId("growth-success").getAttribute("data-lead-id");
  expect(id).toBeTruthy();
  await shot(page, "homepage_after_form_success");

  await page.getByTestId("growth-submit").click();
  await expect(page.getByTestId("growth-duplicate")).toContainText(id || "");
  await expect(page.getByTestId("growth-duplicate")).toContainText("没有重复建档");
  await expect(page.getByTestId("growth-success")).toHaveCount(0);

  const spam = await page.request.post("/api/growth-leads", {
    data: {
      company_name: "合成询价贸易有限公司",
      contact_name: "合成对接人",
      phone: "13900001112",
      industry: "工业贸易",
      pain: "报价慢",
      intent: "growth_talk",
      consent: true,
      company_website: "https://spam.example",
    },
    headers: { "content-type": "application/json", "x-qice-request": "1" },
  });
  expect(spam.status()).toBe(400);

  const anon = await page.request.get("/api/admin/growth-leads");
  expect(anon.status()).toBe(401);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("home-menu").click();
  await expect(page.getByTestId("home-drawer")).toBeVisible();
  await axe(page, "mobile drawer");
  await shot(page, "homepage_mobile_drawer", false);
  await page.getByTestId("home-menu-close").click();
  await expect(page.getByTestId("home-drawer")).toBeHidden();
  await shot(page, "homepage_after_mobile");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/login");
  await page.getByTestId("login-phone").fill("13800000000");
  await page.getByTestId("login-password").fill("Admin1234");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("workspace-label")).toHaveText("管理员工作台", { timeout: 60_000 });
  await page.goto("/admin/growth-leads");
  const row = page.getByTestId("growth-lead-row").filter({ hasText: "合成询价贸易有限公司" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("官网首页");
  await expect(row).toHaveAttribute("data-source", "homepage");
  await expect(row).toHaveAttribute("data-intent", "scene_trial");
  await expect(row).toContainText("13900001111");
  await axe(page, "admin growth leads");
  await shot(page, "admin_growth_lead_table", false);
  await row.getByTestId("growth-lead-status").selectOption("已联系");
  await expect(row.getByTestId("growth-lead-status")).toHaveValue("已联系", { timeout: 20_000 });

  await page.goto("/admin/enterprises");
  await expect(page.getByText("合成询价贸易有限公司")).toHaveCount(0);

  await page.goto("/register");
  await expect(page.getByTestId("register-form")).toBeVisible();
  const apk = await page.request.get("/downloads/qiceai-android.apk", { maxRedirects: 0 });
  expect(apk.status()).toBe(307);
  expect(apk.headers().location).toBe(APK_DOWNLOAD_URL);
});
