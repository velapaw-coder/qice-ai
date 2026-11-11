/**
 * 企业服务知识库。公开文章和客户政策评估分开。
 * 已发布目录见 publishedKnowledge。测试传入合成目录，不写入发布列表。
 * 正文只接受结构化文本，渲染时转义，不执行 HTML。
 */

export const KNOWLEDGE_HUB_PATH = "/knowledge";
export const KNOWLEDGE_NAME = "企业服务知识库";

export const KNOWLEDGE_CATEGORIES = [
  {
    slug: "subsidy",
    label: "企业补助",
    summary: "阅读补助和税收扣减时，先分清适用地区、有效期和申领窗口。",
  },
  {
    slug: "business",
    label: "工商服务",
    summary: "登记、变更、年报和经营异常名录的办事常识。具体入口以登记地登记机关为准。",
  },
  {
    slug: "ip",
    label: "知识产权",
    summary: "商标、专利和软件著作权的申请与维护常识。可以自行办理，也可以委托依法设立的代理机构。",
  },
] as const;

export type KnowledgeCategorySlug = (typeof KNOWLEDGE_CATEGORIES)[number]["slug"];

export type KnowledgeBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export type KnowledgeSource = {
  name?: string;
  title: string;
  identifier?: string;
  url?: string;
};

export type KnowledgeArticle = {
  slug: string;
  category: KnowledgeCategorySlug;
  title: string;
  description: string;
  reviewState: "draft" | "listed" | "published";
  /** 文章自己的核对状态。窗口需确认不能显示成当前依据已核实。 */
  contentStatus: "当前依据核实" | "窗口需确认" | null;
  /** 编辑核对日。不是法律法规的官方发布日期，也不当作文章发布日期。 */
  checkedAt: string;
  /** 没有单独的发布日期时保持为空，不用核对日顶替。 */
  publishedAt: string | null;
  updatedAt: string | null;
  pendingReview: boolean;
  region: string | null;
  validFrom: string | null;
  validUntil: string | null;
  validityNote: string | null;
  applicationWindow: string | null;
  sources: KnowledgeSource[];
  blocks: KnowledgeBlock[];
  relatedSlugs: string[];
};

export type KnowledgeCrumb = { name: string; path: string };

