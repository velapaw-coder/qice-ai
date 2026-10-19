import { encryptSecret } from "./crypto";
import { closeStaleCrawlRuns, enqueueCrawl } from "./crawl";
import { nowIso, uid, type Env } from "./util";

export async function handleScheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(runCron(event.cron, env));
}

async function runCron(cron: string, env: Env): Promise<void> {
  await closeStaleCrawlRuns(env.DB);
  await ensureDeepseek(env);
  await expirePolicies(env);
  await deleteExpiredFiles(env);
  await purgeWithdrawn(env);
  if (cron === "0 18 1 * *") {
    await enqueueCrawl(env, "monthly", null);
    console.log(JSON.stringify({ level: "info", msg: "monthly_crawl_enqueued" }));
  }
}

async function ensureDeepseek(env: Env): Promise<void> {
  if (!env.DEEPSEEK_API_KEY) return;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_providers").first<{ n: number }>();
  if ((row?.n ?? 0) > 0) return;
  try {
    const enc = await encryptSecret(env.SETTINGS_ENC_KEY, env.DEEPSEEK_API_KEY);
    await env.DB.prepare(
      `INSERT INTO ai_providers (id, name, vendor, base_url, api_key_enc, api_key_last4, model, cap_text, cap_vision, cap_json_mode, timeout_ms, enabled, updated_at)
       VALUES (?, 'DeepSeek', 'deepseek', 'https://api.deepseek.com', ?, ?, 'deepseek-chat', 1, 0, 1, 60000, 1, ?)`,
    )
      .bind(uid(), enc, env.DEEPSEEK_API_KEY.slice(-4), nowIso())
      .run();
    const id = await env.DB.prepare("SELECT id FROM ai_providers WHERE vendor = 'deepseek' LIMIT 1").first<{ id: string }>();
    if (id) await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('llm_text_primary', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(id.id).run();
  } catch (err) {
    console.log(JSON.stringify({ level: "warn", msg: "deepseek_bootstrap_failed", error: String(err) }));
  }
}

async function expirePolicies(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await env.DB.prepare(
    `SELECT p.id, p.code, v.effective_to FROM policies p
     JOIN policy_versions v ON v.policy_id = p.id AND v.version = p.current_version
     WHERE p.status = '启用' AND v.effective_to IS NOT NULL AND v.effective_to != '' AND v.effective_to < ?`,
  )
    .bind(today)
    .all<{ id: string; code: string }>();
  for (const row of rows.results || []) {
    await env.DB.prepare("UPDATE policies SET status = '停用', updated_at = ? WHERE id = ?").bind(nowIso(), row.id).run();
    await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, created_at) VALUES (?, NULL, 'policy.expire', 'policy', ?, ?, ?)")
      .bind(uid(), row.id, JSON.stringify({ code: row.code }), nowIso())
      .run();
  }
}

async function deleteExpiredFiles(env: Env): Promise<void> {
  const rows = await env.DB.prepare("SELECT id, r2_key FROM files WHERE deleted_at IS NULL AND expires_at < ? LIMIT 200")
    .bind(nowIso())
    .all<{ id: string; r2_key: string }>();
  const list = rows.results || [];
  if (!list.length) return;
  await env.BUCKET.delete(list.map((f) => f.r2_key));
  const now = nowIso();
  await env.DB.batch(list.map((f) => env.DB.prepare("UPDATE files SET deleted_at = ? WHERE id = ?").bind(now, f.id)));
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, created_at) VALUES (?, NULL, 'file.expire', 'file', 'batch', ?, ?)")
    .bind(uid(), JSON.stringify({ count: list.length }), now)
    .run();
}

async function purgeWithdrawn(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const ents = await env.DB.prepare(
    `SELECT e.id FROM enterprises e JOIN consents c ON c.enterprise_id = e.id
     WHERE e.status = '已撤回' AND c.revoked_at IS NOT NULL AND c.revoked_at < ? LIMIT 20`,
  )
    .bind(cutoff)
    .all<{ id: string }>();
  for (const ent of ents.results || []) {
    const files = await env.DB.prepare("SELECT id, r2_key FROM files WHERE enterprise_id = ? AND deleted_at IS NULL").bind(ent.id).all<{ id: string; r2_key: string }>();
    const list = files.results || [];
    if (list.length) await env.BUCKET.delete(list.map((f) => f.r2_key));
    const now = nowIso();
    if (list.length) await env.DB.batch(list.map((f) => env.DB.prepare("UPDATE files SET deleted_at = ?, extraction_json = NULL WHERE id = ?").bind(now, f.id)));
    await env.DB.prepare("DELETE FROM enterprise_profile WHERE enterprise_id = ?").bind(ent.id).run();
    await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, created_at) VALUES (?, NULL, 'privacy.purge', 'enterprise', ?, ?, ?)")
      .bind(uid(), ent.id, JSON.stringify({ files: list.length }), now)
      .run();
  }
}
