# Aivora 中国大陆迁移 · 海外依赖审计（Phase 1）

> **目标**：标记所有可能影响中国大陆部署的海外依赖，给出替代方案、阻塞等级与迁移优先级。
> 本文档不包含真实密钥；只描述「依赖在哪里 / 用来做什么 / 怎么换」。

## 优先级速读

- **P0 阻塞** — 不替换不能在中国大陆跑 demo
- **P1 公开测试前必须改** — demo 阶段先用兜底，但公开测试前要替换
- **P2 商业化正式上线前再改也可以**

## 总览表

| # | 依赖 | 位置 | 用途 | 阻塞 demo？ | 推荐替代 | 优先级 |
|---|---|---|---|---|---|---|
| 1 | OpenAI SDK | `src/lib/providers/openai.ts` `src/lib/providers/openai-image.ts` | LLM (脚本/角度/QA) + 图像生成 | 是（chat.openai.com 在大陆不稳定/不可访问） | 火山方舟 Ark · 豆包 (`Doubao-Pro / Doubao-1.5-Vision-Pro`) | **P0** |
| 2 | Vercel Blob (`@vercel/blob`) | `src/app/api/upload/blob/route.ts`、`src/lib/services/stitch-service.ts`、`src/lib/services/ad-render-service.ts`、`src/lib/video-generation/brand-end-card-renderer.ts`、`src/lib/video-generation/mock-clip-generator.ts`、`src/lib/providers/openai-image.ts` | 上传素材、视频成品、渲染产物、Logo PNG 落盘 | 是（vercel-storage.com 在大陆不稳定，多数 ISP 直连失败） | 火山 TOS（对象存储），后续接火山 CDN | **P0** |
| 3 | Vercel 部署平台 | `vercel.json`、`.vercelignore`、`docs/DEPLOYMENT.md`、`README.md` 引用 | 托管 Next.js + Cron + Edge | 是 | 火山 ECS + Docker + Nginx | **P0** |
| 4 | Neon Postgres | `prisma/schema.prisma` (datasource) + `docs/DEPLOYMENT.md` | 业务数据库 | 是 | 火山 RDS PostgreSQL | **P0** |
| 5 | Vercel Cron | `vercel.json` (空配置)、`.github/workflows/poll-videos.yml`、`.github/workflows/stitch-videos.yml` | 视频任务轮询、拼接调度 | 是 | 服务器 systemd-timer / cron / k8s CronJob，或自托管 worker container | **P0** |
| 6 | Stripe | `src/lib/services/stripe-billing-service.ts`、`src/app/api/webhooks/stripe/route.ts`、`src/app/api/billing/checkout/route.ts`、`src/app/(business)/business/billing/page.tsx`、`src/app/(personal)/personal/billing/page.tsx`、`src/components/billing/usage-dashboard.tsx`、`prisma/schema.prisma` (stripeCustomerId / stripeSubscriptionId) | 订阅付费 / Checkout / Webhook | 否（demo 阶段不收钱） | 中国阶段先关闭支付路径；后续微信支付/支付宝/对公转账 | P2（demo 不阻塞，但要确保 UI 默认禁用） |
| 7 | OpenAI Image (`gpt-image-1`) | `src/lib/providers/openai-image.ts` | Logo 生成 | 是（生成走 OpenAI，又落 Vercel Blob） | 火山方舟 Ark / 豆包文生图 + 火山 TOS | P0 |
| 8 | 即梦 / Seedance (火山 Ark) | `src/lib/providers/seedance.ts`、`src/lib/services/video-service.ts` | 视频生成 (T2V / I2V) | 否（本身就是火山方舟产品，可直连）| 保留；纳入 video-generation provider 抽象层 | P0（结构性改造，非替换） |
| 9 | Apify TikTok Scraper | `src/lib/providers/apify-tiktok.ts`、`src/lib/services/discovery-service.ts` | TikTok 数据抓取（市场调研） | 否（默认空配置 → fallback 纯 LLM） | 中国大陆改为抖音/小红书爬虫；MVP 阶段保持空配置走 LLM 模式 | P2 |
| 10 | HeyGen 数字人 | `src/components/demo/*`、`docs/DEPLOYMENT.md` (DIGITAL_HUMAN_PROVIDER) | 数字人视频 demo | 否（默认 mock） | 后续可接腾讯智影 / 商汤 / 火山数字人 | P2 |
| 11 | TikTok Content Posting API | `src/lib/services/publish-service.ts` (待索引)、`docs/DEPLOYMENT.md` (TIKTOK_CLIENT_KEY) | 自动发布 TikTok | 否（中国版本只发抖音/视频号） | 抖音开放平台 + 视频号助手 + 小红书开放接口 | P2 |
| 12 | remove.bg API | `src/lib/providers/remove-bg.ts` | 抠图 (V2 可选) | 否 (默认 noop) | 火山方舟视觉 / 阿里 Image Search / 自建 SAM | P2 |
| 13 | NextAuth Credentials Provider | `src/lib/auth.ts` | 邮箱密码登录 | 否（demo 阶段可接受） | Phase 2 接手机号 + 短信登录；Phase 3 微信扫码 | P1 |
| 14 | GitHub Actions for cron / stitch | `.github/workflows/poll-videos.yml`、`.github/workflows/stitch-videos.yml`、`scripts/stitch-runner.ts` | 外部 ffmpeg runner + 视频任务轮询 | 是（github.com Actions 在大陆访问不稳定且依赖 Vercel Blob） | Docker compose 内独立 worker container 或 systemd-timer 调用 `/api/cron/*` | **P0** |
| 15 | 写死的火山 Ark cn-beijing endpoint | `src/lib/providers/seedance.ts` (默认 `https://ark.cn-beijing.volces.com/api/v3`) | Seedance API | 否（中国大陆就是要走这个） | 保持 env override；改成 `ARK_BASE_URL` 仅在 env 缺失时退回该默认 | P1（已经是 env 优先，足够） |
| 16 | `https://placehold.co` 占位图 | `src/lib/providers/openai-image.ts` (MOCK_PALETTE) | mock logo 占位 | 否（mock 仅在 dev 用） | 中国大陆 mock 改为本地 SVG / data URL，避免外网请求 | P2 |
| 17 | i18n 默认语言 | `src/i18n/config.ts`、`NEXT_PUBLIC_DEFAULT_LOCALE` | 默认 zh-CN | 否（已默认中文） | 保持现状；中国大陆模式强制 zh-CN | OK |
| 18 | 货币 / 时区硬编码 | `src/lib/services/quota-service.ts` (USD?)、计费 UI | 价格用 USD 展示 | 否（demo 阶段不展示价格） | 改为 ¥（CNY），时区 Asia/Shanghai | P1 |
| 19 | `tiktokspTMDk4tfsdecinKCtSok8lruzVXdLei.txt` 验证文件 | `public/tiktokspTMDk4tfsdecinKCtSok8lruzVXdLei.txt` | TikTok 域名校验 | 否（中国部署可保留也可移除） | 保留无害 | P2 |
| 20 | `apify-client` npm 依赖 | `package.json` | Apify 调用 | 否 | 中国大陆可保留依赖但不调用（无 token 时走 LLM mock） | P2 |