export type KnowledgeModel = {
  status: 200 | 404;
  indexable: boolean;
  kind: "hub" | "category" | "article" | "missing";
  title: string;
  description: string;
  canonicalPath: string;
  crumbs: KnowledgeCrumb[];
  query: string;
  categories: { slug: KnowledgeCategorySlug; label: string; summary: string; count: number; path: string }[];
  articles: KnowledgeArticle[];
  article: KnowledgeArticle | null;
  related: KnowledgeArticle[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOUNDARY = "本文仅作知识介绍，具体条件、窗口和审核结果以主管机关现行规定为准。如需结合企业情况讨论下一步，可预约增长交流。交流用于了解情况，不承诺代办，也不保证审批结果。";

export function knowledgeCategory(slug: string) {
  return KNOWLEDGE_CATEGORIES.find((item) => item.slug === slug) || null;
}

export function knowledgePath(category: KnowledgeCategorySlug, slug = ""): string {
  return slug ? `${KNOWLEDGE_HUB_PATH}/${category}/${slug}` : `${KNOWLEDGE_HUB_PATH}/${category}`;
}

export function knowledgeBoundary(): string {
  return BOUNDARY;
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasMarkup(value: string): boolean {
  return /[<>]/.test(value);
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function sourceError(source: KnowledgeSource): string | null {
  if (!source.title) return "来源要写文件名称";
  if ([source.name || "", source.title, source.identifier || ""].some(hasMarkup)) return "来源不能包含 HTML";
  if (!source.url) return null;
  if (!/^https?:\/\/[a-z0-9.-]+(?:\/[^\s<>"]*)?$/i.test(source.url)) return "来源链接不正确";
  return null;
}

function isListed(article: KnowledgeArticle): boolean {
  return article.reviewState === "listed" || article.reviewState === "published";
}

export function knowledgeArticleError(article: KnowledgeArticle): string | null {
  if (!SLUG.test(article.slug) || article.slug.length < 3 || article.slug.length > 80) return "文章地址标识不正确";
  if (!knowledgeCategory(article.category)) return "文章分类不正确";
  if (article.title.length < 8 || article.title.length > 80 || hasMarkup(article.title)) return "文章标题需要 8 到 80 字，且不能包含 HTML";
  if (article.description.length < 20 || article.description.length > 160 || hasMarkup(article.description)) return "摘要需要 20 到 160 字，且不能包含 HTML";
  if (!validDate(article.checkedAt)) return "核对日期不正确";
  if (article.reviewState === "published") {
    if (!article.publishedAt || !article.updatedAt || !validDate(article.publishedAt) || !validDate(article.updatedAt) || article.updatedAt < article.publishedAt) {
      return "正式发布日期或更新日期不正确";
    }
  } else if (article.reviewState === "listed" || article.reviewState === "draft") {
    if (article.publishedAt || article.updatedAt) return "没有单独发布日期时不能填写发布日期";
  } else {
    return "稿件状态不正确";
  }
  if (article.reviewState === "listed" && article.contentStatus !== "当前依据核实" && article.contentStatus !== "窗口需确认") {
    return "上线文章要标明当前依据核实或窗口需确认";
  }
  if (!article.sources.length) return "文章至少要有一条来源";
  for (const source of article.sources) {
    const problem = sourceError(source);
    if (problem) return problem;
  }
  if (!article.blocks.length) return "文章没有正文";
  let text = "";
  for (const block of article.blocks) {
    if (block.type === "list") {
      if (!block.items.length || block.items.some((item) => !clean(item) || hasMarkup(item))) return "列表内容不能为空，也不能包含 HTML";
      text += block.items.join("");
    } else if (!clean(block.text) || hasMarkup(block.text)) {
      return "正文不能为空，也不能包含 HTML";
    } else {
      text += block.text;
    }
  }
  if ([...text].length < 80) return "正文过短，不能作为已发布文章";
  if (article.category === "subsidy") {
    if (!article.region || hasMarkup(article.region)) return "补助文章要写明适用地区";
    if (!article.validityNote || hasMarkup(article.validityNote)) return "补助文章要写明有效期和申领窗口";
    if (article.applicationWindow && hasMarkup(article.applicationWindow)) return "申领窗口不能包含 HTML";
    if (article.validFrom && !validDate(article.validFrom)) return "补助开始日期不正确";
    if (article.validUntil && !validDate(article.validUntil)) return "补助结束日期不正确";
    if (article.validFrom && article.validUntil && article.validUntil < article.validFrom) return "补助结束日期早于开始日期";
  }
  for (const slug of article.relatedSlugs) {
    if (!SLUG.test(slug)) return "相关文章标识不正确";
  }
  return null;
}

export function checkKnowledgeCatalog(articles: KnowledgeArticle[]): { ok: true; articles: KnowledgeArticle[] } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const article of articles) {
    const problem = knowledgeArticleError(article);
    if (problem) return { ok: false, error: `${article.slug || "未命名"}：${problem}` };
    if (seen.has(article.slug)) return { ok: false, error: `${article.slug}：地址标识重复` };
    seen.add(article.slug);
  }
  for (const article of articles) {
    for (const slug of article.relatedSlugs) {
      const related = articles.find((item) => item.slug === slug);
      if (!related) return { ok: false, error: `${article.slug}：相关文章 ${slug} 尚未发布` };
    }
  }
  return { ok: true, articles: sortArticles(articles) };
}

function sortArticles(articles: KnowledgeArticle[]): KnowledgeArticle[] {
  const stamp = (article: KnowledgeArticle) => article.updatedAt || article.checkedAt;
  return [...articles].sort((a, b) => (stamp(a) === stamp(b) ? a.slug.localeCompare(b.slug) : stamp(b).localeCompare(stamp(a))));
}

function normalizePath(path: string): string {
  const bare = path.split("?")[0].split("#")[0];
  if (!bare) return "/";
  return bare.replace(/\/+$/, "") || "/";
}

function readQuery(search: string): string {
  const value = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("q") || "";
  return clean(value).replace(/[<>]/g, "").slice(0, 40);
}

export function searchKnowledge(articles: KnowledgeArticle[], query: string): KnowledgeArticle[] {
  const needle = clean(query).toLowerCase();
  if (!needle) return sortArticles(articles);
  return sortArticles(articles).filter((article) => articleText(article).toLowerCase().includes(needle));
}

function articleText(article: KnowledgeArticle): string {
  const blocks = article.blocks.flatMap((block) => (block.type === "list" ? block.items : [block.text]));
  return [article.title, article.description, article.region || "", article.validityNote || "", article.applicationWindow || "", ...blocks].join("\n");
}

export function resolveKnowledge(path: string, search = "", articles: KnowledgeArticle[] = []): KnowledgeModel | null {
  const normalized = normalizePath(path);
  if (normalized !== KNOWLEDGE_HUB_PATH && !normalized.startsWith(`${KNOWLEDGE_HUB_PATH}/`)) return null;
  const query = readQuery(search);
  const categories = KNOWLEDGE_CATEGORIES.map((item) => ({
    ...item,
    count: articles.filter((article) => article.category === item.slug).length,
    path: knowledgePath(item.slug),
  }));
  const rest = normalized.slice(KNOWLEDGE_HUB_PATH.length).split("/").filter(Boolean);
  const base = {
    query,
    categories,
    articles: [] as KnowledgeArticle[],
    article: null as KnowledgeArticle | null,
    related: [] as KnowledgeArticle[],
  };
  if (rest.length === 0) {
    const listed = searchKnowledge(articles, query);
    const indexable = !query && articles.some(isListed);
    return {
      ...base,
      status: 200,
      indexable,
      kind: "hub",
      title: `${KNOWLEDGE_NAME}｜企策AI增长`,
      description: indexable
        ? "企业补助、工商服务和知识产权的办事常识。每篇标明核对状态。核对日期不是政策发布日期。"
        : "企策AI增长的企业服务知识库。当前没有可公开的文章。",
      canonicalPath: KNOWLEDGE_HUB_PATH,
      crumbs: [{ name: "首页", path: "/" }, { name: KNOWLEDGE_NAME, path: KNOWLEDGE_HUB_PATH }],
      articles: listed,
    };
  }
  if (rest.length > 2) return missing(categories, query);
  const category = knowledgeCategory(rest[0]);
  if (!category) return missing(categories, query);
  if (rest.length === 1) {
    const listed = searchKnowledge(articles.filter((article) => article.category === category.slug), query);
    return {
      ...base,
      status: 200,
      indexable: !query && listed.some(isListed),
      kind: "category",
      title: `${category.label}｜${KNOWLEDGE_NAME}｜企策AI增长`,
      description: category.summary,
      canonicalPath: knowledgePath(category.slug),
      crumbs: [
        { name: "首页", path: "/" },
        { name: KNOWLEDGE_NAME, path: KNOWLEDGE_HUB_PATH },
        { name: category.label, path: knowledgePath(category.slug) },
      ],
      articles: listed,
    };
  }
  const article = articles.find((item) => item.category === category.slug && item.slug === rest[1]) || null;
  if (!article) return missing(categories, query);
  return {
    ...base,
    status: 200,
    indexable: !query && isListed(article),
    kind: "article",
    title: `${article.title}｜企策AI增长`,
    description: article.description,
    canonicalPath: knowledgePath(article.category, article.slug),
    crumbs: [
      { name: "首页", path: "/" },
      { name: KNOWLEDGE_NAME, path: KNOWLEDGE_HUB_PATH },
      { name: category.label, path: knowledgePath(category.slug) },
      { name: article.title, path: knowledgePath(article.category, article.slug) },
    ],
    article,
    related: article.relatedSlugs
      .map((slug) => articles.find((item) => item.slug === slug))
      .filter((item): item is KnowledgeArticle => Boolean(item)),
  };
}

function missing(categories: KnowledgeModel["categories"], query: string): KnowledgeModel {
  return {
    status: 404,
    indexable: false,
    kind: "missing",
    title: `没有这篇文章｜${KNOWLEDGE_NAME}`,
    description: "这个地址没有已发布的知识库文章。",
    canonicalPath: KNOWLEDGE_HUB_PATH,
    crumbs: [{ name: "首页", path: "/" }, { name: KNOWLEDGE_NAME, path: KNOWLEDGE_HUB_PATH }],
    query,
    categories,
    articles: [],
    article: null,
    related: [],
  };
}

export function knowledgeSitemapPaths(articles: KnowledgeArticle[]): string[] {
  const published = articles.filter(isListed);
  if (!published.length) return [];
  const paths = [KNOWLEDGE_HUB_PATH];
  for (const category of KNOWLEDGE_CATEGORIES) {
    if (published.some((article) => article.category === category.slug)) paths.push(knowledgePath(category.slug));
  }
  for (const article of sortArticles(published)) paths.push(knowledgePath(article.category, article.slug));
  return paths;
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderKnowledgeHtml(model: KnowledgeModel): string {
  const crumbs = `<nav>${model.crumbs.map((crumb) => `<a href="${esc(crumb.path)}">${esc(crumb.name)}</a>`).join(" / ")}</nav>`;
  if (model.kind === "missing") {
    return `${crumbs}<h1>没有这篇文章</h1><p>这个地址没有已发布内容。</p><p><a href="/#contact">预约增长交流</a></p>`;
  }
  if (model.kind === "article" && model.article) {
    const article = model.article;
    const facts = [
      `<p>核对状态：${esc(article.contentStatus || (article.reviewState === "published" ? "已有发布日期" : "未公开"))}</p>`,
      `<p>文稿核对日：${esc(article.checkedAt)}（北京时间）。这是编辑核对日期，不是政策发布日期。</p>`,
      article.pendingReview ? "<p>文中期限或新规仍在对照官方文本，本文不是最终结论。</p>" : "",
      article.region ? `<p>适用地区：${esc(article.region)}</p>` : "",
      article.validityNote ? `<p>阅读提示：${esc(article.validityNote)}</p>` : "",
      article.applicationWindow ? `<p>申领窗口：${esc(article.applicationWindow)}</p>` : "",
      validityLabel(article) && article.validFrom ? `<p>有效期：${esc(validityLabel(article))}</p>` : "",
    ].join("");
    const body = article.blocks.map((block) => {
      if (block.type === "heading") return `<h2>${esc(block.text)}</h2>`;
      if (block.type === "list") return `<ul>${block.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
      return `<p>${esc(block.text)}</p>`;
    }).join("");
    const sources = article.sources.map((source) => {
      const label = source.name && source.name !== source.title ? `${source.name}：${source.title}` : source.title;
      const text = `${label}${source.identifier ? `（${source.identifier}）` : ""}`;
      return source.url ? `<li><a href="${esc(source.url)}">${esc(text)}</a></li>` : `<li>${esc(text)}</li>`;
    }).join("");
    const related = model.related.map((item) => `<li><a href="${esc(knowledgePath(item.category, item.slug))}">${esc(item.title)}</a></li>`).join("");
    return [
      crumbs,
      `<h1>${esc(article.title)}</h1>`,
      facts,
      body,
      `<h2>来源</h2><ul>${sources}</ul>`,
      related ? `<h2>相关文章</h2><ul>${related}</ul>` : "",
      `<p>${esc(BOUNDARY)}</p>`,
      `<p><a href="/#contact">预约增长交流</a></p>`,
    ].join("");
  }
  const heading = model.kind === "category" ? model.crumbs.at(-1)?.name || KNOWLEDGE_NAME : KNOWLEDGE_NAME;
  const list = model.articles.length
    ? `<ul>${model.articles.map((article) => `<li><a href="${esc(knowledgePath(article.category, article.slug))}">${esc(article.title)}</a>${article.contentStatus ? `（${esc(article.contentStatus)}）` : ""}</li>`).join("")}</ul>`
    : `<p>${esc(knowledgeEmptyLabel(model))}</p>`;
  const cats = model.categories.map((item) => `<li><a href="${esc(item.path)}">${esc(item.label)}</a></li>`).join("");
  return `${crumbs}<h1>${esc(heading)}</h1><p>${esc(model.description)}</p><ul>${cats}</ul>${list}<p>${esc(BOUNDARY)}</p><p><a href="/#contact">预约增长交流</a></p>`;
}

export function knowledgeEmptyLabel(model: Pick<KnowledgeModel, "kind" | "query">): string {
  if (model.query) return "没有符合搜索的文章。";
  if (model.kind === "category") return "这一类还没有已发布文章。";
  return "还没有已发布文章。";
}

function validityLabel(article: KnowledgeArticle): string {
  const span = article.validFrom || article.validUntil ? `${article.validFrom || "未注明开始"}至${article.validUntil || "未注明结束"}` : "";
  return [span, article.validityNote || ""].filter(Boolean).join("。");
}

export function knowledgeJsonLd(model: KnowledgeModel, site: string): Record<string, unknown> | null {
  if (!model.indexable || model.status !== 200) return null;
  const crumbs = {
    "@type": "BreadcrumbList",
    itemListElement: model.crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.path === "/" ? `${site}/` : `${site}${crumb.path}`,
    })),
  };
  if (model.kind === "article" && model.article) {
    const article = model.article;
    return {
      "@context": "https://schema.org",
      "@graph": [
        crumbs,
        {
          "@type": "Article",
          headline: article.title,
          description: article.description,
          ...(article.publishedAt && article.updatedAt
            ? { datePublished: article.publishedAt, dateModified: article.updatedAt }
            : {}),
          mainEntityOfPage: `${site}${model.canonicalPath}`,
          author: { "@type": "Organization", name: "企策AI增长", url: `${site}/` },
          publisher: { "@type": "Organization", name: "企策AI增长", url: `${site}/` },
        },
      ],
    };
  }
  return {
    "@context": "https://schema.org",
    "@graph": [
      crumbs,
      {
        "@type": "CollectionPage",
        name: model.crumbs.at(-1)?.name || KNOWLEDGE_NAME,
        description: model.description,
        url: `${site}${model.canonicalPath}`,
      },
    ],
  };
}
