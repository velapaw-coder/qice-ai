import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkKnowledgeCatalog,
  knowledgeSitemapPaths,
  renderKnowledgeHtml,
  resolveKnowledge,
  type KnowledgeArticle,
} from "../../src/shared/knowledge";
import { publicKnowledge } from "../../src/shared/draftKnowledge";
import { publishedKnowledge } from "../../src/shared/publishedKnowledge";
import { decorateKnowledgeHtml } from "../../src/worker/seo";

const shell = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>企策AI增长｜AI驱动企业价值重构与长期增长陪跑平台</title>
    <meta name="description" content="首页摘要" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

function article(overrides: Partial<KnowledgeArticle> = {}): KnowledgeArticle {
  return {
    slug: "synthetic-subsidy",
    category: "subsidy",
    title: "合成补助常识说明稿",
    description: "这是单元测试用的合成摘要，用来检查列表、搜索和结构化数据，不是已发布文章。",
    reviewState: "published",
    contentStatus: null,
    checkedAt: "2026-11-11",
    pendingReview: false,
    publishedAt: "2026-01-01",
    updatedAt: "2026-02-01",
    region: "合成市",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    validityNote: "只在测试数据里有效",
    applicationWindow: "测试窗口不对外办理",
    sources: [{ name: "合成机关", title: "合成文件", identifier: "合成〔2026〕1号" }],
    blocks: [
      { type: "paragraph", text: "这段合成正文只存在于单元测试，用来确认转义、列表、搜索和字段展示。它不会进入已发布目录，也不能当成真实补助、工商或知识产权文章，更不能拿去对外发布。" },
      { type: "list", items: ["先看地区", "再看有效期"] },
    ],
    relatedSlugs: [],
    ...overrides,
  };
}

