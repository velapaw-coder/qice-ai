import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NAV_TITLES,
  SITE_TITLES,
  auditActionLabel,
  crawlRunIsStale,
  crawlRunStatus,
  extractMainText,
  extractPolicyLinks,
  junkTitleReason,
  policyLevelFromRegions,
} from "@shared/policyPage";

const HTML = `<html><head><script>var ctx = '/nsrxtSiteapp';</script><style>.a{}</style><title>国家税务总局广东省税务局</title></head>
<body>
<nav>
  <a href="https://guangdong.chinatax.gov.cn/">国家税务总局广东省税务局</a>
  <a href="https://guangdong.chinatax.gov.cn/search">搜一下</a>
  <a href="/public">公众查询</a>
  <a href="/gdsw/index.html">首页</a>
</nav>
<a href="/gdsw/ssfg/2024-10/19/content_123.shtml">关于延续小微企业社保补贴的&nbsp;通知</a>
<a href="/gdsw/ssfg/2024-10/19/content_123.shtml">关于延续小微企业社保补贴的通知</a>
<a href="/gdsw/ssfg/2024-11/02/content_456.shtml">关于延续小微企业社保补贴的通知</a>
<div class="article">各地人力资源和社会保障局：现就延续小微企业社保补贴有关事项通知如下。请认真贯彻执行本通知要求，确保补贴按时发放到符合条件的企业，并做好政策宣传和经办服务。</div>
</body></html>`;

describe("政策页抽取", () => {
  it("只保留政策文章链接，并按网址和标题去重", () => {
    const links = extractPolicyLinks(HTML, "https://guangdong.chinatax.gov.cn/", "https://guangdong.chinatax.gov.cn/");
    expect(links).toEqual([
      {
        url: "https://guangdong.chinatax.gov.cn/gdsw/ssfg/2024-10/19/content_123.shtml",
        title: "关于延续小微企业社保补贴的 通知",
      },
    ]);
  });

  it("正文去掉脚本、导航，并解码 HTML 实体", () => {
    const page = extractMainText(HTML);
    expect(page.text).not.toContain("var ctx");
    expect(page.text).not.toContain("搜一下");
    expect(page.text).not.toContain("&nbsp;");
    expect(page.text).toContain("各地人力资源和社会保障局");
  });

  it("无效标题和正常政策标题分开", () => {
    expect(junkTitleReason("var ctx = '/nsrxtSiteapp';")).toContain("脚本");
    expect(junkTitleReason("搜一下")).toContain("导航");
    expect(junkTitleReason("公众查询")).toContain("导航");
    expect(junkTitleReason("国家税务总局广东省税务局")).toContain("网站名称");
    expect(junkTitleReason("&nbsp;")).not.toBeNull();
    expect(junkTitleReason("关于延续小微企业社保补贴的通知")).toBeNull();
  });

  it("层级、抓取结束状态和审计名称", () => {
    expect(policyLevelFromRegions(["CN"])).toBe("国家");
    expect(policyLevelFromRegions(["44"])).toBe("省");
    expect(policyLevelFromRegions(["4403"])).toBe("市");
    expect(crawlRunStatus({ pending: 2, sources_ok: 0, sources_failed: 0, drafts_created: 0 })).toBe("进行中");
    expect(crawlRunStatus({ pending: 0, sources_ok: 0, sources_failed: 3, drafts_created: 0 })).toBe("失败");
    expect(crawlRunStatus({ pending: 0, sources_ok: 1, sources_failed: 0, drafts_created: 2 })).toBe("完成");
    expect(crawlRunIsStale("2026-10-19T00:00:00.000Z", Date.parse("2026-10-19T00:31:00.000Z"))).toBe(true);
    expect(crawlRunIsStale("2026-10-19T00:00:00.000Z", Date.parse("2026-10-19T00:10:00.000Z"))).toBe(false);
    expect(auditActionLabel("policy.create")).toBe("新建政策");
    expect(auditActionLabel("assessment.publish")).toBe("发布方案");
    expect(auditActionLabel("user.reset_password")).toBe("重置密码");
    expect(auditActionLabel("consent.agree")).toBe("同意授权");
  });

  it("驳回脚本使用同一套无效标题", () => {
    const sql = readFileSync("scripts/reject-junk-drafts.sql", "utf8");
    for (const title of [...NAV_TITLES, ...SITE_TITLES]) expect(sql).toContain(title);
    expect(sql).toContain("var ");
    expect(sql).toContain("https://hrss.gd.gov.cn/zcfg/");
    expect(sql).toContain("已驳回");
    const seed = readFileSync("migrations/0002_seed.sql", "utf8");
    expect(seed).toContain("https://hrss.gd.gov.cn/zcfg/");
    expect(seed).not.toContain("zwgk/xxgkml/zcfg");
  });
});
