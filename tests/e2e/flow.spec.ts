import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { DISCLAIMER } from "../../src/shared/rules/evaluate";

const VAT = "fixtures/fake/爱华-增值税申报表-合成.xlsx";
const SS = "fixtures/fake/爱华-社保清单-合成.xlsx";
const SOLE_VAT = "fixtures/fake/个体户-增值税申报表-合成.xlsx";
const SOLE_SS = "fixtures/fake/个体户-社保清单-合成.xlsx";
const SHOTS = "/opt/cursor/artifacts/screenshots";
const GO = ["APPRENTICE_SUBSIDY", "SKILL_EVAL_SUBSIDY"];
const VERIFY = ["GRAD_SS_SUBSIDY", "KEY_HIRE_TAX", "VET_HIRE_TAX", "DISABLED_LEVY", "DISABLED_WAGE_DEDUCT"];

async function shot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("爱华主流程与个体户暂不支持", async ({ browser }: { browser: Browser }) => {
  test.setTimeout(240_000);
  const admin = await browser.newContext();
  const consultant = await browser.newContext();
  const company = await browser.newContext();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const adminPage = await admin.newPage();
  const consultantPage = await consultant.newPage();
  const companyPage = await company.newPage();
  const mobilePage = await mobile.newPage();

  await companyPage.goto("/");
  await expect(companyPage.locator("text=企策AI").first()).toBeVisible();
  await expect(companyPage.locator("body")).not.toContainText("企益");
  await expect(companyPage.locator("body")).not.toContainText("30%");
  await expect(companyPage.locator("text=系统智能测算，顾问复核")).toBeVisible();
  await shot(companyPage, "homepage");
  await mobilePage.goto("/");
  await expect(mobilePage.locator("text=免费申请政策初评").first()).toBeVisible();
  await shot(mobilePage, "homepage-mobile");

  await companyPage.goto("/register");
  await shot(companyPage, "register");
  await companyPage.getByTestId("company").fill("深圳爱华国际教育科技有限公司");
  await companyPage.getByTestId("contact").fill("合成联系人");
  await companyPage.getByTestId("phone").fill("13700000001");
  await companyPage.getByTestId("password").fill("Aihua1234");
  await companyPage.getByTestId("password2").fill("Aihua1234");
  await companyPage.getByTestId("register-submit").click();
  await expect(companyPage.getByTestId("upload-page")).toBeVisible();
  await expect(companyPage.getByTestId("consent-form")).toHaveCount(0);
  await expect(companyPage.getByTestId("upload-consent")).toHaveText("上传即表示同意《数据授权书》《隐私政策》（含资料存放于境外服务器）");
  await expect(companyPage.getByTestId("link-consent")).toHaveAttribute("href", "/legal/consent");
  await expect(companyPage.getByTestId("link-privacy")).toHaveAttribute("href", "/legal/privacy");
  const beforeConsent = await (await companyPage.request.get("/api/consent/current")).json();
  expect(beforeConsent.active).toBe(false);
  await expect(companyPage.getByTestId("vat-file")).toBeEnabled();
  await companyPage.getByTestId("vat-file").setInputFiles(VAT);
  await expect(companyPage.getByTestId("file-progress")).toContainText("识别完成");
  const afterConsent = await (await companyPage.request.get("/api/consent/current")).json();
  expect(afterConsent.active).toBe(true);
  expect(afterConsent.agreed.consent_version).toBe("v1");
  expect(afterConsent.agreed.agreed_at).toBeTruthy();
  await companyPage.getByTestId("ss-file").setInputFiles(SS);
  await expect(companyPage.locator("[data-testid='file-progress'] li")).toHaveCount(2);
  await expect(companyPage.locator("[data-testid='file-progress'] li").nth(1)).toContainText("识别完成");
  await shot(companyPage, "upload");

  await adminPage.goto("/login");
  await login(adminPage, "13800000000", "Admin1234");
  await expect(adminPage.getByTestId("admin-home")).toBeVisible();
  await shot(adminPage, "admin-todos");
  const auditRes = await adminPage.request.get("/api/admin/audit");
  const auditJson = (await auditRes.json()) as { logs: { action: string; actor_id: string | null; ip: string | null; meta_json: string | null }[] };
  const agreed = auditJson.logs.find((log) => log.action === "consent.agree");
  expect(agreed?.actor_id).toBeTruthy();
  expect(agreed?.ip).toBeTruthy();
  const agreeMeta = JSON.parse(agreed?.meta_json || "{}") as { version?: string; user_id?: string; privacy_version?: string };
  expect(agreeMeta.version).toBe("v1");
  expect(agreeMeta.privacy_version).toBe("privacy-v1");
  expect(agreeMeta.user_id).toBe(agreed?.actor_id);
  await adminPage.goto("/admin/policies");
  await expect(adminPage.getByTestId("enable-APPRENTICE_SUBSIDY")).toBeVisible();
  const enabled: string[] = [];
  for (let guard = 0; guard < 6; guard += 1) {
    await expect(adminPage.getByTestId("policy-page")).toContainText(`第 ${guard + 1} /`);
    const codes = await adminPage.locator("[data-testid^='enable-']").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid") || ""));
    if (guard === 0) expect(codes.length).toBeGreaterThan(7);
    for (const id of codes) {
      await adminPage.getByTestId(id).click();
      await expect(adminPage.getByTestId(id)).toHaveCount(0);
      enabled.push(id);
    }
    const next = adminPage.getByTestId("policy-next");
    if (await next.isDisabled()) break;
    await Promise.all([
      adminPage.waitForResponse((res) => res.url().includes("/api/admin/policies?") && res.url().includes(`page=${guard + 2}`)),
      next.click(),
    ]);
    await expect(adminPage.locator("[data-testid^='enable-']").first()).toBeVisible();
  }
  expect(enabled.length).toBeGreaterThan(7);
  await adminPage.goto("/admin/ai-settings");
  await expect(adminPage.getByTestId("ai-settings")).toBeVisible();
  await expect(adminPage.getByTestId("vendor")).toBeVisible();
  await shot(adminPage, "admin-ai-settings");
  await adminPage.goto("/admin/users");
  await adminPage.getByTestId("user-name").fill("合成顾问");
  await adminPage.getByTestId("user-phone").fill("13900000001");
  await adminPage.getByTestId("user-role").selectOption("consultant");
  await adminPage.getByRole("button", { name: "生成临时密码并创建" }).click();
  const tempText = await adminPage.getByTestId("temp-password").innerText();
  const tempPassword = tempText.match(/临时密码：([^。\s]+)/)?.[1];
  expect(tempPassword).toBeTruthy();

  const denied = await companyPage.request.get("/api/admin/todos");
  expect(denied.status()).toBe(403);
  await companyPage.getByTestId("submit").click();
  await expect(companyPage.getByTestId("status-title")).toHaveText("待复核", { timeout: 30_000 });
  const before = await companyPage.request.get("/api/report");
  const beforeJson = await before.json();
  expect(beforeJson.published).toBe(false);
  expect(beforeJson.estimate_low).toBeUndefined();
  const submitLog = beforeJson;
  expect(submitLog.status).toBe("待复核");

  await consultantPage.goto("/login");
  await login(consultantPage, "13900000001", tempPassword!);
  await expect(consultantPage.getByTestId("change-password")).toBeVisible();
  await consultantPage.getByTestId("change-phone").fill("13900000001");
  await consultantPage.getByTestId("change-old").fill(tempPassword!);
  await consultantPage.getByTestId("change-new").fill("Consult1234");
  await consultantPage.getByRole("button", { name: "保存新密码" }).click();
  await expect(consultantPage.getByTestId("admin-home")).toBeVisible();
  await consultantPage.getByRole("link", { name: "深圳爱华国际教育科技有限公司" }).first().click();
  await expect(consultantPage.getByTestId("admin-review")).toBeVisible();
  await consultantPage.getByTestId("industry").fill("教育");
  await expect(consultantPage.getByTestId("established")).toHaveValue("");
  await expect(consultantPage.getByTestId("established-state")).toHaveText("待识别");
  await consultantPage.getByTestId("established").fill("2014-01-01");
  await consultantPage.getByTestId("capital").fill("1000000");
  await consultantPage.getByTestId("dishonest").selectOption("false");
  await consultantPage.getByTestId("save-profile").click();
  const matched = consultantPage.getByText("已重新匹配");
  await expect(matched).toBeVisible();
  const ruleMs = Number((await matched.innerText()).match(/(\d+(?:\.\d+)?)\s*ms/)?.[1]);
  expect(ruleMs).toBeLessThan(10);
  for (const code of GO) {
    await expect(consultantPage.getByTestId(`tier-${code}`)).toContainText("可推进");
  }
  for (const code of VERIFY) {
    const card = consultantPage.getByTestId(`tier-${code}`);
    await expect(card).toContainText("需核实");
    await expect(card).not.toContainText("可推进");
  }
  await expect(consultantPage.getByTestId("admin-estimate")).toContainText("最高约 1 万元");
  await expect(consultantPage.getByTestId("band-select")).toHaveValue("1-3");
  await consultantPage.getByTestId("band-select").selectOption("3-8");
  await consultantPage.locator("main").evaluate((node) => { node.scrollTop = 0; });
  const header = await consultantPage.getByTestId("admin-header").boundingBox();
  const review = await consultantPage.getByTestId("admin-review").boundingBox();
  expect(header && review && header.y < 8 && review.y >= header.y + header.height - 1).toBeTruthy();
  await shot(consultantPage, "admin-review", false);
  await consultantPage.setViewportSize({ width: 390, height: 844 });
  await consultantPage.locator("main").evaluate((node) => { node.scrollTop = 0; });
  const mobileHeader = await consultantPage.getByTestId("admin-header").boundingBox();
  const mobileReview = await consultantPage.getByTestId("admin-review").boundingBox();
  expect(mobileHeader && mobileReview && mobileHeader.y < 8 && mobileReview.y >= mobileHeader.y + mobileHeader.height - 1).toBeTruthy();
  await shot(consultantPage, "admin-review-mobile", false);
  await consultantPage.getByTestId("admin-menu").click();
  await expect(consultantPage.getByTestId("admin-drawer")).toBeVisible();
  await expect(consultantPage.getByRole("link", { name: "待办" })).toBeVisible();
  await shot(consultantPage, "admin-drawer", false);
  await consultantPage.getByTestId("admin-menu-close").click();
  await consultantPage.setViewportSize({ width: 1280, height: 720 });
  await consultantPage.getByTestId("publish").click();
  await expect(consultantPage.getByText("已发布给企业")).toBeVisible();
  await expect(consultantPage.getByTestId("create-policy-deal")).toBeVisible();

  await companyPage.goto("/app/report");
  await expect(companyPage.getByTestId("estimate")).toHaveText("预计可申请：3–8 万元");
  await expect(companyPage.getByTestId("estimate-note")).toHaveText("具体金额以顾问沟通为准");
  await expect(companyPage.getByTestId("claim-list")).toBeVisible();
  await expect(companyPage.getByTestId("disclaimer")).toHaveText(DISCLAIMER);
  const reportText = await companyPage.locator("body").innerText();
  for (const banned of ["服务费", "30%", "7800", "9000", "9600", "最高约"]) expect(reportText).not.toContain(banned);
  await shot(companyPage, "enterprise-report");
  await companyPage.setViewportSize({ width: 390, height: 844 });
  await shot(companyPage, "enterprise-mobile", false);
  await companyPage.setViewportSize({ width: 1280, height: 720 });
  await companyPage.getByTestId("slot").selectOption("工作日上午");
  await companyPage.getByTestId("topic").selectOption("both");
  await companyPage.getByTestId("book").click();
  await expect(companyPage.getByText("已提交，顾问会按您留的手机号联系。")).toBeVisible();

  await consultantPage.reload();
  await consultantPage.locator("input[data-deal]").first().check();
  await consultantPage.getByTestId("create-policy-deal").click();
  await expect(consultantPage.getByText("已创建政策成交")).toBeVisible();
  await consultantPage.getByTestId("fde-need").fill("需要一套客服数字员工，线下另议服务费");
  await consultantPage.getByTestId("create-fde").click();
  await expect(consultantPage.getByText("已创建 FDE 成交")).toBeVisible();
  await consultantPage.getByTestId("realize-amount").fill("5000");
  await consultantPage.getByTestId("realize-date").fill("2026-10-01");
  await consultantPage.getByTestId("realize").click();
  await expect(consultantPage.getByTestId("deal-stage-label")).toContainText("已兑现");

  const download = await Promise.all([
    consultantPage.waitForEvent("download"),
    consultantPage.getByTestId("download-vat").click(),
  ]).then(([file]) => file);
  expect(download.suggestedFilename()).toContain("增值税");
  const zip = await Promise.all([
    consultantPage.waitForEvent("download"),
    consultantPage.getByTestId("zip").click(),
  ]).then(([file]) => file);
  expect(zip.suggestedFilename()).toContain("深圳爱华国际教育科技有限公司");
  const zipped = unzipSync(readFileSync(await zip.path()));
  const names = Object.keys(zipped);
  expect(names.some((name) => name.startsWith("增值税申报表/"))).toBe(true);
  expect(names.some((name) => name.startsWith("社保清单/"))).toBe(true);

  const sole = await browser.newContext();
  const solePage = await sole.newPage();
  await solePage.goto("/register");
  await solePage.getByTestId("company").fill("东莞市测试纸品厂（合成）");
  await solePage.getByTestId("contact").fill("合成经营者");
  await solePage.getByTestId("phone").fill("13700000002");
  await solePage.getByTestId("password").fill("Sole12345");
  await solePage.getByTestId("password2").fill("Sole12345");
  await solePage.getByTestId("register-submit").click();
  await expect(solePage.getByTestId("upload-consent")).toBeVisible();
  await expect(solePage.getByTestId("vat-file")).toBeEnabled();
  await solePage.getByTestId("vat-file").setInputFiles(SOLE_VAT);
  await expect(solePage.locator("[data-testid='file-progress'] li")).toHaveCount(1);
  await expect(solePage.locator("[data-testid='file-progress'] li")).toContainText("识别完成");
  await solePage.getByTestId("ss-file").setInputFiles(SOLE_SS);
  await expect(solePage.locator("[data-testid='file-progress'] li")).toHaveCount(2);
  await expect(solePage.locator("[data-testid='file-progress'] li").nth(1)).toContainText("识别完成");
  await solePage.getByTestId("submit").click();
  await expect(solePage.getByTestId("status-title")).toHaveText("暂不支持", { timeout: 30_000 });

  await admin.close();
  await consultant.close();
  await company.close();
  await mobile.close();
  await sole.close();
});
