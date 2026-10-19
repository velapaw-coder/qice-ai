import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { zipSync } from "fflate";
import { deriveClientKey } from "@shared/password";
import { formatPublicBand, parseBands, type EstimateBand } from "@shared/bands";
import { formatRange } from "@shared/rules/evaluate";
import { api } from "../lib/api";
import { Banner, Button, Card, Input, Label, Textarea, TierBadge } from "../components/ui";
import { ChangePasswordPage } from "./AuthPages";

const links = [
  ["/", "待办"],
  ["/enterprises", "企业"],
  ["/deals/policy", "政策线"],
  ["/deals/fde", "FDE"],
  ["/policies", "政策库"],
  ["/policy-drafts", "草稿"],
  ["/policy-sources", "抓取来源"],
  ["/crawl-runs", "抓取记录"],
  ["/ai-settings", "模型"],
  ["/users", "账号"],
  ["/audit", "审计"],
  ["/settings", "设置"],
];

export function AdminApp() {
  const [me, setMe] = useState<{ user: { role: string; must_change_password: boolean; name: string } } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ user: { role: string; must_change_password: boolean; name: string } }>("/api/me").then(setMe).catch((err) => setError(err.message));
  }, []);
  if (error) return <div className="p-6"><Banner tone="error">{error}</Banner><Link to="/login">去登录</Link></div>;
  if (!me) return <p className="p-6 text-sm">正在进入后台…</p>;
  if (me.user.role === "enterprise") return <Navigate to="/app" replace />;
  if (me.user.must_change_password && location.pathname !== "/admin/change-password") return <Navigate to="/admin/change-password" replace />;
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-bg">
      <header className="z-30 shrink-0 border-b border-line bg-white" data-testid="admin-header">
        <div className="mx-auto flex min-h-14 max-w-7xl items-center gap-3 px-3 py-2">
          <Link to="/admin" className="shrink-0 font-extrabold text-navy">企策AI 后台</Link>
          <nav className="flex min-w-0 flex-1 gap-3 overflow-x-auto text-sm whitespace-nowrap">
            {links.map(([path, label]) => <Link key={path} to={`/admin${path === "/" ? "" : path}`}>{label}</Link>)}
          </nav>
          <span className="hidden text-xs text-muted sm:inline">{me.user.name}</span>
          <button
            className="text-sm text-brand"
            type="button"
            data-testid="admin-logout"
            onClick={() => api("/api/auth/logout", { method: "POST", body: "{}" }).then(() => { window.location.href = "/login"; })}
          >退出</button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-3 py-4">
        <Routes>
          <Route index element={<Todos />} />
          <Route path="enterprises" element={<EnterpriseList />} />
          <Route path="enterprises/:id" element={<EnterpriseDetail />} />
          <Route path="deals/policy" element={<PolicyDeals />} />
          <Route path="deals/fde" element={<FdeDeals />} />
          <Route path="policies" element={<Policies />} />
          <Route path="policies/:id" element={<PolicyEdit />} />
          <Route path="policy-drafts" element={<Drafts />} />
          <Route path="policy-drafts/:id" element={<DraftDetail />} />
          <Route path="policy-sources" element={<Sources />} />
          <Route path="crawl-runs" element={<Crawls />} />
          <Route path="ai-settings" element={<AiSettings />} />
          <Route path="users" element={<Users />} />
          <Route path="audit" element={<Audit />} />
          <Route path="settings" element={<Settings />} />
          <Route path="change-password" element={<ChangePasswordPage next="/admin" />} />
        </Routes>
        </div>
      </main>
    </div>
  );
}

function useData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = () => api<T>(path).then(setData).catch((err) => setError(err.message));
  useEffect(() => { reload(); }, [path]);
  return { data, error, reload };
}

