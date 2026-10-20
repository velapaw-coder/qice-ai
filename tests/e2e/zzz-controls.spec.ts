import { expect, test, type Locator, type Page } from "@playwright/test";

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

async function clickControl(page: Page, locator: Locator) {
  const tag = await locator.evaluate((node) => node.tagName);
  const href = await locator.getAttribute("href");
  const target = await locator.getAttribute("target");
  const testid = (await locator.getAttribute("data-testid")) || "";
  const here = new URL(page.url());
  if (tag === "A" && href) {
    const next = new URL(href, here);
    if (next.origin === here.origin && next.pathname === here.pathname && !next.search && !next.hash) return "same-page";
  }
  const failed: string[] = [];
  const tracked = new Set<string>();
  let sawOk = false;
  const onRequest = (req: { url: () => string; method: () => string; guid?: string }) => {
    if (req.url().includes("/api/")) tracked.add(`${req.method()} ${req.url()}`);
  };
  const onResponse = (res: { url: () => string; status: () => number; request: () => { method: () => string } }) => {
    const key = `${res.request().method()} ${res.url()}`;
    if (!res.url().includes("/api/") || !tracked.has(key)) return;
    if (res.status() >= 400) failed.push(`${res.status()} ${key}`);
    else sawOk = true;
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  const beforeUrl = page.url();
  const before = await page.locator("main").innerText().catch(() => "");
  const invalidBefore = await page.locator("main :invalid").count();
  if (target === "_blank") {
    const popupPromise = page.waitForEvent("popup");
    await locator.click();
    const popup = await popupPromise;
    await expect(popup.locator("body")).not.toHaveText("");
    await popup.close();
    page.off("request", onRequest);
    page.off("response", onResponse);
    expect(failed, failed.join("\n")).toEqual([]);
    return "popup";
  }
  const expectsDownload = testid === "zip" || (href || "").includes("/download");
  const downloadPromise = expectsDownload ? page.waitForEvent("download", { timeout: 25_000 }) : null;
  await locator.click();
  if (downloadPromise) await downloadPromise;
  let changed = Boolean(downloadPromise);
  for (let attempt = 0; attempt < 40 && !changed; attempt++) {
    if (page.url() !== beforeUrl) changed = true;
    else if ((await page.locator("main :invalid").count()) > invalidBefore) changed = true;
    else if (sawOk) changed = true;
    else if ((await page.locator("main").innerText().catch(() => "")) !== before) changed = true;
    else await page.waitForTimeout(300);
  }
  page.off("request", onRequest);
  page.off("response", onResponse);
  expect(failed, failed.join("\n")).toEqual([]);
  expect(changed, testid || href || await locator.innerText()).toBeTruthy();
  if (page.url() !== beforeUrl && !page.url().includes("/login")) await page.goto(beforeUrl);
  return page.url() !== beforeUrl ? "navigate" : "effect";
}

async function restoreAdminPassword(page: Page, temporary: string) {
  await page.goto("/admin/change-password");
  await page.getByTestId("change-phone").fill("13800000000");
  await page.getByTestId("change-old").fill(temporary);
  await page.getByTestId("change-new").fill("Admin1234");
  await page.getByTestId("change-confirm").fill("Admin1234");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByTestId("admin-home")).toBeVisible({ timeout: 60_000 });
}

async function audit(page: Page) {
  await expect(page.getByText(/正在读取|正在进入/)).toHaveCount(0);
  const controls = page.locator("header button:visible, header a:visible, aside button:visible, aside a:visible, main button:visible, main a:visible");
  const total = await controls.count();
  const clicked: string[] = [];
  for (let i = 0; i < total; i++) {
    const locator = controls.nth(i);
    if (!(await locator.isVisible().catch(() => false))) continue;
    if (await locator.isDisabled().catch(() => false)) continue;
    const testid = (await locator.getAttribute("data-testid")) || "";
    if (testid === "admin-logout" || testid === "logout") continue;
    const label = ((await locator.innerText().catch(() => "")) || testid).replace(/\s+/g, " ").trim().slice(0, 40);
    const kind = await clickControl(page, locator);
    if (testid === "reset-13800000000") {
      await page.getByTestId("reset-generate").click();
      await expect(page.getByTestId("temp-password")).toContainText("临时密码：", { timeout: 60_000 });
      const temporary = (await page.getByTestId("temp-password").innerText()).match(/临时密码：([^。\s]+)/)?.[1];
      expect(temporary).toBeTruthy();
      await restoreAdminPassword(page, temporary!);
      await page.goto("/admin/users");
      await expect(page.getByText(/正在读取|正在进入/)).toHaveCount(0);
    }
    if (kind !== "same-page") clicked.push(label || testid || "控件");
    if (page.url().includes("/login")) break;
  }
  expect(clicked.length).toBeGreaterThan(0);
}

