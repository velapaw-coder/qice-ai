import { Hono } from "hono";
import { evaluate, DISCLAIMER } from "../../shared/rules/evaluate";
import { parseRule } from "../../shared/rules/schema";
import type { PolicyRule } from "../../shared/rules/types";
import { cityFromRegion, entityFromUscc, isValidUscc, regionFromUscc } from "../../shared/uscc";
import { decryptSecret, encryptSecret } from "../crypto";
import { enqueueCrawl, importTextDraft, joinUrl } from "../crawl";
import { getEnterprise, loadEvalProfile, profileMap, runMatch, setStatus } from "../match";
import { audit, beijingDate, clientIp, contentDisposition, hitLimit, notifyWecom, nowIso, readJson, requireStaff, setting, uid, type AppEnv } from "../util";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", async (c, next) => {
  if (!requireStaff(c.get("role"))) return c.json({ error: "需要顾问或管理员权限" }, 403);
  await next();
});

function adminOnly(role: string) {
  return role === "admin";
}

adminRoutes.get("/admin/todos", async (c) => {
  const db = c.env.DB;
  const threeDays = new Date(Date.now() - 3 * 86400_000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const [review, appointments, unsupported, resubmit, fresh, drafts, expiring] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM enterprises WHERE status = '待复核' AND account_status = 'active'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status = '待联系'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM enterprises WHERE status = '暂不支持' AND account_status = 'active'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM enterprises WHERE status = '需补传' AND status_changed_at < ? AND account_status = 'active'").bind(threeDays).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM enterprises WHERE status = '待上传' AND created_at < ? AND account_status = 'active'").bind(threeDays).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM policy_drafts WHERE status = '待审核'").first<{ n: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM policies p JOIN policy_versions v ON v.policy_id = p.id AND v.version = p.current_version
       WHERE p.status = '启用' AND v.effective_to IS NOT NULL AND v.effective_to != '' AND v.effective_to <= ? AND v.effective_to >= ?`,
    )
      .bind(soon, today)
      .first<{ n: number }>(),
  ]);
  const groups = [
    { key: "review", title: "待复核", count: review?.n ?? 0 },
    { key: "appointments", title: "新预约", count: appointments?.n ?? 0 },
    { key: "unsupported", title: "暂不支持", count: unsupported?.n ?? 0 },
    { key: "resubmit", title: "需补传超过 3 天", count: resubmit?.n ?? 0 },
    { key: "fresh", title: "新注册未上传超过 3 天", count: fresh?.n ?? 0 },
    { key: "drafts", title: "待审核政策草稿", count: drafts?.n ?? 0 },
    { key: "expiring", title: "即将到期规则", count: expiring?.n ?? 0 },
  ];
  const listFor = async (key: string) => {
    if (key === "review") return db.prepare("SELECT id, name, city, entity_type, contact_name, contact_phone, status, warnings_json, submitted_at AS time FROM enterprises WHERE status = '待复核' ORDER BY submitted_at DESC LIMIT 20").all();
    if (key === "unsupported") return db.prepare("SELECT id, name, city, entity_type, contact_name, contact_phone, status, warnings_json, status_changed_at AS time FROM enterprises WHERE status = '暂不支持' ORDER BY status_changed_at DESC LIMIT 20").all();
    if (key === "resubmit") return db.prepare("SELECT id, name, city, entity_type, contact_name, contact_phone, status, warnings_json, status_changed_at AS time FROM enterprises WHERE status = '需补传' AND status_changed_at < ? ORDER BY status_changed_at LIMIT 20").bind(threeDays).all();
    if (key === "fresh") return db.prepare("SELECT id, name, city, entity_type, contact_name, contact_phone, status, warnings_json, created_at AS time FROM enterprises WHERE status = '待上传' AND created_at < ? ORDER BY created_at LIMIT 20").bind(threeDays).all();
    if (key === "appointments")
      return db.prepare(
        `SELECT a.id, a.enterprise_id, e.name, e.contact_phone, a.slot_pref, a.topic, a.note, a.created_at AS time
         FROM appointments a JOIN enterprises e ON e.id = a.enterprise_id WHERE a.status = '待联系' ORDER BY a.created_at DESC LIMIT 20`,
      ).all();
    return { results: [] };
  };
  const lists = Object.fromEntries(await Promise.all(groups.map(async (g) => [g.key, (await listFor(g.key)).results || []])));
  return c.json({ groups, lists });
});

adminRoutes.get("/admin/enterprises", async (c) => {
  const status = c.req.query("status") || "";
  const q = (c.req.query("q") || "").trim();
  const rows = await c.env.DB.prepare(
    `SELECT id, name, contact_name, contact_phone, city, entity_type, region_code, status, warnings_json, created_at, submitted_at, uscc, dup_enterprise_id
     FROM enterprises WHERE account_status = 'active' AND (? = '' OR status = ?) AND (? = '' OR name LIKE ? OR contact_phone LIKE ?)
     ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(status, status, q, `%${q}%`, `%${q}%`)
    .all();
  return c.json({ enterprises: rows.results || [] });
});

adminRoutes.get("/admin/enterprises/:id", async (c) => {
  const ent = await getEnterprise(c.env.DB, c.req.param("id"));
  if (!ent) return c.json({ error: "企业不存在" }, 404);
  const db = c.env.DB;
  const [files, profileRows, draft, published, staff, appointments, policyDeals, fde, dup] = await Promise.all([
    db.prepare("SELECT id, kind, source_type, filename, size, parse_status, parse_note, period_start, period_end, uploaded_at, parent_file_id, mime FROM files WHERE enterprise_id = ? AND deleted_at IS NULL ORDER BY period_start, uploaded_at").bind(ent.id).all(),
    db.prepare("SELECT field, value_json, source, confidence, updated_at FROM enterprise_profile WHERE enterprise_id = ?").bind(ent.id).all(),
    db.prepare("SELECT * FROM assessments WHERE enterprise_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1").bind(ent.id).first(),
    db.prepare("SELECT * FROM assessments WHERE enterprise_id = ? AND status = 'published' ORDER BY version DESC LIMIT 1").bind(ent.id).first(),
    db.prepare("SELECT * FROM staff_verifications WHERE enterprise_id = ?").bind(ent.id).all(),
    db.prepare("SELECT * FROM appointments WHERE enterprise_id = ? ORDER BY created_at DESC").bind(ent.id).all(),
    db.prepare("SELECT * FROM policy_deals WHERE enterprise_id = ? ORDER BY created_at DESC").bind(ent.id).all(),
    db.prepare("SELECT * FROM fde_deals WHERE enterprise_id = ? ORDER BY created_at DESC").bind(ent.id).all(),
    ent.dup_enterprise_id ? db.prepare("SELECT id, name, contact_phone FROM enterprises WHERE id = ?").bind(ent.dup_enterprise_id).first() : Promise.resolve(null),
  ]);
  const draftId = (draft as { id?: string } | null)?.id;
  const publishedId = (published as { id?: string } | null)?.id;
  const itemSource = draftId || publishedId;
  const items = itemSource ? await db.prepare("SELECT * FROM assessment_items WHERE assessment_id = ? ORDER BY sort").bind(itemSource).all() : { results: [] };
  const profile: Record<string, { value: unknown; source: string; confidence: number | null }> = {};
  for (const row of (profileRows.results || []) as { field: string; value_json: string; source: string; confidence: number | null }[]) {
    profile[row.field] = { value: JSON.parse(row.value_json), source: row.source, confidence: row.confidence };
  }
  return c.json({ enterprise: ent, dup, files: files.results || [], profile, draft, items: items.results || [], published, staff: staff.results || [], appointments: appointments.results || [], policy_deals: policyDeals.results || [], fde_deals: fde.results || [], disclaimer: DISCLAIMER });
});

