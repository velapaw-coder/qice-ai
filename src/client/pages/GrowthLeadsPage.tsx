import { useEffect, useState } from "react";
import { GROWTH_LEAD_STATUSES, growthIntentLabel, growthSourceLabel, type GrowthLeadStatus } from "@shared/growthLead";
import { formatShanghai } from "@shared/policyPage";
import { api } from "../lib/api";
import { Banner, EmptyState, PageHeader } from "../components/ui";

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
};

export function GrowthLeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  function load() {
    api<{ leads: Lead[] }>("/api/admin/growth-leads")
      .then((res) => {
        setLeads(res.leads);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "暂时无法读取意向"));
  }

  useEffect(() => {
    load();
  }, []);

  async function update(id: string, status: string) {
    setBusyId(id);
    setError("");
    try {
      await api(`/api/admin/growth-leads/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "没有保存状态");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-4" data-testid="growth-lead-admin">
      <PageHeader
        kicker="官网线索"
        title="增长意向"
        description="来自官网首页的预约增长交流和AI场景体验。这些记录没有企业账号，不进入原有客户、政策资料或工单。"
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {leads && leads.length === 0 ? <EmptyState title="还没有增长意向">首页提交成功后，会出现在这里。</EmptyState> : null}
      {leads && leads.length > 0 ? (
        <ul className="space-y-3">
          {leads.map((lead) => (
            <li key={lead.id} data-testid="growth-lead-row" data-source={lead.source} data-intent={lead.intent} className="rounded-[18px] border border-line bg-white p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-lg font-extrabold text-navy">{lead.company_name}</p>
                  <p className="mt-1 text-sm font-semibold text-[#1e4fc8]">{growthSourceLabel(lead.source)} · {growthIntentLabel(lead.intent)}</p>
                  <p className="mt-2 text-sm text-ink">{lead.contact_name} · {lead.phone}</p>
                  <p className="text-sm text-muted">{lead.industry} · {lead.pain}</p>
                  <p className="mt-2 text-xs text-muted">{formatShanghai(lead.created_at)}</p>
                </div>
                <label className="block text-sm font-semibold text-navy">
                  状态
                  <select
                    className="app-select mt-1 w-full rounded-[11px] border border-[#d8e1ef] bg-white px-3 text-sm sm:w-40"
                    data-testid="growth-lead-status"
                    value={lead.status}
                    disabled={busyId === lead.id}
                    onChange={(event) => update(lead.id, event.target.value)}
                  >
                    {GROWTH_LEAD_STATUSES.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