---

## 详细审计

### 1. OpenAI SDK（chat + 图像 + vision）— P0

**当前依赖名**：`openai@^6.33.0`

**所在文件**：
- `src/lib/providers/openai.ts`（chat completions / JSON 模式 / vision，含 fallback chain）
- `src/lib/providers/openai-image.ts`（`gpt-image-1` Logo 生成）

**当前用途**：
- 调研、卖点、Angle、脚本、Director Plan、Seedance prompt、QA、蒸馏、视觉分析、Logo 生成。
- 通过 `OpenAITier` 抽象出了 8 个 tier，但底层硬编码 OpenAI SDK。

**阻塞中国大陆部署**：是。`api.openai.com` 在中国大陆封锁，公司内网/普通 ISP 都无法稳定直连。

**推荐替代**：
- 火山方舟 Ark 提供 OpenAI 兼容的 `/chat/completions` 接口（`https://ark.cn-beijing.volces.com/api/v3/chat/completions`），可直接复用 OpenAI SDK 但需替换 `baseURL` + `apiKey` + `model`（豆包系列：`doubao-pro-32k`、`doubao-1.5-pro-32k`、`doubao-1.5-vision-pro-32k`）。
- Vision 接口火山有 `doubao-1.5-vision-pro` 等型号。
- 图像生成需独立适配（火山 OpenAPI 提供 `cv_process` 等通用图像服务，或走 SeedDream / SeedDance Image）。

**迁移方式**：
- 抽象层 `lib/ai/` 把 chat / vision / image 都包到 provider interface。
- `AI_PROVIDER=openai` → 现有 OpenAI 走法
- `AI_PROVIDER=volcengine` → Ark 适配器（chat 调用与 OpenAI 兼容，image 走 placeholder）

