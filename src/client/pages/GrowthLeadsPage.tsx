import { useEffect, useState } from "react";
import { GROWTH_LEAD_STATUSES, growthIntentLabel, growthSourceLabel, shanghaiLocalInput, type GrowthLeadStatus } from "@shared/growthLead";
import { formatShanghai } from "@shared/policyPage";
import { api } from "../lib/api";
import { Banner, Button, EmptyState, PageHeader } from "../components/ui";

type Lead = {
  id: string;
  source: string;
  intent: string;
  company_name: string;
  contact_name: string;
  phone: string;
  industry: string;
  pain: string;
  status: GrowthLeadStatus;
  created_at: string;
  assignee_id: string | null;
  assignee_name: string | null;
  next_follow_up_at: string | null;
};

type Note = { id: string; body: string; created_at: string; author_name: string | null };
type Staff = { id: string; name: string; role: string };

export function GrowthLeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [notes, setNotes] = useState<Record<string, Note[]>>({});
  const [staff, setStaff] = useState<Staff[]>([]);
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [times, setTimes] = useState<Record<string, string>>({});

  function load() {
    api<{ leads: Lead[] }>("/api/admin/growth-leads")
      .then((res) => {
        setLeads(res.leads);
        setTimes(Object.fromEntries(res.leads.map((lead) => [lead.id, shanghaiLocalInput(lead.next_follow_up_at)])));
        setError("");
        const hash = window.location.hash.replace("#", "");
        if (hash) document.getElementById(hash)?.scrollIntoView({ block: "start" });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "暂时无法读取意向"));
  }

  useEffect(() => {
    load();
    api<{ user: { role: string } }>("/api/me").then((res) => setRole(res.user.role)).catch(() => setRole(""));
    api<{ users: Staff[] }>("/api/admin/growth-lead-assignees").then((res) => setStaff(res.users)).catch(() => setStaff([]));
  }, []);

  async function loadNotes(id: string) {
    const res = await api<{ notes: Note[] }>(`/api/admin/growth-leads/${id}/notes`);
    setNotes((prev) => ({ ...prev, [id]: res.notes }));
  }

  useEffect(() => {
    if (!leads) return;
    for (const lead of leads) {
      loadNotes(lead.id).catch(() => setError("暂时无法读取跟进备注"));
    }
  }, [leads]);

  async function patch(id: string, body: Record<string, unknown>, failure: string) {
    setBusyId(id);
    setError("");
    try {
      await api(`/api/admin/growth-leads/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusyId("");
    }
  }

  async function addNote(id: string) {
    const text = (drafts[id] || "").trim();
    if (!text) {
      setError("请填写跟进备注");
      return;
    }
    setBusyId(id);
    setError("");
    try {
      await api(`/api/admin/growth-leads/${id}/notes`, { method: "POST", body: JSON.stringify({ body: text }) });
      setDrafts((prev) => ({ ...prev, [id]: "" }));
      await loadNotes(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "备注没有保存");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-4" data-testid="growth-lead-admin">
      <PageHeader
        kicker="官网线索"
        title="增长意向"
        description="来自官网首页的预约增长交流和AI场景体验。这些记录没有企业账号，不进入原有客户、政策资料或工单。备注只追加，不覆盖。"
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {leads && leads.length === 0 ? <EmptyState title="还没有增长意向">首页提交成功后，会出现在这里。</EmptyState> : null}
      {leads && leads.length > 0 ? (
        <ul className="space-y-3">
          {leads.map((lead) => (
            <li id={lead.id} key={lead.id} data-testid="growth-lead-row" data-source={lead.source} data-intent={lead.intent} className="rounded-[18px] border border-line bg-white p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-lg font-extrabold text-navy">{lead.company_name}</p>
                  <p className="mt-1 text-sm font-semibold text-[#1e4fc8]">{growthSourceLabel(lead.source)} · {growthIntentLabel(lead.intent)}</p>
                  <p className="mt-2 text-sm text-ink">{lead.contact_name} · {lead.phone}</p>
                  <p className="text-sm text-muted">{lead.industry} · {lead.pain}</p>
                  <p className="mt-2 text-xs text-muted">提交于 {formatShanghai(lead.created_at)}</p>
                  <p className="text-xs text-muted" data-testid="growth-follow-up-label">下次跟进（北京时间）：{lead.next_follow_up_at ? formatShanghai(lead.next_follow_up_at) : "未安排"}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:w-[28rem]">
                  <label className="block text-sm font-semibold text-navy">
                    状态
                    <select
                      className="app-select mt-1 w-full rounded-[11px] border border-[#d8e1ef] bg-white px-3 text-sm"
                      data-testid="growth-lead-status"
                      value={lead.status}
                      disabled={busyId === lead.id}
                      onChange={(event) => patch(lead.id, { status: event.target.value }, "没有保存状态")}
                    >
                      {GROWTH_LEAD_STATUSES.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-navy">
                    负责人
                    <select
                      className="app-select mt-1 w-full rounded-[11px] border border-[#d8e1ef] bg-white px-3 text-sm"
                      data-testid="growth-lead-assignee"
                      value={lead.assignee_id || ""}
                      disabled={busyId === lead.id || role !== "admin"}
                      onChange={(event) => patch(lead.id, { assignee_id: event.target.value || null }, "没有保存负责人")}
                    >
                      <option value="">未分配</option>
                      {staff.map((person) => (
                        <option key={person.id} value={person.id}>{person.name} · {person.role === "admin" ? "管理员" : "顾问"}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-navy sm:col-span-2">
                    下次跟进（北京时间）
                    <input
                      type="datetime-local"
                      className="mt-1 w-full rounded-[11px] border border-[#d8e1ef] bg-white px-3 py-2 text-sm text-ink"
                      data-testid="growth-follow-up"
                      value={times[lead.id] || ""}
                      disabled={busyId === lead.id}
                      onChange={(event) => setTimes((prev) => ({ ...prev, [lead.id]: event.target.value }))}
                    />
                  </label>
                  <div className="flex gap-2 sm:col-span-2">
                    <Button type="button" variant="outline" data-testid="growth-follow-up-save" disabled={busyId === lead.id} onClick={() => patch(lead.id, { next_follow_up_at: times[lead.id] || null }, "没有保存跟进时间")}>保存跟进时间</Button>
                    <Button type="button" variant="outline" data-testid="growth-follow-up-clear" disabled={busyId === lead.id} onClick={() => patch(lead.id, { next_follow_up_at: null }, "没有清空跟进时间")}>清空</Button>
                  </div>
                </div>
              </div>
              <div className="mt-4 border-t border-line pt-3" data-testid="growth-note-list">
                {(notes[lead.id] || []).length === 0 ? <p className="text-sm text-muted">还没有跟进备注。</p> : (notes[lead.id] || []).map((note) => (
                  <p key={note.id} className="mt-2 text-sm text-ink" data-testid="growth-note-item">{formatShanghai(note.created_at)} · {note.author_name || "工作人员"}：{note.body}</p>
                ))}
                <label className="mt-3 block text-sm font-semibold text-navy">
                  追加备注
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-[11px] border border-[#d8e1ef] bg-white px-3 py-2 text-sm text-ink"
                    data-testid="growth-note"
                    value={drafts[lead.id] || ""}
                    maxLength={1000}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [lead.id]: event.target.value }))}
                  />
                </label>
                <Button type="button" className="mt-2" data-testid="growth-note-save" disabled={busyId === lead.id} onClick={() => addNote(lead.id)}>保存备注</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
