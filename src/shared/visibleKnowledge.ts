import { publicKnowledge } from "./draftKnowledge";
import { publishedKnowledge } from "./publishedKnowledge";

/** 公开文章没有单独的发布日期。这里直接使用复核后的 9 篇。 */
export const visibleKnowledge = publishedKnowledge.length ? publishedKnowledge : publicKnowledge;