function Todos() {
  const { data, error } = useData<{ groups: { key: string; title: string; count: number }[]; lists: Record<string, Record<string, string>[]> }>("/api/admin/todos");
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <p>正在读取待办…</p>;
  return (
    <div className="space-y-4" data-testid="admin-home">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {data.groups.map((group) => <Card key={group.key}><p className="text-xs text-muted">{group.title}</p><p className="text-2xl font-bold">{group.count}</p></Card>)}
      </div>
      {data.groups.map((group) => (
        <Card key={group.key}>
          <h2 className="font-semibold">{group.title}</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {(data.lists[group.key] || []).map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link className="font-medium text-brand" to={`/admin/enterprises/${row.enterprise_id || row.id}`}>{row.name || row.title || row.id}</Link>
                <span className="text-muted">{row.contact_phone || ""} {row.city || ""} {row.time?.slice(0, 16) || ""}</span>
              </li>
            ))}
            {(data.lists[group.key] || []).length === 0 ? <li className="py-2 text-muted">暂无</li> : null}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function EnterpriseList() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data, error, reload } = useData<{ enterprises: Record<string, string>[] }>(`/api/admin/enterprises?q=${encodeURIComponent(q)}&status=${status}`);
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="企业名或手机号" value={q} onChange={(e) => setQ(e.target.value)} data-testid="enterprise-search" />
        <select className="rounded-xl border border-line px-3" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          {["待上传", "识别中", "需补传", "待复核", "已发布", "暂不支持", "已撤回"].map((item) => <option key={item}>{item}</option>)}
        </select>
        <Button variant="outline" onClick={reload}>查询</Button>
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Card>
        {(data?.enterprises || []).map((ent) => (
          <Link key={ent.id} to={`/admin/enterprises/${ent.id}`} className="flex items-center justify-between border-b border-line py-3 text-sm">
            <span><b>{ent.name}</b><span className="ml-2 text-muted">{ent.contact_phone}</span></span>
            <span>{ent.status} · {ent.city || "地区待识别"}</span>
          </Link>
        ))}
        {data && data.enterprises.length === 0 ? <p className="text-sm text-muted">没有符合条件的企业</p> : null}
      </Card>
    </div>
  );
}

