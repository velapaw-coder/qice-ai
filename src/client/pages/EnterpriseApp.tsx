import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { formatRange, DISCLAIMER } from "@shared/rules/evaluate";
import { api, putFile } from "../lib/api";
import { compressImage, extractionFromPdfText, maybeConvertHeic, parseSpreadsheet, readPdf } from "../lib/files";
import { recognizePages } from "../lib/vision";
import { Banner, Button, Card, Input, Label, Textarea, TierBadge } from "../components/ui";
import { ChangePasswordPage } from "./AuthPages";

interface Me {
  user: { role: string; must_change_password: boolean; phone: string; name: string };
  enterprise: { id: string; name: string; status: string; status_note?: string; warnings?: string[] } | null;
}

export function EnterpriseApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const location = useLocation();
  useEffect(() => {
    api<Me>("/api/me").then(setMe).catch((err) => setError(err.message));
  }, [location.pathname]);
  if (error) return <div className="p-6"><Banner tone="error">{error}</Banner><Link to="/login">去登录</Link></div>;
  if (!me) return <p className="p-6 text-sm text-muted">正在读取账号…</p>;
  if (me.user.role !== "enterprise") return <Navigate to="/admin" replace />;
  if (me.user.must_change_password && location.pathname !== "/app/change-password") return <Navigate to="/app/change-password" replace />;
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-bg">
      <header className="no-print z-30 shrink-0 border-b border-line bg-white">
        <div className="mx-auto flex min-h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Link to="/app" className="shrink-0 font-extrabold text-navy">企策AI</Link>
          <nav className="flex gap-3 overflow-x-auto text-sm whitespace-nowrap">
            <Link to="/app/upload">资料</Link>
            <Link to="/app/report">方案</Link>
            <Link to="/app/settings">设置</Link>
          </nav>
        </div>
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
    <Card>
      <p className="text-sm text-muted">{me.enterprise?.name}</p>
      <h1 className="mt-1 text-xl font-bold" data-testid="status-title">{status}</h1>
      <p className="mt-2 text-sm" data-testid="status-message">{text[status]}</p>
      {status === "需补传" ? <Banner tone="error">{me.enterprise?.status_note}</Banner> : null}
      <div className="mt-4 flex gap-2">
        {["待上传", "识别中", "需补传"].includes(status) ? <Button asChild><Link to="/app/upload">去上传</Link></Button> : null}
        {status === "已发布" ? <Button asChild><Link to="/app/report">查看方案</Link></Button> : null}
      </div>
    </Card>
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

function UploadPage({ me }: { me: Me }) {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const fileSeq = useRef(0);
  const [error, setError] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [consent, setConsent] = useState("");
  const [checks, setChecks] = useState({ main: false, cross: false });
  const navigate = useNavigate();
  useEffect(() => {
    api<{ template: { content_md: string } | null; active: boolean }>("/api/consent/current")
      .then((row) => {
        setConsent(row.template?.content_md || "");
        setAgreed(row.active);
      })
      .catch((err) => setError(err.message));
  }, []);
  async function agree(e: FormEvent) {
    e.preventDefault();
    if (!checks.main || !checks.cross) return setError("请分别勾选两项授权");
    await api("/api/consent", { method: "POST", body: JSON.stringify({ main_agreed: true, cross_border_agreed: true }) });
    setAgreed(true);
    setError("");
  }
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
      <Card>
        <h1 className="text-xl font-bold">上传两份资料</h1>
        <p className="mt-2 text-sm text-muted">有 Excel 原件时优先上传原件。文件较大时建议用电脑上传。手机微信里如果选不到聊天文件，可以拍照，或把链接发给电脑。</p>
        <div className="mt-3 rounded-xl bg-bg p-3 text-sm">
          <b>资料在电脑上？</b>
          <p className="text-muted">复制链接，用电脑浏览器或电脑版微信打开，登录后上传。</p>
          <Button type="button" variant="outline" className="mt-2" onClick={() => navigator.clipboard.writeText(link)}>复制上传链接</Button>
        </div>
      </Card>
      {!agreed ? (
        <Card>
          <h2 className="font-semibold">数据授权</h2>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-6 text-muted">{consent || "正在读取授权书…"}</pre>
          <form onSubmit={agree} className="mt-3 space-y-2 text-sm" data-testid="consent-form">
            <label className="flex gap-2"><input type="checkbox" checked={checks.main} onChange={(e) => setChecks({ ...checks, main: e.target.checked })} data-testid="consent-main" />我已阅读并同意《数据处理授权书》，并确认我方已就所提供的员工个人信息取得合法授权或具备合法处理依据。</label>
            <label className="flex gap-2"><input type="checkbox" checked={checks.cross} onChange={(e) => setChecks({ ...checks, cross: e.target.checked })} data-testid="consent-cross" />我知悉并单独同意：试点期间资料将存储并处理在中华人民共和国境外的 Cloudflare 服务器上。</label>
            <Button type="submit">确认授权</Button>
          </form>
        </Card>
      ) : null}
      <Card>
        <h2 className="font-semibold">最近一年增值税申报表</h2>
        <p className="text-sm text-muted">可多选，月报或季报都可以，最多 30 个文件。</p>
        <Input className="mt-2" type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.heic" disabled={!agreed} data-testid="vat-file" onChange={(e) => onPick("vat", e.target.files)} />
      </Card>
      <Card>
        <h2 className="font-semibold">最新一个月社保清单</h2>
        <p className="text-sm text-muted">最多 10 个文件，照片可以一页一张。</p>
        <Input className="mt-2" type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.heic" disabled={!agreed} data-testid="ss-file" onChange={(e) => onPick("social_security", e.target.files)} />
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
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button disabled={!agreed} data-testid="submit" onClick={() => submit(false)}>提交资料</Button>
        <Button variant="outline" disabled={!agreed} data-testid="manual-submit" onClick={() => submit(true)}>交给顾问处理</Button>
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
    return <Card><h1 className="text-xl font-bold">{String(data.status)}</h1><p className="mt-2 text-sm" data-testid="status-message">{String(data.message || "")}</p></Card>;
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
    <div className="space-y-4 pb-24" data-testid="report-page">
      <Card>
        <p className="text-sm text-muted">整体预估区间</p>
        <h1 className="mt-1 text-2xl font-bold text-navy" data-testid="estimate">{formatRange(Number(data.estimate_low || 0), Number(data.estimate_high || 0))}</h1>
        <p className="mt-3 text-sm leading-6" data-testid="disclaimer">{DISCLAIMER}</p>
      </Card>
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
      <form onSubmit={book} className="no-print space-y-3 rounded-2xl border border-line bg-white p-4" data-testid="appointment-form">
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
    setMessage("授权已撤回，资料将在 7 天内删除。重新授权后可以继续上传。");
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
      <Card>
        <h1 className="text-xl font-bold">设置</h1>
        <div className="mt-4 flex flex-col gap-2">
          <Button asChild variant="outline"><Link to="/app/change-password">修改密码</Link></Button>
          <Button variant="danger" onClick={revoke} data-testid="revoke">撤回授权</Button>
          <Button variant="danger" onClick={remove}>申请删除资料</Button>
          <Button variant="ghost" onClick={logout} data-testid="logout">退出登录</Button>
        </div>
        {message ? <p className="mt-3 text-sm">{message}</p> : null}
      </Card>
    </div>
  );
}