**优先级**：P0

---

### 2. Vercel Blob — P0

**当前依赖名**：`@vercel/blob@^2.3.3`

**所在文件**（业务侧直接 import 或动态 import）：
- `src/app/api/upload/blob/route.ts` — 用户素材上传入口
- `src/lib/services/stitch-service.ts:760` — 拼接后的 MP4 落盘
- `src/lib/services/ad-render-service.ts:7,222,264` — 渲染产物 + manifest JSON
- `src/lib/video-generation/brand-end-card-renderer.ts:431` — 品牌片尾卡
- `src/lib/video-generation/mock-clip-generator.ts:214` — Mock clip 缓存
- `src/lib/providers/openai-image.ts:112` — Logo 图片落盘
- `scripts/sunny-shutter-investor-demo*.ts`、`scripts/upload-pet-demo-bgm-v2.ts`、`scripts/stitch-runner.ts`、`scripts/stitch-real-footage-walkthrough-video.ts` — 演示脚本
- `.github/workflows/stitch-videos.yml` — GH Action 上传产物

**当前用途**：
- 公开 URL 落盘（上传素材、视频段、拼接成品、Logo、片尾、Mock 视频）
- DB 只存 URL；前端通过 Vercel CDN 直接拉

**阻塞中国大陆部署**：是。
- `*.public.blob.vercel-storage.com` 在中国大陆访问极不稳定。
- 没有 ICP 备案，CDN 节点也命中海外。
- 已有强约束「缺 BLOB_READ_WRITE_TOKEN 直接 throw」(`stitch-service.ts:756`、`openai-image.ts:107`)，这意味着 demo 必须替换才能跑通。

**推荐替代**：
- 火山引擎 TOS（Tinder Object Storage）：S3 兼容接口，国内多 region。
- SDK 选用 `@volcengine/tos-sdk`（官方），或走 AWS S3 SDK 兼容模式（`@aws-sdk/client-s3`）+ 自定义 endpoint。
- 后续接火山 CDN（acceleration domain → 公网回源 TOS bucket）。

**迁移方式**：
- 抽象层 `lib/storage/` 提供 `uploadFile / uploadBuffer / getSignedUploadUrl / getSignedDownloadUrl / getPublicUrl / deleteObject`。
- 业务代码不再直接 `import { put } from "@vercel/blob"`，改成 `getStorageProvider().uploadBuffer(...)`。
- 两个 bucket：`uploads/`（用户上传）+ `renders/`（生成视频成品），方便后续做权限/CDN 分级。

**优先级**：P0

---

### 3. Vercel 部署平台 — P0

**所在文件**：`vercel.json`、`.vercelignore`、`docs/DEPLOYMENT.md`、`README.md`

**当前用途**：
- 托管 Next.js 全部 routes + serverless functions
- Cron（升级 Pro 后）
- Edge runtime

**阻塞中国大陆部署**：是。
- `vercel.app` 域名在大陆访问不稳定，且 Vercel 节点都在海外。
- 国内合规需要 ICP 备案 + 服务器在境内。

**推荐替代**：
- 火山 ECS（普通虚拟机） + Docker + Nginx 反向代理。
- Next.js 标准 `next build && next start` 模式即可。
- Cron 用 systemd-timer 或独立 worker container 调用 `/api/cron/poll-videos`。

**迁移方式**：见 Phase 7 (`docs/CHINA_DEPLOYMENT.md` + `Dockerfile` + `docker-compose.yml`)。

**优先级**：P0

---

### 4. Neon Postgres — P0

**所在文件**：`prisma/schema.prisma` (datasource), `package.json` 不依赖 Neon SDK；`DATABASE_URL` 由 env 决定。

**当前用途**：业务数据库。

**阻塞中国大陆部署**：是（Neon 服务在境外，跨境访问会被防火墙拦截）。

**推荐替代**：
- 火山 RDS PostgreSQL（推荐 13+/14+/15+）
- 直接替换 `DATABASE_URL` 即可。
- 注意：Prisma 当前用普通连接（非 Neon serverless driver），所以**没有 Neon 特有行为**，迁移成本接近 0。

**确认事项**（详见 `docs/CHINA_DEPLOYMENT.md`）：
- ✅ 项目未使用 `@neondatabase/serverless` / Prisma Accelerate / Edge runtime DB。
- ✅ `src/lib/db.ts` 用标准 `PrismaClient`，开发模式 global 缓存，生产新建。
- ✅ `prisma migrate deploy` 可在普通 PG 上跑。
- ⚠️ Neon 通常默认要求 `sslmode=require`；火山 RDS 默认也支持 SSL，但具体参数视 RDS 实例配置（白名单 + SSL CA）而定。