adminRoutes.patch("/admin/enterprises/:id", async (c) => {
  const ent = await getEnterprise(c.env.DB, c.req.param("id"));
  if (!ent) return c.json({ error: "企业不存在" }, 404);
  const body = await readJson<Record<string, string>>(c.req.raw);
  if (!body) return c.json({ error: "无法读取" }, 400);
  if (body.uscc) {
    const code = body.uscc.trim().toUpperCase();
    if (!isValidUscc(code)) return c.json({ error: "统一社会信用代码校验位不正确" }, 400);
    const kind = entityFromUscc(code);
    const region = regionFromUscc(code);
    await c.env.DB.prepare("UPDATE enterprises SET uscc = ?, uscc_source = 'consultant', entity_type = ?, region_code = ?, city = ? WHERE id = ?")
      .bind(code, kind === "unknown" ? null : kind, region, cityFromRegion(region), ent.id)
      .run();
    await upsertProfile(c.env.DB, ent.id, "uscc", code, c.get("userId"));
    await upsertProfile(c.env.DB, ent.id, "entity_type", kind, c.get("userId"));
    await upsertProfile(c.env.DB, ent.id, "region_code", region, c.get("userId"));
  }
  if (body.entity_type) {
    await c.env.DB.prepare("UPDATE enterprises SET entity_type = ? WHERE id = ?").bind(body.entity_type, ent.id).run();
    await upsertProfile(c.env.DB, ent.id, "entity_type", body.entity_type, c.get("userId"));
  }
  if (body.region_code) {
    await c.env.DB.prepare("UPDATE enterprises SET region_code = ?, city = ? WHERE id = ?").bind(body.region_code, cityFromRegion(body.region_code), ent.id).run();
    await upsertProfile(c.env.DB, ent.id, "region_code", body.region_code, c.get("userId"));
  }
  if (body.town !== undefined) {
    await c.env.DB.prepare("UPDATE enterprises SET town = ? WHERE id = ?").bind(body.town, ent.id).run();
    await upsertProfile(c.env.DB, ent.id, "town", body.town, c.get("userId"));
  }
  if (body.name) await c.env.DB.prepare("UPDATE enterprises SET name = ? WHERE id = ?").bind(body.name.trim(), ent.id).run();
  if (body.contact_name) await c.env.DB.prepare("UPDATE enterprises SET contact_name = ? WHERE id = ?").bind(body.contact_name.trim(), ent.id).run();
  await audit(c.env.DB, c.get("userId"), "enterprise.update", "enterprise", ent.id, clientIp(c.req.raw), body);
  const matched = await runMatch(c.env, ent.id);
  return c.json({ ok: true, rule_ms: matched.ruleMs, status: matched.status });
});

