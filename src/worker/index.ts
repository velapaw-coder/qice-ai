import { Hono } from "hono";
import { handleQueue, type CrawlMessage } from "./crawl";
import { handleScheduled } from "./cron";
import { adminRoutes } from "./routes/admin";
import { enterpriseRoutes } from "./routes/enterprise";
import { llmRoutes } from "./routes/llm";
import { publicRoutes } from "./routes/public";
import { ticketRoutes } from "./routes/tickets";
import { loadSession, type Env, type Role, type Vars } from "./util";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

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

app.notFound((c) => c.json({ error: "没有这个接口" }, 404));
app.onError((err, c) => {
  console.log(JSON.stringify({ level: "error", message: err.message }));
  return c.json({ error: "服务器繁忙，请稍后再试" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
  queue: (batch: MessageBatch<CrawlMessage>, env: Env) => handleQueue(batch, env),
};
