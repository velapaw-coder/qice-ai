/** 列表页链接和正文清洗。抓取、草稿筛选和批量驳回共用同一套判断。 */

export const NAV_TITLES = [
  "搜一下",
  "搜索",
  "检索",
  "公众查询",
  "首页",
  "网站首页",
  "登录",
  "注册",
  "联系我们",
  "网站地图",
  "政务微信",
  "政务微博",
  "简体",
  "繁体",
  "英文版",
  "更多",
  "下一页",
  "上一页",
  "返回顶部",
  "English",
];

export const SITE_TITLES = [
  "国家税务总局广东省税务局",
  "国家税务总局",
  "国家税务总局深圳市税务局",
  "广东省人力资源和社会保障厅",
  "广东省人民政府",
  "深圳市人民政府",
  "广东省财政厅",
  "中华人民共和国人力资源和社会保障部",
  "国家税务总局政策法规库",
];

const POLICY_HINT = /关于|通知|公告|意见|办法|规定|方案|细则|条例|决定|函|补贴|资助|奖励|申报|政策|措施|指引|目录|清单|解读|规划|实施|暂行|图解/;

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)));
}

export function normalizeSpace(input: string): string {
  return decodeHtmlEntities(input).replace(/\s+/g, " ").trim();
}

export function junkTitleReason(title: string): string | null {
  const raw = title || "";
  const text = normalizeSpace(raw);
  if (!text) return "标题为空";
  if (/&(?:nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/i.test(raw) && text.length < 8) return "标题是 HTML 实体";
  if (NAV_TITLES.includes(text)) return "标题是导航文字";
  if (SITE_TITLES.includes(text)) return "标题是网站名称";
  if (text.length < 8) return "标题过短";
  if (text.length > 120) return "标题过长";
  if (/var\s+\w+\s*=|function\s*\(|<\/?[a-z][^>]*>|window\.|document\.|ctx\s*=|\{|\}/i.test(text)) return "标题像脚本或标签";
  if (/^[A-Za-z0-9_./\\=:;'"+\-\s]+$/.test(text)) return "标题没有中文";
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (han < 6) return "中文太少";
  if (columnSiteTitle(text)) return "标题是栏目导航";
  return null;
}

export function policyLinkCountLabel(count: number): string {
  return `政策链接 ${Math.max(0, count)}`;
}

export function formatShanghai(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw.replace("T", " ").replace(/\.\d+Z?$/, "").slice(0, 19);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const hour = pick("hour") === "24" ? "00" : pick("hour").padStart(2, "0");
  return `${pick("year")}-${pick("month")}-${pick("day")} ${hour}:${pick("minute")}:${pick("second")}`;
}

export function crawlSourceLabel(input: { type?: string; errors_json?: string; source_name?: string; source_count?: number; sources?: string[] }): string {
  let sourceName = input.source_name || "";
  let count = input.source_count;
  let sources = input.sources || [];
  if (input.errors_json) {
    try {
      const parsed = JSON.parse(input.errors_json) as { source_name?: string; source_count?: number; sources?: unknown } | unknown[];
      if (parsed && !Array.isArray(parsed)) {
        sourceName = sourceName || parsed.source_name || "";
        if (count == null && typeof parsed.source_count === "number") count = parsed.source_count;
        if (!sources.length && Array.isArray(parsed.sources)) sources = parsed.sources.filter((name): name is string => typeof name === "string");
      }
    } catch {
      sourceName = sourceName || "";
    }
  }
  const type = input.type || "";
  const batch = type === "initial" || type === "monthly" || sourceName.includes("全部");
  const names = sources.map((name) => name.trim()).filter(Boolean);
  const known = typeof count === "number" && Number.isFinite(count) ? count : names.length ? names.length : undefined;
  if (batch) {
    if (known == null) return "全部来源";
    const head = names.slice(0, 4);
    if (!head.length) return `全部来源(${known})`;
    return `全部来源(${known})：${head.join("、")}${names.length > head.length ? "等" : ""}`;
  }
  if (sourceName && sourceName !== "—") return sourceName;
  if (names.length === 1) return names[0]!;
  return "—";
}

export function cleanStoredDraftText(raw: string): string {
  const input = String(raw || "");
  if (!input.trim()) return "";
  if (/<[a-z][^>]{0,80}>/i.test(input)) {
    const extracted = extractMainText(input).text.trim();
    if (hanCount(extracted) >= 40) return extracted;
  }
  const titles = [...NAV_TITLES, ...SITE_TITLES].sort((a, b) => b.length - a.length);
  const lines = input.split(/\n+/).map((line) => {
    let text = stripInlineNoise(line);
    for (const title of titles) text = text.split(title).join(" ");
    return text.replace(/[ \t\f\v]+/g, " ").trim();
  }).filter((line) => line && !storedChromeLine(line));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 60_000);
}

export function policyTitleHint(title: string): boolean {
  if (junkTitleReason(title)) return false;
  const text = normalizeSpace(title);
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return han >= 8 && POLICY_HINT.test(text);
}

export interface ArticleLink {
  url: string;
  title: string;
}

export function extractPolicyLinks(html: string, baseUrl: string, linkPattern: string): ArticleLink[] {
  const found: ArticleLink[] = [];
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const re = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const href = attr(match[1] || "", "href");
    if (!href) continue;
    const title = normalizeSpace(match[2]!.replace(/<[^>]+>/g, " "));
    let abs = "";
    try {
      abs = new URL(href, baseUrl).href.split("#")[0]!;
    } catch {
      continue;
    }
    if (!articleUrl(abs, baseUrl, linkPattern)) continue;
    if (!policyTitleHint(title)) continue;
    const urlKey = abs.replace(/\/$/, "");
    const titleKey = title.replace(/\s/g, "");
    if (seenUrl.has(urlKey) || seenTitle.has(titleKey)) continue;
    seenUrl.add(urlKey);
    seenTitle.add(titleKey);
    found.push({ url: abs, title: title.slice(0, 200) });
    if (found.length >= 30) break;
  }
  return found;
}

export function extractMainText(html: string): { title: string; text: string } {
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const heading = normalizeSpace((withoutNoise.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").replace(/<[^>]+>/g, " "));
  const titled = normalizeSpace((withoutNoise.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]+>/g, " ").split(/[_\-|–—]/)[0] || "");
  const region = pickMain(withoutNoise)
    .replace(/<(nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const lines = decodeHtmlEntities(region.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "\n"))
    .split(/\n+/)
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line) => line && !chromeLine(line));
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 60_000);
  const title = policyTitleHint(heading) ? heading : policyTitleHint(titled) ? titled : heading || titled;
  return { title: title.slice(0, 200), text };
}

export function pageLooksLikePolicy(title: string, text: string): boolean {
  if (junkTitleReason(title) || !policyTitleHint(title)) return false;
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return han >= 80;
}

export function policyLevelFromRegions(regions: string[] | undefined): string {
  const codes = (regions || []).map((code) => String(code || "").trim()).filter(Boolean);
  if (!codes.length || codes.some((code) => code === "CN" || code === "000000")) return "国家";
  if (codes.some((code) => code.length >= 6)) return "区县";
  if (codes.some((code) => code.length === 4)) return "市";
  return "省";
}

export function crawlRunStatus(row: { pending: number; sources_ok: number; sources_failed: number; drafts_created: number }): "进行中" | "完成" | "失败" {
  if (row.pending > 0) return "进行中";
  if (row.drafts_created === 0 && row.sources_ok === 0 && row.sources_failed > 0) return "失败";
  return "完成";
}

export const CRAWL_STALE_MS = 30 * 60 * 1000;

export function crawlRunIsStale(startedAt: string, nowMs: number): boolean {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return false;
  return nowMs - started >= CRAWL_STALE_MS;
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "consent.agree": "同意授权",
  "auth.register": "企业注册",
  "auth.login": "登录",
  "auth.change_password": "修改密码",
  "auth.logout": "退出登录",
  "enterprise.update": "修改企业资料",
  "enterprise.return": "退回补传",
  "enterprise.notified": "记录电话告知",
  "enterprise.rematch": "重新匹配",
  "enterprise.submit": "企业提交资料",
  "enterprise.submit_unsupported": "提交后暂不支持",
  "enterprise.dup_resolve": "处理重复企业",
  "profile.update": "修改企业画像",
  "staff.update": "修改人员核查",
  "file.register": "登记上传文件",
  "file.upload_by_consultant": "顾问代传文件",
  "file.download": "下载文件",
  "file.preview": "预览文件",
  "file.delete": "删除文件",
  "file.expire": "到期删除文件",
  "files.zip_download": "打包下载",
  "files.zip_download_blocked": "打包下载被拒绝",
  "assessment.edit": "修改方案初稿",
  "assessment.publish": "发布方案",
  "policy.create": "新建政策",
  "policy.update": "保存政策版本",
  "policy.enable": "启用政策",
  "policy.disable": "停用政策",
  "policy.expire": "政策到期停用",
  "policy_draft.import": "导入政策草稿",
  "policy_draft.adopt": "采纳政策草稿",
  "policy_draft.reject": "驳回政策草稿",
  "policy_draft.bulk_reject": "批量驳回草稿",
  "policy_draft.reclean": "清洗草稿原文",
  "deal.policy_create": "创建政策成交",
  "deal.policy_update": "更新政策成交",
  "deal.realization": "记录兑现",
  "deal.fde_create": "创建 FDE 成交",
  "deal.fde_update": "更新 FDE 成交",
  "user.create": "新建账号",
  "user.reset_password": "重置密码",
  "user.contact_update": "更新联系方式",
  "enterprise.assign_consultant": "分配专属顾问",
  "ticket.create": "新建工单",
  "ticket.reply": "回复工单",
  "ticket.close": "关闭工单",
  "ticket.reopen": "重新打开工单",
  "ticket.status": "更新工单状态",
  "ticket.reassign": "转派工单",
  "settings.update": "修改系统设置",
  "ai_provider.create": "添加模型",
  "ai_provider.update": "修改模型",
  "ai_provider.test": "测试模型连通",
  "crawl.start": "发起抓取",
  "appointment.create": "提交预约",
  "appointment.update": "更新预约",
  "privacy.revoke": "撤回授权",
  "privacy.delete_request": "申请删除资料",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] || "其他操作";
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return (match?.[1] || match?.[2] || match?.[3] || "").trim();
}

