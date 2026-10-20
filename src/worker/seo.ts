/** 规范域名。无论请求来自哪个 Host，canonical 都指向这里，不做跳转。 */
export const SITE = "https://goqice.com";

export const SITE_TITLE = "企策AI｜企业政策优惠与AI智能化升级服务平台";
export const SITE_DESCRIPTION = "企策AI提供企业政策优惠初步评估、专业申报协助与AI FDE智能化升级服务。";
export const KEYWORDS = "企策AI,企业政策,政策优惠,政策申报,AI FDE,深圳市精灵探索科技有限公司";
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

/** 忽略 Host。旧域名 qice.chang2.ccwu.cc 与本地地址都规范到 goqice.com。 */
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
  const urls = SITEMAP_PATHS.map((path) => `  <url><loc>${canonicalFor("", path)}</loc></url>`).join("\n");
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
        name: "企策AI",
        legalName: "深圳市精灵探索科技有限公司",
        url: `${SITE}/`,
        logo: `${SITE}/brand/logo-80.png`,
      },
      {
        "@type": "WebSite",
        name: "企策AI",
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
  return [
    "<h1>让政策红利助力企业 AI升级</h1>",
    "<p>企业政策优惠 × AI智能化升级</p>",
    `<p>${esc("智能筛查企业适用政策，专业团队协助申报，结合AI数字员工与FDE落地服务，让企业降低经营成本、提升运营效率。")}</p>`,
    "<p>优先面向10人以上企业 · 政策优惠及兑现以实际审核为准</p>",
    "<h2>从政策优惠到AI增效，一站式协同服务</h2>",
    `<p>${esc("先识别企业可能享受的政策优惠，再按经营需求规划AI升级，帮助企业更从容地推进数字化转型。")}</p>`,
    "<h3>企业政策智能初筛</h3>",
    `<p>${esc("根据企业经营、税务及社保资料，系统智能匹配可能适用的政策，顾问复核后形成初步方案。")}</p>`,
    "<h3>政策申报协助</h3>",
    `<p>${esc("提供申报条件核验、资料准备、申报协助与进度跟踪服务，按合同约定明确服务范围及责任。")}</p>`,
    "<h3>AI FDE智能化升级</h3>",
    `<p>${esc("从实际岗位与业务流程出发，落地AI数字员工、销售获客、数据处理与办公自动化。")}</p>`,
    "<h2>不仅帮助企业发现政策机会，更关注长期经营效率</h2>",
    `<p>${esc("企业AI升级往往需要新增预算。企策AI希望帮助企业先了解可依法享受的政策优惠，再结合实际经济收益合理规划AI服务投入。")}</p>`,
    "<h2>从发现政策到落地升级</h2>",
    "<p>发现可享受的政策：系统匹配税收、社保和就业支持，顾问复核后再给企业看。</p>",
    "<p>协助申报落地：确认服务范围后，协助准备材料并跟踪办理。</p>",
    "<p>按需规划 AI 升级：政策服务和 AI FDE 分开选择，企业按经营需要决定。</p>",
    "<h2>五步开启企业政策评估</h2>",
    `<p>${esc("资料要求清晰，过程可跟进，政策服务与AI升级可独立选择。")}</p>`,
    "<p>提交申请：注册账号，填写企业名称、联系人、手机号。</p>",
    "<p>提交资料：经授权后提交近一年增值税申报表及最新社保清单。</p>",
    "<p>智能测算：系统智能测算，顾问复核，出具初步方案。</p>",
    "<p>签约申报：确认服务范围，协助办理申报。</p>",
    "<p>AI升级：根据企业需要，另行选择AI FDE实施服务。</p>",
    "<h2>初步评估，仅需准备两类资料</h2>",
    "<p>注册后直接上传资料，上传即表示同意数据授权书和隐私政策。</p>",
    "<h3>最近一年的增值税申报表</h3>",
    "<p>用于初步了解企业税务情况；正式申报可能需要补充其他材料。</p>",
    "<h3>企业最新社保缴费清单</h3>",
    "<p>用于初步了解参保与缴费情况。</p>",
    "<h2>企业常见问题</h2>",
    "<h3>员工超过10人就一定能获得补贴吗？</h3>",
    `<p>${esc("不能。10人以上只是本平台的业务初筛标准。实际资格取决于具体政策、地区、行业、企业和人员条件。")}</p>`,
    "<h3>政策优惠一定是每个月发放现金吗？</h3>",
    `<p>${esc("不一定。不同政策可能是一次性补助、阶段性补贴、税费减免或其他形式，兑现时间与方式以政策和主管部门审核为准。")}</p>`,
    "<h3>初步评估需要哪些资料？</h3>",
    `<p>${esc("通常先准备最近一年的增值税申报表和企业最新社保清单。上传即表示同意数据授权书和隐私政策。")}</p>`,
    "<h3>是否必须购买AI服务才能办理政策申报？</h3>",
    `<p>${esc("不需要。政策服务与AI FDE实施分别约定，企业可根据自身经营需要自主选择。")}</p>`,
    "<h2>发现政策机会，开启AI增效</h2>",
    "<p>注册并上传两份资料，获取初步方案。</p>",
    "<p>运营主体：深圳市精灵探索科技有限公司</p>",
  ].join("");
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

export function documentHeaders(path: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
  };
  if (shouldNoindex(path)) headers["x-robots-tag"] = "noindex, nofollow";
  return headers;
}
