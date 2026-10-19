import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { DISCLAIMER } from "@shared/rules/evaluate";
import { api, putFile } from "../lib/api";
import { compressImage, extractionFromPdfText, maybeConvertHeic, parseSpreadsheet, readPdf } from "../lib/files";
import { recognizePages } from "../lib/vision";
import { Banner, BrandMark, Button, Card, Input, Label, PageHeader, Textarea, TierBadge } from "../components/ui";
import { ChangePasswordPage } from "./AuthPages";

interface Me {
  user: { role: string; must_change_password: boolean; phone: string; name: string };
  enterprise: { id: string; name: string; status: string; status_note?: string; warnings?: string[] } | null;
}

export function EnterpriseApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => {
    api<Me>("/api/me").then(setMe).catch((err) => setError(err.message));
  }, [location.pathname]);
  useEffect(() => { setMenu(false); }, [location.pathname]);
  if (error) return <div className="p-6"><Banner tone="error">{error}</Banner><Link to="/login">去登录</Link></div>;
  if (!me) return <p className="p-6 text-sm text-muted">正在读取账号…</p>;
  if (me.user.role !== "enterprise") return <Navigate to="/admin" replace />;
  if (me.user.must_change_password && location.pathname !== "/app/change-password") return <Navigate to="/app/change-password" replace />;
  const step = progressIndex(me.enterprise?.status || "待上传");
  const nav = [
    ["/app/upload", "资料"],
    ["/app/report", "方案"],
    ["/app/settings", "设置"],
  ];
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-bg">
      <header className="no-print z-30 shrink-0 bg-gradient-to-r from-[#0c1936] to-[#16356f] text-white">
        <div className="mx-auto flex min-h-16 max-w-3xl items-center justify-between gap-3 px-4">
          <button type="button" className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 sm:hidden" data-testid="enterprise-menu" aria-label="打开菜单" onClick={() => setMenu(true)}>☰</button>
          <Link to="/app" className="flex shrink-0 items-center gap-2 text-lg font-extrabold tracking-tight"><BrandMark light />企策AI</Link>
          <nav className="hidden gap-1 text-sm whitespace-nowrap sm:flex">
            {nav.map(([path, label]) => (
              <Link key={path} to={path} className={`rounded-full px-3 py-1.5 font-semibold ${location.pathname.startsWith(path) ? "bg-white text-[#1e4fc8]" : "text-[#d5e2f7]"}`}>{label}</Link>
            ))}
          </nav>
        </div>
        {menu ? (
          <div className="space-y-2 border-t border-white/10 px-4 py-3 sm:hidden" data-testid="enterprise-drawer">
            <div className="flex justify-end"><button type="button" className="text-xl" data-testid="enterprise-menu-close" aria-label="关闭菜单" onClick={() => setMenu(false)}>×</button></div>
            {nav.map(([path, label]) => (
              <Link key={path} to={path} className="block rounded-xl px-3 py-2 font-semibold text-[#d5e2f7]">{label}</Link>
            ))}
          </div>
        ) : null}
        <ol className="mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 pb-4" data-testid="progress-steps">
          {["注册", "上传", "识别", "顾问复核", "方案"].map((label, index) => {
            const state = index < step ? "done" : index === step ? "current" : "todo";
            return (
              <li key={label} className={`min-w-[4.5rem] flex-1 rounded-xl px-2 py-2 text-center ${state === "current" ? "bg-white text-[#1e4fc8]" : state === "done" ? "bg-white/15 text-white" : "bg-white/5 text-[#93a9cb]"}`}>
                <span className="block text-[11px] font-extrabold">{String(index + 1).padStart(2, "0")}</span>
                <span className="block text-xs font-semibold">{label}</span>
              </li>
            );
          })}
        </ol>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-5">
        <Routes>
          <Route index element={<StatusHome me={me} />} />
          <Route path="upload" element={<UploadPage me={me} />} />
          <Route path="report" element={<ReportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="change-password" element={<ChangePasswordPage next="/app" />} />
        </Routes>
        </div>
      </main>
    </div>
  );
}

function progressIndex(status: string) {
  if (status === "识别中") return 2;
  if (status === "待复核" || status === "暂不支持") return 3;
  if (status === "已发布") return 4;
  return 1;
}