async function upsertProfile(db: D1Database, enterpriseId: string, field: string, value: unknown, actor: string) {
  await db.prepare(
    `INSERT INTO enterprise_profile (enterprise_id, field, value_json, source, confidence, updated_by, updated_at)
     VALUES (?, ?, ?, 'consultant', 1, ?, ?)
     ON CONFLICT(enterprise_id, field) DO UPDATE SET value_json = excluded.value_json, source = 'consultant', confidence = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(enterpriseId, field, JSON.stringify(value), actor, nowIso())
    .run();
}

adminRoutes.patch("/admin/enterprises/:id/profile", async (c) => {
  const ent = await getEnterprise(c.env.DB, c.req.param("id"));
  if (!ent) return c.json({ error: "企业不存在" }, 404);
  const body = await readJson<{ fields?: Record<string, unknown> }>(c.req.raw);
  if (!body?.fields) return c.json({ error: "缺少字段" }, 400);
  for (const [field, value] of Object.entries(body.fields)) {
    await upsertProfile(c.env.DB, ent.id, field, value, c.get("userId"));
  }
  await audit(c.env.DB, c.get("userId"), "profile.update", "enterprise", ent.id, clientIp(c.req.raw), { fields: Object.keys(body.fields) });
  const matched = await runMatch(c.env, ent.id);
  return c.json({ ok: true, rule_ms: matched.ruleMs, status: matched.status });
});

adminRoutes.put("/admin/enterprises/:id/staff", async (c) => {
  const ent = await getEnterprise(c.env.DB, c.req.param("id"));
  if (!ent) return c.json({ error: "企业不存在" }, 404);
  const body = await readJson<{ counts?: Record<string, number>; note?: string }>(c.req.raw);
  if (!body?.counts) return c.json({ error: "缺少人数" }, 400);
  const groups = ["veteran", "poverty", "unemployed", "disabled", "graduate", "owner_veteran", "owner_poverty", "owner_unemployed", "owner_disabled"];
  for (const [group, count] of Object.entries(body.counts)) {
    if (!groups.includes(group) || !Number.isFinite(count) || count < 0) return c.json({ error: `人数不正确：${group}` }, 400);
    await c.env.DB.prepare(
      `INSERT INTO staff_verifications (enterprise_id, staff_group, count, verified_by, verified_at, note)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(enterprise_id, staff_group) DO UPDATE SET count = excluded.count, verified_by = excluded.verified_by, verified_at = excluded.verified_at, note = excluded.note`,
    )
      .bind(ent.id, group, count, c.get("userId"), nowIso(), body.note || null)
      .run();
  }
  await audit(c.env.DB, c.get("userId"), "staff.update", "enterprise", ent.id, clientIp(c.req.raw), body.counts);
  const matched = await runMatch(c.env, ent.id);
  return c.json({ ok: true, rule_ms: matched.ruleMs });
});

adminRoutes.post("/admin/enterprises/:id/rematch", async (c) => {
  const matched = await runMatch(c.env, c.req.param("id"));
  await audit(c.env.DB, c.get("userId"), "enterprise.rematch", "enterprise", c.req.param("id"), clientIp(c.req.raw), { rule_ms: matched.ruleMs });
  return c.json(matched);
});

adminRoutes.post("/admin/enterprises/:id/return", async (c) => {
  const body = await readJson<{ note?: string }>(c.req.raw);
  if (!body?.note?.trim()) return c.json({ error: "请填写给企业看的说明" }, 400);
  await setStatus(c.env.DB, c.req.param("id"), "需补传", body.note.trim().slice(0, 500));
  const ent = await getEnterprise(c.env.DB, c.req.param("id"));
  await audit(c.env.DB, c.get("userId"), "enterprise.return", "enterprise", c.req.param("id"), clientIp(c.req.raw));
  if (ent) await notifyWecom(c.env, c.executionCtx, `企策AI：${ent.name} 被退回补传。 /admin/enterprises/${ent.id}`);
  return c.json({ ok: true });
});

adminRoutes.post("/admin/enterprises/:id/notified", async (c) => {
  await c.env.DB.prepare("UPDATE enterprises SET notified_at = ? WHERE id = ?").bind(nowIso(), c.req.param("id")).run();
  await audit(c.env.DB, c.get("userId"), "enterprise.notified", "enterprise", c.req.param("id"), clientIp(c.req.raw));
  return c.json({ ok: true });
});

adminRoutes.post("/admin/enterprises/:id/dup-resolve", async (c) => {
  const body = await readJson<{ action?: string }>(c.req.raw);
  const ent = await getEnterprise(c.env.DB, c.req.param("id"));
  if (!ent) return c.json({ error: "企业不存在" }, 404);
  if (body?.action === "keep") {
    await c.env.DB.prepare("UPDATE enterprises SET dup_resolved = 1 WHERE id = ?").bind(ent.id).run();
  } else if (body?.action === "disable") {
    await c.env.DB.prepare("UPDATE enterprises SET account_status = 'disabled', dup_resolved = 1, status_note = '顾问停用' WHERE id = ?").bind(ent.id).run();
  } else if (body?.action === "merge" && ent.dup_enterprise_id) {
    await c.env.DB.prepare("UPDATE files SET enterprise_id = ? WHERE enterprise_id = ?").bind(ent.dup_enterprise_id, ent.id).run();
    await c.env.DB.prepare("UPDATE enterprises SET account_status = 'disabled', dup_resolved = 1, status_note = '已并入另一家' WHERE id = ?").bind(ent.id).run();
  } else return c.json({ error: "无法处理" }, 400);
  await audit(c.env.DB, c.get("userId"), "enterprise.dup_resolve", "enterprise", ent.id, clientIp(c.req.raw), body);
  return c.json({ ok: true });
});

adminRoutes.post("/admin/enterprises/:id/files", async (c) => {
  const ent = await getEnterprise(c.env.DB, c.req.param("id"));
  if (!ent) return c.json({ error: "企业不存在" }, 404);
  if (ent.status === "已撤回") return c.json({ error: "企业已撤回授权，不能代传" }, 409);
  const agreed = await c.env.DB.prepare("SELECT revoked_at, consent_version FROM consents WHERE enterprise_id = ? ORDER BY agreed_at DESC LIMIT 1")
    .bind(ent.id)
    .first<{ revoked_at: string | null }>();
  if (!agreed || agreed.revoked_at) return c.json({ error: "企业还没有有效授权" }, 409);
  const body = await readJson<{ kind?: string; source_type?: string; filename?: string; size?: number; mime?: string; parent_file_id?: string }>(c.req.raw);
  if (!body?.kind || !body.filename) return c.json({ error: "文件信息不完整" }, 400);
  const id = uid();
  const exp = new Date(Date.now() + 180 * 86400_000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO files (id, enterprise_id, kind, source_type, parent_file_id, uploaded_by, parse_status, r2_key, filename, mime, size, uploaded_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'consultant', 'pending', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, ent.id, body.kind, body.source_type || "excel", body.parent_file_id || null, `files/${crypto.randomUUID()}`, body.filename.slice(0, 180), body.mime || "", body.size || 0, nowIso(), exp)
    .run();
  await audit(c.env.DB, c.get("userId"), "file.upload_by_consultant", "file", id, clientIp(c.req.raw), { enterprise_id: ent.id });
  return c.json({ id });
});

adminRoutes.get("/admin/files/:id/download", async (c) => {
  const file = await c.env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(c.req.param("id")).first<{
    id: string;
    enterprise_id: string;
    r2_key: string;
    filename: string;
    mime: string;
    deleted_at: string | null;
    size: number;
  }>();
  if (!file || file.deleted_at) return c.json({ error: "文件不存在" }, 404);
  const ent = await getEnterprise(c.env.DB, file.enterprise_id);
  if (!ent || ent.status === "已撤回") return c.json({ error: "授权已撤回，不能下载" }, 403);
  const obj = await c.env.BUCKET.get(file.r2_key);
  if (!obj) return c.json({ error: "文件内容不在存储里" }, 404);
  const inline = c.req.query("inline") === "1";
  const via = c.req.query("via") || "direct";
  await audit(c.env.DB, c.get("userId"), inline ? "file.preview" : "file.download", "file", file.id, clientIp(c.req.raw), { via, enterprise_id: file.enterprise_id });
  return new Response(obj.body, {
    headers: {
      "content-type": file.mime || "application/octet-stream",
      "content-disposition": contentDisposition(file.filename, inline),
      "cache-control": "no-store",
    },
  });
});

adminRoutes.post("/admin/enterprises/:id/zip-intent", async (c) => {
  const ent = await getEnterprise(c.env.DB, c.req.param("id"));
  if (!ent || ent.status === "已撤回") return c.json({ error: "不能打包下载" }, 403);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM zip_events WHERE user_id = ? AND created_at > ?").bind(c.get("userId"), since).first<{ n: number }>();
  if ((used?.n ?? 0) >= 30) {
    await audit(c.env.DB, c.get("userId"), "files.zip_download_blocked", "enterprise", ent.id, clientIp(c.req.raw));
    return c.json({ error: "打包下载过于频繁" }, 429);
  }
  const files = await c.env.DB.prepare(
    "SELECT id, kind, filename, size, period_start FROM files WHERE enterprise_id = ? AND deleted_at IS NULL AND parent_file_id IS NULL",
  )
    .bind(ent.id)
    .all<{ id: string; kind: string; filename: string; size: number; period_start: string | null }>();
  const list = files.results || [];
  if (!list.length) return c.json({ error: "没有可下载的文件", files: [] }, 400);
  const mapped = list.map((f) => {
    const folder = f.kind === "vat" ? "增值税申报表" : "社保清单";
    const prefix = f.period_start ? `${f.period_start.slice(0, 7)}_` : "";
    return { id: f.id, path: `${folder}/${prefix}${f.filename}`, size: f.size };
  });
  const total = mapped.reduce((s, f) => s + (f.size || 0), 0);
  await c.env.DB.prepare("INSERT INTO zip_events (id, user_id, created_at) VALUES (?, ?, ?)").bind(uid(), c.get("userId"), nowIso()).run();
  await audit(c.env.DB, c.get("userId"), "files.zip_download", "enterprise", ent.id, clientIp(c.req.raw), {
    file_ids: mapped.map((f) => f.id),
    count: mapped.length,
    total_size: total,
  });
  return c.json({ files: mapped, filename: `${ent.name}_${beijingDate()}.zip` });
});

adminRoutes.patch("/admin/assessments/:id", async (c) => {
  const assessment = await c.env.DB.prepare("SELECT * FROM assessments WHERE id = ?").bind(c.req.param("id")).first<{ id: string; status: string; estimate_low: number; estimate_high: number }>();
  if (!assessment || assessment.status !== "draft") return c.json({ error: "只能修改未发布的初稿" }, 409);
  const body = await readJson<{
    items?: { id: string; tier?: string; verify_text?: string; reason?: string }[];
    add?: { name: string; category?: string; tier?: string; verify_text?: string };
    remove?: string[];
    estimate_low?: number;
    estimate_high?: number;
    clear_override?: boolean;
  }>(c.req.raw);
  if (!body) return c.json({ error: "无法读取" }, 400);
  for (const item of body.items || []) {
    if (item.tier && !["go", "verify", "reject"].includes(item.tier)) return c.json({ error: "档位不正确" }, 400);
    await c.env.DB.prepare("UPDATE assessment_items SET tier = COALESCE(?, tier), verify_text = COALESCE(?, verify_text), reason = COALESCE(?, reason), manual = 1 WHERE id = ? AND assessment_id = ?")
      .bind(item.tier || null, item.verify_text ?? null, item.reason ?? null, item.id, assessment.id)
      .run();
  }
  for (const id of body.remove || []) {
    await c.env.DB.prepare("DELETE FROM assessment_items WHERE id = ? AND assessment_id = ?").bind(id, assessment.id).run();
  }
  if (body.add?.name) {
    await c.env.DB.prepare(
      "INSERT INTO assessment_items (id, assessment_id, name, category, tier, verify_text, reason, sort, manual) VALUES (?, ?, ?, ?, ?, ?, '', 99, 1)",
    )
      .bind(uid(), assessment.id, body.add.name, body.add.category || "顾问补充", body.add.tier || "verify", body.add.verify_text || "")
      .run();
  }
  if (body.clear_override) {
    await c.env.DB.prepare("UPDATE assessments SET estimate_override_json = NULL WHERE id = ?").bind(assessment.id).run();
  } else if (body.estimate_low !== undefined || body.estimate_high !== undefined) {
    const override = { low: body.estimate_low ?? assessment.estimate_low, high: body.estimate_high ?? assessment.estimate_high, system_low: assessment.estimate_low, system_high: assessment.estimate_high };
    await c.env.DB.prepare("UPDATE assessments SET estimate_override_json = ? WHERE id = ?").bind(JSON.stringify(override), assessment.id).run();
  }
  await audit(c.env.DB, c.get("userId"), "assessment.edit", "assessment", assessment.id, clientIp(c.req.raw));
  return c.json({ ok: true });
});

adminRoutes.post("/admin/assessments/:id/publish", async (c) => {
  const assessment = await c.env.DB.prepare("SELECT * FROM assessments WHERE id = ?").bind(c.req.param("id")).first<{
    id: string;
    enterprise_id: string;
    status: string;
    estimate_low: number;
    estimate_high: number;
    estimate_override_json: string | null;
  }>();
  if (!assessment || assessment.status !== "draft") return c.json({ error: "没有可发布的初稿" }, 409);
  const ent = await getEnterprise(c.env.DB, assessment.enterprise_id);
  if (!ent || ent.status === "暂不支持" || ent.status === "已撤回") return c.json({ error: "当前企业不能发布方案" }, 409);
  const items = await c.env.DB.prepare("SELECT id, name, category, tier, verify_text, reason, conditions_text, code FROM assessment_items WHERE assessment_id = ? ORDER BY sort").bind(assessment.id).all();
  const override = assessment.estimate_override_json ? JSON.parse(assessment.estimate_override_json) : null;
  const snapshot = JSON.stringify({
    items: items.results || [],
    disclaimer: DISCLAIMER,
    estimate_low: override?.low ?? assessment.estimate_low,
    estimate_high: override?.high ?? assessment.estimate_high,
  });
  await c.env.DB.prepare("UPDATE assessments SET status = 'published', published_by = ?, published_at = ?, snapshot_json = ?, estimate_low = ?, estimate_high = ? WHERE id = ?")
    .bind(c.get("userId"), nowIso(), snapshot, override?.low ?? assessment.estimate_low, override?.high ?? assessment.estimate_high, assessment.id)
    .run();
  await setStatus(c.env.DB, ent.id, "已发布", null);
  await audit(c.env.DB, c.get("userId"), "assessment.publish", "assessment", assessment.id, clientIp(c.req.raw));
  return c.json({ ok: true });
});

adminRoutes.get("/admin/policies", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, code, name, category, status, current_version, origin, updated_at FROM policies ORDER BY code").all();
  return c.json({ policies: rows.results || [] });
});

adminRoutes.get("/admin/policies/:id", async (c) => {
  const policy = await c.env.DB.prepare("SELECT * FROM policies WHERE id = ?").bind(c.req.param("id")).first<{ id: string; current_version: number }>();
  if (!policy) return c.json({ error: "政策不存在" }, 404);
  const version = await c.env.DB.prepare("SELECT * FROM policy_versions WHERE policy_id = ? AND version = ?").bind(policy.id, policy.current_version).first();
  return c.json({ policy, version });
});

adminRoutes.get("/admin/policies/:id/versions", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, version, definition_json, basis, url, effective_from, effective_to, created_at FROM policy_versions WHERE policy_id = ? ORDER BY version").bind(c.req.param("id")).all();
  return c.json({ versions: rows.results || [] });
});

adminRoutes.post("/admin/policies", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以维护政策库" }, 403);
  const body = await readJson<{ rule?: unknown; basis?: string; url?: string; effective_from?: string; effective_to?: string }>(c.req.raw);
  const parsed = parseRule(body?.rule);
  if (!parsed.rule) return c.json({ error: parsed.error }, 400);
  const exists = await c.env.DB.prepare("SELECT id FROM policies WHERE code = ?").bind(parsed.rule.code).first();
  if (exists) return c.json({ error: "政策编码已存在" }, 409);
  const id = uid();
  const vid = uid();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO policies (id, code, name, category, status, current_version, origin, created_at, updated_at) VALUES (?, ?, ?, ?, '草稿', 1, 'manual', ?, ?)").bind(id, parsed.rule.code, parsed.rule.name, parsed.rule.category, now, now),
    c.env.DB.prepare("INSERT INTO policy_versions (id, policy_id, version, definition_json, basis, url, effective_from, effective_to, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)").bind(vid, id, JSON.stringify(parsed.rule), body?.basis || parsed.rule.basis || "", body?.url || "", body?.effective_from || null, body?.effective_to || null, c.get("userId"), now),
  ]);
  await audit(c.env.DB, c.get("userId"), "policy.create", "policy", id, clientIp(c.req.raw));
  return c.json({ id });
});

adminRoutes.patch("/admin/policies/:id", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以维护政策库" }, 403);
  const policy = await c.env.DB.prepare("SELECT * FROM policies WHERE id = ?").bind(c.req.param("id")).first<{ id: string; current_version: number; code: string }>();
  if (!policy) return c.json({ error: "政策不存在" }, 404);
  const body = await readJson<{ rule?: unknown; basis?: string; url?: string; effective_from?: string; effective_to?: string }>(c.req.raw);
  const parsed = parseRule(body?.rule);
  if (!parsed.rule) return c.json({ error: parsed.error }, 400);
  const version = policy.current_version + 1;
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE policies SET name = ?, category = ?, current_version = ?, updated_at = ? WHERE id = ?").bind(parsed.rule.name, parsed.rule.category, version, now, policy.id),
    c.env.DB.prepare("INSERT INTO policy_versions (id, policy_id, version, definition_json, basis, url, effective_from, effective_to, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(uid(), policy.id, version, JSON.stringify(parsed.rule), body?.basis || "", body?.url || "", body?.effective_from || null, body?.effective_to || null, c.get("userId"), now),
  ]);
  await audit(c.env.DB, c.get("userId"), "policy.update", "policy", policy.id, clientIp(c.req.raw), { version });
  return c.json({ ok: true, version });
});

adminRoutes.post("/admin/policies/:id/enable", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以启用" }, 403);
  await c.env.DB.prepare("UPDATE policies SET status = '启用', updated_at = ? WHERE id = ?").bind(nowIso(), c.req.param("id")).run();
  await audit(c.env.DB, c.get("userId"), "policy.enable", "policy", c.req.param("id"), clientIp(c.req.raw));
  return c.json({ ok: true });
});

adminRoutes.post("/admin/policies/:id/disable", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以停用" }, 403);
  await c.env.DB.prepare("UPDATE policies SET status = '停用', updated_at = ? WHERE id = ?").bind(nowIso(), c.req.param("id")).run();
  await audit(c.env.DB, c.get("userId"), "policy.disable", "policy", c.req.param("id"), clientIp(c.req.raw));
  return c.json({ ok: true });
});

adminRoutes.post("/admin/policies/:id/dry-run", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以试算" }, 403);
  const body = await readJson<{ enterprise_id?: string }>(c.req.raw);
  if (!body?.enterprise_id) return c.json({ error: "请选择企业" }, 400);
  const policy = await c.env.DB.prepare("SELECT * FROM policies WHERE id = ?").bind(c.req.param("id")).first<{ current_version: number }>();
  if (!policy) return c.json({ error: "政策不存在" }, 404);
  const version = await c.env.DB.prepare("SELECT id, definition_json FROM policy_versions WHERE policy_id = ? AND version = ?").bind(c.req.param("id"), policy.current_version).first<{ id: string; definition_json: string }>();
  const ent = await getEnterprise(c.env.DB, body.enterprise_id);
  if (!version || !ent) return c.json({ error: "试算数据不完整" }, 404);
  const rule = JSON.parse(version.definition_json) as PolicyRule;
  rule.policy_version_id = version.id;
  const profile = await loadEvalProfile(c.env.DB, ent);
  const staffRows = await c.env.DB.prepare("SELECT staff_group, count FROM staff_verifications WHERE enterprise_id = ?").bind(ent.id).all<{ staff_group: string; count: number }>();
  const staff: Record<string, number> = {};
  for (const row of staffRows.results || []) staff[row.staff_group] = row.count;
  const result = evaluate(profile, staff, [rule], { now: new Date() });
  return c.json({ result, saved: false });
});

adminRoutes.get("/admin/deals/policy", async (c) => {
  const stage = c.req.query("stage") || "";
  const rows = await c.env.DB.prepare(
    `SELECT d.*, e.name AS enterprise_name FROM policy_deals d JOIN enterprises e ON e.id = d.enterprise_id
     WHERE (? = '' OR d.stage = ?) ORDER BY d.created_at DESC LIMIT 200`,
  )
    .bind(stage, stage)
    .all();
  const sum = await c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(fee_amount), 0) AS fee FROM policy_realizations").first<{ amount: number; fee: number }>();
  return c.json({ deals: rows.results || [], totals: sum });
});

adminRoutes.post("/admin/deals/policy", async (c) => {
  const body = await readJson<{ enterprise_id?: string; items?: { name: string; policy_id?: string }[]; assessment_id?: string }>(c.req.raw);
  if (!body?.enterprise_id || !body.items?.length) return c.json({ error: "请选择政策项目" }, 400);
  const ent = await getEnterprise(c.env.DB, body.enterprise_id);
  if (!ent || ent.status !== "已发布") return c.json({ error: "方案发布后才能创建政策成交" }, 409);
  const ids: string[] = [];
  for (const item of body.items) {
    const id = uid();
    ids.push(id);
    await c.env.DB.prepare(
      "INSERT INTO policy_deals (id, enterprise_id, policy_id, assessment_id, item_name, stage, owner_id, created_at) VALUES (?, ?, ?, ?, ?, '方案已发', ?, ?)",
    )
      .bind(id, ent.id, item.policy_id || null, body.assessment_id || null, item.name, c.get("userId"), nowIso())
      .run();
  }
  await audit(c.env.DB, c.get("userId"), "deal.policy_create", "enterprise", ent.id, clientIp(c.req.raw), { ids });
  return c.json({ ids });
});

adminRoutes.patch("/admin/deals/policy/:id", async (c) => {
  const body = await readJson<Record<string, string>>(c.req.raw);
  if (!body) return c.json({ error: "无法读取" }, 400);
  await c.env.DB.prepare(
    "UPDATE policy_deals SET stage = COALESCE(?, stage), fee_terms_text = COALESCE(?, fee_terms_text), fee_agreed_note = COALESCE(?, fee_agreed_note), signed_at = COALESCE(?, signed_at), note = COALESCE(?, note) WHERE id = ?",
  )
    .bind(body.stage || null, body.fee_terms_text ?? null, body.fee_agreed_note ?? null, body.signed_at || null, body.note ?? null, c.req.param("id"))
    .run();
  await audit(c.env.DB, c.get("userId"), "deal.policy_update", "policy_deal", c.req.param("id"), clientIp(c.req.raw));
  return c.json({ ok: true });
});

adminRoutes.post("/admin/deals/policy/:id/realizations", async (c) => {
  const body = await readJson<{ amount?: number; realized_at?: string; fee_amount?: number; proof_note?: string }>(c.req.raw);
  if (!body?.amount || !body.realized_at) return c.json({ error: "请填写兑现金额和日期" }, 400);
  const id = uid();
  await c.env.DB.prepare(
    "INSERT INTO policy_realizations (id, deal_id, amount, realized_at, fee_amount, proof_note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, c.req.param("id"), body.amount, body.realized_at, body.fee_amount ?? null, body.proof_note || null, c.get("userId"), nowIso())
    .run();
  await c.env.DB.prepare("UPDATE policy_deals SET stage = '已兑现' WHERE id = ? AND stage != '终止'").bind(c.req.param("id")).run();
  await audit(c.env.DB, c.get("userId"), "deal.realization", "policy_deal", c.req.param("id"), clientIp(c.req.raw), { amount: body.amount });
  return c.json({ id });
});

adminRoutes.get("/admin/deals/policy/:id/realizations", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM policy_realizations WHERE deal_id = ? ORDER BY realized_at").bind(c.req.param("id")).all();
  return c.json({ realizations: rows.results || [] });
});

adminRoutes.get("/admin/deals/fde", async (c) => {
  const stage = c.req.query("stage") || "";
  const rows = await c.env.DB.prepare(
    `SELECT d.*, e.name AS enterprise_name FROM fde_deals d JOIN enterprises e ON e.id = d.enterprise_id
     WHERE (? = '' OR d.stage = ?) ORDER BY d.created_at DESC LIMIT 200`,
  )
    .bind(stage, stage)
    .all();
  const sum = await c.env.DB.prepare("SELECT COALESCE(SUM(quote_amount), 0) AS quote, COALESCE(SUM(purchase_amount), 0) AS purchase FROM fde_deals").first();
  return c.json({ deals: rows.results || [], totals: sum });
});

adminRoutes.post("/admin/deals/fde", async (c) => {
  const body = await readJson<{ enterprise_id?: string; need_desc?: string }>(c.req.raw);
  if (!body?.enterprise_id) return c.json({ error: "缺少企业" }, 400);
  const id = uid();
  await c.env.DB.prepare("INSERT INTO fde_deals (id, enterprise_id, stage, need_desc, owner_id, created_at) VALUES (?, ?, '需求沟通', ?, ?, ?)")
    .bind(id, body.enterprise_id, body.need_desc || "", c.get("userId"), nowIso())
    .run();
  await audit(c.env.DB, c.get("userId"), "deal.fde_create", "fde_deal", id, clientIp(c.req.raw));
  return c.json({ id });
});

adminRoutes.patch("/admin/deals/fde/:id", async (c) => {
  const body = await readJson<Record<string, string | number>>(c.req.raw);
  if (!body) return c.json({ error: "无法读取" }, 400);
  await c.env.DB.prepare(
    "UPDATE fde_deals SET stage = COALESCE(?, stage), need_desc = COALESCE(?, need_desc), quote_amount = COALESCE(?, quote_amount), quoted_at = COALESCE(?, quoted_at), purchase_amount = COALESCE(?, purchase_amount), purchased_at = COALESCE(?, purchased_at) WHERE id = ?",
  )
    .bind(body.stage || null, body.need_desc ?? null, body.quote_amount ?? null, body.quoted_at || null, body.purchase_amount ?? null, body.purchased_at || null, c.req.param("id"))
    .run();
  await audit(c.env.DB, c.get("userId"), "deal.fde_update", "fde_deal", c.req.param("id"), clientIp(c.req.raw));
  return c.json({ ok: true });
});

adminRoutes.get("/admin/appointments", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT a.*, e.name AS enterprise_name, e.contact_phone FROM appointments a JOIN enterprises e ON e.id = a.enterprise_id ORDER BY a.created_at DESC LIMIT 100`,
  ).all();
  return c.json({ appointments: rows.results || [] });
});

