import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { attachmentError, qrError, ticketFieldError } from "@shared/tickets";
import { api } from "../lib/api";
import { Banner, Button, Card, EmptyState, Input, Label, PageHeader, Textarea } from "../components/ui";

interface ConsultantView {
  assigned: boolean;
  placeholder: string;
  general_phone: string;
  general_wechat: string;
  consultant: { name: string; contact_phone: string; wechat_id: string; has_qr: boolean } | null;
}

interface TicketSummary {
  id: string;
  title: string;
  status: string;
  enterprise_name: string;
  updated_at: string;
  unread: boolean;
}

interface TicketMessage {
  id: string;
  author_name: string;
  author_role: string;
  body: string;
  created_at: string;
  attachments: { id: string; filename: string; mime: string; size: number }[];
}

export function ConsultantCard({ testId }: { testId: string }) {
  const [data, setData] = useState<ConsultantView | null>(null);
  useEffect(() => {
    api<ConsultantView>("/api/consultant").then(setData).catch(() => setData(null));
  }, []);
  return (
    <Card>
      <h2 className="font-semibold text-navy">我的专属顾问</h2>
      <div className="mt-2 space-y-1 text-sm" data-testid={testId}>
        {!data ? <p className="text-muted">顾问信息加载后显示</p> : null}
        {data && !data.assigned ? (
          <>
            <p className="font-semibold text-navy" data-testid={testId === "my-consultant" ? "consultant-state" : undefined}>顾问分配中</p>
            <p data-testid={testId === "my-consultant" ? "general-contact" : undefined}>{data.placeholder}</p>
            {data.general_phone ? <p>通用电话 {data.general_phone}</p> : null}
            {data.general_wechat ? <p>通用微信 {data.general_wechat}</p> : null}
          </>
        ) : null}
        {data?.assigned && data.consultant ? (
          <>
            <p className="font-semibold text-navy" data-testid={testId === "my-consultant" ? "consultant-name" : undefined}>{data.consultant.name}</p>
            <p data-testid={testId === "my-consultant" ? "consultant-phone" : undefined}>电话 {data.consultant.contact_phone || "未留电话"}</p>
            <p data-testid={testId === "my-consultant" ? "consultant-wechat" : undefined}>微信 {data.consultant.wechat_id || "未留微信"}</p>
            {data.consultant.has_qr ? <img className="mt-2 h-28 w-28 rounded-lg border border-line object-cover" alt="微信二维码" src="/api/consultant/qr" data-testid={testId === "my-consultant" ? "consultant-qr" : undefined} /> : null}
          </>
        ) : null}
      </div>
    </Card>
  );
}

async function putBlob(path: string, file: File) {
  const res = await fetch(path, {
    method: "PUT",
    body: file,
    credentials: "include",
    headers: { "content-type": file.type || "application/octet-stream", "x-qice-request": "1" },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "上传失败");
  }
}

