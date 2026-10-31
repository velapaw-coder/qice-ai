import { contentDisposition } from "./util";

/** 安卓安装包的标准类型。未知扩展名时退回二进制流，避免被当成网页。 */
export const APK_CONTENT_TYPE = "application/vnd.android.package-archive";

/** 成功响应给浏览器和 Cloudflare 边缘的缓存时间：7 天，期间不回源校验。 */
export const APK_CACHE_CONTROL = "public, max-age=604800, immutable";

/** 首页使用的稳定地址。版本号文件放在同一目录，不写进这个链接。 */
export const APK_PUBLIC_PATH = "/downloads/qiceai-android.apk";

const APK_PATH = /^\/downloads\/([A-Za-z0-9][A-Za-z0-9._-]*\.apk)$/;

/** 只接受 downloads 目录里的单个 apk 文件名，避免路径跳出该目录。 */
export function apkDownloadName(pathname: string): string | null {
  const match = pathname.match(APK_PATH);
  return match?.[1] ?? null;
}

/** 边缘缓存只按 GET 地址存放整包，不把 HEAD 或 Range 写进去。 */
export function apkCacheRequest(url: string): Request {
  const parsed = new URL(url);
  parsed.hash = "";
  return new Request(parsed.toString(), { method: "GET" });
}

export type ApkEdgeCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

export type ApkWaitUntil = {
  waitUntil(promise: Promise<unknown>): void;
};

/** Workers 的 caches.default 只在边缘运行时存在。本地单测没有它。 */
export function apkEdgeCache(): ApkEdgeCache | null {
  const storage = (globalThis as { caches?: { default?: ApkEdgeCache } }).caches;
  const cache = storage?.default;
  if (!cache || typeof cache.match !== "function" || typeof cache.put !== "function") return null;
  return cache;
}

/**
 * 把静态资源响应改成安装包下载。
 * 单页回退会把找不到的路径换成 index.html；那种响应不能当安装包发出去。
 */
export async function apkAssetResponse(asset: Response, method: string, filename: string): Promise<Response> {
  const type = (asset.headers.get("content-type") || "").toLowerCase();
  if (!asset.ok || type.includes("text/html")) {
    await asset.body?.cancel();
    return new Response("没有这个安装包", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const headers = new Headers(asset.headers);
  headers.delete("cf-cache-status");
  headers.set("content-type", APK_CONTENT_TYPE);
  headers.set("content-disposition", contentDisposition(filename, false));
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", APK_CACHE_CONTROL);
  if (method === "HEAD") {
    await asset.body?.cancel();
    return new Response(null, { status: asset.status, headers });
  }
  return new Response(asset.body, { status: asset.status, headers });
}

/**
 * 同一边缘节点第二次 GET 直接读 caches.default，不再向静态资源要整包。
 * 找不到的包不写入缓存。
 */
export async function serveApk(
  request: Request,
  assets: { fetch(request: Request): Promise<Response> },
  filename: string,
  cache: ApkEdgeCache | null,
  ctx?: ApkWaitUntil,
): Promise<Response> {
  const method = request.method;
  const key = apkCacheRequest(request.url);
  if (cache && (method === "GET" || method === "HEAD")) {
    const hit = await cache.match(key);
    if (hit) {
      if (method === "HEAD") {
        await hit.body?.cancel();
        return new Response(null, { status: hit.status, headers: hit.headers });
      }
      return hit;
    }
  }
  const asset = await assets.fetch(key);
  const full = await apkAssetResponse(asset, "GET", filename);
  if (!(cache && full.ok && full.status === 200)) {
    if (method === "HEAD") {
      await full.body?.cancel();
      return new Response(null, { status: full.status, headers: full.headers });
    }
    return full;
  }
  const headers = new Headers(full.headers);
  const bytes = new Uint8Array(await full.arrayBuffer());
  const stored = new Response(Uint8Array.from(bytes), { status: 200, headers: new Headers(headers) });
  const put = cache.put(key, stored).catch((err: unknown) => {
    console.log(JSON.stringify({ level: "error", message: err instanceof Error ? err.message : "安装包边缘缓存写入失败" }));
  });
  if (ctx) ctx.waitUntil(put);
  else await put;
  if (method === "HEAD") return new Response(null, { status: 200, headers: new Headers(headers) });
  return new Response(Uint8Array.from(bytes), { status: 200, headers: new Headers(headers) });
}
