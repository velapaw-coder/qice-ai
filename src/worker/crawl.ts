import { applyModelSuggestion, POLICY_EXTRACTION_PROMPT } from "../shared/rules/suggest";
import { crawlRunIsStale, extractMainText, extractPolicyLinks, junkTitleReason, pageLooksLikePolicy } from "../shared/policyPage";
import { uid, nowIso, type Env } from "./util";
import { setting } from "./util";
import { decryptSecret } from "./crypto";

export type CrawlMessage =
  | { kind: "list"; runId: string; sourceId: string; page: number }
  | { kind: "detail"; runId: string; sourceId: string; url: string; title?: string };

const UA = "QiceAIPolicyBot/1.0 (+https://qice.local/legal/privacy; policy research)";

interface SourceRow {
  id: string;
  name: string;
  region_code: string | null;
  list_url: string;
  link_pattern: string | null;
  max_pages: number;
  enabled: number;
  consecutive_failures: number;
}

async function settle(db: D1Database, runId: string, fields: Record<string, number>, note?: string): Promise<void> {
  const names = ["sources_ok", "sources_failed", "drafts_created", "duplicates", "ignored"] as const;
  const deltas = names.map((name) => fields[name] || 0);
  const now = nowIso();
  await db
    .prepare(
      `UPDATE crawl_runs SET
        sources_ok = sources_ok + ?,
        sources_failed = sources_failed + ?,
        drafts_created = drafts_created + ?,
        duplicates = duplicates + ?,
        ignored = ignored + ?,
        pending = CASE WHEN pending > 0 THEN pending - 1 ELSE 0 END,
        status = CASE
          WHEN pending <= 1 THEN CASE
            WHEN drafts_created + ? = 0 AND sources_ok + ? = 0 AND sources_failed + ? > 0 THEN '失败'
            ELSE '完成' END
          ELSE status END,
        finished_at = CASE WHEN pending <= 1 THEN COALESCE(finished_at, ?) ELSE finished_at END
       WHERE id = ?`,
    )
    .bind(...deltas, deltas[2], deltas[0], deltas[1], now, runId)
    .run();
  if (!note) return;
  const row = await db.prepare("SELECT errors_json FROM crawl_runs WHERE id = ?").bind(runId).first<{ errors_json: string }>();
  let meta: { source_id?: string; source_name?: string; notes?: string[] } = {};
  try {
    const parsed = JSON.parse(row?.errors_json || "{}") as { source_id?: string; source_name?: string; notes?: string[] } | unknown[];
    if (parsed && !Array.isArray(parsed)) meta = parsed;
  } catch {
    meta = {};
  }
  meta.notes = [...(meta.notes || []), note].slice(-8);
  await db.prepare("UPDATE crawl_runs SET errors_json = ? WHERE id = ?").bind(JSON.stringify(meta), runId).run();
}

export async function closeStaleCrawlRuns(db: D1Database, nowMs = Date.now()): Promise<void> {
  const now = new Date(nowMs).toISOString();
  await db
    .prepare(
      `UPDATE crawl_runs SET
        status = CASE WHEN drafts_created = 0 AND sources_ok = 0 AND sources_failed > 0 THEN '失败' ELSE '完成' END,
        finished_at = COALESCE(finished_at, ?),
        pending = 0
       WHERE status = '进行中' AND pending <= 0`,
    )
    .bind(now)
    .run();
  const stuck = await db
    .prepare("SELECT id, started_at, errors_json FROM crawl_runs WHERE status = '进行中'")
    .all<{ id: string; started_at: string; errors_json: string }>();
  for (const run of stuck.results || []) {
    if (!crawlRunIsStale(run.started_at, nowMs)) continue;
    let meta: { source_id?: string; source_name?: string; notes?: string[] } = {};
    try {
      const parsed = JSON.parse(run.errors_json || "{}") as { notes?: string[] } | unknown[];
      if (parsed && !Array.isArray(parsed)) meta = parsed;
    } catch {
      meta = {};
    }
    meta.notes = [...(meta.notes || []), "超过 30 分钟仍未结束，已标记失败"].slice(-8);
    await db
      .prepare("UPDATE crawl_runs SET status = '失败', finished_at = ?, pending = 0, errors_json = ? WHERE id = ? AND status = '进行中'")
      .bind(now, JSON.stringify(meta), run.id)
      .run();
  }
}

