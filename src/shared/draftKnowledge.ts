import packageJson from "./knowledge-drafts.json";
import { checkKnowledgeCatalog, type KnowledgeArticle, type KnowledgeBlock, type KnowledgeCategorySlug } from "./knowledge";

type SourceRow = { title: string; url: string };
type Row = {
  slug: string;
  title: string;
  description: string;
  categorySlug: string;
  region: string;
  status: "当前依据核实" | "窗口需确认";
  statusNote: string;
  checkedAt: string;
  sourceUrls: SourceRow[];
  body: string;
};

const CATEGORY: Record<string, KnowledgeCategorySlug> = {
  "enterprise-subsidy": "subsidy",
  "business-registration": "business",
  "intellectual-property": "ip",
};

function blocksFromBody(body: string): KnowledgeBlock[] {
  return body.split(/\n\n+/).map((text) => text.trim()).filter(Boolean).map((text) => ({ type: "paragraph" as const, text }));
}

function sourceTitle(title: string): string {
  return title.replace(/，HTTP\s*\d+/g, "").replace(/，HTTPS/g, "");
}

function toArticle(raw: Row, relatedSlugs: string[]): KnowledgeArticle {
  const category = CATEGORY[raw.categorySlug];
  if (!category) throw new Error(`${raw.slug}：分类无法接入`);
  return {
    slug: raw.slug,
    category,
    title: raw.title,
    description: raw.description,
    reviewState: "listed",
    contentStatus: raw.status,
    checkedAt: raw.checkedAt,
    publishedAt: null,
    updatedAt: null,
    pendingReview: false,
    region: raw.region,
    validFrom: null,
    validUntil: null,
    validityNote: raw.statusNote,
    applicationWindow: null,
    sources: raw.sourceUrls.map((source) => ({ title: sourceTitle(source.title), url: source.url })),
    blocks: blocksFromBody(raw.body),
    relatedSlugs,
  };
}

const rawArticles = packageJson.articles as Row[];
const grouped = new Map<string, string[]>();
for (const article of rawArticles) {
  const list = grouped.get(article.categorySlug) || [];
  list.push(article.slug);
  grouped.set(article.categorySlug, list);
}
const checked = checkKnowledgeCatalog(rawArticles.map((article) => toArticle(
  article,
  (grouped.get(article.categorySlug) || []).filter((slug) => slug !== article.slug),
)));
if (!checked.ok) throw new Error(checked.error);

/** 复核后的公开文章。没有另编发布日期，核对日只作核对日。 */
export const publicKnowledge: KnowledgeArticle[] = checked.articles;
