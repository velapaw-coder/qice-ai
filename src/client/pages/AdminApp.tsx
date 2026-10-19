import { useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { zipSync } from "fflate";
import { deriveClientKey } from "@shared/password";
import { formatPublicBand, parseBands, type EstimateBand } from "@shared/bands";
import { formatRange } from "@shared/rules/evaluate";
import { api } from "../lib/api";
import { Banner, BrandMark, Button, Card, EmptyState, Input, Label, PageHeader, StatCard, Textarea, TierBadge } from "../components/ui";
import { ChangePasswordPage } from "./AuthPages";

const groups = [
  { label: "工作台", items: [
    { to: "/admin", label: "待办", icon: "▣", end: true },
    { to: "/admin/enterprises", label: "企业", icon: "◎" },
  ]},
  { label: "成交", items: [
    { to: "/admin/deals/policy", label: "政策线", icon: "▤" },
    { to: "/admin/deals/fde", label: "FDE", icon: "✧" },
  ]},
  { label: "政策", items: [
    { to: "/admin/policies", label: "政策库", icon: "▦" },
    { to: "/admin/policy-drafts", label: "草稿", icon: "✎" },
    { to: "/admin/policy-sources", label: "抓取来源", icon: "⌁" },
    { to: "/admin/crawl-runs", label: "抓取记录", icon: "◷" },
  ]},
  { label: "系统", items: [
    { to: "/admin/ai-settings", label: "模型", icon: "◇" },
    { to: "/admin/users", label: "账号", icon: "○" },
    { to: "/admin/audit", label: "审计", icon: "✓" },
    { to: "/admin/settings", label: "设置", icon: "⚙" },
  ]},
];

const STATUSES = ["待上传", "识别中", "需补传", "待复核", "已发布", "暂不支持", "已撤回"];

function logout() {
  return api("/api/auth/logout", { method: "POST", body: "{}" }).then(() => { window.location.href = "/login"; });
}

export function AdminApp() {
  const [me, setMe] = useState<{ user: { role: string; must_change_password: boolean; name: string } } | null>(null);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => {
    api<{ user: { role: string; must_change_password: boolean; name: string } }>("/api/me").then(setMe).catch((err) => setError(err.message));
  }, []);
  useEffect(() => { setMenu(false); }, [location.pathname]);
  if (error) return <div className="p-6"><Banner tone="error">{error}</Banner><Link to="/login">去登录</Link></div>;
  if (!me) return <p className="p-6 text-sm">正在进入后台…</p>;
  if (me.user.role === "enterprise") return <Navigate to="/app" replace />;
  if (me.user.must_change_password && location.pathname !== "/admin/change-password") return <Navigate to="/admin/change-password" replace />;
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-bg">
      <header className="z-30 flex h-14 shrink-0 items-center gap-3 bg-gradient-to-r from-[#0c1936] to-[#16356f] px-3 text-white" data-testid="admin-header">
        <button type="button" className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 lg:hidden" data-testid="admin-menu" aria-label="打开菜单" onClick={() => setMenu(true)}>☰</button>
        <Link to="/admin" className="flex items-center gap-2 text-lg font-extrabold tracking-tight"><BrandMark light />企策AI</Link>
        <span className="ml-auto hidden text-xs text-[#c3d0e7] sm:inline">顾问工作台</span>
      </header>
      <div className="flex min-h-0 flex-1">
        {menu ? <button type="button" className="fixed inset-0 z-40 bg-[#071126b8] lg:hidden" aria-label="关闭菜单" onClick={() => setMenu(false)} /> : null}
        <aside
          data-testid="admin-drawer"
          className={`${menu ? "flex" : "hidden"} fixed bottom-0 left-0 top-14 z-50 w-64 flex-col bg-gradient-to-b from-[#0c1936] to-[#112a58] text-white lg:static lg:flex`}
        >
          <div className="flex items-center justify-between px-4 py-3 lg:hidden">
            <span className="text-sm text-[#c3d0e7]">菜单</span>
            <button type="button" className="text-xl text-white" data-testid="admin-menu-close" aria-label="关闭菜单" onClick={() => setMenu(false)}>×</button>
          </div>
          <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-2">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-2 text-[11px] font-extrabold tracking-[0.16em] text-[#93a9cb]">{group.label}</p>
                <div className="mt-1 space-y-1">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${isActive ? "bg-white text-[#1e4fc8] shadow-[0_8px_18px_#0003]" : "text-[#d5e2f7] hover:bg-white/10"}`}
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#edf3ff] text-xs text-[#2d62eb]">{item.icon}</span>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t border-white/10 p-3">
            <p className="truncate text-sm font-semibold">{me.user.name}</p>
            <p className="text-xs text-[#93a9cb]">{me.user.role === "admin" ? "管理员" : "顾问"}</p>
            <button type="button" className="mt-2 text-sm font-semibold text-[#9ec0ff]" data-testid="admin-logout" onClick={logout}>退出登录</button>
          </div>
        </aside>
        <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-5">
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
  const { data, error, reload } = useData<{ groups: { key: string; title: string; count: number }[]; lists: Record<string, Record<string, string>[]> }>("/api/admin/todos");
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <p>正在读取待办…</p>;
  return (
    <div className="space-y-4" data-testid="admin-home">
      <PageHeader kicker="工作台" title="待办" description="先处理待复核和企业预约，再看补传、草稿和即将到期的规则。" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {data.groups.map((group) => <StatCard key={group.key} label={group.title} value={group.count} />)}
      </div>
      {data.groups.map((group) => (
        <Card key={group.key}>
          <h2 className="font-semibold text-navy">{group.title}</h2>
          {(data.lists[group.key] || []).length === 0 ? <div className="mt-3"><EmptyState title="暂无">{group.title}里现在没有待处理事项。</EmptyState></div> : (
            <div className="mt-3 overflow-x-auto">
              <table className="app-table">
                <thead><tr><th>事项</th><th>联系方式</th><th>时间</th><th></th></tr></thead>
                <tbody>
                  {(data.lists[group.key] || []).map((row) => (
                    <tr key={row.id}>
                      <td><Link className="font-semibold text-[#1e4fc8]" to={`/admin/enterprises/${row.enterprise_id || row.id}`}>{row.name || row.title || row.id}</Link></td>
                      <td className="text-muted">{row.contact_phone || "—"} {row.city || ""}</td>
                      <td className="text-muted">{row.time?.slice(0, 16).replace("T", " ") || "—"}</td>
                      <td>{group.key === "appointments" ? <button type="button" className="text-sm font-semibold text-[#1e4fc8]" data-testid="appointment-done" onClick={() => api(`/api/admin/appointments/${row.id}`, { method: "PATCH", body: JSON.stringify({ status: "已联系" }) }).then(() => reload())}>已联系</button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function EnterpriseList() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data, error, reload } = useData<{ enterprises: Record<string, string>[]; counts?: Record<string, number> }>(`/api/admin/enterprises?q=${encodeURIComponent(q)}&status=${status}`);
  const counts = data?.counts || {};
  return (
    <div className="space-y-4">
      <PageHeader kicker="工作台" title="企业" description="按状态查看注册企业。点一张统计卡可以只看这一类。" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {STATUSES.map((item) => (
          <StatCard key={item} label={item} value={counts[item] || 0} active={status === item} onClick={() => setStatus(status === item ? "" : item)} />
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="企业名或手机号" value={q} onChange={(e) => setQ(e.target.value)} data-testid="enterprise-search" />
        <select className="rounded-[11px] border border-[#d8e1ef] bg-white px-3" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          {STATUSES.map((item) => <option key={item}>{item}</option>)}
        </select>
        <Button variant="outline" onClick={reload}>查询</Button>
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {data && data.enterprises.length === 0 ? <EmptyState title="没有符合条件的企业">换一个状态，或用企业名、手机号再查一次。</EmptyState> : (
        <div className="overflow-x-auto rounded-[18px] border border-line bg-white shadow-[0_10px_32px_#1d46800a]">
          <table className="app-table">
            <thead><tr><th>企业</th><th>联系人</th><th>状态</th><th>地区</th></tr></thead>
            <tbody>
              {(data?.enterprises || []).map((ent) => (
                <tr key={ent.id}>
                  <td><Link className="font-semibold text-[#1e4fc8]" to={`/admin/enterprises/${ent.id}`}>{ent.name}</Link></td>
                  <td className="text-muted">{ent.contact_name} · {ent.contact_phone}</td>
                  <td>{ent.status}</td>
                  <td className="text-muted">{ent.city || "地区待识别"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EnterpriseDetail() {
  const { id = "" } = useParams();
  const { data, error, reload } = useData<any>(`/api/admin/enterprises/${id}`);
  const [msg, setMsg] = useState("");
  const [bandId, setBandId] = useState("");
  const [dealStage, setDealStage] = useState<Record<string, string>>({});
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
      <PageHeader kicker="企业复核" title={ent.name} description={`${ent.contact_name} · ${ent.status}。核对资料和画像后，选择对企业展示的预估档。`} />
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted"><button className="font-semibold text-[#1e4fc8]" onClick={() => navigator.clipboard.writeText(ent.contact_phone)}>{ent.contact_phone}</button> · 点手机号可复制</p>
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
          <p className="mt-1 text-sm" data-testid="profile-facts">纳税人 {String(value("taxpayer_type") || "待识别")} · 人数 {String(value("headcount") || "待识别")} · 地区 {ent.city || "待补"} · 主体 {ent.entity_type || "待补"}</p>
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
            <Textarea name="note" placeholder="例如：社保清单请导出 Excel 原表" required data-testid="return-note" />
            <Button variant="outline" type="submit" data-testid="return-submit">退回补传</Button>
          </form>
        </Card>
        <Card>
          <h2 className="font-semibold">FDE 成交</h2>
          <form onSubmit={createFde} className="mt-2 space-y-2">
            <Textarea name="need" placeholder="需求描述" data-testid="fde-need" />
            <Button type="submit" data-testid="create-fde">创建 FDE deal</Button>
          </form>
          <div className="mt-3 space-y-3 text-sm">
            {(data.fde_deals || []).map((deal: { id: string; stage: string; need_desc?: string; quote_amount?: number }) => (
              <form key={`${deal.id}-${deal.stage}-${deal.quote_amount || 0}`} className="space-y-2 border-t border-line pt-3" onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                await api(`/api/admin/deals/fde/${deal.id}`, { method: "PATCH", body: JSON.stringify({ stage: String(form.get("stage") || deal.stage), quote_amount: Number(form.get("quote")), quoted_at: new Date().toISOString().slice(0, 10) }) });
                setMsg("报价已保存");
                reload();
              }}>
                <p data-testid="fde-stage-label">{deal.stage} · {deal.need_desc}{deal.quote_amount ? ` · 报价 ${deal.quote_amount}` : ""}</p>
                <Input name="quote" type="number" placeholder="报价金额" required data-testid="fde-quote" defaultValue={deal.quote_amount || ""} />
                <select name="stage" className="w-full rounded-xl border border-line px-3 py-2" defaultValue={deal.stage} data-testid="fde-stage">
                  <option>需求沟通</option>
                  <option>已报价</option>
                </select>
                <Button type="submit" data-testid="fde-quote-save">保存报价</Button>
              </form>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <h2 className="font-semibold">政策成交与兑现</h2>
        {(data.policy_deals || []).map((deal: { id: string; item_name: string; stage: string }) => (
          <div key={deal.id} className="mt-3 border-t border-line pt-3" data-testid={`deal-${deal.item_name}`}>
            <p className="text-sm" data-testid="deal-stage-label">{deal.item_name} · {deal.stage}</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <select className="w-full rounded-xl border border-line px-3 py-2 sm:max-w-xs" data-testid="deal-stage" value={dealStage[deal.id] || deal.stage} onChange={(e) => setDealStage({ ...dealStage, [deal.id]: e.target.value })}>
                {["方案已发", "已签约", "申报中", "已兑现", "终止"].map((stage) => <option key={stage}>{stage}</option>)}
              </select>
              <Button type="button" variant="outline" data-testid="deal-stage-save" onClick={async () => {
                await api(`/api/admin/deals/policy/${deal.id}`, { method: "PATCH", body: JSON.stringify({ stage: dealStage[deal.id] || deal.stage }) });
                setMsg("阶段已更新");
                reload();
              }}>保存阶段</Button>
            </div>
            <form onSubmit={(e) => realize(deal.id, e)} className="mt-2 grid gap-2 md:grid-cols-5">
              <Input name="amount" type="number" placeholder="兑现金额" required data-testid="realize-amount" />
              <Input name="date" type="date" required data-testid="realize-date" />
              <Input name="fee" type="number" placeholder="服务费（内部）" />
              <Input name="proof" placeholder="凭证备注" />
              <Button type="submit" data-testid="realize">记录兑现</Button>
            </form>
          </div>
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
    <div className="space-y-4" data-testid="policy-deals">
      <PageHeader kicker="成交" title="政策线" description={`兑现金额合计 ${data?.totals?.amount || 0} 元，手工服务费合计 ${data?.totals?.fee || 0} 元。收费条款只在后台可见。`} />
      {(data?.deals || []).length === 0 ? <EmptyState title="还没有政策成交">在企业复核页勾选项目后再创建。</EmptyState> : (
        <div className="overflow-x-auto rounded-[18px] border border-line bg-white shadow-[0_10px_32px_#1d46800a]">
          <table className="app-table">
            <thead><tr><th>企业</th><th>项目</th><th>阶段</th><th>收费方式</th></tr></thead>
            <tbody>
              {(data?.deals || []).map((deal) => <tr key={String(deal.id)}><td>{deal.enterprise_name}</td><td>{deal.item_name}</td><td>{deal.stage}</td><td>{deal.fee_terms_text || "线下协商，未填写"}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FdeDeals() {
  const { data, error } = useData<{ deals: Record<string, string | number>[]; totals: { quote: number; purchase: number } }>("/api/admin/deals/fde");
  if (error) return <Banner tone="error">{error}</Banner>;
  return (
    <div className="space-y-4" data-testid="fde-deals">
      <PageHeader kicker="成交" title="FDE" description={`报价合计 ${data?.totals?.quote || 0} 元，采购合计 ${data?.totals?.purchase || 0} 元。`} />
      {(data?.deals || []).length === 0 ? <EmptyState title="还没有 FDE 成交">企业复核页可以单独创建 AI 升级需求。</EmptyState> : (
        <div className="overflow-x-auto rounded-[18px] border border-line bg-white shadow-[0_10px_32px_#1d46800a]">
          <table className="app-table">
            <thead><tr><th>企业</th><th>阶段</th><th>需求</th><th>报价</th></tr></thead>
            <tbody>{(data?.deals || []).map((deal) => <tr key={String(deal.id)}><td>{deal.enterprise_name}</td><td>{deal.stage}</td><td>{deal.need_desc}</td><td>{deal.quote_amount || "—"}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const POLICY_TEMPLATE = `{
  "code": "QA_TRAIN_SUBSIDY",
  "name": "合成培训补贴",
  "category": "就业补贴",
  "regions": ["4403"],
  "entity_types": ["enterprise"],
  "conditions": [{"field": "tax_normal", "op": "eq", "value": true, "level": "hard", "text": "正常经营"}],
  "estimate": null,
  "basis": "合成测试规则，非真实政策",
  "show_when_rejected": false
}`;

function Policies() {
  const { data, error, reload } = useData<{ policies: { id: string; code: string; name: string; status: string; category: string }[] }>("/api/admin/policies");
  const [json, setJson] = useState(POLICY_TEMPLATE);
  const [msg, setMsg] = useState("");
  if (error) return <Banner tone="error">{error}</Banner>;
  return (
    <div className="space-y-4" data-testid="policy-library">
      <PageHeader kicker="政策" title="政策库" description="种子规则都是草稿。只有启用后才会参与匹配。企业端不显示单项金额。" />
      <Card>
        <h2 className="font-semibold text-navy">新建规则</h2>
        <p className="text-sm text-muted">保存后是草稿，需要再点启用才会参与匹配。</p>
        <Textarea className="mt-2 min-h-40 font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} data-testid="policy-json" />
        <Button className="mt-2" data-testid="create-policy" onClick={async () => {
          try {
            const rule = JSON.parse(json);
            await api("/api/admin/policies", { method: "POST", body: JSON.stringify({ rule, basis: rule.basis || "" }) });
            setMsg("已创建为草稿");
            reload();
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "创建失败");
          }
        }}>创建草稿规则</Button>
        {msg ? <p className="mt-2 text-sm" data-testid="policy-create-msg">{msg}</p> : null}
      </Card>
      <div className="overflow-x-auto rounded-[18px] border border-line bg-white shadow-[0_10px_32px_#1d46800a]">
        <table className="app-table">
          <thead><tr><th>政策</th><th>分类</th><th>状态</th><th></th></tr></thead>
          <tbody>
            {(data?.policies || []).map((policy) => (
              <tr key={policy.id}>
                <td><Link to={`/admin/policies/${policy.id}`} className="font-semibold text-[#1e4fc8]">{policy.name}</Link><div className="text-xs text-muted">{policy.code}</div></td>
                <td>{policy.category}</td>
                <td>{policy.status}</td>
                <td className="text-right">{policy.status !== "启用" ? <Button data-testid={`enable-${policy.code}`} onClick={() => api(`/api/admin/policies/${policy.id}/enable`, { method: "POST", body: "{}" }).then(reload)}>启用</Button> : <Button variant="outline" data-testid={`disable-${policy.code}`} onClick={() => api(`/api/admin/policies/${policy.id}/disable`, { method: "POST", body: "{}" }).then(reload)}>停用</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PolicyEdit() {
  const { id = "" } = useParams();
  const { data, error, reload } = useData<{ policy: { name: string; status: string; current_version: number }; version: { definition_json: string; basis: string } }>(`/api/admin/policies/${id}`);
  const versions = useData<{ versions: { version: number; created_at: string }[] }>(`/api/admin/policies/${id}/versions`);
  const enterprises = useData<{ enterprises: { id: string; name: string }[] }>("/api/admin/enterprises");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [enterpriseId, setEnterpriseId] = useState("");
  const [dry, setDry] = useState("");
  useEffect(() => { if (data?.version) setText(data.version.definition_json); }, [data]);
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <p>正在读取规则…</p>;
  const current = data;
  async function save() {
    let rule: unknown;
    try { rule = JSON.parse(text); } catch { return setMsg("JSON 无法解析"); }
    const basis = current.version.basis;
    try {
      const saved = await api<{ version: number }>(`/api/admin/policies/${id}`, { method: "PATCH", body: JSON.stringify({ rule, basis }) });
      setMsg(`已保存为新版本 ${saved.version}，状态不会自动启用`);
      reload();
      versions.reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "保存失败");
    }
  }
  async function dryRun() {
    try {
      const res = await api<{ result: { items: { name: string; tier: string }[]; estimate_low: number; estimate_high: number }; saved: boolean }>(`/api/admin/policies/${id}/dry-run`, { method: "POST", body: JSON.stringify({ enterprise_id: enterpriseId }) });
      const lines = (res.result.items || []).map((item) => `${item.name} ${item.tier}`).join("；") || "没有命中";
      setDry(`${lines} · 测算 ${res.result.estimate_low}-${res.result.estimate_high} · saved ${String(res.saved)}`);
    } catch (err) {
      setDry(err instanceof Error ? err.message : "试算失败");
    }
  }
  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-xl font-bold">{data.policy.name}</h1>
        <p className="text-sm text-muted">状态 {data.policy.status}。当前版本 <span data-testid="policy-version">{data.policy.current_version}</span>。条件和估算直接改 JSON，保存时会校验。</p>
        <Textarea className="mt-3 min-h-80 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} data-testid="policy-json-edit" />
        <Button className="mt-3" onClick={save} data-testid="save-policy-version">保存新版本</Button>
        {msg ? <p className="mt-2 text-sm" data-testid="policy-save-msg">{msg}</p> : null}
        <ul className="mt-3 space-y-1 text-sm" data-testid="policy-versions">
          {(versions.data?.versions || []).map((version) => <li key={version.version}>版本 {version.version} · {version.created_at.slice(0, 19).replace("T", " ")}</li>)}
        </ul>
      </Card>
      <Card>
        <h2 className="font-semibold">试算</h2>
        <p className="text-sm text-muted">只对选中的企业跑这一条规则，不写入方案。</p>
        <select className="mt-2 w-full rounded-xl border border-line px-3 py-2" data-testid="dry-run-enterprise" value={enterpriseId} onChange={(e) => setEnterpriseId(e.target.value)}>
          <option value="">选择企业</option>
          {(enterprises.data?.enterprises || []).map((ent) => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
        </select>
        <Button className="mt-2" type="button" data-testid="dry-run" onClick={dryRun}>试算</Button>
        {dry ? <p className="mt-2 text-sm" data-testid="dry-run-result">{dry}</p> : null}
      </Card>
    </div>
  );
}

function Drafts() {
  const { data, error, reload } = useData<{ drafts: { id: string; title: string; status: string; source_url?: string }[] }>("/api/admin/policy-drafts");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  if (error) return <Banner tone="error">{error}</Banner>;
  return (
    <div className="space-y-3" data-testid="policy-drafts">
      <PageHeader kicker="政策" title="草稿" description="粘贴政策原文，生成待审核草稿。自动抓取的结果也会出现在这里。" />
      <Card>
        <h2 className="font-semibold text-navy">粘贴导入</h2>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="把政策原文贴在这里。PDF 请先在浏览器里复制文本。" data-testid="paste-text" />
        <Button className="mt-2" data-testid="paste-import" onClick={async () => {
          try {
            const res = await api<{ id: string }>("/api/admin/policy-drafts/import", { method: "POST", body: JSON.stringify({ text }) });
            setMsg(res.id === "duplicate" ? "这份正文已经导入过" : "已生成待审核草稿");
            await reload();
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "导入失败");
          }
        }}>生成待审核草稿</Button>
        {msg ? <p className="mt-2 text-sm" data-testid="paste-result">{msg}</p> : null}
      </Card>
      {data && data.drafts.length === 0 ? <EmptyState title="还没有草稿">粘贴原文，或等抓取来源产出待审核记录。</EmptyState> : (
        <div className="overflow-x-auto rounded-[18px] border border-line bg-white shadow-[0_10px_32px_#1d46800a]">
          <table className="app-table">
            <thead><tr><th>标题</th><th>状态</th></tr></thead>
            <tbody>{(data?.drafts || []).map((draft) => <tr key={draft.id}><td><Link className="font-semibold text-[#1e4fc8]" to={`/admin/policy-drafts/${draft.id}`}>{draft.title}</Link></td><td>{draft.status}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DraftDetail() {
  const { id = "" } = useParams();
  const { data, error, reload } = useData<{ draft: { title: string; status: string; suggested_definition_json?: string }; text: string }>(`/api/admin/policy-drafts/${id}`);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { if (data) setText(data.draft.suggested_definition_json || ""); }, [data]);
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <p>正在读取草稿…</p>;
  async function saveJson() {
    let rule: unknown;
    try { rule = JSON.parse(text); } catch { setMsg("JSON 无法解析"); return; }
    try {
      await api(`/api/admin/policy-drafts/${id}`, { method: "PATCH", body: JSON.stringify({ suggested_definition_json: rule }) });
      setMsg("规则已保存");
      reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "保存失败");
    }
  }
  async function adopt() {
    try {
      await api(`/api/admin/policy-drafts/${id}/adopt`, { method: "POST", body: "{}" });
      setMsg("已采纳为草稿规则");
      reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "采纳失败");
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><h2 className="font-semibold">原文</h2><pre className="mt-2 max-h-[70vh] overflow-auto whitespace-pre-wrap text-xs">{data.text || "没有原文"}</pre></Card>
      <Card>
        <h2 className="font-semibold">{data.draft.title}</h2>
        <p className="text-sm" data-testid="draft-status">状态 {data.draft.status}</p>
        <Textarea className="mt-2 min-h-48 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} data-testid="draft-json" placeholder="还没有建议规则。贴上规则 JSON 后再采纳。" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" data-testid="save-draft-json" onClick={saveJson}>保存规则 JSON</Button>
          <Button type="button" data-testid="adopt-draft" onClick={adopt}>采纳为草稿规则</Button>
          <Button type="button" variant="outline" onClick={() => api(`/api/admin/policy-drafts/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: "与现有规则重复或依据不足" }) }).then(() => reload())}>驳回</Button>
        </div>
        {msg ? <p className="mt-2 text-sm" data-testid="draft-msg">{msg}</p> : null}
      </Card>
    </div>
  );
}

