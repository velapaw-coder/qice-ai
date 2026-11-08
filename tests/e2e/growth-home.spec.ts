import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { deriveClientKey } from "../../src/shared/password";
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

test("官网首页增长意向可以保存，旧入口仍在", async ({ page, browser }: { page: Page; browser: Browser }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "企策AI增长" })).toBeVisible();
  await expect(page.getByTestId("brand-positioning")).toHaveText("AI驱动企业价值重构与长期增长陪跑平台");
  await expect(page.getByTestId("brand-line")).toHaveText("发现向往 · 连接同频 · 重构商业 · 共创增长");
  await expect(page.getByTestId("hero-lead")).toHaveText("企策AI增长，不只是帮助企业用AI把今天的生意做得更好，更重要的是，陪伴企业重新发现客户的向往，创造明天的新生意。");
  await expect(page.getByText("发现人的真实向往，激活企业潜在价值")).toBeVisible();
  await expect(page.getByText("让企业通过AI创造新的商业可能与第二增长曲线")).toBeVisible();
  await expect(page.getByText("创始人IP")).toBeVisible();
  await expect(page.getByText("同频社区")).toBeVisible();
  await expect(page.getByText("用AI发现人的真实向往，激活企业潜在价值，创造新的商业可能。")).toHaveCount(0);
  await expect(page.getByText("让同频的人相遇，让有价值的商业自然生长。")).toHaveCount(0);
  await expect(page.getByText("同频匹配")).toHaveCount(0);
  await expect(page.getByText("让AI真正进入业务，用可验证的改善支持企业增长。").first()).toBeVisible();
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
  await expect(page.getByTestId("growth-duplicate")).toContainText("没有重复建档");
  await expect(page.getByTestId("growth-duplicate")).not.toHaveAttribute("data-lead-id", /.+/);
  await expect(page.getByTestId("growth-success")).toHaveCount(0);
  const normalized = await page.request.post("/api/growth-leads", {
    data: {
      company_name: "合成询价贸易有限公司",
      contact_name: "合成对接人",
      phone: "139-0000-1111",
      industry: "工业贸易",
      pain: "报价慢",
      intent: "scene_trial",
      consent: true,
    },
    headers: { "content-type": "application/json", "x-qice-request": "1" },
  });
  expect(normalized.status()).toBe(200);
  const normalizedBody = (await normalized.json()) as { ok?: boolean; duplicate?: boolean; id?: string };
  expect(normalizedBody.ok).toBe(true);
  expect(normalizedBody.duplicate).toBe(true);
  expect(normalizedBody.id).toBeUndefined();

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
  const anonPatch = await page.request.patch("/api/admin/growth-leads/not-a-lead", {
    data: { status: "已联系" },
    headers: { "content-type": "application/json", "x-qice-request": "1" },
  });
  expect(anonPatch.status()).toBe(401);

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
  const leadList = await page.request.get("/api/admin/growth-leads");
  expect(leadList.status()).toBe(200);
  const leadPayload = (await leadList.json()) as { leads: Record<string, string>[] };
  expect(leadPayload.leads).toHaveLength(1);
  expect(leadPayload.leads[0]?.ip).toBeUndefined();
  expect(leadPayload.leads[0]?.dedupe_key).toBeUndefined();
  expect(leadPayload.leads[0]?.phone).toBe("13900001111");
  await axe(page, "admin growth leads");
  await shot(page, "admin_growth_lead_table", false);
  const badStatus = await page.request.patch(`/api/admin/growth-leads/${id}`, {
    data: { status: "已删除" },
    headers: { "content-type": "application/json", "x-qice-request": "1" },
  });
  expect(badStatus.status()).toBe(400);
  await row.getByTestId("growth-lead-status").selectOption("已联系");
  await expect(row.getByTestId("growth-lead-status")).toHaveValue("已联系", { timeout: 20_000 });

  const consultantKey = await deriveClientKey("13900002222", "Consult2234");
  const createdConsultant = await page.request.post("/api/admin/users", {
    data: { phone: "13900002222", name: "合成顾问", role: "consultant", client_key: consultantKey, must_change_password: false },
    headers: { "content-type": "application/json", "x-qice-request": "1" },
  });
  expect(createdConsultant.status()).toBe(200);
  const consultant = await browser.newContext();
  const consultantPage = await consultant.newPage();
  await consultantPage.goto("/login");
  await consultantPage.getByTestId("login-phone").fill("13900002222");
  await consultantPage.getByTestId("login-password").fill("Consult2234");
  await consultantPage.getByTestId("login-submit").click();
  await expect(consultantPage.getByTestId("workspace-label")).toHaveText("顾问工作台", { timeout: 60_000 });
  await consultantPage.goto("/admin/growth-leads");
  await expect(consultantPage.getByTestId("growth-lead-row").filter({ hasText: "合成询价贸易有限公司" })).toHaveCount(1);
  await consultant.close();

  const enterprise = await browser.newContext();
  const enterprisePage = await enterprise.newPage();
  await enterprisePage.goto("/register");
  await enterprisePage.getByTestId("company").fill("合成权限隔离有限公司");
  await enterprisePage.getByTestId("contact").fill("合成联系人");
  await enterprisePage.getByTestId("phone").fill("13700000021");
  await enterprisePage.getByTestId("password").fill("Ent223456");
  await enterprisePage.getByTestId("password2").fill("Ent223456");
  await enterprisePage.getByTestId("register-submit").click();
  await expect(enterprisePage.getByTestId("upload-page")).toBeVisible({ timeout: 60_000 });
  const deniedRead = await enterprisePage.request.get("/api/admin/growth-leads");
  expect(deniedRead.status()).toBe(403);
  const deniedWrite = await enterprisePage.request.patch(`/api/admin/growth-leads/${id}`, {
    data: { status: "已搁置" },
    headers: { "content-type": "application/json", "x-qice-request": "1" },
  });
  expect(deniedWrite.status()).toBe(403);
  await enterprise.close();

  await page.goto("/admin/enterprises");
  await expect(page.getByText("合成询价贸易有限公司")).toHaveCount(0);

  await page.goto("/register");
  await expect(page.getByTestId("register-form")).toBeVisible();
  const apk = await page.request.get("/downloads/qiceai-android.apk", { maxRedirects: 0 });
  expect(apk.status()).toBe(307);
  expect(apk.headers().location).toBe(APK_DOWNLOAD_URL);
});
