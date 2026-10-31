import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeHtml } from "../../src/client/home/markup";
import { APK_DOWNLOAD_URL, APK_R2_DEV_URL, apkDownloadName, apkRedirectTarget } from "../../src/worker/apk";
import worker from "../../src/worker/index";
import { decorateHtml, pageKind } from "../../src/worker/seo";

const shell = `<!doctype html><html><head></head><body><div id="root"></div></body></html>`;

function assets() {
  return {
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/downloads/") && path.endsWith(".apk")) {
        throw new Error("安装包不应再由 Worker 读出");
      }
      return new Response("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  };
}

describe("安卓安装包", () => {
  it("首页卡片指向 media.qicego.com，文案不变", () => {
    expect(APK_DOWNLOAD_URL).toBe("https://media.qicego.com/site/qiceai-android.apk?v=12");
    expect(APK_R2_DEV_URL).toBe("https://pub-e921aafb91ca4eafb5855ceb8ae23624.r2.dev/site/qiceai-android.apk?v=12");
    expect(homeHtml).toContain(`href="${APK_DOWNLOAD_URL}"`);
    expect(homeHtml).not.toContain(APK_R2_DEV_URL);
    expect(homeHtml).not.toContain("r2.dev");
    expect(homeHtml).not.toContain('download="qiceai-android.apk"');
    expect(homeHtml).toContain('data-testid="android-download"');
    expect(homeHtml).toContain("下载安卓版");
    expect(homeHtml).toContain("允许安装未知来源");
    expect(homeHtml).toContain("打开后进入 qicego.com");
    expect(pageKind("/downloads/qiceai-android.apk")).toBeNull();
    const html = decorateHtml(shell, "/");
    expect(html).toContain(`href="${APK_DOWNLOAD_URL}">下载安卓版</a>`);
    expect(html).not.toContain("r2.dev");
  });

  it("仓库不再携带安装包文件", () => {
    expect(existsSync("public/downloads/qiceai-android.apk")).toBe(false);
    expect(existsSync("public/downloads/qiceai-v1.2.0.apk")).toBe(false);
  });

  it("只把 downloads 目录里的 apk 文件名当成旧地址", () => {
    expect(apkDownloadName("/downloads/qiceai-android.apk")).toBe("qiceai-android.apk");
    expect(apkDownloadName("/downloads/qiceai-v1.2.0.apk")).toBe("qiceai-v1.2.0.apk");
    expect(apkRedirectTarget("/downloads/qiceai-android.apk")).toBe(APK_DOWNLOAD_URL);
    expect(apkRedirectTarget("/downloads/qiceai-v1.2.0.apk")).toBe(APK_DOWNLOAD_URL);
    expect(apkRedirectTarget("/downloads/other-build.apk")).toBe(APK_DOWNLOAD_URL);
    expect(apkDownloadName("/downloads/../secret.apk")).toBeNull();
    expect(apkRedirectTarget("/downloads/../secret.apk")).toBeNull();
    expect(apkDownloadName("/downloads/qiceai-android.apk.txt")).toBeNull();
    expect(apkDownloadName("/app/downloads/qiceai-android.apk")).toBeNull();
    expect(apkDownloadName("/downloads/qiceai%20android.apk")).toBeNull();
  });

  it("旧的 /downloads/*.apk 307 到 media.qicego.com，不会回成首页", async () => {
    const env = { ASSETS: assets() };
    for (const path of ["/downloads/qiceai-android.apk", "/downloads/qiceai-v1.2.0.apk", "/downloads/missing.apk"]) {
      const res = await worker.fetch(new Request(`https://qicego.com${path}`), env);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(APK_DOWNLOAD_URL);
      expect(res.headers.get("location")).not.toContain("r2.dev");
      expect(await res.text()).not.toContain("<html");
    }
    const head = await worker.fetch(new Request("https://qicego.com/downloads/qiceai-android.apk/", { method: "HEAD" }), env);
    expect(head.status).toBe(307);
    expect(head.headers.get("location")).toBe(APK_DOWNLOAD_URL);

    const home = await worker.fetch(new Request("https://qicego.com/"), env);
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toContain(APK_DOWNLOAD_URL);
  });
});
