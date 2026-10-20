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
  canonicalFor,
  decorateHtml,
  documentHeaders,
  pageKind,
  robotsTxt,
  shouldNoindex,
  sitemapXml,
} from "../../src/worker/seo";

const shell = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>企策AI｜企业政策优惠与AI智能化升级服务平台</title>
    <meta name="description" content="企策AI提供企业政策优惠初步评估、专业申报协助与AI FDE智能化升级服务。" />
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
    expect(xml).toContain("<loc>https://goqice.com/</loc>");
    expect(xml).toContain("<loc>https://goqice.com/legal/privacy</loc>");
    expect(xml).toContain("<loc>https://goqice.com/legal/consent</loc>");
    expect(xml).toContain("<loc>https://goqice.com/legal/terms</loc>");
    expect(xml).not.toContain("/login");
    expect(xml).not.toContain("/register");
    expect(xml).not.toContain("/admin");
    expect(xml).not.toContain("/app");
    expect(xml).not.toContain("/api");
  });

  it("首页 HTML 带真实文案，canonical 固定为 goqice.com", () => {
    const html = decorateHtml(shell, "/");
    expect(canonicalFor("qice.chang2.ccwu.cc", "/")).toBe("https://goqice.com/");
    expect(canonicalFor("127.0.0.1:43123", "/")).toBe("https://goqice.com/");
    expect(html).toContain('rel="canonical" href="https://goqice.com/"');
    expect(html).toContain('name="google-site-verification" content="QUFnL2SkqIMTjBYg4f9jG-caFdtmHLNAp1ikX6XdWYI"');
    expect(html).toContain(`content="${KEYWORDS}"`);
    expect(html).toContain(`property="og:image" content="${OG_IMAGE}"`);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain("深圳市精灵探索科技有限公司");
    expect(html).toContain("让政策红利助力企业 AI升级");
    expect(html).toContain("从政策优惠到AI增效，一站式协同服务");
    expect(html).toContain("员工超过10人就一定能获得补贴吗？");
    expect(html).toContain("不能。10人以上只是本平台的业务初筛标准。");
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
      expect(html).toContain(`rel="canonical" href="https://goqice.com${path}"`);
      expect(html).not.toContain("员工超过10人就一定能获得补贴吗？");
      expect(html).not.toContain("og:image");
      expect(html).not.toContain("google-site-verification");
      expect(documentHeaders(path)["x-robots-tag"]).toBe("noindex, nofollow");
    }
    expect(canonicalFor("qice.chang2.ccwu.cc", "/admin")).toBe("https://goqice.com/admin");
  });

  it("已知法律页有短正文，未知法律页 noindex", () => {
    const privacy = decorateHtml(shell, "/legal/privacy");
    expect(privacy).toContain("<h1>隐私政策</h1>");
    expect(privacy).toContain("模板，待法务确认");
    expect(privacy).toContain('rel="canonical" href="https://goqice.com/legal/privacy"');
    expect(privacy).toContain('name="google-site-verification" content="QUFnL2SkqIMTjBYg4f9jG-caFdtmHLNAp1ikX6XdWYI"');
    expect(privacy).not.toContain("noindex");
    const unknown = decorateHtml(shell, "/legal/other");
    expect(shouldNoindex("/legal/other")).toBe(true);
    expect(unknown).toContain("noindex");
    expect(unknown).not.toContain("让政策红利");
  });

  it("Google 验证文件只有那一行", () => {
    expect(readFileSync("public/googled5c7c4e254bd8e0c.html", "utf8")).toBe(GOOGLE_VERIFY_BODY);
    expect(GOOGLE_VERIFY_CONTENT_TYPE.startsWith("text/html")).toBe(true);
  });

  it("wrangler 让文档路由先进入 Worker，静态资源仍不经过 Worker", () => {
    const raw = readFileSync("wrangler.jsonc", "utf8");
    for (const route of ["/", "/robots.txt", "/sitemap.xml", "/googled5c7c4e254bd8e0c.html", "/login", "/register", "/legal/*", "/admin", "/admin/*", "/app", "/app/*", "/api/*"]) {
      expect(raw).toContain(`"${route}"`);
    }
    expect(raw).not.toMatch(/"run_worker_first"\s*:\s*true/);
  });
});
