# AI Context Workflow — 用 codemap 让 AI 少烧 token

> 配套规则：[`.cursor/rules/ai-context-workflow.mdc`](../.cursor/rules/ai-context-workflow.mdc)
> 配套数据：[`ai-context/`](../ai-context/) （由 `npm run codemap:build` 生成）

这份文档是**给 AI agent 和开发者的实操指南**：每一类常见任务，应该按什么顺序查、查哪几个 ai-context 文件、跑什么命令、读哪些源文件。目的只有一个 —— **跳过整 repo 扫描，直奔目标文件**。

---

## 0. 通用 5 步流程

不管什么任务，先走这 5 步：

```
1. Read   ai-context/agent-entry.md          # 项目快照 + token 预算规则
2. Run    npm run context:find -- "<task>"   # 关键词 → top 10 相关文件
3. Read   推荐的 top 3-5 文件（大文件用行号区间）
4. Read   ai-context/dependency-map.json     # 想知道牵连面再查
5. ❗      直到第 4 步还定位不准，才升级到 grep / 全文件读取
```

不要跳过第 1-2 步。`agent-entry.md` ~3 KB，`context:find` 0.3 秒——和无脑全 repo 扫一比，token 收益非常显著。

---

## 1. 视频生成（Seedance / 即梦 / 多段拼接）

**入口命令**

```bash
npm run context:find -- "video generation seedance"
# 或更具体：
npm run context:find -- "video generation dispatch seedance"
```

**最常命中的文件（按推荐阅读顺序）**

| # | 文件 | 角色 |
|---|------|------|
| 1 | `src/lib/providers/seedance.ts` | Seedance / 即梦 API 封装（提交、查询、状态映射） |
| 2 | `src/lib/services/video-service.ts` | ⚠ 1058 行 — 用行号区间。`dispatchVideoForBrief` / `dispatchMultiSegmentGeneration` 是入口 |
| 3 | `src/lib/video-generation/generation-supervisor.ts` | 多段视频生成的 supervisor |
| 4 | `src/lib/video-generation/prompt-intelligence.ts` | 段提示词构造（387 行） |
| 5 | `src/lib/video-generation/quality-reviewer.ts` | Seedance prompt 静态校验 |
| 6 | `src/app/api/video-generation/dispatch/route.ts` | POST endpoint（222 行） |
| 7 | `src/app/api/video-generation/plan/route.ts` | POST endpoint（49 行） |
| 8 | `src/app/api/video-generation/classify-asset/route.ts` | POST endpoint（45 行） |

**典型场景**

- "Seedance 任务失败排查" → 先读 `providers/seedance.ts`（状态映射），再读 `services/video-service.ts` 中 `dispatchMultiSegmentGeneration` 附近行。
- "调整段提示词" → `lib/video-generation/prompt-intelligence.ts` 配合 `tests/unified-prompt-intelligence.test.ts`。
- "新增 video-generation API" → 模板看 `dispatch/route.ts` + `plan/route.ts`。

---

## 2. FFmpeg / 拼接 / 音频 loudness

**入口命令**

```bash
npm run context:find -- "ffmpeg stitching audio loudness"
```

**最常命中的文件**

| # | 文件 | 角色 |
|---|------|------|
| 1 | `src/lib/services/stitch-service.ts` | 服务端拼接业务逻辑（564 行） |
| 2 | `src/app/api/cron/stitch-videos/route.ts` | Vercel Cron 入口 |
| 3 | `src/app/api/internal/stitch/claim/route.ts` | Stitch runner 拉取任务 |
| 4 | `src/app/api/internal/stitch/complete/route.ts` | Stitch runner 回写结果 |
| 5 | `scripts/stitch-runner.ts` | 在 GitHub Action runner / Cloud Run 上跑的独立 ffmpeg 拼接器 |
| 6 | `scripts/stitch-real-footage-walkthrough-video.ts` | 一次性 demo 拼接脚本 |
| 7 | `tests/stitch-service-runtime.test.ts` | 集成测试 |
| 8 | `.github/workflows/stitch-videos.yml` | Stitch runner 的 CI workflow |

**典型场景**

