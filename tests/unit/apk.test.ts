import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeHtml } from "../../src/client/home/markup";
import worker from "../../src/worker/index";
import { APK_CONTENT_TYPE, APK_PUBLIC_PATH, apkAssetResponse, apkDownloadName } from "../../src/worker/apk";
import { decorateHtml, pageKind } from "../../src/worker/seo";

const shell = `<!doctype html><html><head></head><body><div id="root"></div></body></html>`;

function assets() {
  const files = new Set(["/downloads/qiceai-android.apk", "/downloads/qiceai-v1.2.0.apk"]);
  return {
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      if (files.has(path)) {
        return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]), {
          headers: { "content-type": "application/octet-stream", etag: '"apk"' },
        });
      }
      return new Response("<!doctype html><html><body>spa</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  };
}

describe("安卓安装包", () => {
  it("首页卡片指向稳定下载地址，安装包路径不是页面", () => {
    expect(homeHtml).toContain(`href="${APK_PUBLIC_PATH}"`);
    expect(homeHtml).toContain('download="qiceai-android.apk"');
    expect(homeHtml).toContain('data-testid="android-download"');
    expect(homeHtml).toContain("下载安卓版");
    expect(homeHtml).toContain("允许安装未知来源");
    expect(homeHtml).toContain("打开后进入 qicego.com");
    expect(pageKind(APK_PUBLIC_PATH)).toBeNull();
    expect(pageKind("/downloads/qiceai-v1.2.0.apk")).toBeNull();
    const html = decorateHtml(shell, "/");
    expect(html).toContain('href="/downloads/qiceai-android.apk">下载安卓版</a>');
  });

  it("public 目录同时放稳定文件名和 v1.2.0，内容相同", () => {
    const stable = readFileSync("public/downloads/qiceai-android.apk");
    const versioned = readFileSync("public/downloads/qiceai-v1.2.0.apk");
    expect(stable.equals(versioned)).toBe(true);
    expect(stable.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(stable.includes(Buffer.from("com.qicego.app", "utf16le"))).toBe(true);
    expect(stable.includes(Buffer.from("APK Sig Block 42"))).toBe(true);
  });

  it("只接受 downloads 目录里的 apk 文件名", () => {
    expect(apkDownloadName("/downloads/qiceai-android.apk")).toBe("qiceai-android.apk");
    expect(apkDownloadName("/downloads/qiceai-v1.2.0.apk")).toBe("qiceai-v1.2.0.apk");
    expect(apkDownloadName("/downloads/../secret.apk")).toBeNull();
    expect(apkDownloadName("/downloads/qiceai-android.apk.txt")).toBeNull();
    expect(apkDownloadName("/app/downloads/qiceai-android.apk")).toBeNull();
    expect(apkDownloadName("/downloads/qiceai%20android.apk")).toBeNull();
  });

  it("响应使用安卓安装包类型，单页回退的网页改成 404", async () => {
    const file = new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
      headers: { "content-type": "application/octet-stream", etag: '"apk"' },
    });
    const ok = await apkAssetResponse(file, "GET", "qiceai-android.apk");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe(APK_CONTENT_TYPE);
    expect(ok.headers.get("content-disposition")).toContain('filename="qiceai-android.apk"');
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("etag")).toBe('"apk"');
    expect(new Uint8Array(await ok.arrayBuffer())[0]).toBe(0x50);

    const html = new Response("<!doctype html><html>spa</html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const missing = await apkAssetResponse(html, "GET", "missing.apk");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("text/plain");
    expect(await missing.text()).not.toContain("spa");
  });

  it("Worker 直接返回安装包，不把这个地址交给首页路由", async () => {
    const env = { ASSETS: assets() };
    const ok = await worker.fetch(new Request("https://qicego.com/downloads/qiceai-android.apk"), env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe(APK_CONTENT_TYPE);
    expect(new Uint8Array(await ok.arrayBuffer())[0]).toBe(0x50);

    const versioned = await worker.fetch(new Request("https://qicego.com/downloads/qiceai-v1.2.0.apk"), env);
    expect(versioned.status).toBe(200);
    expect(versioned.headers.get("content-type")).toBe(APK_CONTENT_TYPE);

    const missing = await worker.fetch(new Request("https://qicego.com/downloads/missing.apk"), env);
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain("spa");

    const home = await worker.fetch(new Request("https://qicego.com/"), env);
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toContain("下载安卓版");
  });
});
