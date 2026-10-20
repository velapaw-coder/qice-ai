import { expect, test, type Browser, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { unzipSync } from "fflate";

const VAT = "fixtures/fake/爱华-增值税申报表-合成.xlsx";
const SS = "fixtures/fake/爱华-社保清单-合成.xlsx";
const COMPANY = "深圳闭环验收科技有限公司";
const RULE = {
  code: "LOOP_RULE",
  name: "闭环岗位补贴",
  category: "就业补贴",
  regions: ["4403"],
  entity_types: ["enterprise"],
  conditions: [{ field: "tax_normal", op: "eq", value: true, level: "hard", text: "正常经营" }],
  estimate: null,
  basis: "闭环验收合成规则，非真实政策",
  show_when_rejected: false,
};

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

async function tempPassword(page: Page, phone: string) {
  const locator = page.getByTestId("temp-password");
  await expect(locator).toContainText("临时密码：", { timeout: 60_000 });
  await expect(locator).toContainText(phone);
  const text = await locator.innerText();
  const password = text.match(/临时密码：([^。\s]+)/)?.[1];
  expect(password).toBeTruthy();
  return password!;
}

test("闭环：建账号、复核发布、管道、规则、抓取、模型和打包", async ({ browser }: { browser: Browser }) => {
  test.setTimeout(480_000);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }));
  });
  await new Promise<void>((resolve) => server.listen(43197, "127.0.0.1", resolve));
  const admin = await browser.newContext();
  const consultant = await browser.newContext();
  const newAdmin = await browser.newContext();
  const company = await browser.newContext();
  const adminPage = await admin.newPage();
  const consultantPage = await consultant.newPage();
  const newAdminPage = await newAdmin.newPage();
  const companyPage = await company.newPage();
  try {
    await login(adminPage, "13800000000", "Admin1234");
    await expect(adminPage.getByTestId("workspace-label")).toHaveText("管理员工作台");
    await adminPage.goto("/admin/users");
    await adminPage.getByTestId("user-name").fill("闭环顾问");
    await adminPage.getByTestId("user-phone").fill("13900000011");
    await adminPage.getByTestId("user-role").selectOption("consultant");
    await adminPage.getByTestId("create-user-submit").click();
    const consultantPassword = await tempPassword(adminPage, "13900000011");

    await login(consultantPage, "13900000011", consultantPassword);
    await expect(consultantPage.getByTestId("workspace-label")).toHaveText("顾问工作台");
    await expect(consultantPage.getByTestId("change-password")).toBeVisible();
    await consultantPage.getByTestId("change-phone").fill("13900000011");
    await consultantPage.getByTestId("change-old").fill(consultantPassword);
    await consultantPage.getByTestId("change-new").fill("Consult1111");
    await consultantPage.getByTestId("change-confirm").fill("Consult1111");
    await consultantPage.getByRole("button", { name: "保存新密码" }).click();
    await expect(consultantPage.getByTestId("admin-home")).toBeVisible();
    await expect(consultantPage.getByTestId("workspace-label")).toHaveText("顾问工作台");

    await adminPage.getByTestId("user-name").fill("闭环管理员");
    await adminPage.getByTestId("user-phone").fill("13900000012");
    await adminPage.getByTestId("user-role").selectOption("admin");
    await adminPage.getByTestId("create-user-submit").click();
    const adminPassword = await tempPassword(adminPage, "13900000012");
    await login(newAdminPage, "13900000012", adminPassword);
    await expect(newAdminPage.getByTestId("workspace-label")).toHaveText("管理员工作台");

    await companyPage.goto("/register");
    await companyPage.getByTestId("company").fill(COMPANY);
    await companyPage.getByTestId("contact").fill("闭环联系人");
    await companyPage.getByTestId("phone").fill("13700000011");
    await companyPage.getByTestId("password").fill("Loop12345");
    await companyPage.getByTestId("password2").fill("Loop12345");
    await companyPage.getByTestId("register-submit").click();
    const blocked = companyPage.getByText("这个网络注册太频繁");
    const ready = companyPage.getByTestId("upload-page");
    await expect(blocked.or(ready)).toBeVisible();
    if (await blocked.isVisible()) {
      await companyPage.waitForTimeout(61_000);
      await companyPage.getByTestId("register-submit").click();
    }
    await expect(ready).toBeVisible();
    await companyPage.getByTestId("vat-file").setInputFiles(VAT);
    await expect(companyPage.locator("[data-testid='file-progress'] li").last()).toContainText("识别完成", { timeout: 60_000 });
    await companyPage.getByTestId("ss-file").setInputFiles(SS);
    await expect(companyPage.locator("[data-testid='file-progress'] li").last()).toContainText("识别完成", { timeout: 90_000 });
    await companyPage.getByTestId("submit").click();
    await expect(companyPage.getByTestId("status-title")).toHaveText("待复核", { timeout: 30_000 });

    await consultantPage.goto("/admin/enterprises");
    await consultantPage.getByTestId("enterprise-search").fill(COMPANY);
    await consultantPage.getByRole("link", { name: COMPANY, exact: true }).click();
    await expect(consultantPage.getByTestId("admin-review")).toBeVisible();
    await consultantPage.getByTestId("band-select").selectOption({ index: 1 });
    await consultantPage.getByTestId("publish").click();
    await expect(consultantPage.getByText("已发布给企业")).toBeVisible();

    await companyPage.goto("/app/report");
    await expect(companyPage.getByTestId("estimate")).toContainText("预计可申请：");
    await companyPage.getByTestId("book").click();
    await expect(companyPage.getByText("已提交，顾问会按您留的手机号联系。")).toBeVisible();

    await consultantPage.locator("input[data-deal]").first().check();
    await consultantPage.getByTestId("create-policy-deal").click();
    await expect(consultantPage.getByText("已创建政策成交")).toBeVisible();
    await consultantPage.getByTestId("fde-need").fill("闭环验收要一个报价");
    await consultantPage.getByTestId("create-fde").click();
    await expect(consultantPage.getByText("已创建 FDE 成交")).toBeVisible();

    await consultantPage.goto("/admin/deals/policy");
    const policyRow = consultantPage.locator("tr", { hasText: COMPANY });
    await policyRow.locator("select").selectOption("已签约");
    await policyRow.getByRole("button", { name: "保存阶段" }).click();
    await expect(policyRow.getByTestId("pipeline-stage-label")).toHaveText("已签约");
    await consultantPage.goto("/admin/deals/fde");
    const fdeRow = consultantPage.locator("tr", { hasText: COMPANY });
    await fdeRow.locator("select").selectOption("已报价");
    await fdeRow.getByRole("button", { name: "保存阶段" }).click();
    await expect(fdeRow.getByTestId("fde-pipeline-stage")).toHaveText("已报价");

    await adminPage.goto("/admin/policy-drafts");
    await adminPage.getByTestId("paste-text").fill("闭环验收政策正文。深圳小微企业正常经营时可申报岗位补贴。这段文字只用于验收，不是真实政策。");
    await adminPage.getByTestId("paste-import").click();
    await expect(adminPage.getByTestId("paste-result")).toContainText("已生成待审核草稿");
    await adminPage.getByRole("link", { name: /闭环验收政策正文/ }).first().click();
    await adminPage.getByTestId("draft-json").fill(JSON.stringify(RULE, null, 2));
    await adminPage.getByTestId("save-draft-json").click();
    await expect(adminPage.getByTestId("draft-msg")).toContainText("规则已保存");
    await adminPage.getByTestId("adopt-draft").click();
    await expect(adminPage.getByTestId("draft-msg")).toContainText("已采纳为草稿规则");
    await adminPage.goto("/admin/policies");
    await adminPage.getByRole("link", { name: "闭环岗位补贴" }).click();
    const edited = JSON.parse(JSON.stringify(RULE)) as typeof RULE;
    edited.basis = "闭环验收已编辑";
    await adminPage.getByTestId("policy-json-edit").fill(JSON.stringify(edited, null, 2));
    await adminPage.getByTestId("save-policy-version").click();
    await expect(adminPage.getByTestId("policy-save-msg")).toContainText("已保存为新版本");
    await adminPage.getByTestId("enable-policy").click();
    await expect(adminPage.getByTestId("disable-policy")).toBeVisible();
    await adminPage.getByTestId("disable-policy").click();
    await expect(adminPage.getByTestId("enable-policy")).toBeVisible();

    await adminPage.goto("/admin/policy-sources");
    await adminPage.getByTestId("source-name").fill("闭环来源");
    await adminPage.getByTestId("source-url").fill("http://127.0.0.1:9/policies");
    await adminPage.getByTestId("source-add").click();
    await expect(adminPage.getByTestId("source-msg")).toContainText("已添加来源");
    await adminPage.locator("li", { hasText: "闭环来源" }).getByRole("button", { name: "手动抓取" }).click();
    await expect(adminPage.getByTestId("source-msg")).toContainText("手动抓取");
    await adminPage.goto("/admin/crawl-runs");
    await expect(adminPage.getByTestId("crawl-runs")).toContainText("手动抓取");

    await adminPage.goto("/admin/ai-settings");
    await adminPage.getByTestId("provider-name").fill("闭环文本模型");
    await adminPage.getByTestId("vendor").selectOption("custom");
    await expect(adminPage.getByTestId("vendor")).toContainText("自定义（OpenAI 兼容）");
    await adminPage.getByTestId("base-url").fill("http://127.0.0.1:43197/v1");
    await adminPage.getByTestId("model-name").fill("fake-text");
    await adminPage.getByTestId("api-key").fill("sk-loop");
    await adminPage.getByTestId("privacy-ack").check();
    await adminPage.getByRole("button", { name: "保存模型" }).click();
    await expect(adminPage.locator("b", { hasText: "闭环文本模型" })).toBeVisible();
    await adminPage.getByTestId("test-text").first().click();
    await expect(adminPage.getByTestId("test-text-result").first()).toContainText("连通");
    await adminPage.getByTestId("test-vision").first().click();
    await expect(adminPage.getByTestId("test-vision-result").first()).toContainText("图中的数字");

    await consultantPage.goto("/admin/enterprises");
    await consultantPage.getByTestId("enterprise-search").fill(COMPANY);
    await consultantPage.getByRole("link", { name: COMPANY, exact: true }).click();
    const zip = await Promise.all([
      consultantPage.waitForEvent("download"),
      consultantPage.getByTestId("zip").click(),
    ]).then(([file]) => file);
    const packed = unzipSync(new Uint8Array(await zip.createReadStream().then(streamToBuffer)));
    expect(Object.keys(packed).length).toBeGreaterThan(0);

    await companyPage.goto("/app/settings");
    await companyPage.getByTestId("revoke").click();
    await expect(companyPage.getByText("授权已撤回，资料将在 7 天内删除。")).toBeVisible();
    await consultantPage.reload();
    await expect(consultantPage.getByTestId("zip-blocked")).toHaveText("授权已撤回，不能打包下载");
    await expect(consultantPage.getByTestId("zip")).toHaveCount(0);
    await expect(consultantPage.getByTestId("download-vat")).toHaveCount(0);
  } finally {
    server.close();
    await admin.close();
    await consultant.close();
    await newAdmin.close();
    await company.close();
  }
});

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
