# Phase 0 · B/C 分支代码普查

扫描命令覆盖 `src/`、`prisma/schema.prisma` 与 `tests/` 中的 `userType / persona / BUSINESS / PERSONAL / business / personal / tenant / channel / workspace`。原始逐行证据为 `docs/evidence/phase-0/bc-branch-scan.txt`：966 个命中，分布在 146 个文件。冻结 Showcase 命中只作排除标记，不纳入合并改造。

处置标签：

- **可直接合并**：已经是共享实现，仅需换统一入口/命名。
- **需迁移**：存在真实路由、权限或数据分叉，Phase 1 必须迁移数据并加旧路由重定向。
- **需人工决策**：合并方式会改变产品定义、权限或历史数据语义，GATE 0 需拍板。

## 1. 路由与导航

| 位置 | 当前分支 | 处置 | Phase 1 目标 |
|---|---|---|---|
| `src/app/(personal)/personal/**` | 首页、Agent、创作、模板、成品、billing 独立路由 | 需迁移 | 并入统一 `/create`、`/library`、`/templates`、`/settings/billing`；旧路径重定向。 |
| `src/app/(business)/business/**` | 首页、创作、creative studio、digital human、performance、products、recommendations、integrations、billing | 需迁移 | 能力按统一五区归位；plan/feature flag 决定可见性，不再由 B/C 路由决定。 |
| `src/app/(personal)/batch-create`、`/batches/[id]` | 批量能力挂在 personal route group | 可直接合并 | 移至统一 `/batches/new`、`/batches/[id]`，保留现有 monitor/service。 |
| `src/app/(public)/persona`、`src/app/api/persona` | 用户主动选择 BUSINESS/PERSONAL persona | 需迁移 | 注册后按 plan 进入同一平台，不再选择产品人格。 |
| `src/app/(personal)/layout.tsx`、`src/app/(business)/layout.tsx` | 两套 shell/guard | 需迁移 | 一个 platform shell + plan/feature flag。 |
| `personal-sidebar.tsx`、`business-sidebar.tsx` | 两套导航定义 | 需迁移 | 统一五个一级区。 |
| `src/app/(public)/showcase/**` | 独立投资人 demo | 需人工决策：固定排除 | 宪法冻结，Phase 1 只做像素 diff，不合并。 |

## 2. API 与权限

| 位置 | 当前分支 | 处置 | 说明 |
|---|---|---|---|
| `src/lib/api-auth.ts`、`src/lib/auth.ts`、`src/middleware.ts` | userType/persona 路由矩阵 | 需迁移 | 改为单一账号 + workspace membership + plan/feature flag。 |
| `src/app/api/auth/register/route.ts` | 注册时写个人/企业身份 | 需迁移 | 统一创建 User/Workspace，plan 由默认值或后台分配。 |
| `src/app/api/video-generation/{plan,dispatch}/route.ts` | 接收/推导 persona | 可直接合并后清理 | 核心 plan/dispatch 已共享；移除 persona discriminator，改 feature context。 |
| `src/app/api/upload/blob/route.ts` | persona/业务用途参与上传路径或校验 | 可直接合并后清理 | 统一 upload contract；资源归属 workspace。 |
| `src/app/api/business/metrics/route.ts` | business-only analytics | 需人工决策 | Phase 3 赛马将重建统一投放指标；需决定迁移还是废弃旧表单。 |
| `src/app/api/personal/agent-chat/route.ts` | personal-only agent | 需迁移 | 并入统一“创作”入口。 |
| `src/app/api/billing/**`、`/api/me/usage` | 已接近 plan/quota 语义 | 可直接合并 | 作为统一计费/配额层保留。 |
| `src/app/api/digital-human/**` | 当前主要服务 business 页面 | 需人工决策 | 是否作为 plan feature 保留；不应保留 business 路由特判。 |

## 3. 数据模型

