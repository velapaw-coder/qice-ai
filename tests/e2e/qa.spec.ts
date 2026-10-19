import { expect, test, type Browser, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { unzipSync } from "fflate";

const SMALL_VAT = "fixtures/fake/小规模-增值税申报表-合成.xlsx";
const SMALL_SS = "fixtures/fake/小规模-社保清单-合成.xlsx";
const DG_VAT = "fixtures/fake/东莞制造-增值税申报表-合成.xlsx";
const DG_SS = "fixtures/fake/东莞制造-社保清单-合成.xlsx";
const FIX_VAT = "fixtures/fake/补传企业-增值税申报表-合成.xlsx";
const FIX_SS = "fixtures/fake/补传企业-社保清单-合成.xlsx";
const BAD = "fixtures/fake/错误资料-合成.xlsx";
const SMALL = "深圳合成小规模商贸有限公司";
const DONGGUAN = "东莞合成智造有限公司";
const FIX = "深圳合成补传科技有限公司";
const SOLE = "东莞市测试纸品厂（合成）";
const SHOTS = "/opt/cursor/artifacts/screenshots";
const RETURN_NOTE = "社保清单请导出 Excel 原表。这是合成测试的退回说明。";
const PASTE_RULE = {
  code: "QA_PASTE_RULE",
  name: "合成粘贴规则",
  category: "就业补贴",
  regions: ["4403"],
  entity_types: ["enterprise"],
  conditions: [{ field: "tax_normal", op: "eq", value: true, level: "hard", text: "正常经营" }],
  estimate: null,
  basis: "合成粘贴，非真实政策",
  show_when_rejected: false,
};

mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

async function register(page: Page, name: string, phone: string, password: string) {
  await page.goto("/register");
  await page.getByTestId("company").fill(name);
  await page.getByTestId("contact").fill("合成联系人");
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

async function uploadPair(page: Page, vat: string, ss: string) {
  await page.getByTestId("vat-file").setInputFiles(vat);
  await expect(page.locator("[data-testid='file-progress'] li").last()).toContainText("识别完成", { timeout: 60_000 });
  await page.getByTestId("ss-file").setInputFiles(ss);
  await expect(page.locator("[data-testid='file-progress'] li").last()).toContainText("识别完成", { timeout: 90_000 });
}

async function openEnterprise(page: Page, name: string) {
  await page.goto("/admin/enterprises");
  await page.getByTestId("enterprise-search").fill(name);
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByTestId("admin-review")).toBeVisible();
}

async function tempPassword(page: Page) {
  const text = await page.getByTestId("temp-password").innerText();
  const password = text.match(/临时密码：([^。\s]+)/)?.[1];
  expect(password).toBeTruthy();
  return password!;
}

async function assertNoDeadAnchors(page: Page) {
  const bad = await page.locator("a").evaluateAll((nodes) =>
    nodes
      .map((node) => ({ href: node.getAttribute("href") || "", text: (node.textContent || "").trim().slice(0, 40) }))
      .filter((item) => item.href === "#" || item.href === "" || item.href.startsWith("javascript:")),
  );
  expect(bad).toEqual([]);
  const unlabeled = await page.locator("button").evaluateAll((nodes) =>
    nodes
      .filter((node) => !(node.textContent || "").trim() && !node.getAttribute("aria-label"))
      .map((node) => node.outerHTML.slice(0, 140)),
  );
  expect(unlabeled).toEqual([]);
}

test("合成案例、跨角色流程与死链", async ({ browser, baseURL }: { browser: Browser; baseURL?: string }) => {
  test.setTimeout(480_000);
  const origin = baseURL || "http://127.0.0.1:43123";
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      hits.push(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true,\"company_name\":\"深圳合成拍照科技有限公司\",\"uscc\":\"91440300MA5QCEA01C\",\"taxpayer_type\":\"general\",\"headcount\":6,\"periods\":[{\"start\":\"2025-10-01\",\"end\":\"2025-12-31\",\"sales\":1000,\"vat_payable\":30,\"surtax\":4}],\"unreadable\":false}" } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(43198, "127.0.0.1", resolve));

  const admin = await browser.newContext();
  const consultant = await browser.newContext();
  const small = await browser.newContext();
  const dongguan = await browser.newContext();
  const fix = await browser.newContext();
  const photo = await browser.newContext();
  const adminPage = await admin.newPage();
  const consultantPage = await consultant.newPage();
  const smallPage = await small.newPage();
  const dgPage = await dongguan.newPage();
  const fixPage = await fix.newPage();
  const photoPage = await photo.newPage();
  const contexts = [admin, consultant, small, dongguan, fix, photo];
  try {
    await login(adminPage, "13800000000", "Admin1234");
    await expect(adminPage.getByTestId("admin-home")).toBeVisible();
    await adminPage.goto("/admin/policies");
    for (let i = 0; i < 40; i++) {
      const button = adminPage.locator("[data-testid^='enable-']").first();
      if ((await button.count()) === 0) break;
      const id = await button.getAttribute("data-testid");
      await button.click();
      await expect(adminPage.getByTestId(id!)).toHaveCount(0);
    }

    await adminPage.goto("/admin/users");
    await adminPage.getByTestId("user-name").fill("合成顾问二");
    await adminPage.getByTestId("user-phone").fill("13900000002");
    await adminPage.getByTestId("user-role").selectOption("consultant");
    await adminPage.getByRole("button", { name: "生成临时密码并创建" }).click();
    const createdPassword = await tempPassword(adminPage);

    await login(consultantPage, "13900000002", createdPassword);
    await expect(consultantPage.getByTestId("change-password")).toBeVisible();
    await consultantPage.getByTestId("change-phone").fill("13900000002");
    await consultantPage.getByTestId("change-old").fill(createdPassword);
    await consultantPage.getByTestId("change-new").fill("Consult2234");
    await consultantPage.getByRole("button", { name: "保存新密码" }).click();
    await expect(consultantPage.getByTestId("admin-home")).toBeVisible();

    await register(smallPage, SMALL, "13700000003", "Small1234");
    await expect(smallPage.getByTestId("upload-consent")).toContainText("上传即表示同意");
    const before = await (await smallPage.request.get("/api/consent/current")).json();
    expect(before.active).toBe(false);
    await uploadPair(smallPage, SMALL_VAT, SMALL_SS);
    const after = await (await smallPage.request.get("/api/consent/current")).json();
    expect(after.active).toBe(true);
    expect(after.agreed.consent_version).toBe("v1");
    await smallPage.getByTestId("submit").click();
    await expect(smallPage.getByTestId("status-title")).toHaveText("待复核", { timeout: 30_000 });

    await openEnterprise(consultantPage, SMALL);
    await expect(consultantPage.getByTestId("profile-facts")).toContainText("纳税人 small_scale");
    await expect(consultantPage.getByTestId("profile-facts")).toContainText("人数 15");
    await expect(consultantPage.getByTestId("profile-facts")).toContainText("地区 深圳");
    await expect(consultantPage.getByTestId("profile-facts")).toContainText("主体 enterprise");
    await consultantPage.getByTestId("publish").click();
    await expect(consultantPage.getByText("已发布给企业")).toBeVisible();

    await smallPage.goto("/app/report");
    await expect(smallPage.getByTestId("estimate")).toContainText("预计可申请：");
    await expect(smallPage.getByTestId("estimate-note")).toHaveText("具体金额以顾问沟通为准");
    await expect(smallPage.getByTestId("disclaimer")).toBeVisible();
    await shot(smallPage, "qa-small-report");
    await smallPage.getByTestId("slot").selectOption("工作日下午");
    await smallPage.getByTestId("topic").selectOption("policy");
    await smallPage.getByTestId("book").click();
    await expect(smallPage.getByText("已提交，顾问会按您留的手机号联系。")).toBeVisible();

    await consultantPage.goto("/admin");
    const appointment = consultantPage.locator("tr", { hasText: SMALL });
    await expect(appointment.getByTestId("appointment-done")).toBeVisible();
    await appointment.getByTestId("appointment-done").click();
    await expect(consultantPage.locator("tr", { hasText: SMALL }).getByTestId("appointment-done")).toHaveCount(0);

    await openEnterprise(consultantPage, SMALL);
    await expect(consultantPage.locator("input[data-deal]").first()).toBeVisible();
    await consultantPage.locator("input[data-deal]").first().check();
    await consultantPage.getByTestId("create-policy-deal").click();
    await expect(consultantPage.getByText("已创建政策成交")).toBeVisible();
    await consultantPage.getByTestId("deal-stage").selectOption("已签约");
    await consultantPage.getByTestId("deal-stage-save").click();
    await expect(consultantPage.getByTestId("deal-stage-label")).toContainText("已签约");
    await consultantPage.getByTestId("deal-stage").selectOption("申报中");
    await consultantPage.getByTestId("deal-stage-save").click();
    await expect(consultantPage.getByTestId("deal-stage-label")).toContainText("申报中");
    await consultantPage.getByTestId("realize-amount").fill("12800");
    await consultantPage.getByTestId("realize-date").fill("2026-10-18");
    await consultantPage.getByTestId("realize").click();
    await expect(consultantPage.getByTestId("deal-stage-label")).toContainText("已兑现");
    await consultantPage.goto("/admin/deals/policy");
    await expect(consultantPage.getByTestId("policy-deals")).toContainText(SMALL);
    await expect(consultantPage.getByTestId("policy-deals")).toContainText("已兑现");

    await openEnterprise(consultantPage, SMALL);
    await consultantPage.getByTestId("fde-need").fill("合成需求：客服数字员工，需要报价");
    await consultantPage.getByTestId("create-fde").click();
    await expect(consultantPage.getByText("已创建 FDE 成交")).toBeVisible();
    await expect(consultantPage.getByTestId("fde-quote")).toBeVisible();
    await consultantPage.getByTestId("fde-quote").fill("26000");
    await consultantPage.getByTestId("fde-stage").selectOption("已报价");
    await consultantPage.getByTestId("fde-quote-save").click();
    await expect(consultantPage.getByTestId("fde-stage-label")).toContainText("已报价");
    await expect(consultantPage.getByTestId("fde-stage-label")).toContainText("26000");
    await consultantPage.goto("/admin/deals/fde");
    await expect(consultantPage.getByTestId("fde-deals")).toContainText("26000");

    await openEnterprise(consultantPage, SMALL);
    const download = await Promise.all([
      consultantPage.waitForEvent("download"),
      consultantPage.getByTestId("download-vat").click(),
    ]).then(([file]) => file);
    expect(download.suggestedFilename()).toContain("增值税");
    const zip = await Promise.all([
      consultantPage.waitForEvent("download"),
      consultantPage.getByTestId("zip").click(),
    ]).then(([file]) => file);
    const names = Object.keys(unzipSync(readFileSync(await zip.path())));
    expect(names.some((name) => name.startsWith("增值税申报表/"))).toBe(true);
    expect(names.some((name) => name.startsWith("社保清单/"))).toBe(true);

    await register(dgPage, DONGGUAN, "13700000004", "Dongguan1");
    await uploadPair(dgPage, DG_VAT, DG_SS);
    await dgPage.getByTestId("submit").click();
    await expect(dgPage.getByTestId("status-title")).toHaveText("待复核", { timeout: 30_000 });
    await openEnterprise(consultantPage, DONGGUAN);
    await expect(consultantPage.getByTestId("profile-facts")).toContainText("纳税人 general");
    await expect(consultantPage.getByTestId("profile-facts")).toContainText("人数 80");
    await expect(consultantPage.getByTestId("profile-facts")).toContainText("地区 东莞");
    await shot(consultantPage, "qa-dongguan");

    await register(fixPage, FIX, "13700000005", "Badfile1234");
    await fixPage.getByTestId("vat-file").setInputFiles(BAD);
    await expect(fixPage.locator("[data-testid='file-progress'] li").last()).toContainText("识别不出", { timeout: 30_000 });
    await fixPage.getByTestId("ss-file").setInputFiles(BAD);
    await expect(fixPage.locator("[data-testid='file-progress'] li").last()).toContainText("识别不出");
    await fixPage.getByTestId("manual-submit").click();
    await expect(fixPage.getByTestId("status-title")).toHaveText("待复核", { timeout: 30_000 });
    await openEnterprise(consultantPage, FIX);
    await consultantPage.getByTestId("return-note").fill(RETURN_NOTE);
    await consultantPage.getByTestId("return-submit").click();
    await fixPage.goto("/app");
    await expect(fixPage.getByTestId("status-title")).toHaveText("需补传");
    await expect(fixPage.getByTestId("status-message")).toContainText(RETURN_NOTE);
    await shot(fixPage, "qa-return");
    await fixPage.getByRole("link", { name: "去上传" }).click();
    await uploadPair(fixPage, FIX_VAT, FIX_SS);
    await fixPage.getByTestId("submit").click();
    await expect(fixPage.getByTestId("status-title")).toHaveText("待复核", { timeout: 30_000 });
    await consultantPage.goto("/admin");
    await expect(consultantPage.getByRole("link", { name: FIX })).toBeVisible();

    await openEnterprise(adminPage, SOLE);
    await expect(adminPage.getByTestId("profile-facts")).toContainText("主体 individual");
    await expect(adminPage.getByTestId("admin-review")).toContainText("暂不支持");

    await adminPage.goto("/admin/policies");
    await adminPage.getByTestId("create-policy").click();
    await expect(adminPage.getByTestId("policy-create-msg")).toHaveText("已创建为草稿");
    await adminPage.getByRole("link", { name: "合成培训补贴" }).click();
    const editor = adminPage.getByTestId("policy-json-edit");
    await expect(editor).toHaveValue(/QA_TRAIN_SUBSIDY/);
    await editor.fill((await editor.inputValue()).replace("合成培训补贴", "合成培训补贴修订"));
    await adminPage.getByTestId("save-policy-version").click();
    await expect(adminPage.getByTestId("policy-save-msg")).toContainText("已保存为新版本 2");
    await expect(adminPage.getByTestId("policy-version")).toHaveText("2");
    await expect(adminPage.getByTestId("policy-versions")).toContainText("版本 1");
    await expect(adminPage.getByTestId("policy-versions")).toContainText("版本 2");
    await adminPage.getByTestId("dry-run-enterprise").selectOption({ label: SMALL });
    await adminPage.getByTestId("dry-run").click();
    await expect(adminPage.getByTestId("dry-run-result")).toContainText("合成培训补贴修订");
    await expect(adminPage.getByTestId("dry-run-result")).toContainText("saved false");
    await adminPage.goto("/admin/policies");
    await adminPage.getByTestId("enable-QA_TRAIN_SUBSIDY").click();
    await expect(adminPage.getByTestId("disable-QA_TRAIN_SUBSIDY")).toBeVisible();
    await adminPage.getByTestId("disable-QA_TRAIN_SUBSIDY").click();
    await expect(adminPage.getByTestId("enable-QA_TRAIN_SUBSIDY")).toBeVisible();
    await adminPage.getByTestId("enable-QA_TRAIN_SUBSIDY").click();
    await expect(adminPage.getByTestId("disable-QA_TRAIN_SUBSIDY")).toBeVisible();

    await adminPage.goto("/admin/policy-drafts");
    await adminPage.getByTestId("paste-text").fill("合成粘贴政策草案\n这是明确标注的合成政策原文，不是真实文件。");
    await adminPage.getByTestId("paste-import").click();
    await expect(adminPage.getByTestId("paste-result")).toContainText("已生成待审核草稿");
    await adminPage.getByRole("link", { name: "合成粘贴政策草案" }).click();
    await expect(adminPage.getByTestId("draft-status")).toContainText("待审核");
    await adminPage.getByTestId("draft-json").fill(JSON.stringify(PASTE_RULE));
    await adminPage.getByTestId("save-draft-json").click();
    await expect(adminPage.getByTestId("draft-msg")).toContainText("规则已保存");
    await adminPage.getByTestId("adopt-draft").click();
    await expect(adminPage.getByTestId("draft-status")).toContainText("已采纳");
    await adminPage.goto("/admin/policies");
    await adminPage.getByTestId("enable-QA_PASTE_RULE").click();
    await expect(adminPage.getByTestId("disable-QA_PASTE_RULE")).toBeVisible();

    await adminPage.goto("/admin/policy-sources");
    const toggle = adminPage.locator("[data-testid^='source-toggle-']").first();
    await expect(toggle).toHaveText("启用");
    await toggle.click();
    await expect(toggle).toHaveText("停用");
    await toggle.click();
    await expect(toggle).toHaveText("启用");

    await adminPage.goto("/admin/settings");
    await adminPage.getByTestId("consultant-phone").fill("13800138000");
    await adminPage.getByLabel("档位名称").first().fill("1–3万元");
    await adminPage.getByTestId("save-settings").click();
    await expect(adminPage.getByTestId("settings-saved")).toHaveText("已保存");
    await adminPage.reload();
    await expect(adminPage.getByTestId("consultant-phone")).toHaveValue("13800138000");
    await expect(adminPage.getByLabel("档位名称").first()).toHaveValue("1–3万元");
    await adminPage.getByLabel("档位名称").first().fill("1–3万");
    await adminPage.getByTestId("save-settings").click();
    await expect(adminPage.getByTestId("settings-saved")).toHaveText("已保存");

    await adminPage.goto("/admin/users");
    await adminPage.getByTestId("reset-13900000002").click();
    const resetPassword = await tempPassword(adminPage);
    const resetCtx = await browser.newContext();
    contexts.push(resetCtx);
    const resetPage = await resetCtx.newPage();
    await login(resetPage, "13900000002", resetPassword);
    await expect(resetPage.getByTestId("change-password")).toBeVisible();
    await resetPage.getByTestId("change-phone").fill("13900000002");
    await resetPage.getByTestId("change-old").fill(resetPassword);
    await resetPage.getByTestId("change-new").fill("Consult3234");
    await resetPage.getByRole("button", { name: "保存新密码" }).click();
    await expect(resetPage.getByTestId("admin-home")).toBeVisible();
    await resetPage.getByTestId("admin-logout").click();
    await expect(resetPage.getByTestId("login-phone")).toBeVisible();

    await adminPage.goto("/admin/audit");
    const audit = adminPage.getByTestId("audit-log");
    await expect(audit).toContainText("consent.agree");
    await expect(audit).toContainText("policy.create");
    await expect(audit).toContainText("user.reset_password");
    await expect(audit).toContainText("assessment.publish");

    await adminPage.goto("/admin/ai-settings");
    await adminPage.getByTestId("provider-name").fill("合成连通模型");
    await adminPage.getByTestId("vendor").selectOption("custom");
    await adminPage.getByTestId("base-url").fill("http://127.0.0.1:43198/v1");
    await adminPage.getByTestId("model-name").fill("fake-text");
    await adminPage.getByTestId("api-key").fill("sk-test-local");
    await adminPage.getByTestId("cap-vision").check();
    await adminPage.getByTestId("privacy-ack").check();
    await adminPage.getByRole("button", { name: "保存模型" }).click();
    await expect(adminPage.locator("b", { hasText: "合成连通模型" })).toBeVisible();
    await adminPage.getByTestId("test-text").click();
    await expect(adminPage.getByTestId("model-test-result")).toContainText("连通");
    expect(hits.length).toBeGreaterThan(0);
    await adminPage.locator("label", { hasText: "llm_vision_primary" }).locator("select").selectOption({ label: "合成连通模型" });
    await adminPage.getByTestId("save-assignment").click();
    await expect(adminPage.getByTestId("model-test-result")).toContainText("主用和备用模型已更新");

    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await register(photoPage, "深圳合成拍照科技有限公司", "13700000008", "Photo2234");
    await photoPage.getByTestId("vat-file").setInputFiles({ name: "合成申报表.png", mimeType: "image/png", buffer: png });
    await expect(photoPage.getByTestId("file-progress")).toContainText("识别完成", { timeout: 30_000 });

    await smallPage.goto("/app/settings");
    await smallPage.getByTestId("change-password-link").click();
    await expect(smallPage.getByTestId("change-password")).toBeVisible();
    await smallPage.getByTestId("change-phone").fill("13700000003");
    await smallPage.getByTestId("change-old").fill("Small1234");
    await smallPage.getByTestId("change-new").fill("Small2234");
    await smallPage.getByRole("button", { name: "保存新密码" }).click();
    await expect(smallPage.getByTestId("status-title")).toBeVisible();
    await smallPage.goto("/app/settings");
    await smallPage.getByTestId("logout").click();
    await expect(smallPage.getByTestId("login-phone")).toBeVisible();
    await login(smallPage, "13700000003", "Small2234");
    await expect(smallPage.getByTestId("status-title")).toHaveText("已发布");

    const home = await browser.newPage();
    await home.goto("/");
    await assertNoDeadAnchors(home);
    for (const hash of ["#services", "#value", "#process", "#faq"]) {
      await expect(home.locator(hash)).toHaveCount(1);
    }
    const contactTag = await home.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.textContent?.includes("联系方式见登录页")) return node.parentElement?.tagName || "";
      }
      return "";
    });
    expect(contactTag).toBe("P");
    for (const doc of ["privacy", "consent", "terms"]) {
      await home.goto(`/legal/${doc}`);
      await expect(home.locator("h1")).toBeVisible();
      await expect(home.locator("article")).not.toContainText("请求失败");
      await expect(home.locator("article p, article li").first()).toBeVisible();
      await assertNoDeadAnchors(home);
    }
    await home.goto("/");
    await home.setViewportSize({ width: 390, height: 844 });
    await home.getByTestId("home-menu").click();
    await expect(home.getByTestId("home-drawer")).toBeVisible();
    await assertNoDeadAnchors(home);
    await shot(home, "qa-home-drawer");
    await home.getByTestId("home-menu-close").click();
    await expect(home.getByTestId("home-drawer")).toBeHidden();

    const routes = [
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
      "/admin/change-password",
    ];
    for (const route of routes) {
      const response = await adminPage.goto(route);
      expect(response?.status(), route).not.toBe(404);
      await assertNoDeadAnchors(adminPage);
    }
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await adminPage.goto("/admin");
    await adminPage.getByTestId("admin-menu").click();
    const drawerLinks = await adminPage.getByTestId("admin-drawer").locator("a").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    expect(drawerLinks.filter(Boolean).length).toBeGreaterThan(8);
    expect(drawerLinks).not.toContain("#");
    await adminPage.getByTestId("admin-menu-close").click();

    await smallPage.setViewportSize({ width: 390, height: 844 });
    await smallPage.goto("/app");
    await smallPage.getByTestId("enterprise-menu").click();
    await expect(smallPage.getByTestId("enterprise-drawer")).toBeVisible();
    await assertNoDeadAnchors(smallPage);
    for (const route of ["/app", "/app/upload", "/app/report", "/app/settings", "/app/change-password"]) {
      const response = await smallPage.goto(route);
      expect(response?.status(), route).not.toBe(404);
      await assertNoDeadAnchors(smallPage);
    }

    const pages = [home, adminPage, smallPage];
    const seen = new Set<string>();
    for (const page of pages) {
      const hrefs = await page.locator("a").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") || ""));
      for (const href of hrefs) {
        if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
        const url = new URL(href, origin);
        if (url.origin !== origin) continue;
        seen.add(url.pathname + url.search);
      }
    }
    for (const path of seen) {
      const response = await adminPage.request.get(path);
      expect(response.status(), path).not.toBe(404);
    }
    for (const file of ["src/client/pages/AdminApp.tsx", "src/client/pages/EnterpriseApp.tsx", "src/client/home/markup.ts", "src/client/pages/AuthPages.tsx"]) {
      expect(readFileSync(file, "utf8")).not.toContain('href="#"');
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});