function articleUrl(url: string, baseUrl: string, linkPattern: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (linkPattern && !url.startsWith(linkPattern)) return false;
  const base = baseUrl.split("#")[0]!.replace(/\/$/, "");
  if (url.replace(/\/$/, "") === base) return false;
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  if (/(login|search|sitemap|javascript)/.test(path)) return false;
  if (/\/(index|list|default)\.html?$/.test(path)) return false;
  return /content|\/art\/|\/article\/|post_\d|\/t\d{6,}|\/\d{6,8}\/|content_\d|\.shtml?$/.test(path);
}

function pickMain(html: string): string {
  const patterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div\b[^>]*(?:id|class)\s*=\s*["'][^"']*(?:TRS_Editor|article-content|article|pages_content|zw_content|xl_content|content_detail|zoom)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && hanCount(match[1] || "") >= 40) return match[1]!;
  }
  return html;
}

function columnSiteTitle(text: string): boolean {
  const parts = text.split(/\s*[-–—|｜]\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const left = parts[0]!;
  const right = parts[parts.length - 1]!;
  if (!left || left.length > 10) return false;
  if (NAV_TITLES.includes(left) || NAV_TITLES.includes(right)) return true;
  if (SITE_TITLES.includes(left) || SITE_TITLES.includes(right)) return true;
  return /(局|厅|部|政府|委员会|政策法规库)$/.test(right);
}

function stripInlineNoise(line: string): string {
  return line
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/var\s+\w+\s*=\s*[^;\n]{0,300};?/gi, " ")
    .replace(/function\s+\w*\s*\([^)]*\)\s*\{[^}]*\}/gi, " ")
    .replace(/\b(window|document)\.[A-Za-z0-9_$.]+(\([^)]*\))?/g, " ");
}

function storedChromeLine(line: string): boolean {
  const text = normalizeSpace(line);
  if (!text) return true;
  if (NAV_TITLES.includes(text) || SITE_TITLES.includes(text)) return true;
  if (junkTitleReason(text) === "标题是栏目导航") return true;
  if (/var\s+\w+\s*=|function\s*\(|function\s+\w+\s*\(|window\.|document\.|ctx\s*=|<\/?[a-z][^>]*>/i.test(text) && hanCount(text) < 8) return true;
  if (/^(版权所有|ICP备|网站标识码|主办单位|联系电话)/.test(text)) return true;
  return false;
}

function chromeLine(line: string): boolean {
  if (NAV_TITLES.includes(line) || SITE_TITLES.includes(line)) return true;
  if (line.length < 12 && junkTitleReason(line)) return true;
  if (/var\s+\w+\s*=|function\s*\(|window\.|document\./i.test(line)) return true;
  if (/^(版权所有|ICP备|网站标识码|主办单位|联系电话)/.test(line)) return true;
  return false;
}

function hanCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) || []).length;
}