function StatusHome({ me }: { me: Me }) {
  const status = me.enterprise?.status || "待上传";
  const text: Record<string, string> = {
    待上传: "请上传两份资料",
    识别中: "正在识别资料，请保持页面打开",
    需补传: me.enterprise?.status_note || "请按提示补充资料",
    待复核: "系统已出初稿，顾问正在复核，复核后会电话联系您",
    暂不支持: "您的主体类型暂不在线上服务范围内，顾问会与您联系",
    已发布: "方案已发布，可以查看并预约顾问",
    已撤回: "授权已撤回，资料将在 7 天内删除",
  };
  return (
    <div className="space-y-4">
      <PageHeader kicker={me.enterprise?.name || "企业门户"} title="办理进度" description="注册之后，按上传、识别、顾问复核，直到方案发布。" />
      <Card>
      <h1 className="text-2xl font-extrabold tracking-tight text-navy" data-testid="status-title">{status}</h1>
      <p className="mt-2 text-sm text-muted" data-testid="status-message">{text[status]}</p>
      {status === "需补传" ? <Banner tone="error">{me.enterprise?.status_note}</Banner> : null}
      <div className="flex gap-2">
        {["待上传", "识别中", "需补传"].includes(status) ? <Button asChild><Link to="/app/upload">去上传</Link></Button> : null}
        {status === "已发布" ? <Button asChild><Link to="/app/report">查看方案</Link></Button> : null}
      </div>
      </Card>
    </div>
  );
}

interface LocalFile {
  id: number;
  name: string;
  state: string;
}

async function registerAndUpload(kind: "vat" | "social_security", file: File, onState: (s: string) => void) {
  onState("正在识别");
  let blob: Blob = file;
  let source = "excel";
  let extraction = null as Awaited<ReturnType<typeof parseSpreadsheet>> | null;
  const derived: Blob[] = [];
  if (/\.(xlsx|xls|csv)$/i.test(file.name)) {
    extraction = await parseSpreadsheet(file);
    source = "excel";
  } else if (/\.pdf$/i.test(file.name)) {
    onState("正在读取 PDF");
    const pdf = await readPdf(file);
    if (pdf.pages.length) {
      source = "pdf_scan";
      onState("正在调用视觉模型");
      for (const page of pdf.pages) derived.push(await compressImage(page, 2_500_000));
      extraction = await recognizePages(kind, derived);
    } else {
      source = "pdf_text";
      extraction = extractionFromPdfText(pdf.text, file.name);
    }
  } else if (/\.(jpe?g|png|heic|webp)$/i.test(file.name) || file.type.startsWith("image/")) {
    onState("正在压缩图片");
    const converted = await maybeConvertHeic(file);
    blob = await compressImage(converted, 2_500_000);
    source = "image";
    onState("正在调用视觉模型");
    extraction = await recognizePages(kind, [blob]);
  } else {
    throw new Error("请上传 Excel、CSV、PDF、JPG、PNG 或 HEIC");
  }
  onState("正在上传");
  const meta = await api<{ id: string }>("/api/files", {
    method: "POST",
    body: JSON.stringify({ kind, source_type: source, filename: file.name, size: blob.size, mime: blob.type || file.type }),
  });
  await putFile(meta.id, blob, blob.type || file.type || "application/octet-stream");
  for (const [index, page] of derived.entries()) {
    const child = await api<{ id: string }>("/api/files", {
      method: "POST",
      body: JSON.stringify({ kind, source_type: "image", filename: `${file.name}-p${index + 1}.jpg`, size: page.size, mime: "image/jpeg", parent_file_id: meta.id }),
    });
    await putFile(child.id, page, "image/jpeg");
  }
  if (extraction) {
    await api(`/api/files/${meta.id}/extraction`, { method: "PUT", body: JSON.stringify(extraction) });
    onState(extraction.parse_status === "success" ? "识别完成" : extraction.parse_note);
  }
}

function UploadConsentLine({ marked = false }: { marked?: boolean }) {
  return (
    <p className="text-xs leading-5 text-muted" data-testid={marked ? "upload-consent" : undefined}>
      上传即表示同意<Link className="text-brand" to="/legal/consent" target="_blank" rel="noreferrer" data-testid={marked ? "link-consent" : undefined}>《数据授权书》</Link><Link className="text-brand" to="/legal/privacy" target="_blank" rel="noreferrer" data-testid={marked ? "link-privacy" : undefined}>《隐私政策》</Link>（含资料存放于境外服务器）
    </p>
  );
}

