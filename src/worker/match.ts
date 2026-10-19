import { evaluate } from "../shared/rules/evaluate";
import type { EvalResult, PolicyRule } from "../shared/rules/types";
import { buildProfile, type BuiltProfile } from "../shared/profile";
import type { Extraction } from "../shared/parsers/tabular";
import { nowIso, uid, type Env } from "./util";

export interface EntRow {
  id: string;
  owner_user_id: string;
  name: string;
  contact_name: string;
  contact_phone: string;
  uscc: string | null;
  uscc_source: string | null;
  entity_type: string | null;
  region_code: string | null;
  city: string | null;
  town: string | null;
  dup_enterprise_id: string | null;
  status: string;
  status_note: string | null;
  warnings_json: string;
  account_status: string;
}

export async function getEnterprise(db: D1Database, id: string): Promise<EntRow | null> {
  return db.prepare("SELECT * FROM enterprises WHERE id = ?").bind(id).first<EntRow>();
}

export async function profileMap(db: D1Database, enterpriseId: string): Promise<Record<string, unknown>> {
  const rows = await db.prepare("SELECT field, value_json, source FROM enterprise_profile WHERE enterprise_id = ?").bind(enterpriseId).all<{
    field: string;
    value_json: string;
    source: string;
  }>();
  const out: Record<string, unknown> = {};
  for (const row of rows.results || []) {
    try {
      out[row.field] = JSON.parse(row.value_json);
    } catch {
      out[row.field] = row.value_json;
    }
  }
  return out;
}

export async function loadEvalProfile(db: D1Database, ent: EntRow): Promise<Record<string, unknown>> {
  const profile = await profileMap(db, ent.id);
  if (ent.uscc) profile.uscc = ent.uscc;
  if (ent.entity_type) profile.entity_type = ent.entity_type;
  if (ent.region_code) profile.region_code = ent.region_code;
  if (ent.city) profile.city = ent.city;
  if (ent.town) profile.town = ent.town;
  return profile;
}

async function loadStaff(db: D1Database, enterpriseId: string): Promise<Record<string, number>> {
  const rows = await db.prepare("SELECT staff_group, count FROM staff_verifications WHERE enterprise_id = ?").bind(enterpriseId).all<{
    staff_group: string;
    count: number;
  }>();
  const staff: Record<string, number> = {};
  for (const row of rows.results || []) staff[row.staff_group] = row.count;
  return staff;
}

async function loadRules(db: D1Database, onlyEnabled: boolean): Promise<PolicyRule[]> {
  const sql = onlyEnabled
    ? `SELECT v.id AS version_id, v.definition_json FROM policies p
       JOIN policy_versions v ON v.policy_id = p.id AND v.version = p.current_version
       WHERE p.status = '启用'`
    : `SELECT v.id AS version_id, v.definition_json FROM policies p
       JOIN policy_versions v ON v.policy_id = p.id AND v.version = p.current_version`;
  const rows = await db.prepare(sql).all<{ version_id: string; definition_json: string }>();
  const rules: PolicyRule[] = [];
  for (const row of rows.results || []) {
    try {
      const rule = JSON.parse(row.definition_json) as PolicyRule;
      rule.policy_version_id = row.version_id;
      rules.push(rule);
    } catch {
      /* 跳过损坏的版本，不让一条坏数据挡住匹配 */
    }
  }
  return rules;
}

export async function enabledRules(db: D1Database): Promise<PolicyRule[]> {
  return loadRules(db, true);
}

