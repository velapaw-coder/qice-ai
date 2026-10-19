import { Hono } from "hono";
import { decryptSecret } from "../crypto";
import { clientIp, nowIso, requireStaff, setting, type AppEnv } from "../util";
import { joinUrl } from "../crawl";
import { POLICY_EXTRACTION_PROMPT } from "../../shared/rules/suggest";

const TASKS = new Set(["vat_text", "ss_text", "vat_image", "ss_image", "policy_text"]);

const PROMPTS: Record<string, string> = {
  vat_text: "从下面已脱敏的增值税申报表文本提取 JSON：company_name, uscc, taxpayer_type(general|small_scale), entity_hint, periods[{start,end,sales,vat_payable,surtax}]。不要输出姓名或证件号。",
  ss_text: "从下面已脱敏的社保清单文本提取 JSON：company_name, uscc, region_hint, headcount, ss_total_month, ss_personal_month, young_candidates。不要输出姓名或证件号。",
  vat_image: "这是一张合成或客户上传的增值税申报表图片。只输出 JSON：company_name, uscc, taxpayer_type, periods[{start,end,sales,vat_payable,surtax}], unreadable(boolean)。不要输出证件号。",
  ss_image: "这是一张社保清单图片。只输出汇总 JSON：company_name, uscc, headcount, ss_personal_month, ss_total_month, young_candidates, unreadable(boolean)。不要输出姓名或证件号。",
  policy_text: POLICY_EXTRACTION_PROMPT,
};

export const llmRoutes = new Hono<AppEnv>();

llmRoutes.post("/llm/extract", async (c) => {
  const task = c.req.query("task") || c.req.header("x-qice-task") || "";
  if (!TASKS.has(task)) return c.json({ error: "不支持的识别任务" }, 400);
  const role = c.get("role");
  const enterpriseId = c.get("enterpriseId") || c.req.query("enterprise_id");
  if (!enterpriseId) return c.json({ error: "缺少企业" }, 400);
  if (role === "enterprise") {
    if (c.get("enterpriseId") !== enterpriseId) return c.json({ error: "无权调用" }, 403);
    const ent = await c.env.DB.prepare("SELECT status FROM enterprises WHERE id = ?").bind(enterpriseId).first<{ status: string }>();
    if (!ent || !["待上传", "识别中", "需补传"].includes(ent.status)) return c.json({ error: "当前状态不能识别" }, 409);
  } else if (!requireStaff(role)) return c.json({ error: "无权调用" }, 403);
  const day = nowIso().slice(0, 10);
  const usage = await c.env.DB.prepare("SELECT count FROM llm_usage WHERE enterprise_id = ? AND day = ?").bind(enterpriseId, day).first<{ count: number }>();
  if ((usage?.count ?? 0) >= 80) return c.json({ error: "今天的识别次数已用完" }, 429);
  const len = Number(c.req.header("content-length") || 0);
  if (len > 4 * 1024 * 1024) return c.json({ error: "识别内容不超过 4MB" }, 413);
  const vision = task.endsWith("image");
  const fallback = c.req.query("fallback") === "1";
  const settingKey = vision ? (fallback ? "llm_vision_fallback" : "llm_vision_primary") : fallback ? "llm_text_fallback" : "llm_text_primary";
  const providerId = await setting(c.env.DB, settingKey);
  if (!providerId) return c.json({ error: fallback ? "没有配置备用模型" : "没有配置主用模型" }, 409);
  const provider = await c.env.DB.prepare("SELECT * FROM ai_providers WHERE id = ? AND enabled = 1").bind(providerId).first<{
    base_url: string;
    api_key_enc: string | null;
    model: string;
    cap_json_mode: number;
    timeout_ms: number;
    cap_text: number;
    cap_vision: number;
  }>();
  if (!provider?.api_key_enc) return c.json({ error: "模型没有可用的密钥" }, 409);
  if (vision && !provider.cap_vision) return c.json({ error: "这个模型没有开视觉能力" }, 409);
  if (!vision && !provider.cap_text) return c.json({ error: "这个模型没有开文本能力" }, 409);
  const apiKey = await decryptSecret(c.env.SETTINGS_ENC_KEY, provider.api_key_enc);
  await c.env.DB.prepare(
    "INSERT INTO llm_usage (enterprise_id, day, count) VALUES (?, ?, 1) ON CONFLICT(enterprise_id, day) DO UPDATE SET count = count + 1",
  )
    .bind(enterpriseId, day)
    .run();
  const prompt = PROMPTS[task]!;
  const prefix = vision
    ? `{"model":${JSON.stringify(provider.model)},"messages":[{"role":"user","content":[{"type":"text","text":${JSON.stringify(prompt)}},{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,`
    : `{"model":${JSON.stringify(provider.model)}${provider.cap_json_mode ? ',"response_format":{"type":"json_object"}' : ''},"messages":[{"role":"system","content":${JSON.stringify(prompt)}},{"role":"user","content":`;
  const suffix = vision ? `"}}]}]}` : `}]}`;
  if (!c.req.raw.body) return c.json({ error: "没有识别内容" }, 400);
  const stream = concat(prefix, limitBytes(c.req.raw.body, 4 * 1024 * 1024), suffix);
  const timeout = provider.timeout_ms || (vision ? 120_000 : 60_000);
  const init = {
    method: "POST" as const,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: stream,
    signal: AbortSignal.timeout(timeout),
    duplex: "half" as const,
  };
  const res = await fetch(joinUrl(provider.base_url, "/chat/completions"), init);
  console.log(JSON.stringify({ level: "info", msg: "llm_proxy", task, status: res.status, enterpriseId, ip: clientIp(c.req.raw) }));
  return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
});

function limitBytes(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) throw new Error("识别内容超过 4MB");
        controller.enqueue(chunk);
      },
    }),
  );
}

function concat(prefix: string, body: ReadableStream<Uint8Array>, suffix: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const head = enc.encode(prefix);
  const tail = enc.encode(suffix);
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(head);
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) controller.enqueue(value);
      }
      controller.enqueue(tail);
      controller.close();
    },
  });
}