describe("企业服务知识库", () => {
  it("发布目录为空，不把测试稿当正式文章", () => {
    expect(publishedKnowledge).toEqual([]);
    expect(knowledgeSitemapPaths(publishedKnowledge)).toEqual([]);
    const hub = resolveKnowledge("/knowledge", "", publishedKnowledge);
    expect(hub?.status).toBe(200);
    expect(hub?.indexable).toBe(false);
    expect(hub?.articles).toEqual([]);
  });

  it("校验地区、有效期、窗口、来源和 HTML", () => {
    expect(checkKnowledgeCatalog([article({ region: "" })]).ok).toBe(false);
    expect(checkKnowledgeCatalog([article({ applicationWindow: null })]).ok).toBe(true);
    expect(checkKnowledgeCatalog([article({ validityNote: null })]).ok).toBe(false);
    expect(checkKnowledgeCatalog([article({ sources: [] })]).ok).toBe(false);
    expect(checkKnowledgeCatalog([article({ blocks: [{ type: "paragraph", text: "<script>alert(1)</script>正文不够也不该发布" }] })]).ok).toBe(false);
    const business = article({
      slug: "synthetic-business",
      category: "business",
      title: "合成工商常识说明稿",
      region: null,
      validFrom: null,
      validUntil: null,
      validityNote: null,
      applicationWindow: null,
    });
    expect(checkKnowledgeCatalog([business]).ok).toBe(true);
  });

  it("列表、分类、搜索、详情和 404 使用同一目录", () => {
    const ip = article({
      slug: "synthetic-ip",
      category: "ip",
      title: "合成知识产权常识说明稿",
      region: null,
      validFrom: null,
      validUntil: null,
      validityNote: null,
      applicationWindow: null,
      relatedSlugs: ["synthetic-subsidy"],
    });
    const rows = [article(), ip];
    expect(checkKnowledgeCatalog(rows).ok).toBe(true);
    const hub = resolveKnowledge("/knowledge", "", rows);
    expect(hub?.articles.map((item) => item.slug)).toEqual(["synthetic-ip", "synthetic-subsidy"]);
    const subsidy = resolveKnowledge("/knowledge/subsidy", "", rows);
    expect(subsidy?.articles).toHaveLength(1);
    expect(subsidy?.indexable).toBe(true);
    const business = resolveKnowledge("/knowledge/business", "", rows);
    expect(business?.indexable).toBe(false);
    expect(business?.articles).toHaveLength(0);
    const found = resolveKnowledge("/knowledge", "?q=知识产权常识", rows);
    expect(found?.articles.map((item) => item.slug)).toEqual(["synthetic-ip"]);
    expect(found?.indexable).toBe(false);
    expect(found?.canonicalPath).toBe("/knowledge");
    const detail = resolveKnowledge("/knowledge/subsidy/synthetic-subsidy", "", rows);
    expect(detail?.kind).toBe("article");
    expect(detail?.article?.region).toBe("合成市");
    const linked = resolveKnowledge("/knowledge/ip/synthetic-ip", "", rows);
    expect(linked?.related.map((item) => item.slug)).toEqual(["synthetic-subsidy"]);
    expect(resolveKnowledge("/knowledge/nope", "", rows)?.status).toBe(404);
    expect(resolveKnowledge("/knowledge/subsidy/missing", "", rows)?.status).toBe(404);
    expect(resolveKnowledge("/knowledge/subsidy/synthetic-subsidy/extra", "", rows)?.status).toBe(404);
    const paths = knowledgeSitemapPaths(rows);
    expect(paths).toContain("/knowledge");
    expect(paths).toContain("/knowledge/subsidy");
    expect(paths).toContain("/knowledge/ip");
    expect(paths).not.toContain("/knowledge/business");
    expect(paths.filter((path) => path === "/knowledge/subsidy/synthetic-subsidy")).toHaveLength(1);
  });

  it("详情页 SSR 带真实标题、canonical、面包屑和文章字段，且不执行正文标签", () => {
    const rows = [article({ blocks: [{ type: "paragraph", text: "合成正文保留普通文字，标签只能作为转义文本出现在校验失败的用例里，这里用足够长的句子占满发布长度。" }, { type: "list", items: ["地区", "窗口"] }] })];
    const model = resolveKnowledge("/knowledge/subsidy/synthetic-subsidy", "", rows)!;
    const html = decorateKnowledgeHtml(shell, model);
    expect(html).toContain("<title>合成补助常识说明稿｜企策AI增长</title>");
    expect(html).toContain('name="description" content="这是单元测试用的合成摘要，用来检查列表、搜索和结构化数据，不是已发布文章。"');
    expect(html).toContain('rel="canonical" href="https://qicego.com/knowledge/subsidy/synthetic-subsidy"');
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain('property="og:url" content="https://qicego.com/knowledge/subsidy/synthetic-subsidy"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('"headline":"合成补助常识说明稿"');
    expect(html).toContain('"datePublished":"2026-01-01"');
    expect(html).toContain('"dateModified":"2026-02-01"');
    expect(html).toContain("适用地区：合成市");
    expect(html).toContain("申领窗口：测试窗口不对外办理");
    expect(html).toContain("合成〔2026〕1号");
    expect(html).toContain('href="/#contact"');
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('"datePublished":"2026-01-01"');
    expect(html).not.toContain('"datePublished":"2026-11-11"');
    expect(html.match(/<title>/g)).toHaveLength(1);
    const empty = decorateKnowledgeHtml(shell, resolveKnowledge("/knowledge", "", [])!);
    expect(empty).toContain("noindex");
    expect(empty).not.toContain('"@type":"Article"');
    expect(renderKnowledgeHtml(resolveKnowledge("/knowledge/subsidy/missing", "", rows)!)).toContain("没有这篇文章");
    expect(readFileSync("public/googled5c7c4e254bd8e0c.html", "utf8")).toContain("google-site-verification:");
  });

  it("九篇复核稿可公开阅读，核对日不写成发布日期", () => {
    expect(publicKnowledge).toHaveLength(9);
    expect(publishedKnowledge).toHaveLength(0);
    const paths = knowledgeSitemapPaths(publicKnowledge);
    expect(paths).toContain("/knowledge");
    expect(paths).toContain("/knowledge/subsidy");
    expect(paths).toContain("/knowledge/business");
    expect(paths).toContain("/knowledge/ip");
    expect(paths.filter((path) => path.split("/").length === 4)).toHaveLength(9);
    const statuses = Object.fromEntries(publicKnowledge.map((item) => [item.slug, item.contentStatus]));
    expect(statuses["enterprise-subsidy-self-check"]).toBe("窗口需确认");
    expect(statuses["trademark-registration-basics"]).toBe("当前依据核实");
    for (const item of publicKnowledge) {
      expect(item.publishedAt).toBeNull();
      expect(item.checkedAt).toBe("2026-11-11");
      expect(item.pendingReview).toBe(false);
    }
    const joined = publicKnowledge.flatMap((item) => item.blocks.flatMap((block) => (block.type === "list" ? block.items : [block.text]))).join("\n");
    expect(joined).not.toContain("不应对外声称");
    expect(joined).not.toContain("已能代理");
    expect(joined).toContain("不能把尚未施行的条文当成当前正在执行的流程");
    expect(joined).toContain("自公告之日起三个月内");
    expect(joined).toContain("自公告之日起二个月内");
    const trademark = resolveKnowledge("/knowledge/ip/trademark-registration-basics", "", publicKnowledge)!;
    expect(trademark.indexable).toBe(true);
    const html = decorateKnowledgeHtml(shell, trademark);
    expect(html).toContain("核对状态：当前依据核实");
    expect(html).toContain("文稿核对日：2026-11-11");
    expect(html).toContain("不是政策发布日期");
    expect(html).not.toContain('"datePublished"');
    expect(html).not.toContain("待复核草稿");
    expect(html).not.toContain("HTTP 200");
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('href="/#contact"');
    const guide = resolveKnowledge("/knowledge/subsidy/enterprise-subsidy-self-check", "", publicKnowledge)!;
    expect(decorateKnowledgeHtml(shell, guide)).toContain("核对状态：窗口需确认");
    const found = resolveKnowledge("/knowledge", "?q=加计扣除", publicKnowledge);
    expect(found?.articles.map((item) => item.slug)).toEqual(["rd-expense-super-deduction"]);
    expect(found?.indexable).toBe(false);
  });
});
