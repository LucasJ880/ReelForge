# Aivora

**外贸电商视频闭环交付系统** · 面向内部运营团队，第一阶段聚焦毛毯 / blanket 类目。

核心闭环：
`产品输入 → 市场分析 → 卖点提炼 → 多版本视频 → 发布 → 数据回流 → 赛马打分 → 特征蒸馏 → 下一轮`

---

## 技术栈

- Next.js 16 App Router + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Prisma + Neon Postgres
- NextAuth v4 Credentials（仅 Admin 登录）
- OpenAI（LLM 管线）+ 即梦/Seedance（T2V/I2V via 火山方舟 Ark）
- Vercel Blob + Vercel Cron

## 快速开始

```bash
# 1. 装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 填入 DATABASE_URL / OPENAI_API_KEY / AUTH_SECRET / BLOB_READ_WRITE_TOKEN
# （可选）ARK_API_KEY（不填走 mock）

# 3. 建库 + 种子管理员
npm run db:push
SEED_ADMIN_EMAIL=admin@aivora.internal SEED_ADMIN_PASSWORD=your-strong-pass npm run db:seed

# 4. 启动
npm run dev
```

打开 http://localhost:3000 → 自动跳 `/login`（已登录则按 `userType` 跳 `/business` / `/personal` / `/internal/orders`）。

公开素材展示页：`/showcase` —— 不需要登录，用于呈现 Aivora 的 real-footage 广告示例（继承自旧 `/demo/real-footage-ads`）。

## 产品形态（Phase 1）

Aivora 整合为统一平台，按 `AdminUser.userType` 区分三种工作台：

| Persona | 入口路由 | 主要场景 |
| --- | --- | --- |
| `business` | `/business/**` | 电商广告：产品/素材导入 → 统一创意输入 → AI 生成 → 品牌包装 → 数据回流 |
| `personal` | `/personal/**` | 个人创作：文/图/视频素材 → 一键生成短视频 → 下载/分享 |
| `operator` / `super_admin` / `reviewer` | `/internal/**` | 内部运营：交付单、赛马、QA、发布、数据、蒸馏、设置 |

未指定 persona 的访客先进 `/persona` 选择。详细数据模型参见 [`prisma/schema.prisma`](./prisma/schema.prisma) 的 `AdminUser.userType`。

## 统一视频生成管线（Phase 5）

唯一视频创建入口：`Unified Creative Input`（`/business/create-ad-video` 与 `/personal/create-video`）。背后由 `src/lib/video-generation/` 11 个模块顺序编排：

```
classifyInput → classifyAsset → buildCreativeBrief → buildBrandPackagingPlan
  → buildClipPlacementPlan → planUnifiedSegments → buildVideoSegments
  → buildAssemblyPlan → buildQualityReview → buildPlanPreview → buildPlan(supervisor)
```

对外 API：

- `POST /api/video-generation/classify-asset` —— 上传后实时推断 `inferredRole`
- `POST /api/video-generation/plan` —— 无副作用预览 `VideoGenerationPlan` + `PlanPreview` + `QualityReview`
- `POST /api/video-generation/dispatch` —— 校验后落 `DeliveryOrder` / `Round` / `Brief`，然后调 `dispatchVideoForBrief` 启动 Seedance 多段流水线

`QualityReview` 内置硬约束：Seedance prompt 不允许出现 logo URL、品牌名、CTA 文案、QR 码等精确视觉元素 —— 这些一律由 Aivora 自己的 overlay 层后期合成。

旧 6 步 Wizard、`/demo/ai-video` 等遗产已删除；`/wizard/*` 路由返回 `410 Gone`，旧 `/orders` / `/rounds` / `/briefs` / `/projects` / `/videos` 在 [`next.config.ts`](./next.config.ts) 用 308 永久重定向到新位置。

## 目录结构

```
src/
├── app/
│   ├── (public)/         # 公开页（/persona、/showcase）
│   ├── (auth)/login/
│   ├── (business)/business/    # Business persona 工作台
│   ├── (personal)/personal/    # Personal persona 工作台
│   ├── (internal)/internal/    # 内部运营 / 旧 (app) 全部迁到这里
│   └── api/
│       ├── video-generation/   # plan / dispatch / classify-asset
│       ├── persona/            # 切换 userType
│       └── ...
├── lib/
│   ├── video-generation/  # Phase 5 统一管线 11 个模块
│   ├── services/          # 已有业务 service
│   ├── providers/         # 外部 API 封装
│   ├── schemas/           # zod schemas（含 unified-input）
│   └── validators/
├── components/
│   ├── ui/
│   ├── layout/           # business-sidebar / personal-sidebar / internal-sidebar
│   ├── video-generation/ # unified-creative-input / attachment-uploader / plan-preview-card
│   └── features/
└── types/                # video-generation.ts 等
prisma/
├── schema.prisma         # 新增 AdminUser.userType / VideoBrief.persona / RawAsset.inferredRole
└── seed.ts
```

## 角色

- `SUPER_ADMIN` — 全权限 + 管理员账号管理
- `OPERATOR` — 创建交付单、执行流程、发布
- `REVIEWER` — QA 审核

Phase 1 起额外引入 `AdminUser.userType`（`business` / `personal` / `OPERATOR`）用于分流 UI；Role 仍然控制后端权限。Phase 2 将引入真正的 end-customer User 模型 + 多租户隔离。

## 发布链路（MVP 半自动）

1. 系统生成 5 条视频（3 优化 + 2 探索）
2. AI + 人工 QA 双打分
3. 运营在 `/internal/publish` 下载成片
4. 人工上传到 TikTok 后在 UI 回填 post_id
5. 12h / 24h / 48h 后运营上传 CSV 数据
6. 系统自动打分、选 top3、蒸馏特征
7. 进入下一轮

## 测试

```bash
npm test           # 全部 node:test 测试（含 unified-* 系列）
npm run typecheck  # tsc --noEmit
```

`tests/unified-*.test.ts` 覆盖统一视频生成管线的所有节点：
`unified-input-classifier` / `unified-asset-classifier` / `unified-brand-packaging` /
`unified-segment-placement` / `unified-prompt-intelligence` /
`unified-quality-reviewer` / `unified-assembly-plan` / `unified-plan-preview` /
`unified-creative-strategist` / `unified-duration-mapping` /
`unified-supervisor.integration`。

所有 LLM 相关测试通过 `LLM_FORCE_MOCK=true` 强制走启发式路径，零外部依赖，可离线运行。

## 文档

- [TESTING.md](./docs/TESTING.md) — 端到端冒烟脚本、真实 UAT、PRD §3 对齐矩阵
- [DEPLOYMENT.md](./docs/DEPLOYMENT.md) — Vercel 部署、环境变量、Cron、冒烟

## Phase 2 路线图

- 引入真正的 end-customer User 模型 + 多租户隔离（替换当前 `AdminUser.userType` 临时方案）
- `dispatch` 路由真正校验 Business / Personal 权限边界（当前 Phase 1 复用 `requireOperator`）
- Brand packaging 接 ffmpeg overlay，真正合成 end card（当前仅生成 plan）
- 接 TikTok Content Posting API 做全自动发布
- 接 TikTok Shop API 拿商业分（CTR / ROAS）
- 扩展到更多类目

## License

Internal use only.
