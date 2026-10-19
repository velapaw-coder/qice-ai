import { Hono } from "hono";
import { formatPublicBand, suggestBand, type EstimateBand } from "../../shared/bands";
import { DISCLAIMER } from "../../shared/rules/evaluate";
import { extractionLooksUnsafe } from "../../shared/profile";
import { isValidUscc } from "../../shared/uscc";
import { applyExtraction, fileExtractions, getEnterprise, runMatch, setStatus } from "../match";
import { consentFailure, withUploadConsent } from "../consent";
import { audit, clientIp, currentConsent, notifyWecom, nowIso, readJson, requireStaff, uid, type AppEnv } from "../util";

export const enterpriseRoutes = new Hono<AppEnv>();

function gate(c: { get: (k: "userId") => string }) {
  return Boolean(c.get("userId"));
}

enterpriseRoutes.get("/me", async (c) => {
  if (!gate(c)) return c.json({ error: "请先登录" }, 401);
  const ent = c.get("enterpriseId")
    ? await getEnterprise(c.env.DB, c.get("enterpriseId")!)
    : null;
  return c.json({
    user: {
      id: c.get("userId"),
      phone: c.get("phone"),
      name: c.get("name"),
      role: c.get("role"),
      must_change_password: c.get("mustChange"),
    },
    enterprise: ent
      ? {
          id: ent.id,
          name: ent.name,
          contact_name: ent.contact_name,
          status: ent.status,
          status_note: ent.status_note,
          warnings: JSON.parse(ent.warnings_json || "[]"),
          city: ent.city,
          entity_type: ent.entity_type,
        }
      : null,
  });
});

enterpriseRoutes.get("/consent/current", async (c) => {
  if (c.get("role") !== "enterprise") return c.json({ error: "只有企业账号可以查看授权书" }, 403);
  const tpl = await currentConsent(c.env.DB);
  const agreed = await c.env.DB.prepare(
    "SELECT consent_version, revoked_at, agreed_at FROM consents WHERE enterprise_id = ? ORDER BY agreed_at DESC LIMIT 1",
  )
    .bind(c.get("enterpriseId"))
    .first<{ consent_version: string; revoked_at: string | null; agreed_at: string }>();
  const active = Boolean(agreed && !agreed.revoked_at && tpl && agreed.consent_version === tpl.version);
  return c.json({ template: tpl, active, agreed });
});