- "拼接出错 / 任务卡住" → `stitch-service.ts` 中 `processPendingFinalVideos` / `claimStitchTask`，再读 `stitch-runner.ts` 看实际 ffmpeg 调用。
- "想加新的音频处理参数" → 改 `stitch-runner.ts`（loudnorm 在那里）。
- "加新的拼接 cron" → 在 `app/api/cron/stitch-videos/route.ts` 旁边加，参考现有写法。

---

## 3. Demo 页面 / Real Footage Ads 演示

**入口命令**

```bash
npm run context:find -- "demo real footage walkthrough"
```

**最常命中的文件**

| # | 文件 | 角色 |
|---|------|------|
| 1 | `src/lib/demo/ai-video-workflow-demo-data.ts` | ⚠ 1054 行 — demo 用的全部 sample data |
| 2 | `src/components/demo/demo-hero.tsx` | demo 页主 hero |
| 3 | `src/components/demo/demo-input-panel.tsx` | demo 输入面板 |
| 4 | `src/components/demo/demo-section.tsx` | demo 容器 section |
| 5 | `src/components/demo/ai-script-section.tsx` | AI 脚本展示 |
| 6 | `src/components/demo/storyboard-grid.tsx` | 分镜网格 |
| 7 | `src/components/demo/final-output-section.tsx` | 最终视频展示 |
| 8 | `src/app/(public)/showcase/...` | 公开 showcase 页 |

**典型场景**

- "改 demo 文案 / sample data" → 只动 `lib/demo/ai-video-workflow-demo-data.ts`，组件不动。
- "demo 视频文件路径错了" → 路径常量在 `ai-video-workflow-demo-data.ts`，**永远不要直接读 `public/generated/*.mp4`**。
- "走查 demo 页面流程" → 顺序：`(public)/showcase/page.tsx` → `demo-section.tsx` → 各个 sub-section。

---

## 4. Demo Leads / Waitlist

**入口命令**

```bash
npm run context:find -- "demo leads waitlist"
```

**最常命中的文件**

| # | 文件 | 角色 |
|---|------|------|
| 1 | `src/app/(internal)/internal/demo-leads/page.tsx` | 内部管理 lead 列表 (308 行) |
| 2 | `src/app/api/demo/real-footage-ads/waitlist/route.ts` | POST 写 lead 到 Prisma |
| 3 | `src/app/(public)/showcase/waitlist-form.tsx` | 公开 waitlist 表单组件 |
| 4 | `prisma/schema.prisma` | Lead 模型（搜 `model Lead` / `WaitlistLead`） |

**典型场景**

- "新增 lead 字段" → 改 Prisma schema → 改 waitlist API → 改 form。
- "看 lead 列表 UI 出 bug" → 先 `internal/demo-leads/page.tsx`。

---

## 5. Vercel Blob 上传 / 视频 URL

**入口命令**

```bash
npm run context:find -- "vercel blob upload video url"
```

**最常命中的文件**

| # | 文件 | 角色 |
|---|------|------|
| 1 | `src/app/api/upload/blob/route.ts` | Blob 上传 endpoint |
| 2 | `src/components/video-generation/attachment-uploader.tsx` | 前端 uploader 组件 |
| 3 | `src/lib/services/ad-render-service.ts` | 标记 `uses Vercel Blob storage` |
| 4 | `src/lib/services/video-service.ts` | 持久化 final video URL |

**典型场景**

- "上传失败" → `upload/blob/route.ts` + `attachment-uploader.tsx` 一起看。
- "Blob URL 没回写到 DB" → `services/video-service.ts` 中存 finalVideoUrl 的位置。

---

## 6. Prisma Schema 改动

**入口**

直接读 `prisma/schema.prisma`（这是单一权威）。改动前先查 `docs/` 里的相关 spec：

```bash
ls docs/   # 找跟你要改的实体相关的 spec
```

不要让 AI 一上来就读全量 schema——schema 顶部的 generator/datasource 段落几乎从不需要改，需要改的是底部的 model 定义。

**典型场景**

- "加新字段" → schema → 跑 `npm run db:migrate`（dev）/ `db:migrate:deploy`（prod）。
- "只想看一个 model" → 用 Read 工具的 line range，例如 `Read prisma/schema.prisma offset=850 limit=80`，不要全文件吞。

---

## 7. Next.js 路由 / API endpoint

**入口**

