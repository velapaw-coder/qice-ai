import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { BrandMark } from "../components/ui";

function render(md: string) {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    out.push(<ul key={`ul-${out.length}`} className="list-disc space-y-1 pl-5">{list.map((item) => <li key={item}>{inline(item)}</li>)}</ul>);
    list = [];
  };
  lines.forEach((line, index) => {
    if (line.startsWith("|")) return;
    if (line.startsWith("- ")) {
      list.push(line.slice(2));
      return;
    }
    flush();
    if (line.startsWith("# ")) out.push(<h1 key={index} className="text-2xl font-bold">{inline(line.slice(2))}</h1>);
    else if (line.startsWith("## ")) out.push(<h2 key={index} className="mt-6 text-lg font-semibold">{inline(line.slice(3))}</h2>);
    else if (line.trim()) out.push(<p key={index}>{inline(line)}</p>);
  });
  flush();
  return out;
}

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => (part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>));
}

const titles: Record<string, string> = { privacy: "隐私政策", consent: "数据授权书", terms: "用户协议" };

export function LegalPage() {
  const { doc = "privacy" } = useParams();
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ content_md: string }>(`/api/legal/${doc}`).then((row) => setContent(row.content_md)).catch((err) => setError(err.message));
  }, [doc]);
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-extrabold text-navy"><BrandMark size={32} />企策AI</Link>
          <span className="text-sm text-muted">{titles[doc] || "文档"} · 模板，待法务确认</span>
        </div>
      </header>
      <article className="mx-auto max-w-3xl space-y-3 px-4 py-8 text-sm leading-7">
        {error ? <p className="text-red-600">{error}</p> : content ? render(content) : <p>正在读取…</p>}
      </article>
    </div>
  );
}