| 模型/字段 | 位置 | 处置 | 迁移要求 |
|---|---|---|---|
| `AdminUser.userType`（BUSINESS/PERSONAL/OPERATOR/SUPER_ADMIN） | `prisma/schema.prisma` | 需迁移 | 角色与客户类型混在一个 enum。拆为系统 role + plan/workspace；先扩后缩，保留映射表与回滚。 |
| `VideoBrief.persona` | `prisma/schema.prisma` | 需迁移 | 现为 analytics discriminator；迁移到 workspace/plan snapshot 或 legacy metadata，不能直接丢历史语义。 |
| `UnifiedCreativeInput.userType` / schemas | `src/lib/schemas/unified-input.ts`、`src/types/video-generation.ts` | 需迁移 | 业务差异改为可选 feature 参数，不允许 provider/流水线分叉。 |
| `BatchJob.userId`、`UsageLog.userId`、`UserUsagePeriod` | schema + quota service | 可直接合并 | 已是统一用户归属；Phase 1 补 Workspace 与 plan 快照。 |
| `StyleTemplate` / `BatchJob.templateVersion` | schema | 可直接合并 | 已满足不可变版本地基，不因 B/C 合并改变。 |
| business metrics / performance 数据 | schema + services | 需人工决策 | 与 Phase 3 Round/Placement/MetricSnapshot 的映射需先盘点。 |

## 4. 组件与服务

| 文件组 | 处置 | 说明 |
|---|---|---|
| `src/components/video-generation/unified-creative-input*` | 可直接合并 | 名称虽统一，内部仍有 userType 条件；保留共同表单，改 feature flags。 |
| `src/components/personal/**`、`src/components/business/**` | 需迁移 | 抽取共享卡片/表格/状态，再挂统一路由；禁止复制第三套。 |
| `src/lib/video-generation/{creative-strategist,input-classifier,plan-preview,generation-supervisor}.ts` | 可直接合并后清理 | 已是同一流水线地基；去掉 persona 特判，provider 继续只走抽象接口。 |
| `business-insights-service.ts`、`business-metrics-import.ts`、`business-order-title-service.ts` | 需人工决策 | Phase 3 盘点后决定复用范围。 |
| `personal-status.ts` 与 business status adapters | 需迁移 | 统一状态 vocabulary，客户安全错误与内部诊断仍分层。 |
| `quota-service.ts`、`quota-tiers.ts` | 可直接合并 | 正是计划要求的 plan/quota 地基。 |
| i18n dictionaries/types/fixtures | 需迁移 | 路由和产品名收敛后更新 key；不能仅删文案绕过测试。 |

## 5. 测试影响面

- 权限/注册：`api-auth-persona-matrix`、`auth-register-validation`、`brief-access-ownership`、persona onboarding。
- Personal：customer strings/status、agent、unified input 与成品页相关测试。
- Business：locale/display title/order title/insights/products/status/brand packaging。
- E2E：auth setup、journeys、final acceptance fixtures 目前显式选择 persona 或访问 B/C 路由。
- Batch：现有 batch tests 可复用，但路由契约与页面入口需更新。

处置：测试文件不删除；Phase 1 先增加统一路径/plan 权限测试，再逐项把旧断言迁移为重定向与兼容性断言。任何改变测试意图的动作单独列出人工 review。

## 6. GATE 0 需人工决策

1. 旧 BUSINESS/PERSONAL 到新 plan 的映射：建议 BUSINESS→studio、PERSONAL→starter；OPERATOR/SUPER_ADMIN 保留为系统角色而非 plan。
2. 是否在 Phase 1 引入 Workspace（建议：引入，先一用户一个默认 workspace，为 B2B 多成员预留）。
3. digital human 是否保留为 studio feature，还是移出统一平台当前范围。
4. business performance/metrics 是直接迁移到 Phase 3 数据模型，还是保留只读 legacy 页面到 Gate 3。
5. persona 旧路径的重定向期限与是否保留 legacy analytics 字段。

## 7. Buddy API 对 Phase 1 的附加约束

Buddy 子循环不会改变本清单的合并方向。Phase 1 必须确保业务层只依赖 `VideoProvider`；未来新增 Buddy 时，provider 选择只能来自全局默认与批次级覆盖，不能重新引入 B/C 路由分支。SL-A 在 Phase 1 后启动，SL-B 的 internal provider 下拉应挂在统一批次创建页。
