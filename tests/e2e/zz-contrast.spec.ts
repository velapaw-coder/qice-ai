import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  const lines = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${label} | ${node.target.join(" ")} | ${(node.failureSummary || "").split("\n")[0]}`),
  );
  expect(lines, lines.join("\n")).toEqual([]);
}

async function readContrast(locator: Locator) {
  return locator.evaluate((el) => {
    function channel(value: number) {
      const scaled = value / 255;
      return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    }
    function luminance(rgb: { r: number; g: number; b: number }) {
      return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
    }
    function parse(input: string) {
      const match = input.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts.length > 3 ? parts[3]! : 1 };
    }
    function mix(fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number }) {
      return {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
      };
    }
    function backdropOf(node: Element) {
      const chain: Element[] = [];
      let cursor: Element | null = node;
      while (cursor) {
        chain.push(cursor);
        cursor = cursor.parentElement;
      }
      let backdrop = { r: 255, g: 255, b: 255 };
      let stops: { r: number; g: number; b: number }[] | null = null;
      for (const item of chain.reverse()) {
        const style = getComputedStyle(item);
        const color = parse(style.backgroundColor);
        const image = style.backgroundImage || "";
        const gradient = image.includes("gradient") ? [...image.matchAll(/rgba?\([^)]+\)|#([0-9a-fA-F]{6})\b/g)] : [];
        if (gradient.length) {
          const behind = backdrop;
          const painted = gradient.flatMap((part) => {
            const token = part[0];
            const parsed = token.startsWith("#")
              ? { r: Number.parseInt(token.slice(1, 3), 16), g: Number.parseInt(token.slice(3, 5), 16), b: Number.parseInt(token.slice(5, 7), 16), a: 1 }
              : parse(token);
            if (!parsed || parsed.a < 0.85) return [];
            return [mix(parsed, behind)];
          });
          if (painted.length) {
            stops = painted;
            backdrop = painted[0]!;
          }
        } else if (color && color.a > 0) {
          backdrop = mix(color, backdrop);
          if (color.a >= 0.99) stops = null;
        }
      }
      return stops && stops.length ? stops : [backdrop];
    }
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || box.width < 2 || box.height < 2) return null;
    const fill = parse(style.color);
    if (!fill || fill.a === 0) return null;
    const label = ("innerText" in el ? el.innerText : el.textContent || "").replace(/\s+/g, " ").trim();
    if (!label) return null;
    const backgrounds = backdropOf(el);
    const ink = mix(fill, backgrounds[0]!);
    const ratios = backgrounds.map((bg) => {
      const left = luminance(ink);
      const right = luminance(bg);
      return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
    });
    const size = Number.parseFloat(style.fontSize);
    const weight = Number(style.fontWeight);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    return { ratio: Math.min(...ratios), min: large ? 3 : 4.5, label: label.slice(0, 30) };
  });
}

async function expectReadable(locator: Locator, state: string) {
  const sample = await readContrast(locator);
  expect(sample, `${state} has no readable text`).not.toBeNull();
  expect(sample!.ratio, `${state} 「${sample!.label}」 ${sample!.ratio.toFixed(2)} < ${sample!.min}`).toBeGreaterThanOrEqual(sample!.min - 0.05);
}

async function auditStates(page: Page, label: string) {
  const items = page.locator("a:visible, button:visible, input:visible, select:visible, textarea:visible, .nav-icon:visible");
  const count = Math.min(await items.count(), 24);
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    await item.hover({ force: true }).catch(() => undefined);
    const hovered = await readContrast(item);
    if (hovered) expect(hovered.ratio, `${label} hover 「${hovered.label}」 ${hovered.ratio.toFixed(2)}`).toBeGreaterThanOrEqual(hovered.min - 0.05);
    await item.focus().catch(() => undefined);
    const focused = await readContrast(item);
    if (focused) expect(focused.ratio, `${label} focus 「${focused.label}」 ${focused.ratio.toFixed(2)}`).toBeGreaterThanOrEqual(focused.min - 0.05);
  }
  const button = page.locator("button:visible").first();
  if (await button.count()) {
    await button.evaluate((el) => {
      el.setAttribute("data-contrast-was", (el as HTMLButtonElement).disabled ? "1" : "0");
      (el as HTMLButtonElement).disabled = true;
    });
    await expectReadable(button, `${label} disabled`);
    await button.evaluate((el) => {
      if (el.getAttribute("data-contrast-was") !== "1") (el as HTMLButtonElement).disabled = false;
      el.removeAttribute("data-contrast-was");
    });
  }
}

async function register(page: Page) {
  await page.goto("/register");
  await page.getByTestId("company").fill("深圳合成对比度科技有限公司");
  await page.getByTestId("contact").fill("对比联系人");
  await page.getByTestId("phone").fill("13700000006");
  await page.getByTestId("password").fill("Contrast1");
  await page.getByTestId("password2").fill("Contrast1");
  await page.getByTestId("register-submit").click();
  const limited = page.getByText("这个网络注册太频繁");
  const arrived = page.waitForURL("**/app/upload", { timeout: 15_000 }).then(() => "ok" as const).catch(() => "wait" as const);
  const blocked = limited.waitFor({ timeout: 8_000 }).then(() => "limit" as const).catch(() => "wait" as const);
  const outcome = await Promise.race([arrived, blocked]);
  if (outcome !== "ok") {
    await page.waitForTimeout(61_000);
    await page.getByTestId("register-submit").click();
    await page.waitForURL("**/app/upload");
  }
}

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("页面文字在默认、悬停、焦点和禁用时都可读", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(DESKTOP);

  for (const path of ["/", "/login", "/register", "/legal/privacy", "/legal/consent", "/legal/terms"]) {
    await page.goto(path);
    await axe(page, `desktop ${path}`);
  }
  await auditStates(page, "register");
  await page.goto("/");
  await auditStates(page, "home");

  await page.setViewportSize(MOBILE);
  await page.goto("/");
  await page.getByTestId("home-menu").click();
  await expect(page.getByTestId("home-drawer")).toBeVisible();
  await axe(page, "mobile home");
  await auditStates(page, "mobile home");
  await page.goto("/login");
  await axe(page, "mobile login");

  await page.setViewportSize(DESKTOP);
  await register(page);
  for (const path of ["/app/upload", "/app", "/app/settings", "/app/report"]) {
    await page.goto(path);
    await axe(page, `enterprise ${path}`);
  }
  await page.goto("/app/upload");
  await expect(page.locator(".nav-pill[aria-current='page']")).toHaveText("资料");
  const active = page.locator(".nav-pill[aria-current='page']");
  await expect(active).toHaveCSS("color", "rgb(12, 24, 50)");
  await expect(active).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await auditStates(page, "enterprise");

  await page.setViewportSize(MOBILE);
  await page.goto("/app/upload");
  await page.getByTestId("enterprise-menu").click();
  await expect(page.getByTestId("enterprise-drawer")).toBeVisible();
  await expect(page.getByTestId("enterprise-drawer").locator(".nav-pill[aria-current='page']")).toHaveCSS("color", "rgb(12, 24, 50)");
  await axe(page, "mobile enterprise");
  await auditStates(page, "mobile enterprise");

  await page.setViewportSize(DESKTOP);
  await page.goto("/app/settings");
  await page.getByTestId("logout").click();
  await login(page, "13800000000", "Admin1234");
  await expect(page.getByTestId("workspace-label")).toHaveText("管理员工作台");
  await expect(page.locator(".nav-pill[aria-current='page']")).toContainText("待办");
  await expect(page.locator(".nav-pill[aria-current='page']")).toHaveCSS("color", "rgb(12, 24, 50)");
  await expect(page.locator(".nav-pill[aria-current='page'] .nav-icon")).toHaveCSS("color", "rgb(30, 79, 200)");
  const adminPaths = ["/admin", "/admin/enterprises", "/admin/deals/policy", "/admin/deals/fde", "/admin/policies", "/admin/policy-drafts", "/admin/policy-sources", "/admin/crawl-runs", "/admin/ai-settings", "/admin/users", "/admin/audit", "/admin/settings"];
  for (const path of adminPaths) {
    await page.goto(path);
    await axe(page, `admin ${path}`);
  }
  await page.goto("/admin");
  await auditStates(page, "admin");

  await page.goto("/admin/users");
  await page.getByTestId("user-name").fill("对比顾问");
  await page.getByTestId("user-phone").fill("13900000003");
  await page.getByRole("button", { name: "生成临时密码并创建" }).click();
  await expect(page.getByTestId("temp-password")).toContainText("临时密码：", { timeout: 60_000 });
  const temp = await page.getByTestId("temp-password").innerText();
  const password = temp.match(/临时密码：([^。\s]+)/)?.[1];
  expect(password).toBeTruthy();

  await page.setViewportSize(MOBILE);
  await page.goto("/admin");
  await page.getByTestId("admin-menu").click();
  await expect(page.getByTestId("admin-drawer").locator(".nav-pill[aria-current='page']")).toHaveCSS("color", "rgb(12, 24, 50)");
  await axe(page, "mobile admin");
  await auditStates(page, "mobile admin");

  await page.setViewportSize(DESKTOP);
  await page.getByTestId("admin-logout").click();
  await login(page, "13900000003", password!);
  await expect(page.getByTestId("workspace-label")).toHaveText("顾问工作台");
  await axe(page, "consultant change-password");
});