function robotsBlocks(text: string): boolean {
  let star = false;
  let lines = 0;
  for (const raw of text.split("\n")) {
    if (++lines > 200) break;
    const line = raw.split("#")[0]!.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (lower.startsWith("user-agent:")) {
      star = lower.slice(11).trim() === "*";
      continue;
    }
    if (star && lower === "disallow: /") return true;
  }
  return false;
}

async function fetchText(url: string, limit: number): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok || !res.body) return { ok: false, status: res.status, text: "", contentType };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  try {
    await reader.cancel();
  } catch {
    /* already closed */
  }
  return { ok: true, status: res.status, text: text.slice(0, limit), contentType };
}


function pageUrl(listUrl: string, page: number): string {
  if (page <= 1) return listUrl;
  const url = new URL(listUrl);
  url.searchParams.set("page", String(page));
  return url.href;
}

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function draftFromText(env: Env, opts: {
  runId: string | null;
  sourceId: string | null;
  url: string;
  text: string;
  title?: string;
  hasPdf?: boolean;
  skipJunk?: boolean;
}): Promise<"created" | "duplicate" | "ignored"> {
  const proposed = (opts.title && !junkTitleReason(opts.title) ? opts.title : "")
    || opts.text.split("\n").map((line) => line.trim()).find((line) => line && !junkTitleReason(line))
    || opts.title
    || "";
  if (opts.skipJunk && !pageLooksLikePolicy(proposed, opts.text)) return "ignored";
  const urlNorm = opts.url.split("#")[0]!;
  const hash = await sha(opts.text.slice(0, 60_000));
  const dup = await env.DB.prepare(
    "SELECT id FROM policy_drafts WHERE url_norm = ? OR content_hash = ? OR (source_id = ? AND title = ? AND title != '') LIMIT 1",
  )
    .bind(urlNorm, hash, opts.sourceId || "", proposed.slice(0, 200))
    .first();
  if (dup) return "duplicate";
  const id = uid();
  const key = `crawl/${id}.txt`;
  await env.BUCKET.put(key, opts.text.slice(0, 60_000), { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  let extracted: Record<string, unknown> = {};
  let definition: unknown = null;
  let relevance = "待审核";
  let ignore = "";
  let confidence: unknown = null;
  const llm = await callPolicyModel(env, opts.text.slice(0, 30_000));
  if (llm) {
    const applied = applyModelSuggestion(llm);
    extracted = applied.extracted;
    relevance = llm.relevant === false ? "忽略" : "相关";
    ignore = String(llm.ignore_reason || "");
    definition = applied.rule;
    confidence = applied.confidence;
  }
  const status = relevance === "忽略" ? "已忽略" : "待审核";
  const title = String((opts.title && !junkTitleReason(opts.title) ? opts.title : "") || llm?.name || proposed || "未命名政策").slice(0, 200);
  await env.DB.prepare(
    `INSERT INTO policy_drafts (id, crawl_run_id, source_id, source_url, url_norm, title, doc_no, issuer, content_hash, raw_text_r2_key, relevance, ignore_reason, extracted_json, suggested_definition_json, confidence_json, has_pdf, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      opts.runId,
      opts.sourceId,
      opts.url,
      urlNorm,
      title,
      String(llm?.doc_no || ""),
      String(llm?.issuer || ""),
      hash,
      key,
      relevance,
      ignore,
      JSON.stringify(extracted),
      definition ? JSON.stringify(definition) : null,
      confidence ? JSON.stringify(confidence) : null,
      opts.hasPdf ? 1 : 0,
      status,
      nowIso(),
    )
    .run();
  return status === "已忽略" ? "ignored" : "created";
}

async function callPolicyModel(env: Env, text: string): Promise<Record<string, unknown> | null> {
  const providerId = await setting(env.DB, "llm_text_primary");
  if (!providerId) return null;
  const row = await env.DB.prepare("SELECT * FROM ai_providers WHERE id = ? AND enabled = 1").bind(providerId).first<{
    base_url: string;
    api_key_enc: string | null;
    model: string;
    cap_json_mode: number;
    timeout_ms: number;
  }>();
  if (!row?.api_key_enc) return null;
  let key = "";
  try {
    key = await decryptSecret(env.SETTINGS_ENC_KEY, row.api_key_enc);
  } catch {
    return null;
  }
  const prompt = `${POLICY_EXTRACTION_PROMPT} 不要输出原文中的个人信息。`;
  const body = {
    model: row.model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: text },
    ],
  };
  if (row.cap_json_mode) (body as { response_format?: unknown }).response_format = { type: "json_object" };
  const res = await fetch(joinUrl(row.base_url, "/chat/completions"), {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.min(row.timeout_ms || 60_000, 60_000)),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content || "";
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { relevant: true, raw: content.slice(0, 2000) };
  }
}

export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, "");
  return path.startsWith("http") ? path : `${b}${path.startsWith("/") ? "" : "/"}${path}`;
}

export async function handleQueue(batch: MessageBatch<CrawlMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await handleMessage(msg.body, env);
    } catch (err) {
      console.log(JSON.stringify({ level: "error", msg: "crawl_failed", error: String(err) }));
      try {
        await settle(env.DB, msg.body.runId, { sources_failed: 1 }, String(err).slice(0, 180));
      } catch {
        /* 计数失败也不能让队列一直重试 */
      }
    }
    msg.ack();
  }
}

async function handleMessage(body: CrawlMessage, env: Env): Promise<void> {
  let settled = false;
  const finish = async (fields: Record<string, number>, note?: string) => {
    if (settled) return;
    settled = true;
    await settle(env.DB, body.runId, fields, note);
  };
  try {
    if (body.kind === "detail" && body.sourceId === "paste") {
      const page = await fetchText(body.url, 80_000);
      if (!page.ok) {
        await finish({ sources_failed: 1 }, `页面 ${page.status}`);
        return;
      }
      const extracted = extractMainText(page.text);
      const result = await draftFromText(env, { runId: body.runId, sourceId: null, url: body.url, text: extracted.text || page.text, title: extracted.title });
      await finish(result === "created" ? { drafts_created: 1 } : result === "duplicate" ? { duplicates: 1 } : { ignored: 1 });
      return;
    }
    const source = await env.DB.prepare("SELECT * FROM policy_sources WHERE id = ?").bind(body.sourceId).first<SourceRow>();
    if (!source) {
      await finish({ sources_failed: 1 }, "来源不存在");
      return;
    }
    if (body.kind === "list") {
      const url = pageUrl(source.list_url, body.page);
      if (body.page === 1) {
        try {
          const robots = await fetchText(new URL("/robots.txt", url).href, 8_000);
          if (robots.ok && robotsBlocks(robots.text)) {
            await env.DB.prepare("UPDATE policy_sources SET last_status = ?, consecutive_failures = consecutive_failures + 1, last_crawled_at = ? WHERE id = ?")
              .bind("robots 禁止", nowIso(), source.id)
              .run();
            await finish({ sources_failed: 1 }, "robots 禁止");
            return;
          }
        } catch {
          /* robots 失败不阻断 */
        }
      }
      const page = await fetchText(url, 80_000);
      if (!page.ok) {
        await env.DB.prepare("UPDATE policy_sources SET last_status = ?, consecutive_failures = consecutive_failures + 1, last_crawled_at = ? WHERE id = ?")
          .bind(`列表页 ${page.status}`, nowIso(), source.id)
          .run();
        await finish({ sources_failed: 1 }, `列表页 ${page.status}`);
        return;
      }
      const links = extractPolicyLinks(page.text, url, source.link_pattern || "");
      await env.DB.prepare("UPDATE policy_sources SET last_status = ?, consecutive_failures = 0, last_crawled_at = ? WHERE id = ?")
        .bind(`文章 ${links.length}`, nowIso(), source.id)
        .run();
      if (links.length) {
        await env.DB.prepare("UPDATE crawl_runs SET pending = pending + ?, items_found = items_found + ? WHERE id = ?").bind(links.length, links.length, body.runId).run();
        for (const link of links) {
          await env.CRAWL_QUEUE.send({ kind: "detail", runId: body.runId, sourceId: source.id, url: link.url, title: link.title } satisfies CrawlMessage, { delaySeconds: 2 });
        }
      }
      if (body.page < source.max_pages && links.length) {
        await env.DB.prepare("UPDATE crawl_runs SET pending = pending + 1 WHERE id = ?").bind(body.runId).run();
        await env.CRAWL_QUEUE.send({ kind: "list", runId: body.runId, sourceId: source.id, page: body.page + 1 } satisfies CrawlMessage, { delaySeconds: 2 });
      }
      await finish({ sources_ok: body.page === 1 ? 1 : 0 });
      return;
    }
    const page = await fetchText(body.url, 80_000);
    if (!page.ok) {
      await finish({ sources_failed: 1 }, `文章 ${page.status}`);
      return;
    }
    const isPdf = page.contentType.includes("pdf") || body.url.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const result = await draftFromText(env, {
        runId: body.runId,
        sourceId: source.id,
        url: body.url,
        title: body.title,
        text: "含 PDF 附件，请顾问用粘贴导入补全文。",
        hasPdf: true,
        skipJunk: !body.title,
      });
      await finish(result === "created" ? { drafts_created: 1 } : result === "duplicate" ? { duplicates: 1 } : { ignored: 1 });
      return;
    }
    const extracted = extractMainText(page.text);
    const result = await draftFromText(env, {
      runId: body.runId,
      sourceId: source.id,
      url: body.url,
      text: extracted.text,
      title: body.title || extracted.title,
      skipJunk: true,
    });
    await finish(result === "created" ? { drafts_created: 1 } : result === "duplicate" ? { duplicates: 1 } : { ignored: 1 });
  } catch (err) {
    await finish({ sources_failed: 1 }, String(err).slice(0, 180));
  }
}

export async function enqueueCrawl(env: Env, type: string, actorId: string | null, sourceId?: string): Promise<string> {
  const runId = uid();
  const sources = sourceId
    ? await env.DB.prepare("SELECT id, name FROM policy_sources WHERE id = ?").bind(sourceId).all<{ id: string; name: string }>()
    : await env.DB.prepare("SELECT id, name FROM policy_sources WHERE enabled = 1").all<{ id: string; name: string }>();
  const rows = sources.results || [];
  const sourceName = sourceId ? rows[0]?.name || "指定来源" : "全部已启用来源";
  await env.DB.prepare(
    "INSERT INTO crawl_runs (id, type, triggered_by, started_at, status, pending, errors_json) VALUES (?, ?, ?, ?, '进行中', ?, ?)",
  )
    .bind(runId, type, actorId, nowIso(), rows.length, JSON.stringify({ source_id: sourceId || "", source_name: sourceName, notes: [] }))
    .run();
  for (const row of rows) {
    await env.CRAWL_QUEUE.send({ kind: "list", runId, sourceId: row.id, page: 1 } satisfies CrawlMessage);
  }
  if (!rows.length) {
    await env.DB.prepare("UPDATE crawl_runs SET status = '完成', finished_at = ?, pending = 0 WHERE id = ?").bind(nowIso(), runId).run();
  }
  return runId;
}

export async function importTextDraft(env: Env, text: string, url: string): Promise<string> {
  const result = await draftFromText(env, { runId: null, sourceId: null, url: url || `paste://${uid()}`, text });
  if (result === "duplicate") return "duplicate";
  const row = await env.DB.prepare("SELECT id FROM policy_drafts ORDER BY created_at DESC LIMIT 1").first<{ id: string }>();
  return row?.id || result;
}