function EnterpriseDetail() {
  const { id = "" } = useParams();
  const { data, error, reload } = useData<any>(`/api/admin/enterprises/${id}`);
  const [msg, setMsg] = useState("");
  const [bandId, setBandId] = useState("");
  const draftId = data?.draft?.id as string | undefined;
  useEffect(() => {
    if (!data) return;
    setBandId(String(data.suggested_band_id || data.bands?.[0]?.id || ""));
  }, [draftId]);
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <p>正在读取企业…</p>;
  const ent = data.enterprise;
  const warnings: string[] = JSON.parse(ent.warnings_json || "[]");
  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const fields: Record<string, unknown> = {};
    for (const key of ["industry", "established", "registered_capital", "town", "licenses", "dishonest", "size_class"]) {
      const value = String(form.get(key) || "");
      if (!value) continue;
      if (key === "registered_capital") fields[key] = Number(value);
      else if (key === "dishonest") fields[key] = value === "true";
      else fields[key] = value;
    }
    const res = await api<{ rule_ms: number }>(`/api/admin/enterprises/${id}/profile`, { method: "PATCH", body: JSON.stringify({ fields }) });
    setMsg(`已重新匹配（规则计算 ${res.rule_ms} ms）`);
    reload();
  }
  async function publish() {
    await api(`/api/admin/assessments/${data.draft.id}/publish`, { method: "POST", body: JSON.stringify({ band_id: bandId }) });
    setMsg("已发布给企业");
    reload();
  }
  async function ret(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get("note") || "");
    await api(`/api/admin/enterprises/${id}/return`, { method: "POST", body: JSON.stringify({ note }) });
    reload();
  }
  async function zip() {
    const plan = await api<{ files: { id: string; path: string }[]; filename: string }>(`/api/admin/enterprises/${id}/zip-intent`, { method: "POST", body: "{}" });
    const entries: Record<string, Uint8Array> = {};
    for (const file of plan.files) {
      const res = await fetch(`/api/admin/files/${file.id}/download?via=zip`, { credentials: "include", headers: { "x-qice-request": "1" } });
      entries[file.path] = new Uint8Array(await res.arrayBuffer());
    }
    const zipped = zipSync(entries, { level: 6 });
    const blob = new Blob([zipped], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = plan.filename;
    a.click();
  }
  async function createDeals() {
    const picked = [...document.querySelectorAll<HTMLInputElement>("input[data-deal]:checked")].map((node) => ({ name: node.value }));
    await api("/api/admin/deals/policy", { method: "POST", body: JSON.stringify({ enterprise_id: id, items: picked, assessment_id: data.published?.id || data.draft?.id }) });
    setMsg("已创建政策成交");
    reload();
  }
  async function createFde(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await api("/api/admin/deals/fde", { method: "POST", body: JSON.stringify({ enterprise_id: id, need_desc: String(new FormData(e.currentTarget).get("need") || "") }) });
    setMsg("已创建 FDE 成交");
    reload();
  }
  async function realize(dealId: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await api(`/api/admin/deals/policy/${dealId}/realizations`, {
      method: "POST",
      body: JSON.stringify({ amount: Number(form.get("amount")), realized_at: String(form.get("date")), fee_amount: form.get("fee") ? Number(form.get("fee")) : undefined, proof_note: String(form.get("proof") || "") }),
    });
    reload();
  }
  const profile = data.profile || {};
  const value = (field: string) => profile[field]?.value ?? "";
  const bands = (data.bands || []) as EstimateBand[];
  const systemLow = Number(data.draft?.estimate_low ?? 0);
  const systemHigh = Number(data.draft?.estimate_high ?? 0);
  return (
    <div className="space-y-4" data-testid="admin-review">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{ent.name}</h1>
            <p className="text-sm text-muted">{ent.contact_name} · <button className="text-brand" onClick={() => navigator.clipboard.writeText(ent.contact_phone)}>{ent.contact_phone}</button> · {ent.status}</p>
          </div>
          <Button variant="outline" data-testid="zip" onClick={zip} disabled={!(data.files || []).some((f: { parent_file_id?: string }) => !f.parent_file_id)}>打包下载</Button>
        </div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <p>信用代码：{ent.uscc || "待补"}（{ent.uscc_source || "未识别"}）</p>
          <p>主体：{ent.entity_type || "待补"} · 地区：{ent.city || "待补"} {ent.region_code || ""} {ent.town || ""}</p>
        </div>
        {warnings.map((w) => <Banner key={w} tone={w.includes("重复") || w.includes("不一致") ? "error" : "warn"}>{w}{ent.dup_enterprise_id && w.includes("重复") ? <Link className="ml-2 underline" to={`/admin/enterprises/${ent.dup_enterprise_id}`}>查看另一家</Link> : null}</Banner>)}
        {data.dup ? <p className="text-sm">疑似与 <Link className="text-brand" to={`/admin/enterprises/${data.dup.id}`}>{data.dup.name}</Link> 重复</p> : null}
      </Card>
      {msg ? <Banner>{msg}</Banner> : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h2 className="font-semibold">资料</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {(data.files || []).filter((f: { parent_file_id?: string }) => !f.parent_file_id).map((f: { id: string; filename: string; kind: string; period_start?: string; size: number }) => (
              <li key={f.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{f.kind === "vat" ? "增值税" : "社保"} {f.period_start || ""} {f.filename}</span>
                <a className="shrink-0 text-brand" href={`/api/admin/files/${f.id}/download`} data-testid={`download-${f.kind}`}>下载</a>
              </li>
            ))}
            {(data.files || []).length === 0 ? <li className="text-muted">还没有文件</li> : null}
          </ul>
        </Card>
        <Card>
          <h2 className="font-semibold">画像</h2>
          <p className="text-xs text-muted">人数 {String(value("headcount") || "待识别")} · 规模 {String(value("size_class") || "待识别")} · 青年候选 {String(value("young_candidates") ?? "—")}</p>
          <form onSubmit={saveProfile} className="mt-3 space-y-2" data-testid="profile-form">
            <Label>行业</Label>
            <Input name="industry" defaultValue={String(value("industry") || "")} data-testid="industry" />
            <Label>成立日期</Label>
            <Input name="established" defaultValue={String(value("established") || "")} placeholder="2014-01-01" data-testid="established" />
            <Label>注册资本（元）</Label>
            <Input name="registered_capital" defaultValue={String(value("registered_capital") || "")} data-testid="capital" />
            <Label>镇街</Label>
            <Input name="town" defaultValue={ent.town || ""} />
            <Label>资质</Label>
            <Input name="licenses" defaultValue={String(value("licenses") || "")} />
            <Label>是否严重失信</Label>
            <select name="dishonest" className="w-full rounded-xl border border-line px-3 py-2" defaultValue={value("dishonest") === false ? "false" : value("dishonest") === true ? "true" : ""} data-testid="dishonest">
              <option value="">未知</option>
              <option value="false">否</option>
              <option value="true">是</option>
            </select>
            <Button type="submit" data-testid="save-profile">保存并重新匹配</Button>
          </form>
        </Card>
        <Card>
          <h2 className="font-semibold">方案初稿</h2>
          {data.draft ? <p className="text-sm" data-testid="admin-estimate">系统测算（仅顾问可见）{formatRange(systemLow, systemHigh)}</p> : <p className="text-sm text-muted">还没有初稿</p>}
          {data.draft ? (
            <div className="mt-2 space-y-2">
              <Label>对企业展示的档位</Label>
              <select className="w-full rounded-xl border border-line px-3 py-2" data-testid="band-select" value={bandId} onChange={(e) => setBandId(e.target.value)}>
                {bands.map((band) => <option key={band.id} value={band.id}>{band.label}</option>)}
              </select>
              <p className="text-xs text-muted">{bands.find((band) => band.id === bandId) ? `企业将看到「${formatPublicBand(bands.find((band) => band.id === bandId)!)}」` : "请选择档位"}</p>
            </div>
          ) : null}
          <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto">
            {(data.items || []).map((item: { id: string; name: string; tier: string; code?: string; verify_text?: string; basis?: string }) => (
              <li key={item.id} className="rounded-xl border border-line p-2 text-sm" data-testid={`tier-${item.code || item.name}`}>
                <div className="flex items-center justify-between gap-2"><b>{item.name}</b><TierBadge tier={item.tier} /></div>
                {item.verify_text ? <p className="text-muted">{item.tier === "go" ? "待确认" : "需核实"}：{item.verify_text}</p> : null}
                {ent.status === "已发布" ? <label className="mt-1 flex gap-2"><input type="checkbox" data-deal value={item.name} />纳入政策成交</label> : null}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-2">
            <Button disabled={!data.draft} onClick={publish} data-testid="publish">发布给企业</Button>
            <Button variant="outline" onClick={() => api(`/api/admin/enterprises/${id}/notified`, { method: "POST", body: "{}" }).then(() => setMsg("已记录电话告知"))}>已电话告知</Button>
            {ent.status === "已发布" ? <Button variant="outline" onClick={createDeals} data-testid="create-policy-deal">创建政策 deal</Button> : null}
          </div>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">退回补传</h2>
          <form onSubmit={ret} className="mt-2 space-y-2">
            <Textarea name="note" placeholder="例如：社保清单请导出 Excel 原表" required />
            <Button variant="outline" type="submit">退回补传</Button>
          </form>
        </Card>
        <Card>
          <h2 className="font-semibold">FDE 成交</h2>
          <form onSubmit={createFde} className="mt-2 space-y-2">
            <Textarea name="need" placeholder="需求描述" data-testid="fde-need" />
            <Button type="submit" data-testid="create-fde">创建 FDE deal</Button>
          </form>
          <ul className="mt-3 space-y-2 text-sm">
            {(data.fde_deals || []).map((deal: { id: string; stage: string; need_desc?: string }) => <li key={deal.id}>{deal.stage} · {deal.need_desc}</li>)}
          </ul>
        </Card>
      </div>
      <Card>
        <h2 className="font-semibold">政策成交与兑现</h2>
        {(data.policy_deals || []).map((deal: { id: string; item_name: string; stage: string }) => (
          <form key={deal.id} onSubmit={(e) => realize(deal.id, e)} className="mt-3 grid gap-2 border-t border-line pt-3 md:grid-cols-5" data-testid={`deal-${deal.item_name}`}>
            <p className="text-sm md:col-span-5">{deal.item_name} · {deal.stage}</p>
            <Input name="amount" type="number" placeholder="兑现金额" required data-testid="realize-amount" />
            <Input name="date" type="date" required data-testid="realize-date" />
            <Input name="fee" type="number" placeholder="服务费（内部）" />
            <Input name="proof" placeholder="凭证备注" />
            <Button type="submit" data-testid="realize">记录兑现</Button>
          </form>
        ))}
        {(data.policy_deals || []).length === 0 ? <p className="mt-2 text-sm text-muted">还没有政策成交</p> : null}
      </Card>
    </div>
  );
}

function PolicyDeals() {
  const { data, error } = useData<{ deals: Record<string, string | number>[]; totals: { amount: number; fee: number } }>("/api/admin/deals/policy");
  if (error) return <Banner tone="error">{error}</Banner>;
  return (
    <Card data-testid="policy-deals">
      <h1 className="text-xl font-bold">政策线</h1>
      <p className="text-sm text-muted">兑现金额合计 {data?.totals?.amount || 0} 元 · 手工服务费合计 {data?.totals?.fee || 0} 元。收费条款只在后台可见。</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="text-muted"><th>企业</th><th>项目</th><th>阶段</th><th>收费方式</th></tr></thead>
          <tbody>
            {(data?.deals || []).map((deal) => <tr key={String(deal.id)} className="border-t border-line"><td>{deal.enterprise_name}</td><td>{deal.item_name}</td><td>{deal.stage}</td><td>{deal.fee_terms_text || "线下协商，未填写"}</td></tr>)}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FdeDeals() {
  const { data, error } = useData<{ deals: Record<string, string | number>[]; totals: { quote: number; purchase: number } }>("/api/admin/deals/fde");
  if (error) return <Banner tone="error">{error}</Banner>;
  return (
    <Card>
      <h1 className="text-xl font-bold">AI FDE 线</h1>
      <p className="text-sm text-muted">报价合计 {data?.totals?.quote || 0} · 采购合计 {data?.totals?.purchase || 0}</p>
      <ul className="mt-3 space-y-2 text-sm">{(data?.deals || []).map((deal) => <li key={String(deal.id)}>{deal.enterprise_name} · {deal.stage} · {deal.need_desc}</li>)}</ul>
    </Card>
  );
}

function Policies() {
  const { data, error, reload } = useData<{ policies: { id: string; code: string; name: string; status: string; category: string }[] }>("/api/admin/policies");
  if (error) return <Banner tone="error">{error}</Banner>;
  return (
    <Card>
      <h1 className="text-xl font-bold">政策库</h1>
      <p className="text-sm text-muted">种子规则都是草稿。只有启用后才会参与匹配。企业端不显示单项金额。</p>
      <ul className="mt-3 divide-y divide-line">
        {(data?.policies || []).map((policy) => (
          <li key={policy.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <Link to={`/admin/policies/${policy.id}`}><b>{policy.name}</b> <span className="text-muted">{policy.code} · {policy.category}</span></Link>
            <span className="flex items-center gap-2">{policy.status}
              {policy.status !== "启用" ? <Button data-testid={`enable-${policy.code}`} onClick={() => api(`/api/admin/policies/${policy.id}/enable`, { method: "POST", body: "{}" }).then(reload)}>启用</Button> : <Button variant="outline" onClick={() => api(`/api/admin/policies/${policy.id}/disable`, { method: "POST", body: "{}" }).then(reload)}>停用</Button>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PolicyEdit() {
  const { id = "" } = useParams();
  const { data, error } = useData<{ policy: { name: string; status: string }; version: { definition_json: string; basis: string } }>(`/api/admin/policies/${id}`);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { if (data?.version) setText(data.version.definition_json); }, [data]);
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <p>正在读取规则…</p>;
  const current = data;
  async function save() {
    let rule: unknown;
    try { rule = JSON.parse(text); } catch { return setMsg("JSON 无法解析"); }
    const basis = current.version.basis;
    await api(`/api/admin/policies/${id}`, { method: "PATCH", body: JSON.stringify({ rule, basis }) });
    setMsg("已保存为新版本，状态不会自动启用");
  }
  return (
    <Card>
      <h1 className="text-xl font-bold">{data.policy.name}</h1>
      <p className="text-sm text-muted">状态 {data.policy.status}。条件和估算直接改 JSON，保存时会校验。</p>
      <Textarea className="mt-3 min-h-80 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      <Button className="mt-3" onClick={save}>保存新版本</Button>
      {msg ? <p className="mt-2 text-sm">{msg}</p> : null}
    </Card>
  );
}

function Drafts() {
  const { data, error } = useData<{ drafts: { id: string; title: string; status: string; source_url?: string }[] }>("/api/admin/policy-drafts");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  if (error) return <Banner tone="error">{error}</Banner>;
  return (
    <div className="space-y-3">
      <Card>
        <h1 className="text-xl font-bold">粘贴导入</h1>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="把政策原文贴在这里。PDF 请先在浏览器里复制文本。" />
        <Button className="mt-2" onClick={() => api("/api/admin/policy-drafts/import", { method: "POST", body: JSON.stringify({ text }) }).then((res) => setMsg(`已生成草稿 ${JSON.stringify(res)}`))}>生成待审核草稿</Button>
        {msg ? <p className="mt-2 text-sm">{msg}</p> : null}
      </Card>
      <Card>
        {(data?.drafts || []).map((draft) => <Link key={draft.id} className="block border-b border-line py-2 text-sm" to={`/admin/policy-drafts/${draft.id}`}>{draft.title} · {draft.status}</Link>)}
        {data && data.drafts.length === 0 ? <p className="text-sm text-muted">还没有抓取或导入的草稿</p> : null}
      </Card>
    </div>
  );
}

function DraftDetail() {
  const { id = "" } = useParams();
  const { data, error } = useData<{ draft: { title: string; status: string; suggested_definition_json?: string }; text: string }>(`/api/admin/policy-drafts/${id}`);
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <p>正在读取草稿…</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><h2 className="font-semibold">原文</h2><pre className="mt-2 max-h-[70vh] overflow-auto whitespace-pre-wrap text-xs">{data.text || "没有原文"}</pre></Card>
      <Card>
        <h2 className="font-semibold">{data.draft.title}</h2>
        <p className="text-sm">状态 {data.draft.status}</p>
        <pre className="mt-2 overflow-auto text-xs">{data.draft.suggested_definition_json || "还没有建议规则。可在编辑后采纳。"}</pre>
        <div className="mt-3 flex gap-2">
          <Button onClick={() => api(`/api/admin/policy-drafts/${id}/adopt`, { method: "POST", body: "{}" })}>采纳为草稿规则</Button>
          <Button variant="outline" onClick={() => api(`/api/admin/policy-drafts/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: "与现有规则重复或依据不足" }) })}>驳回</Button>
        </div>
      </Card>
    </div>
  );
}

function Sources() {
  const { data, error, reload } = useData<{ sources: { id: string; name: string; enabled: number; list_url: string; last_status?: string }[] }>("/api/admin/policy-sources");
  if (error) return <Banner tone="error">{error}</Banner>;
  return (
    <Card>
      <h1 className="text-xl font-bold">抓取来源</h1>
      <p className="text-sm text-muted">默认停用。上线前逐个试抓，确认能访问再启用。自动抓取失败不影响企业方案。</p>
      <ul className="mt-3 space-y-3 text-sm">
        {(data?.sources || []).map((source) => (
          <li key={source.id} className="border-b border-line pb-2">
            <b>{source.name}</b> · {source.enabled ? "启用" : "停用"} · {source.last_status || "未抓取"}
            <p className="truncate text-muted">{source.list_url}</p>
            <Button variant="outline" onClick={() => api(`/api/admin/policy-sources/${source.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !source.enabled }) }).then(reload)}>{source.enabled ? "停用" : "启用"}</Button>
          </li>
        ))}
      </ul>
      <Button className="mt-3" onClick={() => api("/api/admin/crawl-runs", { method: "POST", body: JSON.stringify({ type: "initial" }) })}>首次批量抓取</Button>
    </Card>
  );
}

function Crawls() {
  const { data, error } = useData<{ runs: Record<string, string | number>[] }>("/api/admin/crawl-runs");
  if (error) return <Banner tone="error">{error}</Banner>;
  return <Card><h1 className="text-xl font-bold">抓取记录</h1><ul className="mt-3 text-sm">{(data?.runs || []).map((run) => <li key={String(run.id)}>{run.type} · {run.status} · 草稿 {run.drafts_created} · 失败 {run.sources_failed}</li>)}{data && data.runs.length === 0 ? <li className="text-muted">还没有运行记录</li> : null}</ul></Card>;
}

const vendorUrls: Record<string, string> = {
  deepseek: "https://api.deepseek.com",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.cn/v1",
  ark: "https://ark.cn-beijing.volces.com/api/v3",
  qianfan: "https://qianfan.baidubce.com/v2",
  custom: "",
};

function AiSettings() {
  const { data, error, reload } = useData<{ providers: { id: string; name: string; vendor: string; model: string; api_key_last4?: string; enabled: number; last_test_msg?: string }[] }>("/api/admin/ai-providers");
  const settings = useData<{ settings: Record<string, string> }>("/api/admin/settings");
  const [vendor, setVendor] = useState("deepseek");
  const [msg, setMsg] = useState("");
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!confirm("请确认隐私政策中的受托方信息已同步更新")) return;
    await api("/api/admin/ai-providers", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        vendor,
        base_url: form.get("base_url"),
        api_key: form.get("api_key"),
        model: form.get("model"),
        cap_text: form.get("cap_text") === "on",
        cap_vision: form.get("cap_vision") === "on",
        cap_json_mode: form.get("cap_json") === "on",
      }),
    });
    setMsg("已保存。密钥只显示后 4 位。");
    reload();
  }
  async function assign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload: Record<string, string> = {};
    for (const key of ["llm_text_primary", "llm_text_fallback", "llm_vision_primary", "llm_vision_fallback"]) payload[key] = String(form.get(key) || "");
    await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ settings: payload }) });
    setMsg("主用和备用模型已更新");
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="ai-settings">
      <Card>
        <h1 className="text-xl font-bold">添加模型</h1>
        <p className="text-sm text-muted">全部走 OpenAI 兼容接口。文本和视觉分开配置，都可以设主用和备用。这里不写死任何密钥。</p>
        <form onSubmit={create} className="mt-3 space-y-2">
          <Label>名称</Label>
          <Input name="name" required placeholder="例如 生产文本模型" />
          <Label>厂商</Label>
          <select name="vendor" className="w-full rounded-xl border border-line px-3 py-2" value={vendor} onChange={(e) => setVendor(e.target.value)} data-testid="vendor">
            {Object.keys(vendorUrls).map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
          <Label>Base URL</Label>
          <Input name="base_url" defaultValue={vendorUrls[vendor]} key={vendor} data-testid="base-url" />
          <Label>模型名</Label>
          <Input name="model" required placeholder="以厂商控制台为准" data-testid="model-name" />
          <Label>API key</Label>
          <Input name="api_key" type="password" required placeholder="保存后只显示后 4 位" data-testid="api-key" />
          <label className="flex gap-2 text-sm"><input name="cap_text" type="checkbox" defaultChecked />文本</label>
          <label className="flex gap-2 text-sm"><input name="cap_vision" type="checkbox" />视觉</label>
          <label className="flex gap-2 text-sm"><input name="cap_json" type="checkbox" defaultChecked />JSON 模式</label>
          <Button type="submit">保存模型</Button>
        </form>
      </Card>
      <Card>
        <h2 className="font-semibold">已配置</h2>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <ul className="mt-2 space-y-2 text-sm">
          {(data?.providers || []).map((provider) => (
            <li key={provider.id} className="rounded-xl border border-line p-2">
              <b>{provider.name}</b> · {provider.vendor} · {provider.model} · sk-****{provider.api_key_last4}
              <div className="mt-1 flex gap-2">
                <Button variant="outline" onClick={() => api(`/api/admin/ai-providers/${provider.id}/test?mode=text`, { method: "POST", body: "{}" }).then((res) => setMsg(JSON.stringify(res)))}>测试文本</Button>
                <Button variant="outline" onClick={() => api(`/api/admin/ai-providers/${provider.id}/test?mode=vision`, { method: "POST", body: "{}" }).then((res) => setMsg(JSON.stringify(res)))}>测试视觉</Button>
              </div>
              {provider.last_test_msg ? <p className="text-muted">{provider.last_test_msg}</p> : null}
            </li>
          ))}
          {data && data.providers.length === 0 ? <li className="text-muted">还没有模型。Excel 和文本 PDF 仍可按表头规则解析。</li> : null}
        </ul>
        <form onSubmit={assign} className="mt-4 space-y-2">
          <h3 className="font-semibold">用途分配</h3>
          {(["llm_text_primary", "llm_text_fallback", "llm_vision_primary", "llm_vision_fallback"] as const).map((key) => (
            <label key={key} className="block text-sm">{key}
              <select name={key} className="mt-1 w-full rounded-xl border border-line px-3 py-2" defaultValue={settings.data?.settings?.[key] || ""}>
                <option value="">不使用</option>
                {(data?.providers || []).map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
            </label>
          ))}
          <Button type="submit">保存分配</Button>
        </form>
        {msg ? <p className="mt-2 text-sm">{msg}</p> : null}
      </Card>
    </div>
  );
}

