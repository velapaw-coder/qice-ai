import { Hono } from "hono";
import { deriveClientKey, passwordError, phoneError, serverPasswordHash } from "../../shared/password";
import {
  audit,
  clearCookie,
  clientIp,
  cookie,
  currentConsent,
  hitLimit,
  nowIso,
  readJson,
  sessionToken,
  uid,
  type AppEnv,
} from "../util";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/health", (c) => c.json({ ok: true, service: "qice-ai" }));

publicRoutes.get("/legal/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (!["privacy", "consent", "terms"].includes(kind)) return c.json({ error: "没有这篇文档" }, 404);
  const row = await c.env.DB.prepare("SELECT version, content_md, effective_at FROM consent_templates WHERE kind = ? ORDER BY effective_at DESC LIMIT 1")
    .bind(kind)
    .first();
  if (!row) return c.json({ error: "文档还没有发布" }, 404);
  return c.json(row);
});

publicRoutes.get("/auth/contact", async (c) => {
  const phone = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'consultant_phone'").first<{ value: string }>();
  const wechat = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'consultant_wechat'").first<{ value: string }>();
  return c.json({ phone: phone?.value || "", wechat: wechat?.value || "" });
});

publicRoutes.post("/auth/register", async (c) => {
  const body = await readJson<{
    company_name?: string;
    contact_name?: string;
    phone?: string;
    client_key?: string;
    company_website?: string;
  }>(c.req.raw);
  if (!body) return c.json({ error: "请求无法读取" }, 400);
  if (body.company_website) return c.json({ error: "提交无效" }, 400);
  const name = (body.company_name || "").trim();
  const contact = (body.contact_name || "").trim();
  const phone = (body.phone || "").trim();
  const clientKey = (body.client_key || "").trim();
  if (name.length < 2 || name.length > 60) return c.json({ error: "企业名称需要 2–60 个字" }, 400);
  if (contact.length < 2 || contact.length > 20) return c.json({ error: "联系人需要 2–20 个字" }, 400);
  const phoneMsg = phoneError(phone);
  if (phoneMsg) return c.json({ error: phoneMsg }, 400);
  if (!/^[0-9a-f]{64}$/.test(clientKey)) return c.json({ error: "密码格式不正确，请更换浏览器后重试" }, 400);
  const ip = clientIp(c.req.raw);
  const allowed = await hitLimit(c.env, `register:${ip}`, 5, 3600, true);
  if (!allowed) return c.json({ error: "这个网络注册太频繁，请一小时后再试" }, 429);
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first();
  if (exists) return c.json({ error: "这个手机号已经注册" }, 409);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = [...saltBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hash = await serverPasswordHash(c.env.PEPPER, clientKey, salt);
  const userId = uid();
  const entId = uid();
  const now = nowIso();
  const { token, hash: sessionHash } = await sessionToken();
  const exp = new Date(Date.now() + 30 * 86400_000).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users (id, phone, password_hash, salt, role, name, status, must_change_password, failed_logins, created_at) VALUES (?, ?, ?, ?, 'enterprise', ?, 'active', 0, 0, ?)",
    ).bind(userId, phone, hash, salt, contact, now),
    c.env.DB.prepare(
      `INSERT INTO enterprises (id, owner_user_id, name, contact_name, contact_phone, status, status_changed_at, warnings_json, account_status, created_at)
       VALUES (?, ?, ?, ?, ?, '待上传', ?, '[]', 'active', ?)`,
    ).bind(entId, userId, name, contact, phone, now, now),
    c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, ip, ua, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      sessionHash,
      userId,
      exp,
      ip,
      (c.req.header("user-agent") || "").slice(0, 300),
      now,
    ),
  ]);
  await audit(c.env.DB, userId, "auth.register", "enterprise", entId, ip);
  const secure = new URL(c.req.url).protocol === "https:";
  c.header("set-cookie", cookie(token, secure));
  return c.json({ ok: true, must_change_password: false, role: "enterprise" });
});

publicRoutes.post("/auth/login", async (c) => {
  const body = await readJson<{ phone?: string; client_key?: string; company_website?: string }>(c.req.raw);
  if (!body) return c.json({ error: "请求无法读取" }, 400);
  if (body.company_website) return c.json({ error: "提交无效" }, 400);
  const phone = (body.phone || "").trim();
  const clientKey = (body.client_key || "").trim();
  const ip = clientIp(c.req.raw);
  const allowed = await hitLimit(c.env, `login:${ip}`, 30, 3600, false);
  if (!allowed) return c.json({ error: "登录太频繁，请稍后再试" }, 429);
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).first<{
    id: string;
    password_hash: string;
    salt: string;
    role: string;
    status: string;
    must_change_password: number;
    failed_logins: number;
    locked_until: string | null;
  }>();
  if (!user || user.status !== "active") return c.json({ error: "手机号或密码不正确" }, 401);
  if (user.locked_until && user.locked_until > nowIso()) return c.json({ error: "失败次数过多，请 15 分钟后再试" }, 423);
  const hash = await serverPasswordHash(c.env.PEPPER, clientKey, user.salt);
  if (hash !== user.password_hash) {
    const fails = user.failed_logins + 1;
    const lock = fails >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await c.env.DB.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?").bind(fails, lock, user.id).run();
    return c.json({ error: "手机号或密码不正确" }, 401);
  }
  await c.env.DB.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").bind(user.id).run();
  const { token, hash: sessionHash } = await sessionToken();
  const exp = new Date(Date.now() + 30 * 86400_000).toISOString();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, ip, ua, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
    sessionHash,
    user.id,
    exp,
    ip,
    (c.req.header("user-agent") || "").slice(0, 300),
    nowIso(),
  ).run();
  await audit(c.env.DB, user.id, "auth.login", "user", user.id, ip);
  c.header("set-cookie", cookie(token, new URL(c.req.url).protocol === "https:"));
  return c.json({ ok: true, role: user.role, must_change_password: Boolean(user.must_change_password) });
});

publicRoutes.post("/auth/logout", async (c) => {
  const raw = c.req.header("cookie") || "";
  const match = raw.match(/(?:^|;\s*)qice_session=([^;]+)/);
  if (match) {
    const { sha256Hex } = await import("../../shared/password");
    const hash = await sha256Hex(decodeURIComponent(match[1]!));
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(hash).run();
  }
  c.header("set-cookie", clearCookie(new URL(c.req.url).protocol === "https:"));
  return c.json({ ok: true });
});

publicRoutes.post("/auth/change-password", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "请先登录" }, 401);
  const body = await readJson<{ old_client_key?: string; new_client_key?: string }>(c.req.raw);
  if (!body?.new_client_key || !/^[0-9a-f]{64}$/.test(body.new_client_key)) return c.json({ error: "新密码格式不正确" }, 400);
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<{
    password_hash: string;
    salt: string;
    phone: string;
    must_change_password: number;
  }>();
  if (!user) return c.json({ error: "账号不存在" }, 404);
  if (!body.old_client_key) return c.json({ error: "请填写当前密码" }, 400);
  const oldHash = await serverPasswordHash(c.env.PEPPER, body.old_client_key, user.salt);
  if (oldHash !== user.password_hash) return c.json({ error: "当前密码不正确" }, 401);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = [...saltBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hash = await serverPasswordHash(c.env.PEPPER, body.new_client_key, salt);
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, salt = ?, must_change_password = 0 WHERE id = ?").bind(hash, salt, userId).run();
  await audit(c.env.DB, userId, "auth.change_password", "user", userId, clientIp(c.req.raw));
  return c.json({ ok: true });
});

void deriveClientKey;
void passwordError;
void currentConsent;
