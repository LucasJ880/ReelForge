# Aivora 测试 & 验证手册

本文档覆盖：
- 静态检查（typecheck / build）
- Mock 模式下的端到端（E2E）冒烟流程
- 针对真实毛毯产品的人工 UAT 脚本
- PRD §3 五个核心问题的对齐检查清单

## 0. 先决条件

```bash
pnpm install
pnpm db:generate
pnpm db:push              # 首次
pnpm db:seed              # 产生 SUPER_ADMIN（邮箱/密码见 .env SEED_ADMIN_*）
```

环境变量：
- 开发期可完全不配 `OPENAI_API_KEY` / `ARK_API_KEY`：
  - `openai` provider 走 mock：生成的文案/调研为占位（但结构完整）
  - `seedance` provider 走 mock：提交/轮询都立刻返回 `SUCCEEDED` + 占位 `outputVideoUrl`
- 正式测试时按 `.env.example` 填入真实 key

## 1. 静态检查（必须通过）

```bash
pnpm typecheck                # 已验证 ✅ 无错误
pnpm build                    # 已验证 ✅ 13 个页面 + 25 个 API routes
```

## 2. Mock E2E 冒烟（闭环 10 步）

按下顺序在 UI 操作（或等效 API 调用）。可在完全 mock 模式下跑通。

| # | 操作 | 入口 | 预期 |
|---|------|------|------|
| 1 | 登录 | `/login` → `/orders` | 使用 seed 账号登录，进入 Orders |
| 2 | 新建交付单 | `/orders/new` | 状态 = `DRAFT` |
| 3 | 执行调研 + 卖点 | Order 详情 → 「执行调研 + 卖点」 | 状态 → `SELLING_POINTS_READY`；Selling Points ≥ 3 条 |
| 4 | 启动第一轮 | Order 详情 → 「开启新一轮」 | 创建 Round #1，`PLANNED` |
| 5 | 生成 5 条 Angle | Round 详情 → 「生成 5 条 Angle」 | 3 条 `OPTIMIZATION` + 2 条 `EXPLORATION`；每条自动创建 VideoBrief |
| 6 | 生成脚本 | Brief 详情 → 「生成脚本」 | `Script` 创建，状态 `SCRIPT_READY` |
| 7 | 分镜 + Prompt | Brief 详情 → 「分镜 + Prompt」 | `ScenePlan` 3-6 个 + `VideoPrompt` 每 scene 1 条，状态 `SCENE_PROMPT_READY` |
| 8 | 触发渲染 | Brief 详情 → 「触发渲染」 | `VideoJob` 产生，mock 立即 `SUCCEEDED`；`finalVideoUrl` 填充，状态 `RENDER_SUCCEEDED` |
| 9 | AI 初审 + 人工决策 | Brief 详情 → 「AI 初审」→ `/qa` → 通过 | `QAReview.aiOverallScore` 产生；人工通过后自动建 `PublishRecord PENDING` |
| 10 | 发布流水 | `/publish` → 下载 → 回填 post_id → 确认上线 | `PublishRecord PUBLISHED`，`VideoBrief PUBLISHED` |
| 11 | 数据回流 | `/metrics` 粘贴 CSV（下载模板） | `MetricsSnapshot` 写入对应窗口 |
| 12 | 打分 + 排名 | Round 详情 → 「打分 + 排名」 | `ScoreReport` 写入；Top-3 brief → `ARCHIVED`，其它 → `DROPPED`；Round → `RANKED` |
| 13 | 蒸馏 | Round 详情 → 「蒸馏特征」 | `DistillationFeature` 写入，Order 状态 → `AWAITING_DISTILLATION` → `NEXT_ROUND_SCHEDULED` |
| 14 | 第二轮 | Order 详情 → 「开启新一轮」 | Round #2 被创建，`baseDistillationId` 指向上一轮产物；生成 Angle 时 LLM prompt 会注入 distillation |

### 快速 API 验证

```bash
# 1. 登录后拿 cookie，然后：
curl -X POST /api/delivery-orders -H 'Content-Type: application/json' -d '{...}'
# ... 脚本化回放完整闭环
```

## 3. 人工 UAT：真实毛毯产品（一只真实 SKU）

推荐至少一条真实数据跑一次，记录以下证据（录屏/截图）：

1. **Discovery 输出的 Pain Points 是否真实反映 TikTok 评论热议？**
   - 验证对 `MarketResearch.pain_points` 做人工比对（抽 5 条 TikTok 高赞评论）
2. **Selling Points 的 scene / emotion 两类是否至少各 1 条？**
3. **5 条 Angle 的 3/2 配比是否被严格执行？** 字段 `type` 数量比对
4. **第二轮的 3 条 OPTIMIZATION 是否真的复用了上一轮的 distillation？** 查看 `ContentAngle.sourceDistillationId`
5. **语言一致性**：3 条以上英语 Angle + 英语脚本 + 英语 prompt；无中文泄漏

## 4. PRD §3 五个问题对齐矩阵

| PRD §3 问题 | 系统机制 | 验证点 |
|---|---|---|
| **Q1 素材 → 爆款转化低** | 5 条/轮 × N 轮赛马 + 蒸馏 + 下一轮 3 条 OPTIMIZATION 基于蒸馏复用 | 观察 `DistillationFeature.structured`，第二轮 Optimization 的 `hook` 结构与之相似 |
| **Q2 爆款不可复制** | `distillationService` 将 Top-3 的结构化特征（hook_type / format / duration / scene_rhythm …）抽象，注入下一轮 Prompt | `DistillationFeature.structured` 是机器可读的 JSON，可被 `angleService` 的 LLM prompt 直接引用 |
| **Q3 难以多地区多语言本地化** | `DeliveryOrder.targetLanguage` + `targetRegionVariant` 贯穿 5 个 service（angle/script/scene/prompt/qa），`localization-service.checkLocaleConsistency` 校验一致性 | 端到端跑一个 `fr-CA` 地区交付单，所有文案均为 Québécois French；qa/runAIQA 会在 issues 指出偏差 |
| **Q4 模特/真人出镜成本高** | `OnCameraMode` 枚举 6 种，默认 `PRODUCT_ONLY`，`UGC_AVATAR` 预留；脚本 / prompt 根据 mode 生成 | 切换 Brief 的 `onCameraMode`，重新生成脚本后检查是否不再出现需要出镜的指令 |
| **Q5 投放 ROI 不透明 / 数据无法回流优化** | `MetricsSnapshot` 12/24/48h 窗口 + `scoring-service.scoreRound` 打分 + `distillation-service.distillRound` 反哺下一轮 | CSV 导入后打分，`ScoreReport.ranking` 可观测；Top-3 的高分 brief 被蒸馏 |

## 5. 已知限制（MVP 范围）

- 商业分（CTR / ATC / 订单 / ROAS）延后到 V2（与 TikTok Shop 打通时）
- `UGC_AVATAR` 的实际 AI 数字人素材生成延后到 V2
- `remove-bg` stub 仅在 key 已配置时才调用外部，目前直接跳过
- TikTok 发布为"半自动"：需人工上传并回填 `external_post_id`
- Cron 轮询 2 分钟一次（`vercel.json`）；真实生产可调整

## 6. Regression guardrails

每次 merge 前最少执行：

```bash
pnpm typecheck && pnpm build
```

关键路径建议补充的测试（V2）：
- `scoring-service.scoreRound` 的纯函数测试（给定 metrics → 确定性排名）
- `qa-criteria.deriveReviewRoute` 边界值（0-10 分）
- `metrics-service.parseMetricsCsv` 错值处理
