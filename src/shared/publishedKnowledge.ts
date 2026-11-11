import { checkKnowledgeCatalog, type KnowledgeArticle } from "./knowledge";

/**
 * 已发布文章。空数组表示还没有核对完成的原稿。
 * 不要把示例、占位或未核对来源写进这个数组。
 * 后续原稿用 KnowledgeArticle 结构追加：分类只限 subsidy、business、ip。
 * 补助文章必须有地区、有效期和申领窗口。正文用 heading、paragraph、list，不要写 HTML。
 */
const catalog = checkKnowledgeCatalog([] satisfies KnowledgeArticle[]);
if (!catalog.ok) throw new Error(catalog.error);

export const publishedKnowledge: KnowledgeArticle[] = catalog.articles;
