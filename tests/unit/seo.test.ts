import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GOOGLE_VERIFY_BODY,
  GOOGLE_VERIFY_CONTENT_TYPE,
  KEYWORDS,
  OG_IMAGE,
  ROBOTS_CONTENT_TYPE,
  SITEMAP_CONTENT_TYPE,
  SITE,
  SITE_DESCRIPTION,
  SITE_TITLE,
  canonicalFor,
  cookieShouldBeSecure,
  decorateHtml,
  documentHeaders,
  pageKind,
  redirectLocation,
  robotsTxt,
  shouldNoindex,
  sitemapXml,
} from "../../src/worker/seo";

const shell = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>${SITE_TITLE}</title>
    <meta name="description" content="${SITE_DESCRIPTION}" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

describe("公开页 SEO", () => {
  it("robots.txt 允许公开页，拦住后台、企业端、登录注册和接口", () => {
    const text = robotsTxt();
    expect(ROBOTS_CONTENT_TYPE.startsWith("text/plain")).toBe(true);
    expect(text).toContain("User-agent: *");
    expect(text).toContain("Allow: /");
    expect(text).toContain("Disallow: /admin");
    expect(text).toContain("Disallow: /app");
    expect(text).toContain("Disallow: /login");
    expect(text).toContain("Disallow: /register");
    expect(text).toContain("Disallow: /api/");
    expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(text).not.toMatch(/301|Location|redirect/i);
  });

  it("sitemap 只列出首页和公开法律页", () => {
    const xml = sitemapXml();
    expect(SITEMAP_CONTENT_TYPE.startsWith("application/xml")).toBe(true);
    expect(xml).toContain("<loc>https://qicego.com/</loc>");
    expect(xml).toContain("<loc>https://qicego.com/legal/privacy</loc>");
    expect(xml).toContain("<loc>https://qicego.com/legal/consent</loc>");
    expect(xml).toContain("<loc>https://qicego.com/legal/terms</loc>");
    expect(xml).not.toContain("goqice.com");
    expect(xml).not.toContain("/login");
    expect(xml).not.toContain("/register");
    expect(xml).not.toContain("/admin");
    expect(xml).not.toContain("/app");
    expect(xml).not.toContain("/api");
  });

  it("首页 HTML 带真实文案，canonical 固定为 qicego.com", () => {
    const html = decorateHtml(shell, "/");
    expect(canonicalFor("qice.chang2.ccwu.cc", "/")).toBe("https://qicego.com/");
    expect(canonicalFor("127.0.0.1:43123", "/")).toBe("https://qicego.com/");
    expect(html).toContain('rel="canonical" href="https://qicego.com/"');
    expect(html).toContain('property="og:url" content="https://qicego.com/"');
    expect(html).not.toContain("goqice.com");
    expect(html).toContain('name="google-site-verification" content="QUFnL2SkqIMTjBYg4f9jG-caFdtmHLNAp1ikX6XdWYI"');
    expect(html).toContain(`content="${KEYWORDS}"`);
    expect(html).toContain(`property="og:image" content="${OG_IMAGE}"`);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain("深圳市精灵探索科技有限公司");
    expect(html).toContain("企策AI增长");
    expect(html).toContain("AI驱动企业价值重构与长期增长陪跑平台");
    expect(html).toContain("发现向往 · 连接同频 · 重构商业 · 共创增长");
    expect(html).toContain("企策AI增长，不只是帮助企业用AI把今天的生意做得更好，更重要的是，陪伴企业重新发现客户的向往，创造明天的新生意。");
    expect(html).toContain("发现人的真实向往，激活企业潜在价值");
    expect(html).toContain("让企业通过AI创造新的商业可能与第二增长曲线");
    expect(html).not.toContain("用AI发现人的真实向往，激活企业潜在价值，创造新的商业可能。");
    expect(html).not.toContain("让同频的人相遇，让有价值的商业自然生长。");
    expect(html).toContain("让AI真正进入业务，用可验证的改善支持企业增长。");
    expect(html).not.toContain("同频匹配");
    expect(html).toContain("询价整理与报价辅助");
    expect(html).toContain("拟开放试点，需先确认适配，不是已经上线的成熟工具。");
    expect(html).toContain("不承诺金额、审批结果，也不承诺政府为AI采购买单。");
    expect(html).not.toContain("让政策红利");
    expect(html).not.toContain("10人以上");
    expect(html).toContain("这里不承诺固定天数、免费三年，提交后也不会自动开通。");
    expect(html).not.toContain("员工超过10人就一定能获得补贴吗？");
    const indexHtml = readFileSync("index.html", "utf8");
    expect(indexHtml).toContain(`<title>${SITE_TITLE}</title>`);
    expect(indexHtml).toContain(`content="${SITE_DESCRIPTION}"`);
    expect(indexHtml).not.toContain("企业政策优惠");
    expect(indexHtml).not.toContain("让政策红利");
    expect(html).toContain('id="qice-seo"');
    expect(html).toContain('getElementById("qice-seo")');
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(documentHeaders("/")).not.toHaveProperty("x-robots-tag");
  });

  it("后台、企业端、登录和注册 noindex，且不塞首页正文", () => {
    for (const path of ["/admin", "/admin/enterprises", "/app", "/app/settings", "/login", "/register"]) {
      const html = decorateHtml(shell, path);
      expect(pageKind(path)).toBe("private");
      expect(shouldNoindex(path)).toBe(true);
      expect(html).toContain('name="robots" content="noindex, nofollow"');
      expect(html).toContain(`rel="canonical" href="https://qicego.com${path}"`);
      expect(html).not.toContain("询价整理与报价辅助");
      expect(html).not.toContain("og:image");
      expect(html).not.toContain("google-site-verification");
      expect(documentHeaders(path)["x-robots-tag"]).toBe("noindex, nofollow");
    }
    expect(canonicalFor("qice.chang2.ccwu.cc", "/admin")).toBe("https://qicego.com/admin");
  });

  it("已知法律页有短正文，未知法律页 noindex", () => {
    const privacy = decorateHtml(shell, "/legal/privacy");
    expect(privacy).toContain("<h1>隐私政策</h1>");
    expect(privacy).toContain("模板，待法务确认");
    expect(privacy).toContain('rel="canonical" href="https://qicego.com/legal/privacy"');
    expect(privacy).toContain('name="google-site-verification" content="QUFnL2SkqIMTjBYg4f9jG-caFdtmHLNAp1ikX6XdWYI"');
    expect(privacy).not.toContain("noindex");
    const unknown = decorateHtml(shell, "/legal/other");
    expect(shouldNoindex("/legal/other")).toBe(true);
    expect(unknown).toContain("noindex");
    expect(unknown).not.toContain("询价整理与报价辅助");
  });

  it("旧主机名 301 到 qicego.com，并保留路径和查询", () => {
    const cases = ["www.qicego.com", "goqice.com", "www.goqice.com", "qice.chang2.ccwu.cc", "GoQice.com:443", "www.qicego.com."];
    for (const host of cases) {
      expect(redirectLocation(host, "127.0.0.1", "/legal/privacy", "?from=old")).toBe(
        "https://qicego.com/legal/privacy?from=old",
      );
    }
    expect(redirectLocation("www.qicego.com", "qicego.com", "/", "")).toBe("https://qicego.com/");
    expect(redirectLocation("qice.chang2.ccwu.cc", "127.0.0.1", "/admin/enterprises", "?page=2")).toBe(
      "https://qicego.com/admin/enterprises?page=2",
    );
    for (const host of ["qicego.com", "ai.qicego.com", "ai.goqice.com", "127.0.0.1", "localhost", "AI.Qicego.com:443"]) {
      expect(redirectLocation(host, host, "/login", "?next=/app")).toBeNull();
    }
    expect(redirectLocation(undefined, "goqice.com", "/robots.txt", "")).toBe("https://qicego.com/robots.txt");
    expect(redirectLocation(undefined, "qicego.com", "/", "?ok=1")).toBeNull();
  });

  it("非本机登录 Cookie 一律 Secure，本机 HTTP 不加", () => {
    expect(cookieShouldBeSecure("qicego.com", "http://qicego.com/api/auth/login")).toBe(true);
    expect(cookieShouldBeSecure("goqice.com", "http://127.0.0.1:43123/api/auth/login")).toBe(true);
    expect(cookieShouldBeSecure("127.0.0.1:43123", "http://127.0.0.1:43123/api/auth/login")).toBe(false);
    expect(cookieShouldBeSecure("localhost", "https://localhost/api/auth/login")).toBe(true);
  });

  it("Google 验证文件只有那一行", () => {
    expect(readFileSync("public/googled5c7c4e254bd8e0c.html", "utf8")).toBe(GOOGLE_VERIFY_BODY);
    expect(GOOGLE_VERIFY_CONTENT_TYPE.startsWith("text/html")).toBe(true);
  });

  it("wrangler 让全部请求先进入 Worker，旧主机名才能在单页回退前跳转", () => {
    const raw = readFileSync("wrangler.jsonc", "utf8");
    expect(raw).toMatch(/"run_worker_first"\s*:\s*true/);
  });
});