test("管理员、顾问和企业端每个可见按钮都有反馈", async ({ browser }) => {
  test.setTimeout(480_000);
  const adminContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const consultantContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const companyContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const adminPage = await adminContext.newPage();
  const consultantPage = await consultantContext.newPage();
  const companyPage = await companyContext.newPage();
  const errors: string[] = [];
  for (const page of [adminPage, consultantPage, companyPage]) {
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
  }
  try {
    await login(adminPage, "13800000000", "Admin1234");
    await expect(adminPage.getByTestId("admin-home")).toBeVisible();
    const adminRoutes = [
      "/admin",
      "/admin/enterprises",
      "/admin/deals/policy",
      "/admin/deals/fde",
      "/admin/policies",
      "/admin/policy-drafts",
      "/admin/policy-sources",
      "/admin/crawl-runs",
      "/admin/ai-settings",
      "/admin/users",
      "/admin/audit",
      "/admin/settings",
      "/admin/tickets",
      "/admin/profile",
    ];
    for (const route of adminRoutes) {
      await adminPage.goto(route);
      await expect(adminPage.locator("main")).toBeVisible();
      await audit(adminPage);
    }
    await adminPage.goto("/admin/enterprises");
    await adminPage.locator("main a").first().click();
    await expect(adminPage.getByTestId("admin-review")).toBeVisible();
    await audit(adminPage);
    await adminPage.goto("/admin/policies");
    await adminPage.locator("main a").first().click();
    await expect(adminPage.getByTestId("policy-json-edit")).toBeVisible();
    await audit(adminPage);
    const draftLink = adminPage.locator("a[href*='/admin/policy-drafts/']");
    await adminPage.goto("/admin/policy-drafts");
    if (await draftLink.count()) {
      await draftLink.first().click();
      await expect(adminPage.getByTestId("draft-json")).toBeVisible();
      await audit(adminPage);
    }

    await adminPage.setViewportSize({ width: 390, height: 844 });
    await adminPage.goto("/admin");
    await adminPage.getByTestId("admin-menu").click();
    await expect(adminPage.getByTestId("admin-drawer")).toBeVisible();
    await adminPage.getByTestId("admin-menu-close").click();
    await expect(adminPage.getByTestId("admin-drawer")).toBeHidden();

    await adminPage.setViewportSize({ width: 1280, height: 800 });
    await adminPage.goto("/admin/users");
    await adminPage.getByTestId("user-name").fill("控件顾问");
    await adminPage.getByTestId("user-phone").fill("13900000021");
    await adminPage.getByTestId("user-role").selectOption("consultant");
    await adminPage.getByTestId("create-user-submit").click();
    await expect(adminPage.getByTestId("temp-password")).toContainText("13900000021", { timeout: 60_000 });
    const temp = await adminPage.getByTestId("temp-password").innerText();
    const password = temp.match(/临时密码：([^。\s]+)/)?.[1];
    expect(password).toBeTruthy();
    await login(consultantPage, "13900000021", password!);
    await expect(consultantPage.getByTestId("workspace-label")).toHaveText("顾问工作台");
    await consultantPage.getByTestId("change-phone").fill("13900000021");
    await consultantPage.getByTestId("change-old").fill(password!);
    await consultantPage.getByTestId("change-new").fill("Consult2121");
    await consultantPage.getByTestId("change-confirm").fill("Consult2121");
    await consultantPage.getByRole("button", { name: "保存新密码" }).click();
    await expect(consultantPage.getByTestId("admin-home")).toBeVisible();
    for (const route of adminRoutes) {
      await consultantPage.goto(route);
      await expect(consultantPage.locator("main")).toBeVisible();
      if (["/admin/ai-settings", "/admin/users", "/admin/audit", "/admin/settings"].includes(route)) {
        await expect(consultantPage.getByTestId("admin-only")).toBeVisible();
      }
      await audit(consultantPage);
    }
    await consultantPage.goto("/admin/enterprises");
    await consultantPage.locator("main a").first().click();
    await expect(consultantPage.getByTestId("admin-review")).toBeVisible();
    await audit(consultantPage);

    await login(companyPage, "13700000001", "Aihua1234");
    for (const route of ["/app", "/app/upload", "/app/report", "/app/settings", "/app/tickets"]) {
      await companyPage.goto(route);
      await expect(companyPage.locator("main")).toBeVisible();
      await audit(companyPage);
    }
    await companyPage.setViewportSize({ width: 390, height: 844 });
    await companyPage.goto("/app/upload");
    await companyPage.getByTestId("enterprise-menu").click();
    await expect(companyPage.getByTestId("enterprise-drawer")).toBeVisible();
    await companyPage.getByTestId("enterprise-menu-close").click();
    await expect(companyPage.getByTestId("enterprise-drawer")).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await adminContext.close();
    await consultantContext.close();
    await companyContext.close();
  }
});
