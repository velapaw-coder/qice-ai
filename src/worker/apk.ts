import { contentDisposition } from "./util";

/** 安卓安装包的标准类型。未知扩展名时退回二进制流，避免被当成网页。 */
export const APK_CONTENT_TYPE = "application/vnd.android.package-archive";

/** 首页使用的稳定地址。版本号文件放在同一目录，不写进这个链接。 */
export const APK_PUBLIC_PATH = "/downloads/qiceai-android.apk";

const APK_PATH = /^\/downloads\/([A-Za-z0-9][A-Za-z0-9._-]*\.apk)$/;

/** 只接受 downloads 目录里的单个 apk 文件名，避免路径跳出该目录。 */
export function apkDownloadName(pathname: string): string | null {
  const match = pathname.match(APK_PATH);
  return match?.[1] ?? null;
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
  headers.set("content-type", APK_CONTENT_TYPE);
  headers.set("content-disposition", contentDisposition(filename, false));
  headers.set("x-content-type-options", "nosniff");
  if (method === "HEAD") {
    await asset.body?.cancel();
    return new Response(null, { status: asset.status, headers });
  }
  return new Response(asset.body, { status: asset.status, headers });
}