function Users() {
  const { data, error, reload } = useData<{ users: { id: string; phone: string; name: string; role: string }[] }>("/api/admin/users");
  const [temp, setTemp] = useState("");
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const phone = String(form.get("phone"));
    const password = `Tmp${Math.random().toString(36).slice(2, 8)}9A`;
    const client_key = await deriveClientKey(phone, password);
    await api("/api/admin/users", { method: "POST", body: JSON.stringify({ phone, name: form.get("name"), role: form.get("role"), client_key }) });
    setTemp(`${phone} 的临时密码：${password}。请电话告知，对方首次登录必须修改。`);
    reload();
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h1 className="text-xl font-bold">新建顾问</h1>
        <form onSubmit={create} className="mt-3 space-y-2" data-testid="create-user">
          <Input name="name" required placeholder="姓名" data-testid="user-name" />
          <Input name="phone" required placeholder="手机号" data-testid="user-phone" />
          <select name="role" className="w-full rounded-xl border border-line px-3 py-2" data-testid="user-role"><option value="consultant">顾问</option><option value="admin">管理员</option></select>
          <Button type="submit">生成临时密码并创建</Button>
        </form>
        {temp ? <p className="mt-3 text-sm" data-testid="temp-password">{temp}</p> : null}
      </Card>
      <Card>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <ul className="text-sm">{(data?.users || []).map((user) => <li key={user.id} className="border-b border-line py-2">{user.name} · {user.phone} · {user.role}</li>)}</ul>
      </Card>
    </div>
  );
}