adminRoutes.patch("/admin/appointments/:id", async (c) => {
  const body = await readJson<{ status?: string }>(c.req.raw);
  if (!body?.status || !["待联系", "已联系", "已取消"].includes(body.status)) return c.json({ error: "状态不正确" }, 400);
  await c.env.DB.prepare("UPDATE appointments SET status = ?, handled_by = ?, handled_at = ? WHERE id = ?").bind(body.status, c.get("userId"), nowIso(), c.req.param("id")).run();
  return c.json({ ok: true });
});

adminRoutes.get("/admin/users", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以管理账号" }, 403);
  const rows = await c.env.DB.prepare("SELECT id, phone, role, name, status, must_change_password, created_at FROM users WHERE role != 'enterprise' ORDER BY created_at").all();
  return c.json({ users: rows.results || [] });
});

adminRoutes.post("/admin/users", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以创建账号" }, 403);
  const body = await readJson<{ phone?: string; name?: string; role?: string; client_key?: string }>(c.req.raw);
  if (!body?.phone || !/^1\d{10}$/.test(body.phone)) return c.json({ error: "手机号不正确" }, 400);
  if (!body.client_key || !/^[0-9a-f]{64}$/.test(body.client_key)) return c.json({ error: "临时密码格式不正确" }, 400);
  if (body.role !== "consultant" && body.role !== "admin") return c.json({ error: "角色只能是顾问或管理员" }, 400);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = [...saltBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const { serverPasswordHash } = await import("../../shared/password");
  const hash = await serverPasswordHash(c.env.PEPPER, body.client_key, salt);
  const id = uid();
  await c.env.DB.prepare(
    "INSERT INTO users (id, phone, password_hash, salt, role, name, status, must_change_password, failed_logins, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 0, ?)",
  )
    .bind(id, body.phone, hash, salt, body.role, body.name || "", nowIso())
    .run();
  await audit(c.env.DB, c.get("userId"), "user.create", "user", id, clientIp(c.req.raw), { role: body.role });
  return c.json({ id });
});

