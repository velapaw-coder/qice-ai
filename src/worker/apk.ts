/**
 * 安卓安装包放在 Cloudflare R2，经 media.qicego.com 分发。
 * 换包时只改 ?v=，首页链接和旧地址跳转会一起更新。
 */
export const APK_DOWNLOAD_URL = "https://media.qicego.com/site/qiceai-android.apk?v=12";

/**
 * R2 开发域名，只作备用记录。页面链接和 307 都不要用它。
 * https://pub-e921aafb91ca4eafb5855ceb8ae23624.r2.dev/site/qiceai-android.apk?v=12
 */
export const APK_R2_DEV_URL = "https://pub-e921aafb91ca4eafb5855ceb8ae23624.r2.dev/site/qiceai-android.apk?v=12";

const APK_PATH = /^\/downloads\/([A-Za-z0-9][A-Za-z0-9._-]*\.apk)$/;

/** 只接受 downloads 目录里的单个 apk 文件名，避免路径跳出该目录。 */
export function apkDownloadName(pathname: string): string | null {
  const match = pathname.match(APK_PATH);
  return match?.[1] ?? null;
}

/** 旧的站内安装包地址一律临时跳到当前 R2 地址，避免被单页回退换成首页。 */
export function apkRedirectTarget(pathname: string): string | null {
  return apkDownloadName(pathname) ? APK_DOWNLOAD_URL : null;
}