async function attachFile(ticketId: string, messageId: string, file: File) {
  const problem = attachmentError(file.type, file.size);
  if (problem) throw new Error(problem);
  const created = await api<{ id: string }>(`/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    body: JSON.stringify({ message_id: messageId, filename: file.name, mime: file.type, size: file.size }),
  });
  await putBlob(`/api/tickets/attachments/${created.id}/content`, file);
}

export function EnterpriseTicketList() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");
  function reload() {
    api<{ tickets: TicketSummary[] }>("/api/tickets").then((res) => setTickets(res.tickets)).catch((err) => setLoadError(err.message));
  }
  useEffect(() => { reload(); }, []);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const titleError = ticketFieldError(title, "标题", 80);
    if (titleError) return setError(titleError);
    const contentError = ticketFieldError(content, "内容", 4000);
    if (contentError) return setError(contentError);
    const file = fileRef.current?.files?.[0];
    if (file) {
      const problem = attachmentError(file.type, file.size);
      if (problem) return setError(problem);
    }
    setBusy(true);
    setError("");
    try {
      const created = await api<{ id: string; message_id: string }>("/api/tickets", {
        method: "POST",
        body: JSON.stringify({ title, content }),
      });
      if (file) await attachFile(created.id, created.message_id, file);
      navigate(`/app/tickets/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader kicker="沟通" title="我的工单" description="把问题和材料发给顾问。处理中可以继续补充，解决后也可以重新打开。" />
      <Card>
        <form noValidate onSubmit={onSubmit} className="space-y-3" data-testid="ticket-create">
          <Label>标题</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="ticket-title" />
          <Label>内容</Label>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} data-testid="ticket-content" />
          <Label>附件（选填，JPG、PNG、WebP 或 PDF，不超过 5MB）</Label>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-testid="ticket-file" />
          {error ? <Banner tone="error"><span data-testid="ticket-error">{error}</span></Banner> : null}
          <Button type="submit" disabled={busy} data-testid="ticket-submit">{busy ? "正在提交…" : "提交工单"}</Button>
        </form>
      </Card>
      {loadError ? <Banner tone="error">{loadError}</Banner> : null}
      {tickets && tickets.length === 0 ? <EmptyState title="还没有工单">提交后可以在这里查看回复。</EmptyState> : null}
      {tickets && tickets.length > 0 ? (
        <div className="overflow-x-auto rounded-[18px] border border-line bg-white">
          <table className="app-table">
            <thead><tr><th>标题</th><th>状态</th></tr></thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td><Link className="font-semibold text-[#1e4fc8]" to={`/app/tickets/${ticket.id}`}>{ticket.title}{ticket.unread ? " · 新回复" : ""}</Link></td>
                  <td>{ticket.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function TicketThread({ base }: { base: "/app" | "/admin" }) {
  const { id = "" } = useParams();
  const [data, setData] = useState<{ ticket: { title: string; status: string; enterprise_name: string; assignee_id: string | null }; messages: TicketMessage[] } | null>(null);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState("");
  const [consultants, setConsultants] = useState<{ id: string; name: string }[]>([]);
  const [assignee, setAssignee] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  function reload() {
    api<{ ticket: { title: string; status: string; enterprise_name: string; assignee_id: string | null }; messages: TicketMessage[] }>(`/api/tickets/${id}`)
      .then((res) => {
        setData(res);
        setAssignee(res.ticket.assignee_id || "");
      })
      .catch((err) => setError(err.message));
  }
  useEffect(() => { reload(); }, [id]);
  useEffect(() => {
    if (base !== "/admin") return;
    api<{ user: { role: string } }>("/api/me").then((res) => {
      setRole(res.user.role);
      if (res.user.role === "admin") {
        api<{ users: { id: string; name: string }[] }>("/api/admin/consultants").then((list) => setConsultants(list.users)).catch(() => setConsultants([]));
      }
    }).catch(() => setRole(""));
  }, [base]);
  async function send(e: FormEvent) {
    e.preventDefault();
    const problem = ticketFieldError(reply, "内容", 4000);
    if (problem) return setError(problem);
    const file = fileRef.current?.files?.[0];
    if (file) {
      const fileProblem = attachmentError(file.type, file.size);
      if (fileProblem) return setError(fileProblem);
    }
    setBusy(true);
    setError("");
    try {
      const created = await api<{ id: string }>(`/api/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ content: reply }) });
      if (file) await attachFile(id, created.id, file);
      setReply("");
      if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }
  async function act(path: string) {
    setError("");
    try {
      await api(path, { method: "POST", body: "{}" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }
  if (error && !data) return <Banner tone="error">{error}</Banner>;
  if (!data) return <p>正在加载工单…</p>;
  return (
    <div className="space-y-4">
      <PageHeader kicker={data.ticket.enterprise_name} title={data.ticket.title} description={`状态：${data.ticket.status}`} />
      <p data-testid="ticket-status">{data.ticket.status}</p>
      <Link className="text-sm font-semibold text-[#1e4fc8]" to={`${base}/tickets`} data-testid="ticket-back">返回工单列表</Link>
      <div className="space-y-3" data-testid="ticket-thread">
        {data.messages.map((message) => (
          <Card key={message.id}>
            <p className="text-sm text-muted">{message.author_name} · {message.author_role === "enterprise" ? "企业" : message.author_role === "admin" ? "管理员" : "顾问"}</p>
            <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
            {message.attachments.map((file) => (
              <a key={file.id} className="mt-2 block text-sm font-semibold text-[#1e4fc8]" href={`/api/tickets/attachments/${file.id}`}>{file.filename}</a>
            ))}
          </Card>
        ))}
      </div>
      <Card>
        <form noValidate onSubmit={send} className="space-y-3">
          <Label>回复</Label>
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} data-testid="ticket-reply" />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-testid="ticket-reply-file" />
          {error ? <Banner tone="error"><span data-testid="ticket-error">{error}</span></Banner> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy} data-testid="ticket-send">{busy ? "正在发送…" : "发送回复"}</Button>
            {base === "/app" && data.ticket.status !== "已解决" ? <Button type="button" variant="outline" data-testid="ticket-close" onClick={() => act(`/api/tickets/${id}/close`)}>关闭工单</Button> : null}
            {base === "/app" && data.ticket.status === "已解决" ? <Button type="button" variant="outline" data-testid="ticket-reopen" onClick={() => act(`/api/tickets/${id}/reopen`)}>重新打开</Button> : null}
          </div>
        </form>
        {base === "/admin" ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {(["待处理", "处理中", "已解决"] as const).map((status) => (
              <Button key={status} type="button" variant="outline" data-testid={`ticket-status-${status}`} onClick={() => api(`/api/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }).then(reload).catch((err) => setError(err.message))}>{status}</Button>
            ))}
          </div>
        ) : null}
        {role === "admin" ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select className="rounded-[11px] border border-[#d8e1ef] px-3 py-2.5 text-[15px]" value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="ticket-assignee">
              <option value="">未指定</option>
              {consultants.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
            <Button type="button" variant="outline" data-testid="ticket-reassign" onClick={() => api(`/api/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ assignee_id: assignee || null }) }).then(() => { setError(""); reload(); }).catch((err) => setError(err.message))}>转派</Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

const TICKET_FILTERS = [
  { id: "", label: "全部", testId: "ticket-filter-all" },
  { id: "待处理", label: "待处理", testId: "ticket-filter-open" },
  { id: "处理中", label: "处理中", testId: "ticket-filter-progress" },
  { id: "已解决", label: "已解决", testId: "ticket-filter-resolved" },
] as const;

export function StaffTicketList() {
  const [filter, setFilter] = useState<(typeof TICKET_FILTERS)[number]["id"]>("待处理");
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const path = filter ? `/api/tickets?status=${encodeURIComponent(filter)}` : "/api/tickets";
    api<{ tickets: TicketSummary[] }>(path).then((res) => setTickets(res.tickets)).catch((err) => setError(err.message));
  }, [filter]);
  return (
    <div className="space-y-4">
      <PageHeader kicker="沟通" title="工单" description="顾问看到自己负责企业的工单。管理员看到全部，也可以转派。" />
      <div className="flex flex-wrap gap-2">
        {TICKET_FILTERS.map((item) => (
          <Button key={item.testId} type="button" variant={filter === item.id ? "primary" : "outline"} data-testid={item.testId} onClick={() => setFilter(item.id)}>{item.label}</Button>
        ))}
      </div>
      <p data-testid="ticket-filter-label">{filter ? `${filter}工单` : "全部工单"}</p>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {tickets && tickets.length === 0 ? <EmptyState title="没有待看的工单">企业提交后会出现在这里。</EmptyState> : null}
      {tickets && tickets.length > 0 ? (
        <div className="overflow-x-auto rounded-[18px] border border-line bg-white">
          <table className="app-table">
            <thead><tr><th>企业</th><th>标题</th><th>状态</th></tr></thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td>{ticket.enterprise_name}</td>
                  <td><Link className="font-semibold text-[#1e4fc8]" to={`/admin/tickets/${ticket.id}`}>{ticket.title}{ticket.unread ? " · 未读" : ""}</Link></td>
                  <td>{ticket.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function StaffProfile() {
  const [phone, setPhone] = useState("");
  const [wechat, setWechat] = useState("");
  const [hasQr, setHasQr] = useState(false);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    api<{ user: { contact_phone?: string; wechat_id?: string; has_qr?: boolean } }>("/api/me").then((res) => {
      if (!live) return;
      setPhone(res.user.contact_phone || "");
      setWechat(res.user.wechat_id || "");
      setHasQr(Boolean(res.user.has_qr));
      setReady(true);
    }).catch((err) => {
      if (!live) return;
      setMsg(err.message);
      setReady(true);
    });
    return () => { live = false; };
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await api("/api/me/contact", { method: "PUT", body: JSON.stringify({ contact_phone: phone, wechat_id: wechat }) });
      setMsg("已保存联系方式");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "保存失败");
    }
  }
  async function uploadQr() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setMsg("请先选择二维码图片");
    const problem = qrError(file.type, file.size);
    if (problem) return setMsg(problem);
    setMsg("");
    try {
      await putBlob("/api/me/contact/qr", file);
      setHasQr(true);
      setMsg("已上传二维码");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "上传失败");
    }
  }
  async function clearQr() {
    setMsg("");
    try {
      await api("/api/me/contact/qr", { method: "DELETE", body: "{}" });
      setHasQr(false);
      setMsg("已删除二维码");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "删除失败");
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader kicker="账号" title="我的资料" description="企业在专属顾问卡片里看到这些联系方式。电话和微信可以留空。" />
      {!ready && !msg ? <p>正在加载资料…</p> : null}
      <Card>
        <form noValidate onSubmit={save} className="space-y-3" data-testid="staff-contact">
          <Label>联系电话</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!ready} data-testid="contact-phone" />
          <Label>微信号</Label>
          <Input value={wechat} onChange={(e) => setWechat(e.target.value)} disabled={!ready} data-testid="contact-wechat" />
          <Button type="submit" disabled={!ready} data-testid="contact-save">保存联系方式</Button>
        </form>
        <div className="mt-4 space-y-2">
          <Label>微信二维码</Label>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={!ready} data-testid="contact-qr" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={!ready} data-testid="contact-qr-upload" onClick={uploadQr}>上传二维码</Button>
            <Button type="button" variant="outline" disabled={!ready || !hasQr} data-testid="contact-qr-clear" onClick={clearQr}>删除二维码</Button>
          </div>
          {hasQr ? <img className="h-28 w-28 rounded-lg border border-line object-cover" alt="我的微信二维码" src="/api/me/contact/qr" /> : null}
        </div>
        {msg ? <p className="mt-3 text-sm" data-testid="contact-msg">{msg}</p> : null}
      </Card>
    </div>
  );
}
