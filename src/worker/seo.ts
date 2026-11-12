import { COMPANY_NAME, homeArticleHtml, KEYWORDS, SITE_DESCRIPTION, SITE_TITLE } from "../shared/growthHome";
import { knowledgeJsonLd, renderKnowledgeHtml, knowledgeSitemapPaths, type KnowledgeModel } from "../shared/knowledge";
import { visibleKnowledge } from "../shared/visibleKnowledge";
import { APK_DOWNLOAD_URL } from "./apk";

export { KEYWORDS, SITE_DESCRIPTION, SITE_TITLE };

/** 规范域名。公开页的 canonical、Open Graph 和 sitemap 都指向这里。 */
export const SITE = "https://qicego.com";
export const PRIMARY_HOST = "qicego.com";

/** 这些 Host 整站 301 到规范域名。ai.qicego.com 和 ai.goqice.com 不在此列。 */
const REDIRECT_HOSTS = new Set(["www.qicego.com", "goqice.com", "www.goqice.com", "qice.chang2.ccwu.cc"]);
export const OG_IMAGE = `${SITE}/og.png`;

export const ROBOTS_CONTENT_TYPE = "text/plain; charset=utf-8";
export const SITEMAP_CONTENT_TYPE = "application/xml; charset=utf-8";
export const GOOGLE_SITE_VERIFICATION = "QUFnL2SkqIMTjBYg4f9jG-caFdtmHLNAp1ikX6XdWYI";
export const GOOGLE_VERIFY_PATH = "/googled5c7c4e254bd8e0c.html";
export const GOOGLE_VERIFY_BODY = "google-site-verification: googled5c7c4e254bd8e0c.html\n";
export const GOOGLE_VERIFY_CONTENT_TYPE = "text/html; charset=utf-8";

const LEGAL_TITLES: Record<string, string> = {
  privacy: "隐私政策",
  consent: "数据授权书",
  terms: "用户协议",
};

/** 站点地图只收录这些公开地址。登录、注册、后台、企业端和接口不收录。 */
export const SITEMAP_PATHS = ["/", "/legal/privacy", "/legal/consent", "/legal/terms"] as const;

export function normalizePath(path: string): string {
  const bare = path.split("?")[0].split("#")[0];
  if (bare === "") return "/";
  return bare.replace(/\/+$/, "") || "/";
}

/** 去掉端口和末尾点，不区分大小写。IPv6 只保留方括号内的地址。 */
export function requestHost(hostHeader: string | null | undefined, fallbackHost = ""): string {
  const raw = (hostHeader || fallbackHost || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end >= 0 ? raw.slice(0, end + 1) : raw;
  }
  return raw.replace(/:\d+$/, "").replace(/\.$/, "");
}

/**
 * 旧主机名 301 到 https://qicego.com，保留原始路径和查询。
 * 规范域名、本机，以及 ai.qicego.com / ai.goqice.com 不跳转。
 */