**优先级**：P0（替换 DATABASE_URL + 文档说明即可）

---

### 5. Vercel Cron + GitHub Actions cron — P0

**所在文件**：
- `vercel.json`（当前为空，Hobby 不开 Vercel Cron）
- `.github/workflows/poll-videos.yml`（每 5 分钟轮询）
- `.github/workflows/stitch-videos.yml`（拼接 worker）
- `src/app/api/cron/poll-videos/route.ts`
- `src/app/api/cron/stitch-videos/route.ts`

**当前用途**：
- 每 5 分钟扫 `VideoJob`，查询 Seedance 任务并回写状态
- 拼接 ready-to-stitch 的 `FinalVideo`

**阻塞中国大陆部署**：是。
- GitHub Actions 调用大陆 ECS 可能受到 GFW 干扰；且依赖 Vercel Blob 上传。
- Vercel Cron 不可用（没部署在 Vercel）。

**推荐替代**：
- ECS 上跑一个独立的 systemd-timer 或独立 cron container：
  ```
  */2 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.cn/api/cron/poll-videos
  ```
- 拼接 worker 改为 docker-compose `worker` service，常驻进程轮询 `/api/internal/stitch/claim`。
- 兼容性：API endpoint 已经存在，外层调度器无关业务逻辑。

**优先级**：P0

---

### 6. Stripe — P2（demo 阶段不阻塞）

**所在文件**：
- `src/lib/services/stripe-billing-service.ts`
- `src/app/api/webhooks/stripe/route.ts`
- `src/app/api/billing/checkout/route.ts`
- `src/app/(business)/business/billing/page.tsx`
- `src/app/(personal)/personal/billing/page.tsx`
- `src/components/billing/usage-dashboard.tsx`
- `prisma/schema.prisma`（`stripeCustomerId`、`stripeSubscriptionId`、`subscriptionTier`）

**当前用途**：Pro 订阅 / Checkout / Webhook。

**阻塞中国大陆部署**：否。
- `stripe-billing-service.ts` 已有 `if (!key) return null` 兜底；不配 `STRIPE_SECRET_KEY` 不会爆。
- Billing UI 会展示 "Stripe 未配置"。

**风险**：
- Billing 页面如果对中国大陆 demo 用户曝光，会让客户看到 Stripe / 美元字样。
- 建议在中国大陆模式下用 `PAYMENT_ENABLED=false` 隐藏入口（或显示"线下开通"提示）。

**推荐替代**（Phase 3+）：微信支付 / 支付宝 / 企业对公（详见 `docs/CHINA_LOGIN_PAYMENT_PLAN.md`）。

**优先级**：P2（demo 不阻塞，UI 入口需根据 env 隐藏）

---

### 7. OpenAI Image (`gpt-image-1`) — P0

见 #1（OpenAI 整体），但图像生成需要单独抽象，因为：
- 火山方舟 chat 接口与 OpenAI 兼容，images 不兼容（需要走方舟 visual `cv_process` 或 SeedDream）。
- Phase 1 暂时把 `generateImages` 包到 AI provider 接口里，但火山实现可以先 placeholder（抛 "not implemented"），让上层 Logo 生成在中国大陆模式下默认 mock 即可。

**优先级**：P0（接口必备），实现可 P1。

---

### 8. 即梦 / Seedance — P0（结构性，非替换）

`src/lib/providers/seedance.ts` 本身就是调用火山 Ark Seedance（`ark.cn-beijing.volces.com`），中国大陆原生友好。

**改造点**：
- 把 `submitSeedanceJob / getSeedanceStatus` 包到 `lib/video-generation/providers/volcengine-video-provider.ts`。
- 业务代码（`video-service.ts`）改成 `getVideoProvider().createVideoJob(...)`，不再直接 import `seedance.ts`。
- 标准化状态命名：`queued / processing / succeeded / failed / cancelled / unknown`（当前 4 态，扩展到 6 态）。

**优先级**：P0（接口对齐），现有行为保留。

---

### 9. Apify TikTok Scraper — P2

`src/lib/providers/apify-tiktok.ts` 在 `APIFY_TOKEN` 缺失时**自然降级**，不阻塞 demo。