adminRoutes.post("/admin/users/:id/reset-password", async (c) => {
  const body = await readJson<{ client_key?: string }>(c.req.raw);
  if (!body?.client_key || !/^[0-9a-f]{64}$/.test(body.client_key)) return c.json({ error: "临时密码格式不正确" }, 400);
  const target = await c.env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(c.req.param("id")).first<{ id: string; role: string }>();
  if (!target) return c.json({ error: "账号不存在" }, 404);
  if (c.get("role") !== "admin" && target.role !== "enterprise") return c.json({ error: "顾问只能重置企业账号" }, 403);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = [...saltBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const { serverPasswordHash } = await import("../../shared/password");
  const hash = await serverPasswordHash(c.env.PEPPER, body.client_key, salt);
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, salt = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?")
    .bind(hash, salt, target.id)
    .run();
  await audit(c.env.DB, c.get("userId"), "user.reset_password", "user", target.id, clientIp(c.req.raw));
  return c.json({ ok: true });
});

adminRoutes.get("/admin/settings", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以看系统设置" }, 403);
  const rows = await c.env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const settings: Record<string, string> = {};
  for (const row of rows.results || []) settings[row.key] = row.key === "wecom_webhook" && row.value ? "已配置" : row.value;
  settings.wecom_webhook_set = (rows.results || []).some((r) => r.key === "wecom_webhook" && r.value) ? "1" : "0";
  return c.json({ settings });
});