export function redirectLocation(
  hostHeader: string | null | undefined,
  fallbackHost: string,
  pathname: string,
  search: string,
): string | null {
  const host = requestHost(hostHeader, fallbackHost);
  if (!REDIRECT_HOSTS.has(host)) return null;
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const query = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${SITE}${path}${query}`;
}

/** 非本机的登录 Cookie 一律加 Secure。本机仍看请求协议，方便本地 HTTP 验收。 */
export function cookieShouldBeSecure(hostHeader: string | null | undefined, requestUrl: string): boolean {
  const url = new URL(requestUrl);
  const host = requestHost(hostHeader, url.hostname);
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") return url.protocol === "https:";
  return true;
}

/** 公开页链接一律用规范域名，不跟随请求 Host。 */
export function canonicalFor(_host: string, path: string): string {
  const normalized = normalizePath(path);
  return normalized === "/" ? `${SITE}/` : `${SITE}${normalized}`;
}

export function robotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /app",
    "Disallow: /login",
    "Disallow: /register",
    "Disallow: /api/",
    "",
    `Sitemap: ${SITE}/sitemap.xml`,
    "",
  ].join("\n");
}

export function sitemapXml(): string {
  const paths = [...SITEMAP_PATHS, ...knowledgeSitemapPaths(visibleKnowledge)];
  const urls = paths.map((path) => `  <url><loc>${canonicalFor("", path)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export type PageKind = "home" | "legal" | "private";

export function legalSlug(path: string): string | null {
  const match = normalizePath(path).match(/^\/legal\/([^/]+)$/);
  if (!match || !LEGAL_TITLES[match[1]]) return null;
  return match[1];
}

export function pageKind(path: string): PageKind | null {
  const normalized = normalizePath(path);
  if (normalized === "/") return "home";
  if (normalized === "/login" || normalized === "/register") return "private";
  if (normalized === "/admin" || normalized.startsWith("/admin/")) return "private";
  if (normalized === "/app" || normalized.startsWith("/app/")) return "private";
  if (normalized === "/legal" || normalized.startsWith("/legal/")) return "legal";
  return null;
}

export function shouldNoindex(path: string): boolean {
  const kind = pageKind(path);
  if (kind === "private") return true;
  if (kind === "legal" && !legalSlug(path)) return true;
  return false;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonLd(): string {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "企策AI增长",
        alternateName: ["企策AI", "QICE AI GROWTH"],
        legalName: COMPANY_NAME,
        url: `${SITE}/`,
        logo: `${SITE}/brand/logo-80.png`,
      },
      {
        "@type": "WebSite",
        name: "企策AI增长",
        alternateName: "QICE AI GROWTH",
        url: `${SITE}/`,
        description: SITE_DESCRIPTION,
      },
    ],
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function headTags(path: string): string {
  const canonical = canonicalFor("", path);
  const slug = legalSlug(path);
  const indexable = pageKind(path) === "home" || Boolean(slug);
  if (!indexable) {
    return [`<link rel="canonical" href="${esc(canonical)}" />`, `<meta name="robots" content="noindex, nofollow" />`].join("\n");
  }
  const title = slug ? `${LEGAL_TITLES[slug]}｜企策AI` : SITE_TITLE;
  const description = slug
    ? `企策AI${LEGAL_TITLES[slug]}。模板，待法务确认。运营主体：深圳市精灵探索科技有限公司。`
    : SITE_DESCRIPTION;
  return [
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta name="google-site-verification" content="${GOOGLE_SITE_VERIFICATION}" />`,
    `<meta name="keywords" content="${esc(KEYWORDS)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="zh_CN" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    jsonLd(),
  ].join("\n");
}

function homeArticle(): string {
  return homeArticleHtml(APK_DOWNLOAD_URL);
}

function legalArticle(slug: string): string {
  const title = LEGAL_TITLES[slug];
  return [
    `<h1>${esc(title)}</h1>`,
    `<p>${esc(`本页为企策AI${title}。模板，待法务确认。`)}</p>`,
    "<p>运营主体：深圳市精灵探索科技有限公司</p>",
  ].join("");
}

function staticArticle(path: string): string {
  const kind = pageKind(path);
  if (kind === "home") return homeArticle();
  const slug = legalSlug(path);
  if (kind === "legal" && slug) return legalArticle(slug);
  return "";
}

/**
 * 在构建好的 index.html 上补 head，并把公开页正文放进 #root。
 * 紧随其后的脚本会在 React 执行前摘掉这段正文，页面视觉保持不变。
 * 不执行脚本的爬虫（如百度）仍能读到正文。
 */
export function decorateHtml(indexHtml: string, path: string): string {
  const normalized = normalizePath(path);
  if (!pageKind(normalized)) return indexHtml;
  let html = indexHtml;
  if (!/rel="canonical"/i.test(html)) {
    html = html.replace(/<\/head>/i, `${headTags(normalized)}\n</head>`);
  }
  const article = staticArticle(normalized);
  if (!article) return html;
  const block = `<div id="root"><article id="qice-seo">${article}</article></div><script>var qiceSeo=document.getElementById("qice-seo");if(qiceSeo)qiceSeo.remove();</script>`;
  if (/<div id="root">\s*<\/div>/.test(html)) {
    return html.replace(/<div id="root">\s*<\/div>/, block);
  }
  return html.replace(/<\/body>/i, `<noscript><article id="qice-seo">${article}</article></noscript></body>`);
}

export function documentHeaders(path: string, extra?: { noindex?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
  };
  if (extra?.noindex || shouldNoindex(path)) headers["x-robots-tag"] = "noindex, nofollow";
  return headers;
}

/** 知识库页替换标题和摘要，正文只使用已转义的结构化 HTML。 */
export function decorateKnowledgeHtml(indexHtml: string, model: KnowledgeModel): string {
  const canonical = canonicalFor("", model.canonicalPath);
  const title = model.title;
  const description = model.description;
  let html = indexHtml.replace(/<title>[^<]*<\/title>/i, `<title>${esc(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"/i, `<meta name="description" content="${esc(description)}"`);
  const tags = model.indexable
    ? [
        `<link rel="canonical" href="${esc(canonical)}" />`,
        `<meta name="google-site-verification" content="${GOOGLE_SITE_VERIFICATION}" />`,
        `<meta property="og:title" content="${esc(title)}" />`,
        `<meta property="og:description" content="${esc(description)}" />`,
        `<meta property="og:image" content="${OG_IMAGE}" />`,
        `<meta property="og:url" content="${esc(canonical)}" />`,
        `<meta property="og:type" content="${model.kind === "article" ? "article" : "website"}" />`,
        `<meta property="og:locale" content="zh_CN" />`,
        knowledgeLd(model),
      ]
    : [`<link rel="canonical" href="${esc(canonical)}" />`, `<meta name="robots" content="noindex, nofollow" />`];
  html = html.replace(/<\/head>/i, `${tags.filter(Boolean).join("\n")}\n</head>`);
  const article = renderKnowledgeHtml(model);
  const block = `<div id="root"><article id="qice-seo">${article}</article></div><script>var qiceSeo=document.getElementById("qice-seo");if(qiceSeo)qiceSeo.remove();</script>`;
  if (/<div id="root">\s*<\/div>/.test(html)) return html.replace(/<div id="root">\s*<\/div>/, block);
  return html.replace(/<\/body>/i, `<noscript><article id="qice-seo">${article}</article></noscript></body>`);
}

function knowledgeLd(model: KnowledgeModel): string {
  const data = knowledgeJsonLd(model, SITE);
  if (!data) return "";
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}