中国大陆模式下：
- 保留 npm 依赖（不卸载，避免破坏海外部署）
- `APIFY_TOKEN` 留空 → discovery-service 走纯 LLM 模式
- 后续如果需要真实国内市场数据，可新增「抖音/小红书」抓取 provider

**优先级**：P2

---

### 10–12. HeyGen / TikTok / remove.bg — P2

均为可选 provider，默认 mock / noop。中国大陆 demo 阶段保持空配置即可。

---

### 13. NextAuth Credentials — P1

`src/lib/auth.ts` 使用 `next-auth/providers/credentials`（邮箱/密码）。
- 中国大陆 demo 阶段可用（管理员手动建账号 + 邮箱密码登录）。
- Phase 2 需补手机号 + 短信登录（阿里云 / 火山 SMS）。
- Phase 3 可接微信扫码。

未使用任何海外 OAuth（Google / GitHub），无阻塞。

**优先级**：P1（不阻塞 demo）

---

### 14. GitHub Actions 视频拼接 worker — P0

详见 #5。中国大陆部署用 docker-compose `worker` container 替代 GH Actions。

---

### 15. 写死的 Ark cn-beijing endpoint — OK

`src/lib/providers/seedance.ts` 默认 `https://ark.cn-beijing.volces.com/api/v3`，本身就在中国大陆。
- 已通过 `ARK_BASE_URL` env 可覆盖。
- 中国大陆部署无需改动；如果客户用专有 Ark region，可换。

---

### 16. `https://placehold.co` mock 占位 — P2

仅在 `IMAGE_ENGINE_MOCK=true` / OPENAI_API_KEY 缺失时使用，dev 阶段。
- 大陆 ECS 可访问（CloudFlare）但带宽不保证。
- 建议 Phase 2 改成本地 SVG data URL。

---

### 17. i18n / 中文化 — 已默认 zh-CN

`NEXT_PUBLIC_DEFAULT_LOCALE=zh-CN` 已经是默认。
- 大部分 UI copy 已经中文化。
- 详见 `docs/CHINA_UX_LOCALIZATION_AUDIT.md`。

---

### 18. 货币 / 时区 — P1

- Stripe 默认 USD，billing 页面会展示美元字样。
- 大陆模式下 `PAYMENT_ENABLED=false` 隐藏入口可规避，但要确保 Quota / 用量统计页面不残留 "$" 符号。
- 时区：服务器 Asia/Shanghai；前端 `new Date().toLocaleString("zh-CN")` 即可。

---

## Demo Readiness 速查

| Demo 必备 | 状态 | 备注 |
|---|---|---|
| 数据库可指向境内 PostgreSQL | ✅ 改 `DATABASE_URL` 即可 | Phase 6 文档 |
| 视频生成走火山 Seedance | ✅ 原生支持 | Phase 4 抽象层 |
| LLM 走火山方舟豆包 | ⚠️ 抽象层就位，需配 `VOLCENGINE_ARK_API_KEY` + 切换 `AI_PROVIDER=volcengine` | Phase 3 |
| 对象存储走火山 TOS | ⚠️ 抽象层就位，需配置 TOS bucket | Phase 5 |
| 部署到 ECS | ⚠️ Dockerfile + compose 就位，需 Nginx + 域名 + ICP 备案 | Phase 7 |
| 健康检查 | ⚠️ `/api/health` 新增 | Phase 8 |
| 内容审核 | ⚠️ 接口就位（noop），上线前需配火山审核 | Phase 9 |
| 登录方式 | ✅ 现有邮箱密码可用 | Phase 10 文档 |

---

## 下一阶段 blocker 清单

**阻塞中国大陆 demo（必须解决）**：
1. 申请火山方舟 API Key + 豆包模型开通
2. 创建火山 TOS bucket（uploads / renders）+ 申请 Access Key
3. 准备一台火山 ECS（Ubuntu 22.04 LTS） + 安装 Docker + Nginx
4. 准备一个域名（demo.xxx.com）+ ICP 备案（最短 7-20 天）
5. 火山 RDS PostgreSQL 实例

**阻塞公开测试**：
1. 真实内容审核 provider（火山内容审核）
2. 短信登录（阿里云/火山 SMS）
3. 隐私政策 / 用户协议 / AI 生成内容声明
4. 公安联网备案

**阻塞商业化上线**：
1. 微信支付 / 支付宝 / 对公开通系统
2. 发票系统
3. 数据存储位置合规公示
4. 未成年人保护

详见各阶段文档。
