import { uid, nowIso, type Env } from "./util";
import { setting } from "./util";
import { decryptSecret } from "./crypto";

export type CrawlMessage =
  | { kind: "list"; runId: string; sourceId: string; page: number }
  | { kind: "detail"; runId: string; sourceId: string; url: string };

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

async function bump(db: D1Database, runId: string, fields: Record<string, number>, done = false): Promise<void> {
  const sets = Object.entries(fields).map(([k]) => `${k} = ${k} + ?`);
  const values = Object.values(fields);
  sets.push("pending = CASE WHEN pending > 0 THEN pending - 1 ELSE 0 END");
  if (done) sets.push("finished_at = ?", "status = '完成'");
  await db
    .prepare(`UPDATE crawl_runs SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values, ...(done ? [nowIso()] : []), runId)
    .run();
  if (!done) {
    const row = await db.prepare("SELECT pending FROM crawl_runs WHERE id = ?").bind(runId).first<{ pending: number }>();
    if (row && row.pending <= 0) {
      await db.prepare("UPDATE crawl_runs SET status = '完成', finished_at = ? WHERE id = ? AND status = '进行中'").bind(nowIso(), runId).run();
    }
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

/** HTMLRewriter only emits while the response body is consumed. */
async function rewriteHtml(html: string, base: string, prefix: string): Promise<{ text: string; links: string[] }> {
  const links: string[] = [];
  let text = "";
  const res = new HTMLRewriter()
    .on("script, style, noscript", {
      element(el) {
        el.remove();
      },
    })
    .on("a", {
      element(el) {
        if (links.length >= 40 || !prefix) return;
        const href = el.getAttribute("href");
        if (!href) return;
        try {
          const abs = new URL(href, base).href.split("#")[0]!;
          if (abs.startsWith(prefix) && !links.includes(abs)) links.push(abs);
        } catch {
          /* ignore */
        }
      },
    })
    .on("*", {
      text(node) {
        if (text.length >= 60_000) return;
        const t = node.text.trim();
        if (t) text += `${t}\n`;
      },
    })
    .transform(new Response(html));
  await res.text();
  return { text: text.slice(0, 60_000), links };
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
  hasPdf?: boolean;
}): Promise<"created" | "duplicate" | "ignored"> {
  const urlNorm = opts.url.split("#")[0]!;
  const hash = await sha(opts.text.slice(0, 60_000));
  const dup = await env.DB.prepare(
    "SELECT id FROM policy_drafts WHERE url_norm = ? OR content_hash = ? LIMIT 1",
  )
    .bind(urlNorm, hash)
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
    extracted = llm;
    relevance = llm.relevant === false ? "忽略" : "相关";
    ignore = String(llm.ignore_reason || "");
    definition = llm.definition_json || null;
    confidence = llm.confidence || null;
  }
  const status = relevance === "忽略" ? "已忽略" : "待审核";
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
      String(llm?.name || opts.text.split("\n").find((l) => l.trim()) || "未命名政策").slice(0, 200),
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
  const prompt =
    "你是政策研究员。只输出 JSON，字段：relevant(boolean), ignore_reason, name, doc_no, issuer, region, entity, category, hard(string[]), soft(string[]), effective_from, effective_to, confidence(0-1), definition_json。不要输出原文中的个人信息。";
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
      msg.ack();
    } catch (err) {
      console.log(JSON.stringify({ level: "error", msg: "crawl_failed", error: String(err) }));
      msg.retry();
    }
  }
}

async function handleMessage(body: CrawlMessage, env: Env): Promise<void> {
  if (body.kind === "detail" && body.sourceId === "paste") {
    const page = await fetchText(body.url, 80_000);
    if (!page.ok) {
      await bump(env.DB, body.runId, { sources_failed: 1 });
      return;
    }
    const { text } = await rewriteHtml(page.text, body.url, "https://");
    const result = await draftFromText(env, { runId: body.runId, sourceId: null, url: body.url, text });
    await bump(env.DB, body.runId, result === "created" ? { drafts_created: 1 } : result === "duplicate" ? { duplicates: 1 } : { ignored: 1 });
    return;
  }
  const source = await env.DB.prepare("SELECT * FROM policy_sources WHERE id = ?").bind(body.sourceId).first<SourceRow>();
  if (!source) {
    await bump(env.DB, body.runId, { sources_failed: 1 });
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
          await bump(env.DB, body.runId, { sources_failed: 1 });
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
      await bump(env.DB, body.runId, { sources_failed: 1 });
      return;
    }
    const { links } = await rewriteHtml(page.text, url, source.link_pattern || "");
    await env.DB.prepare("UPDATE policy_sources SET last_status = ?, consecutive_failures = 0, last_crawled_at = ? WHERE id = ?")
      .bind(`链接 ${links.length}`, nowIso(), source.id)
      .run();
    if (links.length) {
      await env.DB.prepare("UPDATE crawl_runs SET pending = pending + ?, items_found = items_found + ? WHERE id = ?").bind(links.length, links.length, body.runId).run();
      for (const link of links) {
        await env.CRAWL_QUEUE.send({ kind: "detail", runId: body.runId, sourceId: source.id, url: link } satisfies CrawlMessage, { delaySeconds: 2 });
      }
    }
    if (body.page < source.max_pages && links.length) {
      await env.DB.prepare("UPDATE crawl_runs SET pending = pending + 1 WHERE id = ?").bind(body.runId).run();
      await env.CRAWL_QUEUE.send({ kind: "list", runId: body.runId, sourceId: source.id, page: body.page + 1 } satisfies CrawlMessage, { delaySeconds: 2 });
    }
    await bump(env.DB, body.runId, { sources_ok: body.page === 1 ? 1 : 0 });
    return;
  }
  const page = await fetchText(body.url, 80_000);
  if (!page.ok) {
    await bump(env.DB, body.runId, { sources_failed: 1 });
    return;
  }
  const isPdf = page.contentType.includes("pdf") || body.url.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    const result = await draftFromText(env, { runId: body.runId, sourceId: source.id, url: body.url, text: "含 PDF 附件，请顾问用粘贴导入补全文。", hasPdf: true });
    await bump(env.DB, body.runId, result === "created" ? { drafts_created: 1 } : result === "duplicate" ? { duplicates: 1 } : { ignored: 1 });
    return;
  }
  const { text } = await rewriteHtml(page.text, body.url, source.link_pattern || "https://");
  const result = await draftFromText(env, { runId: body.runId, sourceId: source.id, url: body.url, text });
  await bump(env.DB, body.runId, result === "created" ? { drafts_created: 1 } : result === "duplicate" ? { duplicates: 1 } : { ignored: 1 });
}

export async function enqueueCrawl(env: Env, type: string, actorId: string | null, sourceId?: string): Promise<string> {
  const runId = uid();
  const sources = sourceId
    ? await env.DB.prepare("SELECT id FROM policy_sources WHERE id = ?").bind(sourceId).all<{ id: string }>()
    : await env.DB.prepare("SELECT id FROM policy_sources WHERE enabled = 1").all<{ id: string }>();
  const ids = (sources.results || []).map((s) => s.id);
  await env.DB.prepare(
    "INSERT INTO crawl_runs (id, type, triggered_by, started_at, status, pending) VALUES (?, ?, ?, ?, '进行中', ?)",
  )
    .bind(runId, type, actorId, nowIso(), ids.length)
    .run();
  for (const id of ids) {
    await env.CRAWL_QUEUE.send({ kind: "list", runId, sourceId: id, page: 1 } satisfies CrawlMessage);
  }
  if (!ids.length) {
    await env.DB.prepare("UPDATE crawl_runs SET status = '完成', finished_at = ? WHERE id = ?").bind(nowIso(), runId).run();
  }
  return runId;
}

export async function importTextDraft(env: Env, text: string, url: string): Promise<string> {
  const result = await draftFromText(env, { runId: null, sourceId: null, url: url || `paste://${uid()}`, text });
  if (result === "duplicate") return "duplicate";
  const row = await env.DB.prepare("SELECT id FROM policy_drafts ORDER BY created_at DESC LIMIT 1").first<{ id: string }>();
  return row?.id || result;
}
