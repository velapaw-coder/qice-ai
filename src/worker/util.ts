/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import { sha256Hex } from "../shared/password";

export type Role = "enterprise" | "consultant" | "admin";

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  CRAWL_QUEUE: Queue;
  REGISTER_LIMITER: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
  ASSETS: Fetcher;
  PEPPER: string;
  SETTINGS_ENC_KEY: string;
  DEEPSEEK_API_KEY?: string;
  /** 本地验收可在 .dev.vars 里调高。生产不设置时按每小时 5 次。 */
  REGISTER_HOURLY_LIMIT?: string;
}

export type Vars = {
  userId: string;
  role: Role;
  phone: string;
  name: string;
  mustChange: boolean;
  enterpriseId: string | null;
};

export type AppEnv = { Bindings: Env; Variables: Vars };
export type App = Hono<AppEnv>;

export const SESSION_COOKIE = "qice_session";
export const SESSION_DAYS = 30;

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(): string {
  return crypto.randomUUID();
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 1_000_000) return null;
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function audit(
  db: D1Database,
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string,
  ip: string,
  meta?: unknown,
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, ip, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(uid(), actorId, action, targetType, targetId, ip, meta ? JSON.stringify(meta).slice(0, 4000) : null, nowIso())
    .run();
}

export function cookie(token: string, secure: boolean, maxAge = SESSION_DAYS * 86400): string {
  const parts = [`${SESSION_COOKIE}=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(secure: boolean): string {
  return cookie("", secure, 0);
}

export async function sessionToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { token, hash: await sha256Hex(token) };
}

export async function loadSession(db: D1Database, request: Request): Promise<{
  id: string;
  phone: string;
  role: Role;
  name: string;
  must_change_password: number;
  enterprise_id: string | null;
} | null> {
  const raw = request.headers.get("cookie") || "";
  const match = raw.match(/(?:^|;\s*)qice_session=([^;]+)/);
  if (!match) return null;
  const hash = await sha256Hex(decodeURIComponent(match[1]!));
  return db
    .prepare(
      `SELECT u.id, u.phone, u.role, u.name, u.must_change_password, e.id AS enterprise_id
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN enterprises e ON e.owner_user_id = u.id
       WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'`,
    )
    .bind(hash, nowIso())
    .first();
}

/** 生产默认每 IP 每小时 5 次。只有本地 .dev.vars 显式调高时才会放开。 */
export function registerHourlyLimit(env: Env): number {
  const raw = env.REGISTER_HOURLY_LIMIT?.trim();
  if (!raw) return 5;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) return 5;
  return n;
}

export async function hitLimit(env: Env, key: string, limit: number, windowSec: number, useBinding = false): Promise<boolean> {
  if (useBinding) {
    try {
      const result = await env.REGISTER_LIMITER.limit({ key });
      if (!result.success) return false;
    } catch (err) {
      console.log(JSON.stringify({ level: "warn", msg: "rate_limit_binding_failed", error: String(err) }));
    }
  }
  const windowStart = String(Math.floor(Date.now() / 1000 / windowSec));
  const row = await env.DB.prepare("SELECT count FROM rate_counters WHERE key = ? AND window_start = ?").bind(key, windowStart).first<{ count: number }>();
  if ((row?.count ?? 0) >= limit) return false;
  await env.DB.prepare(
    "INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1",
  )
    .bind(key, windowStart)
    .run();
  return true;
}

export function beijingDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");
}

export function contentDisposition(filename: string, inline: boolean): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function setting(db: D1Database, key: string): Promise<string> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? "";
}

export async function currentConsent(db: D1Database): Promise<{ version: string; content_md: string } | null> {
  return db.prepare("SELECT version, content_md FROM consent_templates WHERE kind = 'consent' ORDER BY effective_at DESC LIMIT 1").first();
}

export function requireStaff(role: Role): boolean {
  return role === "consultant" || role === "admin";
}

export async function notifyWecom(env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }, text: string): Promise<void> {
  ctx.waitUntil(
    (async () => {
      const url = await setting(env.DB, "wecom_webhook");
      if (!url.startsWith("https://")) return;
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msgtype: "text", text: { content: text.slice(0, 500) } }),
      }).catch(() => undefined);
    })(),
  );
}
