# 企策AI

企业政策优惠与 AI 智能化升级服务平台的 MVP。企业注册后上传增值税申报表和社保清单，系统按政策规则出初稿，顾问复核后发布整体预估区间，并在后台跟踪政策成交和 AI 落地成交。

本仓库可以在本地完整跑通。**不要在未经确认时执行 `wrangler deploy`，也不要创建 Cloudflare 账号或调用付费模型。**

## 本地运行

需要 Node.js 22。

```bash
npm install
cp .dev.vars.example .dev.vars
npm run fixtures
npm run db:migrate
npm run create-admin -- --phone 13800000000 --password 'Admin1234' --name 管理员 --role admin --force
npm run build
npm run start
```

浏览器打开 [http://127.0.0.1:43123](http://127.0.0.1:43123)。

`npm run dev` 只启动 Vite，接口仍要另开 `npm run start`。验收和日常查看请用上面的 `wrangler dev`。

本地账号：

- 管理员由 `create-admin` 写入，首次不必改密码。
- 顾问在后台「账号」页创建，临时密码只显示一次，首次登录必须修改。
- 企业在 `/register` 注册。登录名是手机号。没有短信验证码。

合成测试资料在 `fixtures/fake/`，文件名和表头都标明「合成测试数据」，不是真实企业和真实人员。

## 测试

```bash
npm test
npm run test:e2e
```

`npm test` 会重新生成合成资料并跑规则引擎、信用代码和表格解析的单元测试。

`npm run test:e2e` 会清空本地 D1（`.wrangler/state`）、构建前端、迁移、创建管理员，再用 Playwright 走通：注册、授权、上传两份表、出初稿、顾问复核并发布、企业看到区间和预约、政策成交与兑现、单文件下载和 ZIP，以及个体户进入「暂不支持」。端到端测试会改掉本地数据库。

## 部署（确认后再做）

目标是 Cloudflare Workers 免费版。免费版每次调用 CPU 时间约 10ms，等待网络和磁盘的时间不计。因此密码慢哈希、Excel、PDF、图片压缩和 ZIP 都在浏览器里做。Worker 只做登录校验、小 JSON 校验、R2 流式上传下载、规则匹配和模型代理。

1. 安装并登录 Wrangler（这一步会用到你自己的 Cloudflare 账号，当前仓库没有代为登录）。
2. 创建资源，并把 `wrangler.jsonc` 里的 `database_id` 换成真实 ID：

```bash
npx wrangler d1 create qice-ai
npx wrangler r2 bucket create qice-files
npx wrangler queues create qice-crawl
```

R2 可能要求账号绑定支付方式，免费额度内通常不扣费。绑定之前请自己确认 Cloudflare 当前条款。

3. 写入密钥。不要把 `.dev.vars` 里的开发值带到线上。

```bash
npx wrangler secret put PEPPER
npx wrangler secret put SETTINGS_ENC_KEY
```

`PEPPER` 是任意长随机字符串。`SETTINGS_ENC_KEY` 是 32 字节密钥的 base64，可以用 `openssl rand -base64 32` 生成。模型密钥不要写进代码，在后台「模型」页配置。可选的 `DEEPSEEK_API_KEY` 只在库里还没有模型时，由定时任务尝试写入一条配置。

4. 迁移和创建管理员（`--remote` 会写线上库）：

```bash
npx wrangler d1 migrations apply qice-ai --remote
PEPPER='线上的同一串' node scripts/create-admin.mjs --phone 13800000000 --password '请换成强密码' --name 管理员 --role admin --remote
```

5. 确认后再发布。线上域名是 `qice.chang2.ccwu.cc`（自定义域名）。这个账号的 `workers.dev` 打不开，不要靠它访问。应用只接受与当前请求相同的来源，Cookie 不设置 Domain，代码里没有写死 `workers.dev` 或 localhost。

```bash
npx wrangler deploy
```

`npm run deploy` 会直接失败，用来避免误发布。

政策抓取来源默认关闭。后台试抓并确认链接规则之后再启用。月度抓取 cron 为北京时间每月 1 日 02:00，每日清理 cron 为北京时间 02:00。本地不会自动触发 cron，可请求 `http://127.0.0.1:43123/cdn-cgi/local/scheduled`。

Workers 的速率限制绑定只支持 10 秒或 60 秒窗口，所以 `REGISTER_LIMITER` 设为每 60 秒 5 次，用来挡住突发。按小时 5 次的注册限制写在 D1 的 `rate_counters` 里。登录按 IP 每小时 30 次，打包下载每小时 30 次，也在 D1。

## 架构说明

- 前端是 Vite + React，构建到 `dist/client`。`wrangler dev` 用静态资源托管页面，只有 `/api/*` 进入 Worker。
- 接口用 Hono。运行时没有用 Drizzle，避免在免费版 CPU 预算里做查询构建；表结构在 `migrations/`。
- 数据库是 D1，文件在私有 R2，不做应用层整文件加密。模型密钥用 `SETTINGS_ENC_KEY` 做 AES-GCM，界面只显示后 4 位。
- 密码：浏览器 PBKDF2-SHA256 60 万次，盐是 `qice-v1:` 加手机号。Worker 只对客户端密钥做 HMAC-SHA256，胡椒是 `PEPPER`。
- 规则在 `seed/policies.json`，迁移时以草稿写入。只有管理员启用后才参与匹配。
- 系统内部仍算出金额，只在顾问复核页显示。企业看到的永远是档位，例如「预计可申请：3–8 万元」，不会出现单个数字或「最高约 X」。档位在后台「设置」里改，默认是 1–3万、3–8万、8–15万、15–30万、30–50万、50万以上。测算低于最低档时建议最低档。单项不显示金额。资金类只作提示，不计入内部测算。
- 服务费没有默认比例。顾问在后台手工填写线下约定。

## 已知限制

- 照片和扫描件上传时会调用 `POST /api/llm/extract`。后台配了视觉模型就转到兼容 OpenAI 的接口；没配或识别失败时，资料仍保存，状态为待复核，由顾问按原件手工录入。Excel、CSV 和文字版 PDF 在浏览器本地解析，不走模型。
- 规则匹配在单元测试和端到端里都低于 10ms。抓取队列会下载网页并用 HTMLRewriter 抽文本，正文截到 6 万字；这是最可能碰到 CPU 上限的路径，所以来源默认关闭，并且一次只处理一个 URL。
- 法律文书是模板，页内写明待法务确认。隐私政策里的表格在页面上按段落展示，不是 HTML 表格。
- 微信内置浏览器没有在本环境实测。上传页提供了复制链接到电脑打开的入口。
- 端到端测试使用合成的深圳增值税表和社保清单，对应验收案例「深圳爱华国际教育科技有限公司」。