adminRoutes.put("/admin/settings", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以改系统设置" }, 403);
  const body = await readJson<{ settings?: Record<string, string> }>(c.req.raw);
  if (!body?.settings) return c.json({ error: "缺少设置" }, 400);
  const allowed = ["consultant_phone", "consultant_wechat", "wecom_webhook", "llm_text_primary", "llm_text_fallback", "llm_vision_primary", "llm_vision_fallback"];
  for (const [key, value] of Object.entries(body.settings)) {
    if (!allowed.includes(key)) continue;
    if (key === "wecom_webhook" && value && !value.startsWith("https://")) return c.json({ error: "webhook 必须是 https 地址" }, 400);
    await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
  }
  await audit(c.env.DB, c.get("userId"), "settings.update", "settings", "settings", clientIp(c.req.raw), { keys: Object.keys(body.settings) });
  return c.json({ ok: true });
});

const VENDORS: Record<string, string> = {
  deepseek: "https://api.deepseek.com",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.cn/v1",
  ark: "https://ark.cn-beijing.volces.com/api/v3",
  qianfan: "https://qianfan.baidubce.com/v2",
  custom: "",
};

adminRoutes.get("/admin/ai-providers", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以配置模型" }, 403);
  const rows = await c.env.DB.prepare(
    "SELECT id, name, vendor, base_url, api_key_last4, model, cap_text, cap_vision, cap_json_mode, timeout_ms, enabled, last_test_at, last_test_ok, last_test_msg, updated_at FROM ai_providers ORDER BY updated_at DESC",
  ).all();
  return c.json({ providers: rows.results || [], vendors: VENDORS });
});

adminRoutes.post("/admin/ai-providers", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以配置模型" }, 403);
  const body = await readJson<{
    name?: string;
    vendor?: string;
    base_url?: string;
    api_key?: string;
    model?: string;
    cap_text?: boolean;
    cap_vision?: boolean;
    cap_json_mode?: boolean;
    timeout_ms?: number;
    enabled?: boolean;
  }>(c.req.raw);
  if (!body?.name || !body.model || !body.vendor) return c.json({ error: "请填写名称、厂商和模型" }, 400);
  if (!body.api_key) return c.json({ error: "请填写 API key" }, 400);
  let enc = "";
  try {
    enc = await encryptSecret(c.env.SETTINGS_ENC_KEY, body.api_key);
  } catch {
    return c.json({ error: "服务器还没有配置 SETTINGS_ENC_KEY" }, 500);
  }
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO ai_providers (id, name, vendor, base_url, api_key_enc, api_key_last4, model, cap_text, cap_vision, cap_json_mode, timeout_ms, enabled, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.name,
      body.vendor,
      body.base_url || VENDORS[body.vendor] || "",
      enc,
      body.api_key.slice(-4),
      body.model,
      body.cap_text === false ? 0 : 1,
      body.cap_vision ? 1 : 0,
      body.cap_json_mode === false ? 0 : 1,
      body.timeout_ms || (body.cap_vision ? 120_000 : 60_000),
      body.enabled === false ? 0 : 1,
      c.get("userId"),
      nowIso(),
    )
    .run();
  await audit(c.env.DB, c.get("userId"), "ai_provider.create", "ai_provider", id, clientIp(c.req.raw), { vendor: body.vendor, model: body.model });
  return c.json({ id });
});

