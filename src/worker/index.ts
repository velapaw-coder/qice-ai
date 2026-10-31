import { Hono } from "hono";
import { handleQueue, type CrawlMessage } from "./crawl";
import { handleScheduled } from "./cron";
import { adminRoutes } from "./routes/admin";
import { enterpriseRoutes } from "./routes/enterprise";
import { llmRoutes } from "./routes/llm";
import { publicRoutes } from "./routes/public";
import { ticketRoutes } from "./routes/tickets";
import { apkAssetResponse, apkDownloadName } from "./apk";
import { decorateHtml, documentHeaders, pageKind, redirectLocation, robotsTxt, sitemapXml, GOOGLE_VERIFY_BODY, GOOGLE_VERIFY_CONTENT_TYPE, GOOGLE_VERIFY_PATH, ROBOTS_CONTENT_TYPE, SITEMAP_CONTENT_TYPE } from "./seo";
import { loadSession, type Env, type Role, type Vars } from "./util";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const location = redirectLocation(c.req.header("host"), url.hostname, url.pathname, url.search);
  if (!location) return next();
  return c.body(null, 301, { location, "cache-control": "public, max-age=3600" });
});

app.use("*", async (c, next) => {
  const path = c.req.path;
  if (path === "/api" || path.startsWith("/api/")) return next();
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
  const normalized = path.replace(/\/+$/, "") || "/";
  if (normalized === "/robots.txt") {
    const headers = { "content-type": ROBOTS_CONTENT_TYPE, "cache-control": "public, max-age=3600" };
    if (c.req.method === "HEAD") return c.body(null, 200, headers);
    return c.body(robotsTxt(), 200, headers);
  }
  if (normalized === "/sitemap.xml") {
    const headers = { "content-type": SITEMAP_CONTENT_TYPE, "cache-control": "public, max-age=3600" };
    if (c.req.method === "HEAD") return c.body(null, 200, headers);
    return c.body(sitemapXml(), 200, headers);
  }
  if (normalized === GOOGLE_VERIFY_PATH) {
    const headers = { "content-type": GOOGLE_VERIFY_CONTENT_TYPE, "cache-control": "public, max-age=3600" };
    if (c.req.method === "HEAD") return c.body(null, 200, headers);
    return c.body(GOOGLE_VERIFY_BODY, 200, headers);
  }
  const apkName = apkDownloadName(normalized);
  if (apkName) {
    const asset = await c.env.ASSETS.fetch(c.req.raw);
    return apkAssetResponse(asset, c.req.method, apkName);
  }
  if (!pageKind(normalized)) return next();
  const assetUrl = new URL(c.req.url);
  assetUrl.pathname = "/index.html";
  assetUrl.search = "";
  const asset = await c.env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
  if (!asset.ok) return next();
  const html = decorateHtml(await asset.text(), normalized);
  const headers = documentHeaders(normalized);
  if (c.req.method === "HEAD") return c.body(null, 200, headers);
  return c.body(html, 200, headers);
});

app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "来源不被允许" }, 403);
    if (c.req.header("x-qice-request") !== "1") return c.json({ error: "缺少请求头" }, 403);
  }
  const session = await loadSession(c.env.DB, c.req.raw).catch(() => null);
  c.set("userId", session?.id || "");
  c.set("role", (session?.role || "enterprise") as Role);
  c.set("phone", session?.phone || "");
  c.set("name", session?.name || "");
  c.set("mustChange", Boolean(session?.must_change_password));
  c.set("enterpriseId", session?.enterprise_id || null);
  if (
    session?.must_change_password &&
    c.req.method !== "GET" &&
    !c.req.path.endsWith("/auth/change-password") &&
    !c.req.path.endsWith("/auth/logout")
  ) {
    return c.json({ error: "请先修改密码", must_change_password: true }, 403);
  }
  if (!session && c.req.path.startsWith("/api/") && !isPublic(c.req.path, c.req.method)) {
    return c.json({ error: "请先登录" }, 401);
  }
  await next();
});

function isPublic(path: string, method: string): boolean {
  if (path === "/api/health") return true;
  if (path.startsWith("/api/legal/")) return method === "GET";
  if (path === "/api/auth/contact") return true;
  if (path === "/api/auth/register" || path === "/api/auth/login") return method === "POST";
  return false;
}

app.route("/api", publicRoutes);
app.route("/api", enterpriseRoutes);
app.route("/api", ticketRoutes);
app.route("/api", adminRoutes);
app.route("/api", llmRoutes);

app.notFound((c) => {
  if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return c.json({ error: "没有这个接口" }, 404);
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.json({ error: "没有这个接口" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});
app.onError((err, c) => {
  console.log(JSON.stringify({ level: "error", message: err.message }));
  return c.json({ error: "服务器繁忙，请稍后再试" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
  queue: (batch: MessageBatch<CrawlMessage>, env: Env) => handleQueue(batch, env),
};