function UploadPage({ me }: { me: Me }) {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const fileSeq = useRef(0);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  async function onPick(kind: "vat" | "social_security", list: FileList | null) {
    if (!list?.length) return;
    setError("");
    for (const file of [...list]) {
      const id = ++fileSeq.current;
      setFiles((prev) => [...prev, { id, name: file.name, state: "排队" }]);
      const patch = (state: string) => setFiles((prev) => prev.map((item) => (item.id === id ? { ...item, state } : item)));
      try {
        await registerAndUpload(kind, file, patch);
      } catch (err) {
        const message = err instanceof Error ? err.message : "上传失败";
        patch(message);
        setError(message);
      }
    }
  }
  async function submit(manual: boolean) {
    setError("");
    try {
      const res = await api<{ status: string }>("/api/submit", { method: "POST", body: JSON.stringify({ manual }) });
      navigate(res.status === "已发布" ? "/app/report" : "/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    }
  }
  const link = typeof window === "undefined" ? "" : window.location.origin + "/app/upload";
  return (
    <div className="space-y-4" data-testid="upload-page">
      <PageHeader kicker="上传资料" title="两份表就够开始" description="有 Excel 原件时优先上传原件。文件较大时建议用电脑。手机里如果选不到聊天文件，可以拍照，或把链接发给电脑。" />
      <Card>
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[15px] bg-[#edf3ff] text-xl text-[#2d62eb]">▣</span>
          <div>
            <h2 className="font-semibold text-navy">资料在电脑上？</h2>
            <p className="text-sm text-muted">复制链接，用电脑浏览器或电脑版微信打开，登录后上传。</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => navigator.clipboard.writeText(link)}>复制上传链接</Button>
          </div>
        </div>
      </Card>
      <Card>
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[15px] bg-[#edf3ff] text-xl text-[#2d62eb]">▤</span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-navy">最近一年增值税申报表</h2>
            <p className="text-sm text-muted">可多选，月报或季报都可以，最多 30 个文件。</p>
            <Input className="mt-3 file:mr-3 file:rounded-[11px] file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-bold file:text-white" type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.heic" data-testid="vat-file" onChange={(e) => onPick("vat", e.target.files)} />
            <div className="mt-2"><UploadConsentLine marked /></div>
          </div>
        </div>
      </Card>
      <Card>
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[15px] bg-[#edf3ff] text-xl text-[#2d62eb]">▥</span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-navy">最新一个月社保清单</h2>
            <p className="text-sm text-muted">最多 10 个文件，照片可以一页一张。</p>
            <Input className="mt-3 file:mr-3 file:rounded-[11px] file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-bold file:text-white" type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.heic" data-testid="ss-file" onChange={(e) => onPick("social_security", e.target.files)} />
            <div className="mt-2"><UploadConsentLine /></div>
          </div>
        </div>
      </Card>
      {files.length ? (
        <Card>
          <h2 className="font-semibold">识别进度</h2>
          <ul className="mt-2 space-y-1 text-sm" data-testid="file-progress">
            {files.map((file) => <li key={file.id} className="flex justify-between gap-3"><span className="truncate">{file.name}</span><span>{file.state}</span></li>)}
          </ul>
        </Card>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {me.enterprise?.status_note && me.enterprise.status === "需补传" ? <Banner tone="warn">{me.enterprise.status_note}</Banner> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button data-testid="submit" onClick={() => submit(false)}>提交资料</Button>
        <Button variant="outline" data-testid="manual-submit" onClick={() => submit(true)}>交给顾问处理</Button>
      </div>
    </div>
  );
}

function ReportPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  useEffect(() => {
    api<Record<string, unknown>>("/api/report").then(setData).catch((err) => setError(err.message));
  }, []);
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <p className="text-sm text-muted">正在读取方案…</p>;
  if (!data.published) {
    return (
      <div className="space-y-4">
        <PageHeader kicker="方案" title={String(data.status)} description={String(data.message || "")} />
        <p className="sr-only" data-testid="status-message">{String(data.message || "")}</p>
      </div>
    );
  }
  const items = (data.items as { name: string; category: string; tier: string; verify_text?: string; reason?: string }[]) || [];
  const groups = ["go", "verify", "reject"].map((tier) => ({ tier, items: items.filter((item) => item.tier === tier) }));
  async function book(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await api("/api/appointments", {
      method: "POST",
      body: JSON.stringify({ slot_pref: form.get("slot"), topic: form.get("topic"), note: form.get("note") }),
    });
    setSent(true);
  }
  return (
    <div className="space-y-4 pb-8" data-testid="report-page">
      <PageHeader kicker="初步方案" title="顾问复核后的结果" description="下面是对企业展示的预估档和可申报项目。单项金额不会出现在这里。" />
      <section className="overflow-hidden rounded-[22px] bg-gradient-to-br from-[#13316b] to-[#285ee0] p-6 text-white shadow-[0_20px_50px_#213c7020]">
        <p className="text-sm text-[#cbdafc]">整体预估</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight" data-testid="estimate">{String(data.public_estimate || "")}</h1>
        <p className="mt-3 text-sm text-white" data-testid="estimate-note">具体金额以顾问沟通为准</p>
        <p className="mt-3 text-sm leading-6 text-[#d5e4ff]" data-testid="disclaimer">{DISCLAIMER}</p>
      </section>
      <h2 className="text-lg font-extrabold tracking-tight text-navy">可申报项目</h2>
      <div data-testid="claim-list" className="space-y-4">
      {groups.map((group) => group.items.length ? (
        <div key={group.tier} className="space-y-2">
          {group.items.map((item) => (
            <Card key={item.name} className="print-block">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{item.name}</h2>
                  <p className="text-xs text-muted">{item.category}</p>
                </div>
                <TierBadge tier={item.tier} />
              </div>
              {item.verify_text ? <p className="mt-2 text-sm">{item.tier === "go" ? "待确认" : "需核实"}：{item.verify_text}</p> : null}
              {item.reason ? <p className="mt-2 text-sm text-muted">原因：{item.reason}</p> : null}
            </Card>
          ))}
        </div>
      ) : null)}
      </div>
      <form onSubmit={book} className="no-print space-y-3 rounded-[18px] border border-line bg-white p-5 shadow-[0_10px_32px_#1d46800a]" data-testid="appointment-form">
        <h2 className="font-semibold">预约顾问沟通</h2>
        <Label>时间</Label>
        <select name="slot" className="w-full rounded-xl border border-line px-3 py-2" data-testid="slot">
          <option value="工作日上午">工作日上午</option>
          <option value="工作日下午">工作日下午</option>
          <option value="随时">随时</option>
        </select>
        <Label>方向</Label>
        <select name="topic" className="w-full rounded-xl border border-line px-3 py-2" data-testid="topic">
          <option value="policy">政策申报</option>
          <option value="fde">AI 升级</option>
          <option value="both">都想聊</option>
        </select>
        <Textarea name="note" placeholder="可选备注" />
        <Button type="submit" data-testid="book">提交预约</Button>
        {sent ? <Banner>已提交，顾问会按您留的手机号联系。</Banner> : null}
      </form>
    </div>
  );
}

function SettingsPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  async function revoke() {
    await api("/api/privacy/revoke", { method: "POST", body: "{}" });
    setMessage("授权已撤回，资料将在 7 天内删除。");
  }
  async function remove() {
    await api("/api/privacy/delete-request", { method: "POST", body: "{}" });
    setMessage("已提交删除申请。");
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    navigate("/login");
  }
  return (
    <div className="space-y-4">
      <PageHeader kicker="账号" title="设置" description="修改密码、撤回授权，或申请删除已上传的资料。" />
      <Card>
        <div className="mt-4 flex flex-col gap-2">
          <Button asChild variant="outline" data-testid="change-password-link"><Link to="/app/change-password">修改密码</Link></Button>
          <Button variant="danger" onClick={revoke} data-testid="revoke">撤回授权</Button>
          <Button variant="danger" onClick={remove}>申请删除资料</Button>
          <Button variant="ghost" onClick={logout} data-testid="logout">退出登录</Button>
        </div>
        {message ? <p className="mt-3 text-sm">{message}</p> : null}
      </Card>
    </div>
  );
}