async function saveDraft(db: D1Database, enterpriseId: string, result: EvalResult, profile: Record<string, unknown>): Promise<string> {
  const existing = await db
    .prepare("SELECT id, version FROM assessments WHERE enterprise_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1")
    .bind(enterpriseId)
    .first<{ id: string; version: number }>();
  const snapshot = JSON.stringify({ profile, items: result.items, system_low: result.estimate_low, system_high: result.estimate_high });
  let assessmentId = existing?.id;
  if (existing) {
    await db
      .prepare("UPDATE assessments SET estimate_low = ?, estimate_high = ?, snapshot_json = ? WHERE id = ?")
      .bind(result.estimate_low, result.estimate_high, snapshot, existing.id)
      .run();
    await db.prepare("DELETE FROM assessment_items WHERE assessment_id = ?").bind(existing.id).run();
  } else {
    const max = await db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM assessments WHERE enterprise_id = ?").bind(enterpriseId).first<{ v: number }>();
    assessmentId = uid();
    await db
      .prepare(
        "INSERT INTO assessments (id, enterprise_id, version, status, estimate_low, estimate_high, snapshot_json, created_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)",
      )
      .bind(assessmentId, enterpriseId, (max?.v ?? 0) + 1, result.estimate_low, result.estimate_high, snapshot, nowIso())
      .run();
  }
  const stmts = result.items.map((item, index) =>
    db
      .prepare(
        `INSERT INTO assessment_items (id, assessment_id, policy_version_id, code, name, category, tier, conditions_text, verify_text, reason, sort, manual)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .bind(uid(), assessmentId!, item.policy_version_id || null, item.code, item.name, item.category, item.tier, item.conditions_text, item.verify_text, item.reason, index),
  );
  if (stmts.length) await db.batch(stmts);
  return assessmentId!;
}

export async function setStatus(db: D1Database, id: string, status: string, note: string | null): Promise<void> {
  await db
    .prepare("UPDATE enterprises SET status = ?, status_note = ?, status_changed_at = ? WHERE id = ?")
    .bind(status, note, nowIso(), id)
    .run();
}

export async function applyExtraction(env: Env, ent: EntRow, extractions: Extraction[], manual: boolean): Promise<BuiltProfile> {
  const consultant = await profileMap(env.DB, ent.id);
  const consultantOnly: Record<string, unknown> = {};
  const sources = await env.DB.prepare("SELECT field, source FROM enterprise_profile WHERE enterprise_id = ?").bind(ent.id).all<{ field: string; source: string }>();
  for (const row of sources.results || []) {
    if (row.source === "consultant" && consultant[row.field] !== undefined) consultantOnly[row.field] = consultant[row.field];
  }
  const built = buildProfile({ registeredName: ent.name, files: extractions, consultant: consultantOnly });
  const warnings = [...built.warnings];
  if (manual) warnings.push("需人工识别");
  const stmts = Object.entries(built.profile)
    .filter(([field]) => !(field in consultantOnly))
    .map(([field, value]) =>
      env.DB.prepare(
        `INSERT INTO enterprise_profile (enterprise_id, field, value_json, source, confidence, updated_by, updated_at)
         VALUES (?, ?, ?, 'client', 0.9, NULL, ?)
         ON CONFLICT(enterprise_id, field) DO UPDATE SET value_json = excluded.value_json, source = 'client', updated_at = excluded.updated_at
         WHERE enterprise_profile.source != 'consultant'`,
      ).bind(ent.id, field, JSON.stringify(value), nowIso()),
    );
  if (stmts.length) await env.DB.batch(stmts);
  let dupId: string | null = ent.dup_enterprise_id;
  if (built.uscc && ent.uscc_source !== "consultant") {
    const other = await env.DB.prepare(
      "SELECT id, name FROM enterprises WHERE uscc = ? AND id != ? AND account_status = 'active' ORDER BY created_at LIMIT 1",
    )
      .bind(built.uscc, ent.id)
      .first<{ id: string; name: string }>();
    if (other) {
      dupId = other.id;
      warnings.push("疑似重复企业");
      await env.DB.prepare("UPDATE enterprises SET dup_enterprise_id = ?, dup_resolved = 0 WHERE id = ? AND (dup_enterprise_id IS NULL OR dup_resolved = 1)")
        .bind(ent.id, other.id)
        .run();
    }
  }
  const keepConsultant = ent.uscc_source === "consultant";
  const uscc = keepConsultant ? ent.uscc : built.uscc;
  const entity = keepConsultant ? ent.entity_type : built.entity === "unknown" ? null : built.entity;
  const region = keepConsultant ? ent.region_code : built.region_code;
  const city = keepConsultant ? ent.city : built.city;
  await env.DB.prepare(
    `UPDATE enterprises SET uscc = ?, uscc_source = ?, entity_type = ?, region_code = ?, city = ?,
      dup_enterprise_id = ?, warnings_json = ?, submitted_at = ? WHERE id = ?`,
  )
    .bind(
      uscc,
      keepConsultant ? "consultant" : built.uscc ? "client" : ent.uscc_source,
      entity,
      region,
      city,
      dupId,
      JSON.stringify([...new Set(warnings)]),
      nowIso(),
      ent.id,
    )
    .run();
  return built;
}

export async function runMatch(env: Env, enterpriseId: string, opts?: { forceStatus?: string | null }): Promise<{ status: string; ruleMs: number; result?: EvalResult }> {
  const ent = await getEnterprise(env.DB, enterpriseId);
  if (!ent) return { status: "missing", ruleMs: 0 };
  if (ent.status === "已撤回") return { status: "已撤回", ruleMs: 0 };
  const profile = await loadEvalProfile(env.DB, ent);
  const entity = String(profile.entity_type || "");
  if (entity === "individual" || entity === "other") {
    await setStatus(env.DB, enterpriseId, "暂不支持", entity === "individual" ? "主体类型为个体工商户，线上暂不支持" : "主体类型不在线上服务范围");
    await env.DB.prepare("DELETE FROM assessment_items WHERE assessment_id IN (SELECT id FROM assessments WHERE enterprise_id = ? AND status = 'draft')").bind(enterpriseId).run();
    await env.DB.prepare("DELETE FROM assessments WHERE enterprise_id = ? AND status = 'draft'").bind(enterpriseId).run();
    return { status: "暂不支持", ruleMs: 0 };
  }
  const rules = await enabledRules(env.DB);
  const staff = await loadStaff(env.DB, enterpriseId);
  const t0 = Date.now();
  const result = evaluate(profile, staff, rules, { now: new Date() });
  const ruleMs = Date.now() - t0;
  await saveDraft(env.DB, enterpriseId, result, profile);
  const warnings = JSON.parse(ent.warnings_json || "[]") as string[];
  if (result.region_uncovered && !warnings.includes("地区未覆盖，需人工评估")) {
    warnings.push("地区未覆盖，需人工评估");
    await env.DB.prepare("UPDATE enterprises SET warnings_json = ? WHERE id = ?").bind(JSON.stringify(warnings), enterpriseId).run();
  }
  const next = opts?.forceStatus;
  if (next) await setStatus(env.DB, enterpriseId, next, ent.status_note);
  else if (ent.status === "暂不支持") await setStatus(env.DB, enterpriseId, "待复核", null);
  return { status: next || (ent.status === "暂不支持" ? "待复核" : ent.status), ruleMs, result };
}

export async function fileExtractions(db: D1Database, enterpriseId: string): Promise<{ fileId: string; kind: string; extraction: Extraction }[]> {
  const rows = await db
    .prepare("SELECT id, kind, extraction_json, parse_status, parent_file_id FROM files WHERE enterprise_id = ? AND deleted_at IS NULL AND parent_file_id IS NULL")
    .bind(enterpriseId)
    .all<{ id: string; kind: string; extraction_json: string | null; parse_status: string; parent_file_id: string | null }>();
  const out: { fileId: string; kind: string; extraction: Extraction }[] = [];
  for (const row of rows.results || []) {
    if (!row.extraction_json || row.parse_status === "failed" || row.parse_status === "pending") continue;
    try {
      out.push({ fileId: row.id, kind: row.kind, extraction: JSON.parse(row.extraction_json) as Extraction });
    } catch {
      /* ignore broken json */
    }
  }
  return out;
}