function Sources() {
  const { data, error, reload } = useData<{ sources: { id: string; name: string; enabled: number; list_url: string; last_status?: string }[] }>("/api/admin/policy-sources");
  if (error) return <Banner tone="error">{error}</Banner>;
  return (
    <div className="space-y-4">
    <PageHeader kicker="政策" title="抓取来源" description="默认停用。上线前逐个试抓，确认能访问再启用。自动抓取失败不影响企业方案。" />
    <Card>
      <ul className="mt-3 space-y-3 text-sm">
        {(data?.sources || []).map((source) => (
          <li key={source.id} className="border-b border-line pb-2">
            <b>{source.name}</b> · {source.enabled ? "启用" : "停用"} · {source.last_status || "未抓取"}
            <p className="truncate text-muted">{source.list_url}</p>
            <Button variant="outline" data-testid={`source-toggle-${source.id}`} onClick={() => api(`/api/admin/policy-sources/${source.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !source.enabled }) }).then(reload)}>{source.enabled ? "停用" : "启用"}</Button>
          </li>
        ))}
      </ul>
      <Button className="mt-3" onClick={() => api("/api/admin/crawl-runs", { method: "POST", body: JSON.stringify({ type: "initial" }) })}>首次批量抓取</Button>
    </Card>
    </div>
  );
}

function Crawls() {
  const { data, error } = useData<{ runs: Record<string, string | number>[] }>("/api/admin/crawl-runs");
  if (error) return <Banner tone="error">{error}</Banner>;
  return (
    <div className="space-y-4" data-testid="crawl-runs">
      <PageHeader kicker="政策" title="抓取记录" description="每次手动或定时抓取都会留下一条记录。" />
      {data && data.runs.length === 0 ? <EmptyState title="还没有运行记录">从来源页发起首次批量抓取后，结果会出现在这里。</EmptyState> : (
        <div className="overflow-x-auto rounded-[18px] border border-line bg-white shadow-[0_10px_32px_#1d46800a]">
          <table className="app-table">
            <thead><tr><th>类型</th><th>状态</th><th>新草稿</th><th>失败来源</th></tr></thead>
            <tbody>{(data?.runs || []).map((run) => <tr key={String(run.id)}><td>{run.type}</td><td>{run.status}</td><td>{run.drafts_created}</td><td>{run.sources_failed}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
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
    if (form.get("privacy_ack") !== "on") {
      setMsg("请先确认隐私政策中的受托方信息");
      return;
    }
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
    <div className="space-y-4" data-testid="ai-settings">
      <PageHeader kicker="系统" title="模型" description="全部走 OpenAI 兼容接口。文本和视觉分开配置，都可以设主用和备用。这里不写死任何密钥。" />
      <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="font-semibold text-navy">添加模型</h2>
        <form onSubmit={create} className="mt-3 space-y-2">
          <Label>名称</Label>
          <Input name="name" required placeholder="例如 生产文本模型" data-testid="provider-name" />
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
          <label className="flex gap-2 text-sm"><input name="cap_text" type="checkbox" defaultChecked data-testid="cap-text" />文本</label>
          <label className="flex gap-2 text-sm"><input name="cap_vision" type="checkbox" data-testid="cap-vision" />视觉</label>
          <label className="flex gap-2 text-sm"><input name="cap_json" type="checkbox" defaultChecked />JSON 模式</label>
          <label className="flex gap-2 text-sm"><input name="privacy_ack" type="checkbox" required data-testid="privacy-ack" />已确认隐私政策中的受托方信息</label>
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
                <Button variant="outline" data-testid="test-text" onClick={() => api(`/api/admin/ai-providers/${provider.id}/test?mode=text`, { method: "POST", body: "{}" }).then((res) => setMsg(JSON.stringify(res)))}>测试文本</Button>
                <Button variant="outline" data-testid="test-vision" onClick={() => api(`/api/admin/ai-providers/${provider.id}/test?mode=vision`, { method: "POST", body: "{}" }).then((res) => setMsg(JSON.stringify(res)))}>测试视觉</Button>
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
          <Button type="submit" data-testid="save-assignment">保存分配</Button>
        </form>
        {msg ? <p className="mt-2 text-sm" data-testid="model-test-result">{msg}</p> : null}
      </Card>
      </div>
    </div>
  );
}

function Users() {
  const { data, error, reload } = useData<{ users: { id: string; phone: string; name: string; role: string }[] }>("/api/admin/users");
  const [temp, setTemp] = useState("");
  async function reset(user: { id: string; phone: string }) {
    const password = `Rst${Math.random().toString(36).slice(2, 8)}9A`;
    const client_key = await deriveClientKey(user.phone, password);
    await api(`/api/admin/users/${user.id}/reset-password`, { method: "POST", body: JSON.stringify({ client_key }) });
    setTemp(`${user.phone} 的临时密码：${password}。对方下次登录必须修改。`);
  }
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
    <div className="space-y-4">
      <PageHeader kicker="系统" title="账号" description="生成临时密码后电话告知。对方首次登录必须修改密码。" />
      <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="font-semibold text-navy">新建顾问</h2>
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
        {(data?.users || []).length === 0 ? <EmptyState title="还没有账号" /> : (
          <table className="app-table">
            <thead><tr><th>姓名</th><th>手机号</th><th>角色</th><th></th></tr></thead>
            <tbody>{(data?.users || []).map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.phone}</td><td>{user.role}</td><td><button type="button" className="text-sm font-semibold text-[#1e4fc8]" data-testid={`reset-${user.phone}`} onClick={() => reset(user)}>重置密码</button></td></tr>)}</tbody>
          </table>
        )}
      </Card>
      </div>
    </div>
  );
}

function Audit() {
  const { data, error } = useData<{ logs: { id: string; action: string; created_at: string; target_id?: string }[] }>("/api/admin/audit");
  if (error) return <Banner tone="error">{error}</Banner>;
  return (
    <div className="space-y-4">
      <PageHeader kicker="系统" title="审计" description="登录后的关键操作会留在这里，包括授权、上传和发布。" />
      {data && data.logs.length === 0 ? <EmptyState title="还没有记录" /> : (
        <div className="overflow-x-auto rounded-[18px] border border-line bg-white shadow-[0_10px_32px_#1d46800a]" data-testid="audit-log">
          <table className="app-table">
            <thead><tr><th>时间</th><th>动作</th><th>对象</th></tr></thead>
            <tbody>{(data?.logs || []).map((log) => <tr key={log.id}><td className="whitespace-nowrap text-muted">{log.created_at.replace("T", " ").slice(0, 19)}</td><td>{log.action}</td><td className="text-muted">{log.target_id}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
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
    <div className="space-y-4">
    <PageHeader kicker="系统" title="设置" description="顾问联系方式和对企业展示的预估档。企业只看到档位，看不到系统测算的具体金额。" />
    <Card>
      <form onSubmit={save} className="mt-3 space-y-3" data-testid="system-settings">
        <Label>顾问电话</Label>
        <Input name="consultant_phone" defaultValue={data.settings.consultant_phone || ""} data-testid="consultant-phone" />
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
        <Button type="submit" data-testid="save-settings">保存</Button>
      </form>
      {msg ? <p className="mt-2 text-sm" data-testid="settings-saved">{msg}</p> : null}
    </Card>
    </div>
  );
}

void useNavigate;