enterpriseRoutes.post("/files", async (c) => {
  if (c.get("role") !== "enterprise") return c.json({ error: "请使用企业账号上传" }, 403);
  const ent = await getEnterprise(c.env.DB, c.get("enterpriseId")!);
  if (!ent || !["待上传", "识别中", "需补传"].includes(ent.status)) return c.json({ error: "当前状态不能上传" }, 409);
  const body = await readJson<{
    kind?: string;
    source_type?: string;
    filename?: string;
    size?: number;
    mime?: string;
    sha256?: string;
    parent_file_id?: string;
  }>(c.req.raw);
  if (!body?.kind || !body.filename || !body.source_type) return c.json({ error: "文件信息不完整" }, 400);
  if (!["vat", "social_security"].includes(body.kind)) return c.json({ error: "文件类型不正确" }, 400);
  const size = Number(body.size || 0);
  if (size <= 0 || size > 10 * 1024 * 1024) return c.json({ error: "单个表格或 PDF 不能超过 10MB" }, 400);
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM files WHERE enterprise_id = ? AND kind = ? AND deleted_at IS NULL AND parent_file_id IS NULL",
  )
    .bind(ent.id, body.kind)
    .first<{ n: number }>();
  const max = body.kind === "vat" ? 30 : 10;
  if ((count?.n ?? 0) >= max) return c.json({ error: body.kind === "vat" ? "增值税申报表最多 30 个文件" : "社保清单最多 10 个文件" }, 400);
  const id = uid();
  const key = `files/${crypto.randomUUID()}`;
  const exp = new Date(Date.now() + 180 * 86400_000).toISOString();
  const uploadedAt = nowIso();
  const filename = body.filename.slice(0, 180);
  const sourceType = body.source_type;
  const kind = body.kind;
  try {
    await withUploadConsent(
      c.env.DB,
      "record",
      {
        enterpriseId: ent.id,
        userId: c.get("userId"),
        ip: clientIp(c.req.raw),
        ua: c.req.header("user-agent") || "",
      },
      async () => {
        await c.env.DB.prepare(
          `INSERT INTO files (id, enterprise_id, kind, source_type, parent_file_id, uploaded_by, parse_status, r2_key, filename, mime, size, sha256, uploaded_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 'enterprise', 'pending', ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(id, ent.id, kind, sourceType, body.parent_file_id || null, key, filename, body.mime || "", size, body.sha256 || null, uploadedAt, exp)
          .run();
        return id;
      },
      async (fileId) => {
        await c.env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fileId).run();
      },
    );
  } catch (err) {
    const blocked = consentFailure(err);
    if (blocked) return c.json({ error: blocked.error }, blocked.status);
    throw err;
  }
  if (ent.status === "待上传") await setStatus(c.env.DB, ent.id, "识别中", null);
  await audit(c.env.DB, c.get("userId"), "file.register", "file", id, clientIp(c.req.raw), { kind });
  return c.json({ id, r2_key: key });
});

enterpriseRoutes.put("/files/:id/content", async (c) => {
  const file = await c.env.DB.prepare("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("id")).first<{
    id: string;
    enterprise_id: string;
    r2_key: string;
    mime: string;
    filename: string;
  }>();
  if (!file) return c.json({ error: "文件不存在" }, 404);
  const allowed = c.get("enterpriseId") === file.enterprise_id || requireStaff(c.get("role"));
  if (!allowed) return c.json({ error: "无权上传这个文件" }, 403);
  const len = Number(c.req.header("content-length") || 0);
  if (!len || len > 10 * 1024 * 1024) return c.json({ error: "请标明文件大小，且不超过 10MB" }, 413);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "没有文件内容" }, 400);
  try {
    await withUploadConsent(
      c.env.DB,
      "require",
      {
        enterpriseId: file.enterprise_id,
        userId: c.get("userId"),
        ip: clientIp(c.req.raw),
        ua: c.req.header("user-agent") || "",
      },
      async () => {
        await c.env.BUCKET.put(file.r2_key, body, { httpMetadata: { contentType: file.mime || "application/octet-stream" } });
        return file.r2_key;
      },
      async (r2Key) => {
        await c.env.BUCKET.delete(r2Key);
      },
    );
  } catch (err) {
    const blocked = consentFailure(err);
    if (blocked) return c.json({ error: blocked.error }, blocked.status);
    throw err;
  }
  await c.env.DB.prepare("UPDATE files SET size = ? WHERE id = ?").bind(len, file.id).run();
  return c.json({ ok: true });
});

enterpriseRoutes.put("/files/:id/extraction", async (c) => {
  const file = await c.env.DB.prepare("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("id")).first<{
    id: string;
    enterprise_id: string;
  }>();
  if (!file) return c.json({ error: "文件不存在" }, 404);
  const allowed = c.get("enterpriseId") === file.enterprise_id || requireStaff(c.get("role"));
  if (!allowed) return c.json({ error: "无权提交识别结果" }, 403);
  const len = Number(c.req.header("content-length") || 0);
  if (len > 48_000) return c.json({ error: "识别结果过大" }, 413);
  const payload = await readJson<Record<string, unknown>>(c.req.raw);
  if (!payload) return c.json({ error: "识别结果无法读取" }, 400);
  const unsafe = extractionLooksUnsafe(payload);
  if (unsafe) return c.json({ error: unsafe }, 400);
  if (payload.uscc && !isValidUscc(String(payload.uscc))) {
    payload.uscc = null;
    payload.uscc_valid = false;
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    warnings.push("纳税人识别号校验位未通过，已标为未知");
    payload.warnings = warnings;
  }
  const periods = Array.isArray(payload.periods) ? payload.periods : [];
  const first = periods[0] as { start?: string; end?: string } | undefined;
  await c.env.DB.prepare(
    "UPDATE files SET parse_status = ?, detected_type = ?, parse_note = ?, extraction_json = ?, period_start = ?, period_end = ? WHERE id = ?",
  )
    .bind(
      String(payload.parse_status || "failed"),
      payload.detected_type ? String(payload.detected_type) : null,
      payload.parse_note ? String(payload.parse_note).slice(0, 500) : null,
      JSON.stringify(payload),
      first?.start || null,
      first?.end || null,
      file.id,
    )
    .run();
  return c.json({ ok: true });
});

enterpriseRoutes.get("/files", async (c) => {
  if (c.get("role") !== "enterprise") return c.json({ error: "无权查看" }, 403);
  const rows = await c.env.DB.prepare(
    "SELECT id, kind, source_type, filename, size, parse_status, detected_type, parse_note, period_start, period_end, uploaded_at, parent_file_id FROM files WHERE enterprise_id = ? AND deleted_at IS NULL ORDER BY uploaded_at",
  )
    .bind(c.get("enterpriseId"))
    .all();
  return c.json({ files: rows.results || [] });
});

enterpriseRoutes.delete("/files/:id", async (c) => {
  const file = await c.env.DB.prepare("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("id")).first<{
    id: string;
    enterprise_id: string;
    r2_key: string;
  }>();
  if (!file || file.enterprise_id !== c.get("enterpriseId")) return c.json({ error: "文件不存在" }, 404);
  const ent = await getEnterprise(c.env.DB, file.enterprise_id);
  if (!ent || !["待上传", "识别中", "需补传"].includes(ent.status)) return c.json({ error: "当前状态不能删除文件" }, 409);
  await c.env.BUCKET.delete(file.r2_key);
  await c.env.DB.prepare("UPDATE files SET deleted_at = ? WHERE id = ? OR parent_file_id = ?").bind(nowIso(), file.id, file.id).run();
  const left = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE enterprise_id = ? AND deleted_at IS NULL AND parent_file_id IS NULL")
    .bind(ent.id)
    .first<{ n: number }>();
  if ((left?.n ?? 0) === 0 && ent.status === "识别中") await setStatus(c.env.DB, ent.id, "待上传", null);
  await audit(c.env.DB, c.get("userId"), "file.delete", "file", file.id, clientIp(c.req.raw));
  return c.json({ ok: true });
});

enterpriseRoutes.post("/submit", async (c) => {
  if (c.get("role") !== "enterprise") return c.json({ error: "请使用企业账号提交" }, 403);
  const ent = await getEnterprise(c.env.DB, c.get("enterpriseId")!);
  if (!ent || !["待上传", "识别中", "需补传"].includes(ent.status)) return c.json({ error: "当前状态不能提交" }, 409);
  const body = await readJson<{ manual?: boolean }>(c.req.raw);
  const files = await c.env.DB.prepare(
    "SELECT id, kind, parse_status FROM files WHERE enterprise_id = ? AND deleted_at IS NULL AND parent_file_id IS NULL",
  )
    .bind(ent.id)
    .all<{ id: string; kind: string; parse_status: string }>();
  const list = files.results || [];
  const ok = (kind: string) => list.some((f) => f.kind === kind && (f.parse_status === "success" || f.parse_status === "partial"));
  const any = (kind: string) => list.some((f) => f.kind === kind);
  if (body?.manual) {
    if (!any("vat") || !any("social_security")) return c.json({ error: "两个资料位都至少要有一个文件" }, 400);
  } else if (!ok("vat") || !ok("social_security")) {
    return c.json({ error: "增值税申报表和社保清单都至少要有一份识别成功的文件。也可以点「交给顾问处理」。" }, 400);
  }
  const extracted = await fileExtractions(c.env.DB, ent.id);
  const built = await applyExtraction(c.env, ent, extracted.map((e) => e.extraction), Boolean(body?.manual));
  if (built.unsupported) {
    await setStatus(c.env.DB, ent.id, "暂不支持", built.entity === "individual" ? "主体类型为个体工商户，线上暂不支持" : "主体类型不在线上服务范围");
    await audit(c.env.DB, c.get("userId"), "enterprise.submit_unsupported", "enterprise", ent.id, clientIp(c.req.raw));
    return c.json({ ok: true, status: "暂不支持", rule_ms: 0 });
  }
  const matched = await runMatch(c.env, ent.id, { forceStatus: "待复核" });
  await audit(c.env.DB, c.get("userId"), "enterprise.submit", "enterprise", ent.id, clientIp(c.req.raw), { rule_ms: matched.ruleMs });
  await notifyWecom(c.env, c.executionCtx, `企策AI：${ent.name} 的资料已提交，进入待复核。 /admin/enterprises/${ent.id}`);
  return c.json({ ok: true, status: "待复核", rule_ms: matched.ruleMs, warnings: built.warnings });
});

enterpriseRoutes.get("/report", async (c) => {
  if (c.get("role") !== "enterprise") return c.json({ error: "无权查看" }, 403);
  const ent = await getEnterprise(c.env.DB, c.get("enterpriseId")!);
  if (!ent) return c.json({ error: "企业不存在" }, 404);
  const published = await c.env.DB.prepare(
    "SELECT * FROM assessments WHERE enterprise_id = ? AND status = 'published' ORDER BY version DESC LIMIT 1",
  )
    .bind(ent.id)
    .first<{ id: string; snapshot_json: string; estimate_low: number | null; estimate_high: number | null; published_at: string }>();
  if (ent.status !== "已发布" || !published) {
    const messages: Record<string, string> = {
      待上传: "请上传两份资料",
      识别中: "正在识别资料，请保持页面打开",
      需补传: ent.status_note || "请按提示补充资料",
      待复核: "系统已出初稿，顾问正在复核，复核后会电话联系您",
      暂不支持: "您的主体类型暂不在线上服务范围内，顾问会与您联系",
      已撤回: "授权已撤回，资料将在 7 天内删除",
    };
    return c.json({ status: ent.status, status_note: ent.status_note, published: false, message: messages[ent.status] || "处理中" });
  }
  const snap = JSON.parse(published.snapshot_json || "{}") as { items?: Record<string, unknown>[]; band?: EstimateBand; public_estimate?: string };
  const band = snap.band || suggestBand(Number(published.estimate_high ?? published.estimate_low ?? 0));
  const items = (snap.items || publishedItems(await loadItems(c.env.DB, published.id))).map(stripItem);
  return c.json({
    status: ent.status,
    published: true,
    published_at: published.published_at,
    public_estimate: snap.public_estimate || formatPublicBand(band),
    band,
    disclaimer: DISCLAIMER,
    items,
  });
});

function stripItem(item: Record<string, unknown>) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    tier: item.tier,
    verify_text: item.verify_text,
    reason: item.reason,
    conditions_text: item.conditions_text,
  };
}

async function loadItems(db: D1Database, assessmentId: string) {
  const rows = await db.prepare("SELECT * FROM assessment_items WHERE assessment_id = ? ORDER BY sort").bind(assessmentId).all<Record<string, unknown>>();
  return rows.results || [];
}

function publishedItems(items: Record<string, unknown>[]) {
  return items;
}

enterpriseRoutes.post("/appointments", async (c) => {
  if (c.get("role") !== "enterprise") return c.json({ error: "无权预约" }, 403);
  const ent = await getEnterprise(c.env.DB, c.get("enterpriseId")!);
  if (!ent || ent.status !== "已发布") return c.json({ error: "方案发布后才能预约顾问" }, 409);
  const body = await readJson<{ slot_pref?: string; topic?: string; note?: string }>(c.req.raw);
  const slots = ["工作日上午", "工作日下午", "随时"];
  const topics = ["policy", "fde", "both"];
  if (!body?.slot_pref || !slots.includes(body.slot_pref)) return c.json({ error: "请选择沟通时间" }, 400);
  if (!body.topic || !topics.includes(body.topic)) return c.json({ error: "请选择想聊的方向" }, 400);
  const id = uid();
  await c.env.DB.prepare(
    "INSERT INTO appointments (id, enterprise_id, slot_pref, topic, note, status, created_at) VALUES (?, ?, ?, ?, ?, '待联系', ?)",
  )
    .bind(id, ent.id, body.slot_pref, body.topic, (body.note || "").slice(0, 500), nowIso())
    .run();
  await audit(c.env.DB, c.get("userId"), "appointment.create", "appointment", id, clientIp(c.req.raw));
  await notifyWecom(c.env, c.executionCtx, `企策AI：${ent.name} 提交了新预约。 /admin/enterprises/${ent.id}`);
  return c.json({ ok: true, id });
});

enterpriseRoutes.post("/privacy/revoke", async (c) => {
  if (c.get("role") !== "enterprise") return c.json({ error: "无权操作" }, 403);
  const entId = c.get("enterpriseId")!;
  await c.env.DB.prepare("UPDATE consents SET revoked_at = ? WHERE enterprise_id = ? AND revoked_at IS NULL").bind(nowIso(), entId).run();
  await setStatus(c.env.DB, entId, "已撤回", "企业撤回授权");
  await audit(c.env.DB, c.get("userId"), "privacy.revoke", "enterprise", entId, clientIp(c.req.raw));
  return c.json({ ok: true });
});

enterpriseRoutes.post("/privacy/delete-request", async (c) => {
  if (c.get("role") !== "enterprise") return c.json({ error: "无权操作" }, 403);
  const entId = c.get("enterpriseId")!;
  await c.env.DB.prepare("UPDATE consents SET revoked_at = ? WHERE enterprise_id = ? AND revoked_at IS NULL").bind(nowIso(), entId).run();
  await setStatus(c.env.DB, entId, "已撤回", "企业申请删除资料");
  await audit(c.env.DB, c.get("userId"), "privacy.delete_request", "enterprise", entId, clientIp(c.req.raw));
  return c.json({ ok: true });
});