adminRoutes.patch("/admin/ai-providers/:id", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以配置模型" }, 403);
  const body = await readJson<Record<string, unknown>>(c.req.raw);
  if (!body) return c.json({ error: "无法读取" }, 400);
  const current = await c.env.DB.prepare("SELECT * FROM ai_providers WHERE id = ?").bind(c.req.param("id")).first<{ api_key_enc: string }>();
  if (!current) return c.json({ error: "模型不存在" }, 404);
  let enc = current.api_key_enc;
  let last4: string | null = null;
  if (typeof body.api_key === "string" && body.api_key) {
    enc = await encryptSecret(c.env.SETTINGS_ENC_KEY, body.api_key);
    last4 = body.api_key.slice(-4);
  }
  await c.env.DB.prepare(
    `UPDATE ai_providers SET name = COALESCE(?, name), base_url = COALESCE(?, base_url), model = COALESCE(?, model),
      api_key_enc = ?, api_key_last4 = COALESCE(?, api_key_last4), cap_text = COALESCE(?, cap_text), cap_vision = COALESCE(?, cap_vision),
      cap_json_mode = COALESCE(?, cap_json_mode), timeout_ms = COALESCE(?, timeout_ms), enabled = COALESCE(?, enabled), updated_by = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      body.name || null,
      body.base_url || null,
      body.model || null,
      enc,
      last4,
      body.cap_text === undefined ? null : body.cap_text ? 1 : 0,
      body.cap_vision === undefined ? null : body.cap_vision ? 1 : 0,
      body.cap_json_mode === undefined ? null : body.cap_json_mode ? 1 : 0,
      body.timeout_ms || null,
      body.enabled === undefined ? null : body.enabled ? 1 : 0,
      c.get("userId"),
      nowIso(),
      c.req.param("id"),
    )
    .run();
  await audit(c.env.DB, c.get("userId"), "ai_provider.update", "ai_provider", c.req.param("id"), clientIp(c.req.raw));
  return c.json({ ok: true });
});

adminRoutes.post("/admin/ai-providers/:id/test", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以测试" }, 403);
  const mode = c.req.query("mode") === "vision" ? "vision" : "text";
  const row = await c.env.DB.prepare("SELECT * FROM ai_providers WHERE id = ?").bind(c.req.param("id")).first<{
    base_url: string;
    api_key_enc: string;
    model: string;
    cap_json_mode: number;
    timeout_ms: number;
  }>();
  if (!row) return c.json({ error: "模型不存在" }, 404);
  const key = await decryptSecret(c.env.SETTINGS_ENC_KEY, row.api_key_enc);
  const started = Date.now();
  let ok = false;
  let message = "";
  try {
    const content = mode === "vision"
      ? [
          { type: "text", text: "读出图中的纳税人识别号和销售额，只输出 JSON。" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${SAMPLE_PNG}` } },
        ]
      : "只输出 JSON：{\"ok\":true}";
    const payload: Record<string, unknown> = { model: row.model, messages: [{ role: "user", content }] };
    if (row.cap_json_mode && mode === "text") payload.response_format = { type: "json_object" };
    const res = await fetch(joinUrl(row.base_url, "/chat/completions"), {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Math.min(row.timeout_ms || 60_000, 60_000)),
    });
    const text = await res.text();
    ok = res.ok && (mode === "vision" || text.includes("{"));
    message = ok ? `连通，HTTP ${res.status}` : `失败 HTTP ${res.status} ${text.slice(0, 180)}`;
  } catch (err) {
    message = String(err).slice(0, 180);
  }
  const ms = Date.now() - started;
  await c.env.DB.prepare("UPDATE ai_providers SET last_test_at = ?, last_test_ok = ?, last_test_msg = ? WHERE id = ?").bind(nowIso(), ok ? 1 : 0, `${message}（${ms}ms）`, c.req.param("id")).run();
  await audit(c.env.DB, c.get("userId"), "ai_provider.test", "ai_provider", c.req.param("id"), clientIp(c.req.raw), { mode, ok, ms });
  return c.json({ ok, message, ms });
});

adminRoutes.get("/admin/policy-sources", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM policy_sources ORDER BY level, name").all();
  return c.json({ sources: rows.results || [] });
});

adminRoutes.post("/admin/policy-sources", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以配置来源" }, 403);
  const body = await readJson<{ name?: string; level?: string; region_code?: string; list_url?: string; link_pattern?: string; max_pages?: number; enabled?: boolean }>(c.req.raw);
  if (!body?.name || !body.list_url) return c.json({ error: "请填写名称和列表页" }, 400);
  const id = uid();
  await c.env.DB.prepare(
    "INSERT INTO policy_sources (id, name, level, region_code, list_url, link_pattern, max_pages, enabled, consecutive_failures, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
  )
    .bind(id, body.name, body.level || "市", body.region_code || "", body.list_url, body.link_pattern || "", Math.min(body.max_pages || 1, 3), body.enabled ? 1 : 0, c.get("userId"))
    .run();
  return c.json({ id });
});

adminRoutes.patch("/admin/policy-sources/:id", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以配置来源" }, 403);
  const body = await readJson<Record<string, string | number | boolean>>(c.req.raw);
  if (!body) return c.json({ error: "无法读取" }, 400);
  await c.env.DB.prepare(
    "UPDATE policy_sources SET name = COALESCE(?, name), list_url = COALESCE(?, list_url), link_pattern = COALESCE(?, link_pattern), max_pages = COALESCE(?, max_pages), enabled = COALESCE(?, enabled), updated_by = ? WHERE id = ?",
  )
    .bind(body.name || null, body.list_url || null, body.link_pattern ?? null, body.max_pages || null, body.enabled === undefined ? null : body.enabled ? 1 : 0, c.get("userId"), c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

adminRoutes.post("/admin/policy-sources/:id/test", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以试抓" }, 403);
  const source = await c.env.DB.prepare("SELECT * FROM policy_sources WHERE id = ?").bind(c.req.param("id")).first<{ list_url: string; link_pattern: string }>();
  if (!source) return c.json({ error: "来源不存在" }, 404);
  const started = Date.now();
  try {
    const res = await fetch(source.list_url, { headers: { "user-agent": "QiceAIPolicyBot/1.0" }, signal: AbortSignal.timeout(12_000) });
    const html = (await res.text()).slice(0, 80_000);
    let links = 0;
    if (source.link_pattern) {
      let from = 0;
      while (links < 50) {
        const at = html.indexOf(source.link_pattern, from);
        if (at < 0) break;
        links += 1;
        from = at + source.link_pattern.length;
      }
    }
    return c.json({ ok: res.ok, status: res.status, links, ms: Date.now() - started });
  } catch (err) {
    return c.json({ ok: false, message: String(err).slice(0, 180), ms: Date.now() - started });
  }
});

adminRoutes.post("/admin/crawl-runs", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以触发抓取" }, 403);
  const body = await readJson<{ type?: string; source_id?: string }>(c.req.raw);
  const runId = await enqueueCrawl(c.env, body?.type || "initial", c.get("userId"), body?.source_id);
  await audit(c.env.DB, c.get("userId"), "crawl.start", "crawl_run", runId, clientIp(c.req.raw));
  return c.json({ id: runId });
});

