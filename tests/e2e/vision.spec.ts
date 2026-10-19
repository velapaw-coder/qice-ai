import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const VAT_JSON = {
  company_name: "合成视觉企业",
  uscc: "91440300MA5QCEA01C",
  taxpayer_type: "general",
  periods: [{ start: "2025-10-01", end: "2025-12-31", sales: 1000, vat_payable: 100, surtax: 12 }],
  unreadable: false,
};
const SS_JSON = {
  company_name: "合成视觉企业",
  uscc: "91440300MA5QCEA01C",
  headcount: 12,
  ss_personal_month: 8000,
  ss_total_month: 20000,
  young_candidates: 1,
  unreadable: false,
};

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("照片走视觉模型，未配置或失败时进入顾问复核", async ({ browser }) => {
  const hits: string[] = [];
  let fail = false;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      hits.push(body);
      if (fail) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "mock down" }));
        return;
      }
      const content = JSON.stringify(body.includes("社保清单") ? SS_JSON : VAT_JSON);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(43199, "127.0.0.1", resolve));
  writeFileSync("/tmp/qice-vision.png", PNG);
  writeFileSync("/tmp/qice-vision-2.png", PNG);

  const admin = await browser.newContext();
  const company = await browser.newContext();
  const adminPage = await admin.newPage();
  const companyPage = await company.newPage();
  try {
    await companyPage.goto("/register");
    await companyPage.getByTestId("company").fill("合成视觉企业");
    await companyPage.getByTestId("contact").fill("合成联系人");
    await companyPage.getByTestId("phone").fill("13700000009");
    await companyPage.getByTestId("password").fill("Photo1234");
    await companyPage.getByTestId("password2").fill("Photo1234");
    await companyPage.getByTestId("register-submit").click();
    await expect(companyPage.getByTestId("upload-consent")).toHaveText("上传即表示同意《数据授权书》《隐私政策》（含资料存放于境外服务器）");
    await expect(companyPage.getByTestId("vat-file")).toBeEnabled();
    await companyPage.getByTestId("vat-file").setInputFiles("/tmp/qice-vision.png");
    await expect(companyPage.getByTestId("file-progress")).toContainText("未配置视觉模型");
    expect(hits).toHaveLength(0);

    await login(adminPage, "13800000000", "Admin1234");
    await expect(adminPage.getByTestId("admin-home")).toBeVisible();
    const created = await adminPage.request.post("/api/admin/ai-providers", {
      headers: { "x-qice-request": "1", "content-type": "application/json" },
      data: {
        name: "本地假视觉模型",
        vendor: "custom",
        base_url: "http://127.0.0.1:43199/v1",
        api_key: "sk-test-vision",
        model: "fake-vision",
        cap_text: false,
        cap_vision: true,
        cap_json_mode: false,
      },
    });
    expect(created.ok()).toBeTruthy();
    const provider = (await created.json()) as { id: string };
    const assigned = await adminPage.request.put("/api/admin/settings", {
      headers: { "x-qice-request": "1", "content-type": "application/json" },
      data: { settings: { llm_vision_primary: provider.id } },
    });
    expect(assigned.ok()).toBeTruthy();

    await companyPage.getByTestId("ss-file").setInputFiles("/tmp/qice-vision.png");
    await expect(companyPage.locator("[data-testid='file-progress'] li").nth(1)).toContainText("识别完成");
    expect(hits.some((body) => body.includes("image_url") && body.includes("社保清单"))).toBeTruthy();

    fail = true;
    await companyPage.getByTestId("vat-file").setInputFiles("/tmp/qice-vision-2.png");
    await expect(companyPage.locator("[data-testid='file-progress'] li").nth(2)).toContainText("顾问");
  } finally {
    await admin.close();
    await company.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