```bash
cat ai-context/route-map.json | head -200   # 或者直接搜：
grep -A2 "/api/your-thing" ai-context/route-map.json
```

`route-map.json` 已经包含 81 条路由（31 page + 42 API + layout/error/not-found），每条 API 都附 `httpMethods`。**永远不需要扫 `src/app` 找路由**。

**典型场景**

- "为什么 /api/xxx 404" → `route-map.json` 查这个 path 是否存在 + httpMethods 对不对。
- "新加一个 API" → 找到结构最像的现有 endpoint 复制，改 path 改 logic。

---

## 8. 认证 / NextAuth

**入口命令**

```bash
npm run context:find -- "auth next-auth session admin"
```

**最常命中的文件**

| # | 文件 | 角色 |
|---|------|------|
| 1 | `src/lib/auth.ts` | NextAuth 配置 |
| 2 | `src/lib/api-auth.ts` | API route 的 session 校验工具 |
| 3 | `src/app/(auth)/login/page.tsx` | 登录页 |
| 4 | `src/middleware.ts` | 路由守卫 |
| 5 | `src/types/next-auth.d.ts` | 类型扩展 |

---

## 9. 测试

**入口**

测试都在 `tests/` 一级目录，文件命名 `<feature>.test.ts`。

```bash
ls tests/ | grep <feature>
npm run context:find -- "<feature>" --area=tests
```

`--area=tests` flag 会**只在测试文件里**搜，避免被业务代码淹没。

---

## 10. Dry-run 演示（"video generation dispatch"）

下面是这次 Phase 1.5 真实跑出来的输出片段（节选）。这就是 AI agent 在真实工作流里**应该先看到**的东西，而不是先扫 repo：

```
=== context-router ===
query:    video generation dispatch seedance
keywords: video, generation, dispatch, seedance, videojob, render, generate, synthesis

命中 area：video-generation, media-processing
  · video-generation: 15 个文件
  · media-processing: 16 个文件

相关路由 (3)：
  · [POST] /api/video-generation/classify-asset  ←  src/app/api/video-generation/classify-asset/route.ts
  · [POST] /api/video-generation/dispatch        ←  src/app/api/video-generation/dispatch/route.ts
  · [POST] /api/video-generation/plan            ←  src/app/api/video-generation/plan/route.ts

Top 文件（节选）：

1. src/app/api/video-generation/dispatch/route.ts  (score=45)
   type=api  area=video-generation  lines=222

2. src/lib/video-generation/prompt-intelligence.ts (score=39)
   symbols: buildVideoSegments, heuristicSegmentPrompts

6. src/lib/services/video-service.ts  (score=37)
   ⚠ large file (1058 lines) — consider line-range read
   symbols: dispatchVideoForBrief, dispatchMultiSegmentGeneration, dispatchVideoGeneration
```

观察点：

- **总用时 < 0.5 秒**，全程零 LLM 调用。
- 直接命中 3 个最相关的 API 路由 + 关键 service 文件。
- 自动给出 1058 行的 large-file 警告，提醒 agent 用行号区间。
- 提示了关键导出符号（`dispatchVideoForBrief` 等），AI 不读源码就知道该 jump 到哪个函数。

**对比传统流程**：如果不跑 context-router，agent 会先 `Glob "src/**/*.ts"` → 列 222 个文件 → 再 `Grep "video"` → 几百条 hit → 再人肉过滤……单是定位就要烧好几千 token。现在 ~3 KB 输入定位完成。

---

## 11. 重建 codemap

```bash
npm run codemap:build
```

什么时候跑：

- 新增/删除大量文件
- 重构目录
- 改 `package.json` 依赖
- `repo-map.json` 顶部 `generatedAt` 超过 2 周

跑一次 ~50 ms，幂等，可放心反复跑。

---

## 12. 不要做的事（重申）

- ❌ 一上来就 `Glob "**/*"` 列文件
- ❌ 一上来就 `Grep` 整个 src
- ❌ 直接读 `public/generated/`、`tmp/`、`.next/`、`.vercel/`、`node_modules/`
- ❌ 读任何 `.env*`（除了 `.env.example`，且**绝对不要把内容放进 prompt 或 commit**）
- ❌ 整文件吞 ≥800 行的 service / page（必须 line range）
- ❌ 同一轮对话里**重复读**已读过的大文件
