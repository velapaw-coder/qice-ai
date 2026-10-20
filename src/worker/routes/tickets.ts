import { Hono } from "hono";
import {
  ATTACHMENT_MAX_COUNT,
  attachmentError,
  canReadTicket,
  contactPhoneError,
  isTicketStatus,
  isUnread,
  qrError,
  ticketFieldError,
  wechatError,
  type TicketAccess,
} from "../../shared/tickets";
import { getEnterprise } from "../match";
import { audit, clientIp, contentDisposition, nowIso, readJson, requireStaff, setting, uid, type AppEnv } from "../util";

export const ticketRoutes = new Hono<AppEnv>();

interface TicketRow {
  id: string;
  enterprise_id: string;
  title: string;
  status: string;
  created_by: string;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  assigned_consultant_id: string | null;
  enterprise_name: string;
}

function accessOf(c: { get: (key: "role" | "userId" | "enterpriseId") => string | null }, ticket: TicketRow): TicketAccess {
  return {
    role: c.get("role") as TicketAccess["role"],
    userId: c.get("userId") || "",
    enterpriseId: (c.get("enterpriseId") as string | null) || null,
    ticketEnterpriseId: ticket.enterprise_id,
    assignedConsultantId: ticket.assigned_consultant_id,
    assigneeId: ticket.assignee_id,
  };
}

async function loadTicket(c: { env: AppEnv["Bindings"]; get: (key: "role" | "userId" | "enterpriseId") => string | null; req: { param: (name: string) => string } }) {
  const ticket = await c.env.DB.prepare(
    `SELECT t.*, e.assigned_consultant_id, e.name AS enterprise_name
     FROM tickets t JOIN enterprises e ON e.id = t.enterprise_id WHERE t.id = ?`,
  )
    .bind(c.req.param("id"))
    .first<TicketRow>();
  if (!ticket) return { error: "工单不存在", status: 404 as const };
  if (!canReadTicket(accessOf(c, ticket))) return { error: "无权查看这张工单", status: 403 as const };
  return { ticket };
}

function scopeSql(role: string): string {
  if (role === "admin") return "1 = 1";
  if (role === "enterprise") return "t.enterprise_id = ?";
  return "(e.assigned_consultant_id = ? OR t.assignee_id = ?)";
}

function scopeBinds(c: { get: (key: "role" | "userId" | "enterpriseId") => string | null }): string[] {
  const role = c.get("role") || "";
  if (role === "admin") return [];
  if (role === "enterprise") return [c.get("enterpriseId") || ""];
  const id = c.get("userId") || "";
  return [id, id];
}

ticketRoutes.get("/tickets/unread", async (c) => {
  if (!c.get("userId")) return c.json({ error: "请先登录" }, 401);
  const role = c.get("role");
  if (role === "enterprise" && !c.get("enterpriseId")) return c.json({ count: 0 });
  const rows = await c.env.DB.prepare(
    `SELECT t.id,
       (SELECT author_id FROM ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_author,
       (SELECT created_at FROM ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_at,
       (SELECT last_read_at FROM ticket_reads WHERE ticket_id = t.id AND user_id = ?) AS last_read
     FROM tickets t JOIN enterprises e ON e.id = t.enterprise_id
     WHERE ${scopeSql(role)}`,
  )
    .bind(c.get("userId"), ...scopeBinds(c))
    .all<{ id: string; last_author: string | null; last_at: string | null; last_read: string | null }>();
  const count = (rows.results || []).filter((row) => isUnread(row.last_at || "", row.last_author || "", c.get("userId"), row.last_read)).length;
  return c.json({ count });
});

