import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const raw = readFileSync(new URL("../uploads/homepage_reference_f1c3.html", import.meta.url), "utf8");
const style = raw.match(/<style>([\s\S]*?)<\/style>/)[1];
let body = raw.match(/<body>([\s\S]*?)<\/body>/)[1];
body = body.replace(/<div class="modal"[\s\S]*<\/script>\s*$/, "");
body = body.replaceAll("企益AI", "企策AI");
body = body.replaceAll("WHY QIYI AI", "WHY QICE AI");
body = body.replace("02</strong>专业测算", "02</strong>智能测算");
body = body.replace(
  "根据企业经营、税务及社保资料，由专业团队筛查可能适用的政策并形成初步评估。",
  "根据企业经营、税务及社保资料，系统智能匹配可能适用的政策，顾问复核后形成初步方案。",
);
body = body.replace("按合同约定明确收费及责任。", "按合同约定明确服务范围及责任。");
body = body.replace("填写企业名称、行业、员工规模与联系人。", "注册账号：填写企业名称、联系人、手机号。");
body = body.replace(
  "<h3>政策测算</h3><p>专业团队核验适用条件，出具初步分析方案。</p>",
  "<h3>智能测算</h3><p>系统智能测算，顾问复核，出具初步方案。</p>",
);
body = body.replace("确认服务范围与收费规则，协助办理申报。", "确认服务范围，协助办理申报。");
body = body.replace(
  "先填写基本信息，工作人员确认授权与安全提交方式后，再提供敏感资料。",
  "注册后直接上传资料，上传即表示同意数据授权书和隐私政策。",
);
body = body.replace("请通过授权安全渠道提交。", "注册后直接上传资料，上传即表示同意数据授权书和隐私政策。");
body = body.replace(
  "通常先准备最近一年的增值税申报表和企业最新社保清单；提交敏感文件前需要确认授权、安全传输与使用范围。",
  "通常先准备最近一年的增值税申报表和企业最新社保清单。上传即表示同意数据授权书和隐私政策。",
);
body = body.replace("提交企业基本信息，申请专业团队初步评估。", "注册并上传两份资料，获取初步方案。");
const example = `<div class="example" aria-label="三步协同"><small style="color:#7c8ba5">三步协同</small><h3 style="margin:8px 0 18px">从发现政策到落地升级</h3><div class="step-line"><span class="n">1</span><div><b>发现可享受的政策</b><span>系统匹配税收、社保和就业支持，顾问复核后再给企业看。</span></div></div><div class="step-line"><span class="n">2</span><div><b>协助申报落地</b><span>确认服务范围后，协助准备材料并跟踪办理。</span></div></div><div class="step-line"><span class="n">3</span><div><b>按需规划 AI 升级</b><span>政策服务和 AI FDE 分开选择，企业按经营需要决定。</span></div></div></div>`;
body = body.replace(/<div class="example">[\s\S]*?<\/div><\/div><\/section>/, `${example}</div></section>`);
body = body.replaceAll(/<button class="btn" onclick="openForm\(\)">([\s\S]*?)<\/button>/g, '<a class="btn" data-cta href="/register">$1</a>');
body = body.replace(
  '<button class="btn light" onclick="openForm()">立即申请免费初评 →</button>',
  '<a class="btn light" data-cta href="/register">注册并上传资料 →</a>',
);
body = body.replace(
  '<nav class="links"><a href="#services">服务内容</a><a href="#value">企业价值</a><a href="#process">服务流程</a><a href="#faq">常见问题</a></nav><a class="btn" data-cta href="/register">免费初步评估 →</a>',
  '<nav class="links"><a href="#services">服务内容</a><a href="#value">企业价值</a><a href="#process">服务流程</a><a href="#faq">常见问题</a><a href="/login">登录</a></nav><a class="nav-login" href="/login">登录</a><a class="btn" data-cta href="/register">免费初步评估 →</a>',
);
body = body.replace(
  "<p>本页面为MVP展示版本；具体政策、服务主体、收费方式以正式协议及现行规定为准。</p>",
  '<p><a href="/legal/privacy">隐私政策</a> · <a href="/legal/consent">数据授权书</a> · <a href="/legal/terms">用户协议</a></p><p>深圳市精灵探索科技有限公司 · 联系方式见登录页</p>',
);
body = body.replaceAll("<header", '<header').replace('href="#home"', 'href="/"');
const extra = `.nav-login{color:#465675;font-weight:700;font-size:14px}.footer a{color:#9eb6e6}.step-line{display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--line)}.step-line:last-child{border-bottom:0}.step-line .n{width:28px;height:28px;border-radius:50%;background:#edf3ff;color:#2259d7;display:grid;place-items:center;font-weight:800;flex:none}.step-line b{display:block}.step-line span{color:#64738d;font-size:13px}@media(max-width:850px){.nav-login{display:none}}`;
if (body.includes("30%") || body.includes("政策服务费") || body.includes("openForm") || body.includes("企益") || body.includes("QIYI")) {
  throw new Error("homepage still has forbidden copy");
}
mkdirSync(new URL("../src/client/home", import.meta.url), { recursive: true });
const ts = `export const homeCss = ${JSON.stringify(style + extra)};\nexport const homeHtml = ${JSON.stringify(body)};\n`;
writeFileSync(new URL("../src/client/home/markup.ts", import.meta.url), ts);
console.log("homepage bytes", ts.length);
