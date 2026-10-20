import { expect, test, type Browser, type Page } from "@playwright/test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

async function register(page: Page, name: string, phone: string, password: string) {
  await page.goto("/register");
  await page.getByTestId("company").fill(name);
  await page.getByTestId("contact").fill("工单联系人");
  await page.getByTestId("phone").fill(phone);
  await page.getByTestId("password").fill(password);
  await page.getByTestId("password2").fill(password);
  await page.getByTestId("register-submit").click();
  const blocked = page.getByText("这个网络注册太频繁");
  const ready = page.getByTestId("upload-page");
  await expect(blocked.or(ready)).toBeVisible();
  if (await blocked.isVisible()) {
    await page.waitForTimeout(61_000);
    await page.getByTestId("register-submit").click();
  }
  await expect(ready).toBeVisible();
}

async function createConsultant(page: Page, name: string, phone: string, password: string) {
  await page.goto("/admin/users");
  await page.getByTestId("user-name").fill(name);
  await page.getByTestId("user-phone").fill(phone);
  await page.getByTestId("user-role").selectOption("consultant");
  await page.getByTestId("user-password").fill(password);
  await page.getByTestId("user-password-confirm").fill(password);
  await expect(page.getByTestId("user-must-change")).not.toBeChecked();
  await page.getByTestId("create-user-custom").click();
  await expect(page.getByTestId("temp-password")).toContainText("直接登录", { timeout: 60_000 });
}

