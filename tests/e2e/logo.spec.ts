import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-phone").fill("13800000000");
  await page.getByTestId("login-password").fill("Admin1234");
  await page.getByTestId("login-submit").click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test("标志在浅色和深色顶栏旁保留企策AI，筛选框与搜索框同高", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const homeLogo = page.locator("header img.brandmark");
  await expect(homeLogo).toBeVisible();
  await expect(homeLogo).toHaveAttribute("src", /logo-80\.png/);
  await expect(page.locator("header .brand")).toContainText("企策AI");
  const homeBox = await homeLogo.boundingBox();
  expect(homeBox?.height).toBeGreaterThan(38);
  expect(homeBox?.height).toBeLessThan(42);
  await expect(page.locator("footer img.brandmark")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBrand = await page.locator("header .brand").boundingBox();
  expect(mobileBrand).toBeTruthy();
  expect(mobileBrand!.x).toBeGreaterThanOrEqual(0);
  expect(mobileBrand!.x + mobileBrand!.width).toBeLessThanOrEqual(390);
  await expect(homeLogo).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/login");
  const loginLogo = page.locator("header img");
  await expect(loginLogo).toBeVisible();
  await expect(loginLogo).toHaveAttribute("src", /logo-72\.png/);
  await expect(page.locator("header")).toContainText("企策AI");
  const loginBox = await loginLogo.boundingBox();
  expect(loginBox?.height).toBeGreaterThan(34);
  expect(loginBox?.height).toBeLessThan(38);

  await page.goto("/legal/privacy");
  await expect(page.locator("header img")).toHaveAttribute("src", /logo-64\.png/);
  await expect(page.locator("header")).toContainText("企策AI");

  await login(page);
  const adminLogo = page.locator("header img");
  await expect(adminLogo).toHaveAttribute("src", /logo-64\.png/);
  const adminBox = await adminLogo.boundingBox();
  expect(adminBox?.height).toBeGreaterThan(30);
  expect(adminBox?.height).toBeLessThan(34);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(adminLogo).toBeVisible();
  const adminBrand = await page.locator("header a").first().boundingBox();
  expect(adminBrand!.x + adminBrand!.width).toBeLessThanOrEqual(390);

  await page.setViewportSize({ width: 1280, height: 800 });
  for (const route of ["/admin/enterprises", "/admin/policies", "/admin/policy-drafts"]) {
    await page.goto(route);
    const search = page.locator("main input").first();
    await expect(search).toBeVisible();
    const searchHeight = await search.evaluate((el) => el.getBoundingClientRect().height);
    const selects = page.locator("main select.app-select");
    const count = await selects.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const selectHeight = await selects.nth(i).evaluate((el) => el.getBoundingClientRect().height);
      expect(Math.abs(selectHeight - searchHeight)).toBeLessThan(0.6);
    }
    expect(Math.abs(searchHeight - 46.75)).toBeLessThan(0.6);
  }
});
