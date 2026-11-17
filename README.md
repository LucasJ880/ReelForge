# Aivora

小商家的内容获客与增长操作系统：上传商品图，Aivora 写镜头、出故事板，商家点头后出片，成片带字幕、配乐和片尾落款。

当前实施依据：[PRD v3.3](./docs/roadmap/2026-07-29-ecommerce-workflow-prd.md)。给 AI agent 的工作须知在 [CLAUDE.md](./CLAUDE.md)，界面规矩在 [DESIGN.md](./DESIGN.md)。

## 现在做什么

- **单条创作**（`/app/create`）：商品图 + 一句描述 → 出方案 → 故事板（逐帧可重做）→ 出片 → 合成。
- **批量生产**（`/app/batches`）：一批商品图按模板批量出片，可暂停、取消、逐条重试。
- **成品库**（`/app/library`）：成片详情、只重新合成（换字幕 / 配乐 / 落款，不扣额度）、重做一段、成片评价、抖音发布包。
- **商品 / 品牌 / 模板库**（`/app/products`、`/app/brands`、`/app/templates`）。
- **询盘**（`/app/leads`，匿名询盘页 `/l/[slug]`，追踪链接 `/t/[code]`）。
- **能力状态**（`/app/status`）、**使用指南**（`/app/guide`）、**行情大屏**（`/wall`）。
- **机器接口**：`/api/videos`、`/api/machine/video-tasks`、`/api/performance`（见 [docs/machine-video-api.md](./docs/machine-video-api.md)）。
- **导演线路**（不走创作台、不碰库）：`npm run director -- check|frames|select|video|status tmp/director/<任务名>`。

2026-11-16 瘦身后已经不在的：Runway 出片、实拍图库与配音（b-roll）、商品链接抓取、抠图、成片画面质检、Stripe 收款、
国内版部署（火山大模型 / TOS / 短信登录）、创始人日报，以及「本周内容」「战绩」「投放赛马」「产品图工作台」四个页面和旧代运营中台。
数据库的表与列都留着（只加不删），以前出好的成片和图文帖照样能在成品库打开。清单见 [瘦身计划](./docs/roadmap/2026-11-16-slimming-plan.md)。

## 技术栈

- Next.js 16 App Router + React 19 + TypeScript，Tailwind CSS v4
- Prisma + Neon Postgres，NextAuth v4（邮箱密码登录）
- 供应商：Shuyu（出图、出片，Seedance）、OpenAI（出方案、导演线路的故事板图）；BytePlus Seedance 直连线路的代码保留
- Vercel（应用、Cron、Blob 存储）；成片合成用随包带的 ffmpeg

## 本地开发

```bash
npm install
cp .env.example .env.local   # 按文件里的说明填
npm run dev                  # 真机模式（predev 会跑 mode:check）
npm run dev:mock             # 纯前端联调：不调任何付费供应商
```

> `.env.local` 如果指向生产库，任何 `db:*` 命令都是对生产执行。迁移只走 `npm run db:migrate:deploy`；
> `db:migrate` / `db:push` / `db:seed` 有确认闸。细节见 CLAUDE.md §4。

## 常用命令

```bash
npm run typecheck      # tsc --noEmit
npm run lint
npm test               # node --test tests/*.test.ts（要 Node 22+）
npm run build
npm run test:prod-smoke   # 发布后冒烟（Playwright，对线上跑）
npm run context:find -- "关键词"   # 按 ai-context/ 索引找文件
npm run codemap:build     # 重建索引
```

## 目录

```
src/app/(platform)/app/   客户自助面（创作、批量、成品库、商品、品牌、模板库、询盘、状态、指南）
src/app/(public)/         法务页（/privacy、/terms）；首页在 src/app/page.tsx
src/app/(auth)/           登录、注册、找回密码
src/app/(wall)/           行情大屏 /wall
src/app/api/              路由只做鉴权与参数校验，业务在 src/lib/services/
src/lib/services/         业务层
src/lib/video-generation/ 出方案、故事板、合成
src/lib/providers/        外部 API 封装
src/lib/contracts/        对外契约
scripts/                  导演线路、评测、运维脚本
tests/                    node:test 单测；e2e/ 是发布后冒烟
```

## 文档

- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) — 部署、环境变量、Cron
- [docs/TESTING.md](./docs/TESTING.md) — 测试说明
- [docs/AI_CONTEXT_WORKFLOW.md](./docs/AI_CONTEXT_WORKFLOW.md) — 代码索引的用法

## License

Internal use only.