adminRoutes.get("/admin/crawl-runs", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM crawl_runs ORDER BY started_at DESC LIMIT 50").all();
  return c.json({ runs: rows.results || [] });
});

adminRoutes.get("/admin/crawl-runs/:id", async (c) => {
  const run = await c.env.DB.prepare("SELECT * FROM crawl_runs WHERE id = ?").bind(c.req.param("id")).first();
  if (!run) return c.json({ error: "记录不存在" }, 404);
  return c.json({ run });
});

adminRoutes.get("/admin/policy-drafts", async (c) => {
  const status = c.req.query("status") || "";
  const rows = await c.env.DB.prepare("SELECT id, title, doc_no, source_url, relevance, status, match_type, created_at, has_pdf FROM policy_drafts WHERE (? = '' OR status = ?) ORDER BY created_at DESC LIMIT 100")
    .bind(status, status)
    .all();
  return c.json({ drafts: rows.results || [] });
});

adminRoutes.get("/admin/policy-drafts/:id", async (c) => {
  const draft = await c.env.DB.prepare("SELECT * FROM policy_drafts WHERE id = ?").bind(c.req.param("id")).first<{ raw_text_r2_key: string | null }>();
  if (!draft) return c.json({ error: "草稿不存在" }, 404);
  let text = "";
  if (draft.raw_text_r2_key) {
    const obj = await c.env.BUCKET.get(draft.raw_text_r2_key);
    if (obj) text = await obj.text();
  }
  return c.json({ draft, text: text.slice(0, 60_000) });
});

adminRoutes.patch("/admin/policy-drafts/:id", async (c) => {
  const body = await readJson<{ title?: string; suggested_definition_json?: unknown; review_note?: string }>(c.req.raw);
  if (!body) return c.json({ error: "无法读取" }, 400);
  if (body.suggested_definition_json) {
    const parsed = parseRule(body.suggested_definition_json);
    if (!parsed.rule) return c.json({ error: parsed.error }, 400);
  }
  await c.env.DB.prepare("UPDATE policy_drafts SET title = COALESCE(?, title), suggested_definition_json = COALESCE(?, suggested_definition_json), review_note = COALESCE(?, review_note) WHERE id = ?")
    .bind(body.title || null, body.suggested_definition_json ? JSON.stringify(body.suggested_definition_json) : null, body.review_note ?? null, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

adminRoutes.post("/admin/policy-drafts/import", async (c) => {
  const body = await readJson<{ url?: string; text?: string }>(c.req.raw);
  if (body?.url && !body.text) {
    const runId = uid();
    await c.env.DB.prepare("INSERT INTO crawl_runs (id, type, triggered_by, started_at, status, pending) VALUES (?, 'manual_url', ?, ?, '进行中', 1)")
      .bind(runId, c.get("userId"), nowIso())
      .run();
    await c.env.CRAWL_QUEUE.send({ kind: "detail", runId, sourceId: "paste", url: body.url });
    return c.json({ run_id: runId, queued: true });
  }
  if (!body?.text?.trim()) return c.json({ error: "请粘贴正文或链接" }, 400);
  const id = await importTextDraft(c.env, body.text.slice(0, 60_000), body.url || "");
  await audit(c.env.DB, c.get("userId"), "policy_draft.import", "policy_draft", id, clientIp(c.req.raw));
  return c.json({ id });
});

adminRoutes.post("/admin/policy-drafts/:id/adopt", async (c) => {
  const draft = await c.env.DB.prepare("SELECT * FROM policy_drafts WHERE id = ?").bind(c.req.param("id")).first<{
    id: string;
    title: string;
    suggested_definition_json: string | null;
    match_policy_id: string | null;
  }>();
  if (!draft?.suggested_definition_json) return c.json({ error: "草稿还没有规则 JSON，请先编辑" }, 400);
  const parsed = parseRule(JSON.parse(draft.suggested_definition_json));
  if (!parsed.rule) return c.json({ error: parsed.error }, 400);
  const body = await readJson<{ policy_id?: string }>(c.req.raw);
  const now = nowIso();
  let policyId = body?.policy_id || draft.match_policy_id;
  let versionId = uid();
  if (!policyId) {
    policyId = uid();
    await c.env.DB.prepare("INSERT INTO policies (id, code, name, category, status, current_version, origin, created_at, updated_at) VALUES (?, ?, ?, ?, '草稿', 1, 'crawl', ?, ?)")
      .bind(policyId, parsed.rule.code, parsed.rule.name, parsed.rule.category, now, now)
      .run();
    await c.env.DB.prepare("INSERT INTO policy_versions (id, policy_id, version, definition_json, basis, url, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)")
      .bind(versionId, policyId, JSON.stringify(parsed.rule), parsed.rule.basis || "", parsed.rule.url || "", c.get("userId"), now)
      .run();
  } else {
    const policy = await c.env.DB.prepare("SELECT current_version FROM policies WHERE id = ?").bind(policyId).first<{ current_version: number }>();
    if (!policy) return c.json({ error: "要更新的政策不存在" }, 404);
    const version = policy.current_version + 1;
    await c.env.DB.prepare("UPDATE policies SET current_version = ?, name = ?, updated_at = ?, status = '草稿' WHERE id = ?").bind(version, parsed.rule.name, now, policyId).run();
    await c.env.DB.prepare("INSERT INTO policy_versions (id, policy_id, version, definition_json, basis, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(versionId, policyId, version, JSON.stringify(parsed.rule), parsed.rule.basis || "", c.get("userId"), now)
      .run();
  }
  await c.env.DB.prepare("UPDATE policy_drafts SET status = '已采纳', reviewed_by = ?, reviewed_at = ?, created_policy_version_id = ? WHERE id = ?")
    .bind(c.get("userId"), now, versionId, draft.id)
    .run();
  await audit(c.env.DB, c.get("userId"), "policy_draft.adopt", "policy_draft", draft.id, clientIp(c.req.raw), { policyId });
  return c.json({ policy_id: policyId, version_id: versionId });
});

adminRoutes.post("/admin/policy-drafts/:id/reject", async (c) => {
  const body = await readJson<{ reason?: string; duplicate?: boolean }>(c.req.raw);
  if (!body?.duplicate && !body?.reason?.trim()) return c.json({ error: "驳回需要填写原因" }, 400);
  const status = body?.duplicate ? "重复" : "已驳回";
  await c.env.DB.prepare("UPDATE policy_drafts SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?")
    .bind(status, body?.reason || "标为重复", c.get("userId"), nowIso(), c.req.param("id"))
    .run();
  await audit(c.env.DB, c.get("userId"), "policy_draft.reject", "policy_draft", c.req.param("id"), clientIp(c.req.raw), { status });
  return c.json({ ok: true });
});

adminRoutes.get("/admin/audit", async (c) => {
  if (!adminOnly(c.get("role"))) return c.json({ error: "只有管理员可以看审计日志" }, 403);
  const rows = await c.env.DB.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200").all();
  return c.json({ logs: rows.results || [] });
});

adminRoutes.get("/admin/regions", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM regions ORDER BY code").all();
  return c.json({ regions: rows.results || [] });
});

void hitLimit;
void profileMap;

/** 1×1 合成 PNG，只用于「测试连接」时给视觉模型一个最小图片，不是真实申报表。 */
const SAMPLE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
