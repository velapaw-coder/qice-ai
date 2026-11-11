import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  knowledgeBoundary,
  knowledgeEmptyLabel,
  resolveKnowledge,
  type KnowledgeArticle,
  type KnowledgeBlock,
} from "@shared/knowledge";
import { visibleKnowledge } from "@shared/visibleKnowledge";
import { SITE_TITLE } from "@shared/growthHome";
import { BrandMark, Button, Input } from "../components/ui";

export function KnowledgePage() {
  const location = useLocation();
  const model = resolveKnowledge(location.pathname, location.search, visibleKnowledge);
  useEffect(() => {
    if (!model) return;
    document.title = model.title;
    return () => {
      document.title = SITE_TITLE;
    };
  }, [model?.title]);
  if (!model) return null;
  return (
    <div className="min-h-screen bg-white text-[#182642]">
      <header className="border-b border-[#e4eaf4] bg-white">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-extrabold text-[#0c1832]"><BrandMark size={32} />企策AI增长</Link>
          <Link to="/#contact" className="text-sm font-bold text-[#1e4fc8]" data-testid="knowledge-cta">预约增长交流</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <nav aria-label="面包屑" className="text-sm text-[#3e4e68]" data-testid="knowledge-crumbs">
          {model.crumbs.map((crumb, index) => (
            <span key={crumb.path}>
              {index > 0 ? <span> / </span> : null}
              <Link className="font-semibold text-[#1e4fc8]" to={crumb.path}>{crumb.name}</Link>
            </span>
          ))}
        </nav>
        {model.kind === "missing" ? (
          <div className="mt-6" data-testid="knowledge-missing">
            <h1 className="text-3xl font-extrabold text-[#0c1832]">没有这篇文章</h1>
            <p className="mt-3 text-base leading-7">这个地址没有已发布内容。</p>
          </div>
        ) : null}
        {model.kind === "article" && model.article ? <ArticleView article={model.article} related={model.related} /> : null}
        {model.kind === "hub" || model.kind === "category" ? (
          <div className="mt-6" data-testid="knowledge-list">
            <h1 className="text-3xl font-extrabold tracking-tight text-[#0c1832]">{model.kind === "hub" ? "企业服务知识库" : model.crumbs.at(-1)?.name}</h1>
            <p className="mt-3 text-base leading-7 text-[#3e4e68]">{model.description}</p>
            <nav aria-label="知识库分类" className="mt-6 flex flex-wrap gap-2" data-testid="knowledge-categories">
              {model.categories.map((item) => (
                <Link key={item.slug} to={item.path} className="rounded-[11px] border border-[#d8e1ef] px-3 py-2 text-sm font-bold text-[#1e4fc8]" data-testid={`knowledge-category-${item.slug}`}>
                  {item.label}
                </Link>
              ))}
            </nav>
            {model.kind === "hub" ? (
              <form className="mt-6 flex gap-2" action="/knowledge" method="get" data-testid="knowledge-search">
                <Input name="q" defaultValue={model.query} aria-label="搜索文章" placeholder="搜索文章" maxLength={40} />
                <Button type="submit" variant="outline">搜索</Button>
              </form>
            ) : null}
            {model.articles.length === 0 ? (
              <p className="mt-6 text-base" data-testid="knowledge-empty">{knowledgeEmptyLabel(model)}</p>
            ) : (
              <ul className="mt-6 space-y-3">
                {model.articles.map((article) => (
                  <li key={article.slug}>
                    <Link className="font-bold text-[#1e4fc8]" to={`/knowledge/${article.category}/${article.slug}`}>{article.title}</Link>
                    {article.contentStatus ? <p className="mt-1 text-sm font-bold text-[#0c1832]" data-testid="knowledge-status">{article.contentStatus}</p> : null}
                    <p className="mt-1 text-sm leading-6 text-[#3e4e68]">{article.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        <p className="mt-8 rounded-[18px] border border-[#d8e1ef] bg-[#f5f8fe] p-4 text-sm leading-6 text-[#182642]" data-testid="knowledge-boundary">{knowledgeBoundary()}</p>
        <Button asChild className="mt-4">
          <Link to="/#contact">预约增长交流</Link>
        </Button>
      </main>
    </div>
  );
}

function ArticleView({ article, related }: { article: KnowledgeArticle; related: KnowledgeArticle[] }) {
  return (
    <article className="mt-6" data-testid="knowledge-article">
      <h1 className="text-3xl font-extrabold tracking-tight text-[#0c1832]">{article.title}</h1>
      <dl className="mt-4 space-y-2 text-sm leading-6 text-[#182642]" data-testid="knowledge-facts">
        <div data-testid="knowledge-status"><dt className="inline font-bold">核对状态：</dt><dd className="inline">{article.contentStatus || "未标明"}</dd></div>
        <div><dt className="inline font-bold">文稿核对日：</dt><dd className="inline">{article.checkedAt}（北京时间）。这是编辑核对日期，不是政策发布日期。</dd></div>
        {article.pendingReview ? <div data-testid="knowledge-pending">文中期限或新规仍在对照官方文本，本文不是最终结论。</div> : null}
        {article.region ? <div><dt className="inline font-bold">适用地区：</dt><dd className="inline">{article.region}</dd></div> : null}
        {article.validityNote ? <div><dt className="inline font-bold">阅读提示：</dt><dd className="inline">{article.validityNote}</dd></div> : null}
        {article.applicationWindow ? <div><dt className="inline font-bold">申领窗口：</dt><dd className="inline">{article.applicationWindow}</dd></div> : null}
      </dl>
      <div className="mt-6 space-y-3 text-base leading-7">
        {article.blocks.map((block, index) => <BlockView key={index} block={block} />)}
      </div>
      <h2 className="mt-8 text-lg font-extrabold text-[#0c1832]">来源</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
        {article.sources.map((source) => {
          const label = `${source.name && source.name !== source.title ? `${source.name}：` : ""}${source.title}${source.identifier ? `（${source.identifier}）` : ""}`;
          return <li key={label}>{source.url ? <a className="font-semibold text-[#1e4fc8]" href={source.url}>{label}</a> : label}</li>;
        })}
      </ul>
      {related.length ? (
        <>
          <h2 className="mt-8 text-lg font-extrabold text-[#0c1832]">相关文章</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {related.map((item) => (
              <li key={item.slug}><Link className="font-semibold text-[#1e4fc8]" to={`/knowledge/${item.category}/${item.slug}`}>{item.title}</Link></li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

function BlockView({ block }: { block: KnowledgeBlock }) {
  if (block.type === "heading") return <h2 className="pt-2 text-lg font-extrabold text-[#0c1832]">{block.text}</h2>;
  if (block.type === "list") return <ul className="list-disc space-y-1 pl-5">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
  return <p>{block.text}</p>;
}