function Audit() {
  const { data, error } = useData<{ logs: { id: string; action: string; created_at: string; target_id?: string }[] }>("/api/admin/audit");
  if (error) return <Banner tone="error">{error}</Banner>;
  return <Card><h1 className="text-xl font-bold">审计日志</h1><ul className="mt-3 space-y-1 text-xs">{(data?.logs || []).map((log) => <li key={log.id}>{log.created_at} · {log.action} · {log.target_id}</li>)}{data && data.logs.length === 0 ? <li>还没有记录</li> : null}</ul></Card>;
}

interface BandDraft {
  id: string;
  lowWan: string;
  highWan: string;
  label: string;
}

function draftsFrom(raw: string | undefined): BandDraft[] {
  return parseBands(raw).map((band) => ({
    id: band.id,
    lowWan: String(band.low / 10000),
    highWan: band.high == null ? "" : String(band.high / 10000),
    label: band.label,
  }));
}

function Settings() {
  const { data, error } = useData<{ settings: Record<string, string> }>("/api/admin/settings");
  const [msg, setMsg] = useState("");
  const [bands, setBands] = useState<BandDraft[] | null>(null);
  useEffect(() => {
    if (!data || bands) return;
    setBands(draftsFrom(data.settings.estimate_bands));
  }, [data, bands]);
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data || !bands) return <p>正在读取设置…</p>;
  const rows = bands;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = rows.map((band) => ({
      id: band.id,
      low: Math.round(Number(band.lowWan) * 10000),
      high: band.highWan.trim() === "" ? null : Math.round(Number(band.highWan) * 10000),
      label: band.label.trim(),
    }));
    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          consultant_phone: form.get("consultant_phone"),
          consultant_wechat: form.get("consultant_wechat"),
          wecom_webhook: form.get("wecom_webhook"),
          estimate_bands: JSON.stringify(payload),
        },
      }),
    });
    setMsg("已保存");
  }
  return (
    <Card>
      <h1 className="text-xl font-bold">系统设置</h1>
      <form onSubmit={save} className="mt-3 space-y-3" data-testid="system-settings">
        <Label>顾问电话</Label>
        <Input name="consultant_phone" defaultValue={data.settings.consultant_phone || ""} />
        <Label>顾问微信</Label>
        <Input name="consultant_wechat" defaultValue={data.settings.consultant_wechat || ""} />
        <Label>企业微信机器人 webhook</Label>
        <Input name="wecom_webhook" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
        <div>
          <h2 className="font-semibold">企业可见预估档</h2>
          <p className="text-sm text-muted">金额单位是万元。最后一档可以不填上限，表示“以上”。企业只看到档位，看不到系统测算的具体金额。</p>
          <div className="mt-2 space-y-2">
            {bands.map((band, index) => (
              <div key={band.id} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
                <Input aria-label="下限万元" inputMode="decimal" value={band.lowWan} onChange={(e) => setBands(bands.map((item, i) => i === index ? { ...item, lowWan: e.target.value } : item))} />
                <Input aria-label="上限万元" inputMode="decimal" value={band.highWan} placeholder="以上" onChange={(e) => setBands(bands.map((item, i) => i === index ? { ...item, highWan: e.target.value } : item))} />
                <Input aria-label="档位名称" value={band.label} onChange={(e) => setBands(bands.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} />
                <Button type="button" variant="outline" onClick={() => setBands(bands.filter((_, i) => i !== index))}>删除</Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" className="mt-2" onClick={() => setBands([...bands, { id: `b${bands.length + 1}`, lowWan: "", highWan: "", label: "新档位" }])}>加一档</Button>
        </div>
        <Button type="submit">保存</Button>
      </form>
      {msg ? <p className="mt-2 text-sm">{msg}</p> : null}
    </Card>
  );
}

void useNavigate;