test("专属顾问、工单和跨角色权限", async ({ browser }: { browser: Browser }) => {
  test.setTimeout(240_000);
  const admin = await browser.newContext();
  const consultantA = await browser.newContext();
  const consultantB = await browser.newContext();
  const company = await browser.newContext();
  const other = await browser.newContext();
  const adminPage = await admin.newPage();
  const consultantPage = await consultantA.newPage();
  const otherConsultant = await consultantB.newPage();
  const companyPage = await company.newPage();
  const otherPage = await other.newPage();
  try {
    await login(adminPage, "13800000000", "Admin1234");
    await createConsultant(adminPage, "工单顾问甲", "13900000041", "Consult4141");
    await createConsultant(adminPage, "工单顾问乙", "13900000042", "Consult4242");

    await login(consultantPage, "13900000041", "Consult4141");
    await expect(consultantPage.getByTestId("workspace-label")).toHaveText("顾问工作台");
    await consultantPage.goto("/admin/profile");
    await consultantPage.getByTestId("contact-phone").fill("13911112222");
    await consultantPage.getByTestId("contact-wechat").fill("qice_jia");
    await consultantPage.getByTestId("contact-save").click();
    await expect(consultantPage.getByTestId("contact-msg")).toHaveText("已保存联系方式");
    await consultantPage.getByTestId("contact-qr").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: PNG });
    await consultantPage.getByTestId("contact-qr-upload").click();
    await expect(consultantPage.getByTestId("contact-msg")).toHaveText("已上传二维码");

    await register(companyPage, "工单验收科技有限公司", "13700000041", "Ticket4141");
    await companyPage.goto("/app");
    const mine = companyPage.getByTestId("my-consultant");
    await expect(mine.getByTestId("consultant-state")).toHaveText("顾问分配中");
    await expect(mine.getByTestId("general-contact")).toContainText("专属顾问");
    await expect(companyPage.getByTestId("enterprise-consultant-side")).toContainText("顾问分配中");

    await companyPage.goto("/app/tickets");
    await companyPage.getByTestId("ticket-title").fill("补贴材料怎么补");
    await companyPage.getByTestId("ticket-content").fill("请告诉我还要补哪份社保");
    await companyPage.getByTestId("ticket-file").setInputFiles({ name: "材料.png", mimeType: "image/png", buffer: PNG });
    await companyPage.getByTestId("ticket-submit").click();
    await expect(companyPage.getByTestId("ticket-status")).toHaveText("待处理");
    const ticketId = companyPage.url().split("/").pop() || "";
    expect(ticketId).toMatch(/[0-9a-f-]{8,}/i);
    const fileHref = await companyPage.getByRole("link", { name: "材料.png" }).getAttribute("href");
    expect((await companyPage.request.get(fileHref || "")).status()).toBe(200);

    await consultantPage.goto("/admin/tickets");
    await expect(consultantPage.getByRole("link", { name: /补贴材料怎么补/ })).toHaveCount(0);
    expect((await consultantPage.request.get(`/api/tickets/${ticketId}`)).status()).toBe(403);

    await adminPage.goto("/admin/enterprises");
    await adminPage.getByTestId("enterprise-search").fill("工单验收科技有限公司");
    await adminPage.getByRole("link", { name: "工单验收科技有限公司", exact: true }).click();
    await expect(adminPage.getByTestId("consultant-select").locator("option", { hasText: "工单顾问甲" })).toHaveCount(1);
    await adminPage.getByTestId("consultant-select").selectOption({ label: "工单顾问甲 13900000041" });
    await adminPage.getByTestId("assign-consultant").click();
    await expect(adminPage.getByText("已保存顾问分配")).toBeVisible();

    await companyPage.goto("/app");
    await expect(mine.getByTestId("consultant-name")).toHaveText("工单顾问甲");
    await expect(mine.getByTestId("consultant-phone")).toContainText("13911112222");
    await expect(mine.getByTestId("consultant-wechat")).toContainText("qice_jia");
    expect((await companyPage.request.get("/api/consultant/qr")).status()).toBe(200);

    await consultantPage.goto("/admin/tickets");
    await expect(consultantPage.getByTestId("ticket-filter-label")).toHaveText("待处理工单");
    await consultantPage.getByRole("link", { name: /补贴材料怎么补/ }).click();
    await consultantPage.getByTestId("ticket-reply").fill("先补最新一期社保");
    await consultantPage.getByTestId("ticket-send").click();
    await expect(consultantPage.getByTestId("ticket-thread")).toContainText("先补最新一期社保");
    await expect(consultantPage.getByTestId("ticket-status")).toHaveText("处理中");

    await register(otherPage, "工单旁观科技有限公司", "13700000042", "Ticket4242");
    expect((await otherPage.request.get(`/api/tickets/${ticketId}`)).status()).toBe(403);
    expect((await otherPage.request.get(fileHref || "")).status()).toBe(403);
    await login(otherConsultant, "13900000042", "Consult4242");
    expect((await otherConsultant.request.get(`/api/tickets/${ticketId}`)).status()).toBe(403);
    const deniedAssign = await consultantPage.request.patch(`/api/admin/enterprises/${ticketId}/consultant`, {
      headers: { "x-qice-request": "1", "content-type": "application/json" },
      data: { consultant_id: null },
    });
    expect(deniedAssign.status()).toBe(403);

    await companyPage.goto("/app");
    await expect(companyPage.getByTestId("ticket-dot")).toBeVisible();
    await companyPage.goto(`/app/tickets/${ticketId}`);
    await expect(companyPage.getByTestId("ticket-thread")).toContainText("先补最新一期社保");
    await companyPage.goto("/app");
    await expect(companyPage.getByTestId("ticket-dot")).toHaveCount(0);

    await companyPage.goto(`/app/tickets/${ticketId}`);
    await companyPage.getByTestId("ticket-close").click();
    await expect(companyPage.getByTestId("ticket-status")).toHaveText("已解决");
    await companyPage.getByTestId("ticket-reopen").click();
    await expect(companyPage.getByTestId("ticket-status")).toHaveText("待处理");

    await adminPage.goto(`/admin/tickets/${ticketId}`);
    await expect(adminPage.getByTestId("ticket-assignee").locator("option", { hasText: "工单顾问乙" })).toHaveCount(1);
    await adminPage.getByTestId("ticket-assignee").selectOption({ label: "工单顾问乙" });
    await adminPage.getByTestId("ticket-reassign").click();
    await expect(adminPage.getByRole("heading", { name: "补贴材料怎么补" })).toBeVisible();
    await otherConsultant.goto("/admin/tickets");
    await expect(otherConsultant.getByTestId("ticket-dot")).toBeVisible();
    await otherConsultant.getByTestId("ticket-filter-progress").click();
    await expect(otherConsultant.getByTestId("ticket-filter-label")).toHaveText("处理中工单");
    await otherConsultant.getByTestId("ticket-filter-resolved").click();
    await expect(otherConsultant.getByTestId("ticket-filter-label")).toHaveText("已解决工单");
    await otherConsultant.getByTestId("ticket-filter-open").click();
    await expect(otherConsultant.getByTestId("ticket-filter-label")).toHaveText("待处理工单");
    await expect(otherConsultant.getByRole("link", { name: /补贴材料怎么补/ })).toBeVisible();
    expect((await otherConsultant.request.get(`/api/tickets/${ticketId}`)).status()).toBe(200);
    expect((await consultantPage.request.get(`/api/tickets/${ticketId}`)).status()).toBe(200);

    await adminPage.goto("/admin/audit");
    const audit = adminPage.getByTestId("audit-log");
    await expect(audit).toContainText("新建工单");
    await expect(audit).toContainText("分配专属顾问");
    await expect(audit).toContainText("回复工单");
    await expect(audit).toContainText("转派工单");
  } finally {
    await Promise.all([admin.close(), consultantA.close(), consultantB.close(), company.close(), other.close()]);
  }
});