ticketRoutes.get("/tickets", async (c) => {
  if (!c.get("userId")) return c.json({ error: "请先登录" }, 401);
  const role = c.get("role");
  if (role === "enterprise" && !c.get("enterpriseId")) return c.json({ tickets: [] });
  const status = c.req.query("status") || "";
  const statusSql = status && isTicketStatus(status) ? " AND t.status = ?" : "";
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.updated_at, t.assignee_id, e.name AS enterprise_name,
       (SELECT author_id FROM ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_author,
       (SELECT created_at FROM ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_at,
       (SELECT last_read_at FROM ticket_reads WHERE ticket_id = t.id AND user_id = ?) AS last_read
     FROM tickets t JOIN enterprises e ON e.id = t.enterprise_id
     WHERE ${scopeSql(role)}${statusSql}
     ORDER BY t.updated_at DESC LIMIT 100`,
  )
    .bind(c.get("userId"), ...scopeBinds(c), ...(statusSql ? [status] : []))
    .all<{
      id: string;
      title: string;
      status: string;
      updated_at: string;
      assignee_id: string | null;
      enterprise_name: string;
      last_author: string | null;
      last_at: string | null;
      last_read: string | null;
    }>();
  const tickets = (rows.results || []).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    updated_at: row.updated_at,
    assignee_id: row.assignee_id,
    enterprise_name: row.enterprise_name,
    unread: isUnread(row.last_at || "", row.last_author || "", c.get("userId"), row.last_read),
  }));
  return c.json({ tickets });
});

ticketRoutes.post("/tickets", async (c) => {
  if (c.get("role") !== "enterprise" || !c.get("enterpriseId")) return c.json({ error: "请使用企业账号提交工单" }, 403);
  const body = await readJson<{ title?: string; content?: string }>(c.req.raw);
  const titleError = ticketFieldError(body?.title || "", "标题", 80);
  if (titleError) return c.json({ error: titleError }, 400);
  const contentError = ticketFieldError(body?.content || "", "内容", 4000);
  if (contentError) return c.json({ error: contentError }, 400);
  const ent = await getEnterprise(c.env.DB, c.get("enterpriseId")!);
  if (!ent) return c.json({ error: "企业不存在" }, 404);
  const id = uid();
  const messageId = uid();
  const now = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO tickets (id, enterprise_id, title, status, created_by, assignee_id, created_at, updated_at) VALUES (?, ?, ?, '待处理', ?, ?, ?, ?)",
  )
    .bind(id, ent.id, body!.title!.trim(), c.get("userId"), ent.assigned_consultant_id || null, now, now)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES (?, ?, ?, 'enterprise', ?, ?)",
  )
    .bind(messageId, id, c.get("userId"), body!.content!.trim(), now)
    .run();
  await audit(c.env.DB, c.get("userId"), "ticket.create", "ticket", id, clientIp(c.req.raw), { enterprise_id: ent.id });
  return c.json({ id, message_id: messageId });
});

ticketRoutes.get("/tickets/attachments/:attachmentId", async (c) => {
  const file = await attachmentFor(c, c.req.param("attachmentId"));
  if ("error" in file) return c.json({ error: file.error }, file.status);
  const obj = await c.env.BUCKET.get(file.row.r2_key);
  if (!obj) return c.json({ error: "附件不存在" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": file.row.mime || "application/octet-stream",
      "content-disposition": contentDisposition(file.row.filename, true),
      "cache-control": "private, max-age=60",
    },
  });
});

ticketRoutes.put("/tickets/attachments/:attachmentId/content", async (c) => {
  const file = await attachmentFor(c, c.req.param("attachmentId"));
  if ("error" in file) return c.json({ error: file.error }, file.status);
  const len = Number(c.req.header("content-length") || 0);
  const problem = attachmentError(file.row.mime, len);
  if (problem) return c.json({ error: problem }, 413);
  if (!c.req.raw.body) return c.json({ error: "没有文件内容" }, 400);
  await c.env.BUCKET.put(file.row.r2_key, c.req.raw.body, { httpMetadata: { contentType: file.row.mime } });
  await c.env.DB.prepare("UPDATE ticket_attachments SET size = ? WHERE id = ?").bind(len, file.row.id).run();
  return c.json({ ok: true });
});

ticketRoutes.get("/tickets/:id", async (c) => {
  const loaded = await loadTicket(c);
  if ("error" in loaded) return c.json({ error: loaded.error }, loaded.status);
  const messages = await c.env.DB.prepare(
    `SELECT m.id, m.author_id, m.author_role, m.body, m.created_at, u.name AS author_name
     FROM ticket_messages m JOIN users u ON u.id = m.author_id
     WHERE m.ticket_id = ? ORDER BY m.created_at`,
  )
    .bind(loaded.ticket.id)
    .all<{ id: string; author_id: string; author_role: string; body: string; created_at: string; author_name: string }>();
  const files = await c.env.DB.prepare(
    "SELECT id, message_id, filename, mime, size FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at",
  )
    .bind(loaded.ticket.id)
    .all<{ id: string; message_id: string; filename: string; mime: string; size: number }>();
  const byMessage = new Map<string, { id: string; filename: string; mime: string; size: number }[]>();
  for (const file of files.results || []) {
    const list = byMessage.get(file.message_id) || [];
    list.push({ id: file.id, filename: file.filename, mime: file.mime, size: file.size });
    byMessage.set(file.message_id, list);
  }
  await c.env.DB.prepare(
    "INSERT INTO ticket_reads (ticket_id, user_id, last_read_at) VALUES (?, ?, ?) ON CONFLICT(ticket_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at",
  )
    .bind(loaded.ticket.id, c.get("userId"), nowIso())
    .run();
  return c.json({
    ticket: {
      id: loaded.ticket.id,
      title: loaded.ticket.title,
      status: loaded.ticket.status,
      enterprise_id: loaded.ticket.enterprise_id,
      enterprise_name: loaded.ticket.enterprise_name,
      assignee_id: loaded.ticket.assignee_id,
      updated_at: loaded.ticket.updated_at,
    },
    messages: (messages.results || []).map((message) => ({ ...message, attachments: byMessage.get(message.id) || [] })),
  });
});

ticketRoutes.post("/tickets/:id/messages", async (c) => {
  const loaded = await loadTicket(c);
  if ("error" in loaded) return c.json({ error: loaded.error }, loaded.status);
  const body = await readJson<{ content?: string }>(c.req.raw);
  const contentError = ticketFieldError(body?.content || "", "内容", 4000);
  if (contentError) return c.json({ error: contentError }, 400);
  const messageId = uid();
  const now = nowIso();
  const staff = requireStaff(c.get("role"));
  const nextStatus = staff && loaded.ticket.status === "待处理" ? "处理中" : loaded.ticket.status;
  await c.env.DB.prepare(
    "INSERT INTO ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(messageId, loaded.ticket.id, c.get("userId"), c.get("role"), body!.content!.trim(), now)
    .run();
  await c.env.DB.prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?").bind(nextStatus, now, loaded.ticket.id).run();
  await audit(c.env.DB, c.get("userId"), "ticket.reply", "ticket", loaded.ticket.id, clientIp(c.req.raw));
  return c.json({ id: messageId, status: nextStatus });
});

ticketRoutes.post("/tickets/:id/attachments", async (c) => {
  const loaded = await loadTicket(c);
  if ("error" in loaded) return c.json({ error: loaded.error }, loaded.status);
  const body = await readJson<{ message_id?: string; filename?: string; mime?: string; size?: number }>(c.req.raw);
  if (!body?.message_id || !body.filename || !body.mime) return c.json({ error: "附件信息不完整" }, 400);
  const problem = attachmentError(body.mime, Number(body.size || 0));
  if (problem) return c.json({ error: problem }, 400);
  const message = await c.env.DB.prepare("SELECT id FROM ticket_messages WHERE id = ? AND ticket_id = ?")
    .bind(body.message_id, loaded.ticket.id)
    .first<{ id: string }>();
  if (!message) return c.json({ error: "这条消息不存在" }, 404);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM ticket_attachments WHERE message_id = ?")
    .bind(message.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= ATTACHMENT_MAX_COUNT) return c.json({ error: "一条消息最多 3 个附件" }, 400);
  const id = uid();
  const key = `tickets/${loaded.ticket.id}/${id}`;
  await c.env.DB.prepare(
    "INSERT INTO ticket_attachments (id, ticket_id, message_id, r2_key, filename, mime, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, loaded.ticket.id, message.id, key, body.filename.slice(0, 180), body.mime, Number(body.size), c.get("userId"), nowIso())
    .run();
  return c.json({ id });
});

ticketRoutes.post("/tickets/:id/close", async (c) => {
  const loaded = await loadTicket(c);
  if ("error" in loaded) return c.json({ error: loaded.error }, loaded.status);
  if (c.get("role") !== "enterprise") return c.json({ error: "只有企业可以关闭工单" }, 403);
  if (loaded.ticket.status !== "已解决") {
    const now = nowIso();
    await c.env.DB.prepare("UPDATE tickets SET status = '已解决', updated_at = ? WHERE id = ?").bind(now, loaded.ticket.id).run();
    await audit(c.env.DB, c.get("userId"), "ticket.close", "ticket", loaded.ticket.id, clientIp(c.req.raw));
  }
  return c.json({ ok: true, status: "已解决" });
});

ticketRoutes.post("/tickets/:id/reopen", async (c) => {
  const loaded = await loadTicket(c);
  if ("error" in loaded) return c.json({ error: loaded.error }, loaded.status);
  if (c.get("role") !== "enterprise") return c.json({ error: "只有企业可以重新打开工单" }, 403);
  if (loaded.ticket.status !== "待处理") {
    const now = nowIso();
    await c.env.DB.prepare("UPDATE tickets SET status = '待处理', updated_at = ? WHERE id = ?").bind(now, loaded.ticket.id).run();
    await audit(c.env.DB, c.get("userId"), "ticket.reopen", "ticket", loaded.ticket.id, clientIp(c.req.raw));
  }
  return c.json({ ok: true, status: "待处理" });
});

ticketRoutes.patch("/tickets/:id", async (c) => {
  if (!requireStaff(c.get("role"))) return c.json({ error: "需要顾问或管理员权限" }, 403);
  const loaded = await loadTicket(c);
  if ("error" in loaded) return c.json({ error: loaded.error }, loaded.status);
  const body = await readJson<{ status?: string; assignee_id?: string | null }>(c.req.raw);
  if (!body) return c.json({ error: "无法读取" }, 400);
  if (body.status && !isTicketStatus(body.status)) return c.json({ error: "状态不正确" }, 400);
  if (Object.prototype.hasOwnProperty.call(body, "assignee_id") && c.get("role") !== "admin") {
    return c.json({ error: "只有管理员可以转派" }, 403);
  }
  let assignee = loaded.ticket.assignee_id;
  if (Object.prototype.hasOwnProperty.call(body, "assignee_id")) {
    if (!body.assignee_id) assignee = null;
    else {
      const user = await c.env.DB.prepare("SELECT id, role FROM users WHERE id = ? AND status = 'active'").bind(body.assignee_id).first<{ id: string; role: string }>();
      if (!user || user.role === "enterprise") return c.json({ error: "只能转派给顾问或管理员" }, 400);
      assignee = user.id;
    }
  }
  const status = body.status || loaded.ticket.status;
  await c.env.DB.prepare("UPDATE tickets SET status = ?, assignee_id = ?, updated_at = ? WHERE id = ?")
    .bind(status, assignee, nowIso(), loaded.ticket.id)
    .run();
  if (body.status && body.status !== loaded.ticket.status) {
    await audit(c.env.DB, c.get("userId"), "ticket.status", "ticket", loaded.ticket.id, clientIp(c.req.raw), { status: body.status });
  }
  if (Object.prototype.hasOwnProperty.call(body, "assignee_id") && assignee !== loaded.ticket.assignee_id) {
    await audit(c.env.DB, c.get("userId"), "ticket.reassign", "ticket", loaded.ticket.id, clientIp(c.req.raw), { assignee_id: assignee });
  }
  return c.json({ ok: true, status, assignee_id: assignee });
});

async function attachmentFor(
  c: { env: AppEnv["Bindings"]; get: (key: "role" | "userId" | "enterpriseId") => string | null },
  attachmentId: string,
) {
  const row = await c.env.DB.prepare(
    `SELECT a.id, a.r2_key, a.filename, a.mime, t.id AS ticket_id, t.enterprise_id, t.assignee_id, e.assigned_consultant_id, e.name AS enterprise_name,
            t.title, t.status, t.created_by, t.created_at, t.updated_at
     FROM ticket_attachments a
     JOIN tickets t ON t.id = a.ticket_id
     JOIN enterprises e ON e.id = t.enterprise_id
     WHERE a.id = ?`,
  )
    .bind(attachmentId)
    .first<TicketRow & { r2_key: string; filename: string; mime: string; ticket_id: string }>();
  if (!row) return { error: "附件不存在", status: 404 as const };
  const ticket: TicketRow = { ...row, id: row.ticket_id };
  if (!canReadTicket(accessOf(c, ticket))) return { error: "无权查看这张工单", status: 403 as const };
  return { row };
}

ticketRoutes.get("/consultant", async (c) => {
  if (c.get("role") !== "enterprise" || !c.get("enterpriseId")) return c.json({ error: "请使用企业账号查看" }, 403);
  const card = await consultantCard(c.env.DB, c.get("enterpriseId")!);
  const { qr_key: _qr, ...publicCard } = card;
  return c.json(publicCard);
});

ticketRoutes.get("/consultant/qr", async (c) => {
  if (c.get("role") !== "enterprise" || !c.get("enterpriseId")) return c.json({ error: "请使用企业账号查看" }, 403);
  const card = await consultantCard(c.env.DB, c.get("enterpriseId")!);
  if (!card.assigned || !card.qr_key) return c.json({ error: "还没有二维码" }, 404);
  const obj = await c.env.BUCKET.get(card.qr_key);
  if (!obj) return c.json({ error: "还没有二维码" }, 404);
  return new Response(obj.body, {
    headers: { "content-type": obj.httpMetadata?.contentType || "image/png", "cache-control": "private, max-age=60" },
  });
});

ticketRoutes.put("/me/contact", async (c) => {
  if (!requireStaff(c.get("role"))) return c.json({ error: "只有顾问或管理员可以填写联系方式" }, 403);
  const body = await readJson<{ contact_phone?: string; wechat_id?: string }>(c.req.raw);
  if (!body) return c.json({ error: "无法读取" }, 400);
  const phone = String(body.contact_phone || "");
  const wechat = String(body.wechat_id || "");
  const phoneProblem = contactPhoneError(phone);
  if (phoneProblem) return c.json({ error: phoneProblem }, 400);
  const wechatProblem = wechatError(wechat);
  if (wechatProblem) return c.json({ error: wechatProblem }, 400);
  await c.env.DB.prepare("UPDATE users SET contact_phone = ?, wechat_id = ? WHERE id = ?")
    .bind(phone.trim(), wechat.trim(), c.get("userId"))
    .run();
  await audit(c.env.DB, c.get("userId"), "user.contact_update", "user", c.get("userId"), clientIp(c.req.raw));
  return c.json({ ok: true });
});

ticketRoutes.put("/me/contact/qr", async (c) => {
  if (!requireStaff(c.get("role"))) return c.json({ error: "只有顾问或管理员可以上传二维码" }, 403);
  const mime = c.req.header("content-type") || "";
  const len = Number(c.req.header("content-length") || 0);
  const problem = qrError(mime, len);
  if (problem) return c.json({ error: problem }, 400);
  if (!c.req.raw.body) return c.json({ error: "没有图片" }, 400);
  const key = `staff-qr/${c.get("userId")}`;
  await c.env.BUCKET.put(key, c.req.raw.body, { httpMetadata: { contentType: mime } });
  await c.env.DB.prepare("UPDATE users SET wechat_qr_r2_key = ? WHERE id = ?").bind(key, c.get("userId")).run();
  await audit(c.env.DB, c.get("userId"), "user.contact_update", "user", c.get("userId"), clientIp(c.req.raw), { qr: true });
  return c.json({ ok: true });
});

ticketRoutes.delete("/me/contact/qr", async (c) => {
  if (!requireStaff(c.get("role"))) return c.json({ error: "只有顾问或管理员可以删除二维码" }, 403);
  const row = await c.env.DB.prepare("SELECT wechat_qr_r2_key FROM users WHERE id = ?").bind(c.get("userId")).first<{ wechat_qr_r2_key: string | null }>();
  if (row?.wechat_qr_r2_key) await c.env.BUCKET.delete(row.wechat_qr_r2_key);
  await c.env.DB.prepare("UPDATE users SET wechat_qr_r2_key = NULL WHERE id = ?").bind(c.get("userId")).run();
  return c.json({ ok: true });
});

ticketRoutes.get("/me/contact/qr", async (c) => {
  if (!requireStaff(c.get("role"))) return c.json({ error: "无权查看" }, 403);
  const row = await c.env.DB.prepare("SELECT wechat_qr_r2_key FROM users WHERE id = ?").bind(c.get("userId")).first<{ wechat_qr_r2_key: string | null }>();
  if (!row?.wechat_qr_r2_key) return c.json({ error: "还没有二维码" }, 404);
  const obj = await c.env.BUCKET.get(row.wechat_qr_r2_key);
  if (!obj) return c.json({ error: "还没有二维码" }, 404);
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType || "image/png", "cache-control": "private, max-age=60" } });
});

export async function consultantCard(db: AppEnv["Bindings"]["DB"], enterpriseId: string) {
  const ent = await getEnterprise(db, enterpriseId);
  const placeholder = (await setting(db, "general_contact_placeholder")) || "顾问分配中。如需联系，请使用通用电话或微信。";
  const generalPhone = await setting(db, "consultant_phone");
  const generalWechat = await setting(db, "consultant_wechat");
  const base = { placeholder, general_phone: generalPhone, general_wechat: generalWechat, qr_key: "" as string };
  if (!ent?.assigned_consultant_id) return { ...base, assigned: false as const, consultant: null };
  const user = await db.prepare(
    "SELECT id, name, contact_phone, wechat_id, wechat_qr_r2_key FROM users WHERE id = ? AND status = 'active' AND role != 'enterprise'",
  )
    .bind(ent.assigned_consultant_id)
    .first<{ id: string; name: string; contact_phone: string; wechat_id: string; wechat_qr_r2_key: string | null }>();
  if (!user) return { ...base, assigned: false as const, consultant: null };
  return {
    ...base,
    assigned: true as const,
    qr_key: user.wechat_qr_r2_key || "",
    consultant: {
      name: user.name,
      contact_phone: user.contact_phone || "",
      wechat_id: user.wechat_id || "",
      has_qr: Boolean(user.wechat_qr_r2_key),
    },
  };
}
