# Real-Footage Ad Agent MVP Runbook

本 Runbook 用于把当前 MVP 跑成一个可演示、可复盘的端到端路径，不包含 Remotion、平台自动发布、复杂时间线编辑器或高级 TTS。

## 环境变量

必需：

- `DATABASE_URL`: Postgres/Neon 连接串。
- `AUTH_SECRET` 或 NextAuth 所需 secret。

推荐：

- `BLOB_READ_WRITE_TOKEN`: 上传素材、渲染 MP4 或 fallback manifest 到 Vercel Blob。
- `OPENAI_API_KEY`: 开启 DirectorAgent / ReviewerAgent / 调研 / 蒸馏真实 LLM 输出；未配置时使用 mock。
- `ENABLE_FFMPEG_RENDER=true`: 开启本地 FFmpeg 真实 9:16 MP4 渲染。

可选：

- `RESET_REAL_FOOTAGE_DEMO=false`: seed demo 时不删除旧 demo order。
- `REAL_FOOTAGE_DEMO_RENDER=false`: seed demo 时跳过渲染。
- `RUN_DB_TESTS=true`: 运行数据库集成测试。

## 本地准备

1. 安装依赖：

```bash
npm install
```

2. 同步 Prisma：

```bash
npm run db:generate
npm run db:push
```

3. 如需真实 FFmpeg MP4 渲染，确认本机可执行：

```bash
ffmpeg -version
```

## 快速 Demo Seed

从干净数据库创建完整真实素材 demo：

```bash
ENABLE_FFMPEG_RENDER=true npm run demo:seed:real-footage
```

脚本会创建：

- 1 个 `DeliveryOrder`
- 3 个 `RawAsset`
- `FootageShot` 索引
- 5 个 `ContentAngle` / `VideoBrief`
- 5 个 `AdEditPlan`
- `ReviewerAgent` 写入的 `QAReview`
- 至少 1 个 `FFMPEG_EDIT` `VideoJob`
- `PublishRecord` 与 24h metrics
- `ScoreReport`
- `DistillationFeature`
- 下一轮 iteration suggestion

如果 `ENABLE_FFMPEG_RENDER` 未开启，渲染服务会写入 manifest fallback，并把首个素材 URL 作为可审核占位成片。

## 手动 E2E 验证路径

1. 打开 `/orders/new` 创建广告项目。
2. 在项目详情上传或登记至少 3 个真实素材。
3. 点击真实素材区的「预处理并打标签」。
4. 执行「生成策略 + 卖点」。
5. 开启视频赛马并进入轮次页。
6. 生成 5 条 Angle。
7. 点击「生成 5 条广告」，生成 5 个 `AdEditPlan` 并运行 ReviewerAgent。
8. 打开任意 Brief，点击「渲染剪辑计划」。
9. 检查 `finalVideoUrl`、`VideoJob` 状态和 `QAReview`。
10. 在发布队列创建/回填发布记录后，到 `/metrics` 导入 CSV。
11. 轮次页点击「复盘 + 下一轮」，生成 `ScoreReport`、`DistillationFeature` 和下一轮建议。

## FFmpeg 渲染验收

当前 renderer 支持：

- 多 clip 分段裁剪与拼接。
- 竖屏 `1080x1920` 9:16 crop。
- 图片素材转静态视频段。
- 字幕与 overlay 通过 `drawtext` 烧录。
- `ENABLE_FFMPEG_RENDER` 未开启时 manifest fallback。
- 明确错误：空 clips、缺失 sourceUrl、时间段无效、非支持格式、非 9:16。

支持格式：

- 视频：`mp4`, `mov`, `m4v`, `webm`
- 图片：`png`, `jpg`, `jpeg`, `webp`

## 测试

默认测试：

```bash
npm test
```

包含：

- `AdEditPlan` Zod validation。
- `DirectorAgent` / `ReviewerAgent` 输出解析。
- renderer fallback manifest。

数据库集成测试：

```bash
RUN_DB_TESTS=true npm test
```

会创建临时 order，验证 metrics 到 score/distillation 的闭环。

## MVP 验收标准

Demo 可接受条件：

- 一个项目至少有 3 个 `RawAsset`。
- 所有素材可预处理为 `FootageShot`。
- 一个 round 能生成 5 个 `AdEditPlan`。
- 5 个计划都有 ReviewerAgent 评分和 QA 记录。
- 至少 1 个计划能成功渲染或明确 fallback。
- `VideoBrief.finalVideoUrl` 与 `VideoJob.status` 正确更新。
- CSV metrics 能回流。
- round 能产出 `ScoreReport`、`DistillationFeature` 和下一轮建议。

## 已知限制

- 素材索引仍是 POC 规则切分，不是真实视频理解模型。
- FFmpeg renderer 是模板化拼接，不是复杂时间线编辑器。
- 音频暂不混音，当前输出默认静音并烧录字幕/overlay。
- 平台发布仍是人工上传和手动回填数据。
- LLM JSON 会被 Zod 校验拦截，失败时需要重试或走 mock/fallback。

## Release Candidate 部署 Readiness

### 必需环境变量

- `DATABASE_URL`: 必需。Prisma 连接 Postgres/Neon。
- `AUTH_SECRET`: 必需。NextAuth session 加密。
- `BLOB_READ_WRITE_TOKEN`: demo 上传和渲染产物持久化强烈建议配置；未配置时上传不可用，本地 FFmpeg 渲染只会返回 `file://` 临时路径，不适合浏览器 demo。
- `ENABLE_FFMPEG_RENDER=true`: 真实 9:16 MP4 导出必需。未开启时系统会返回 manifest fallback，并在 VideoJob / AdEditPlan 上写入可读原因。
- `OPENAI_API_KEY`: 真实 DirectorAgent / ReviewerAgent / 蒸馏建议建议配置；未配置时部分流程走 mock。

### 上传大小限制

- 当前应用层限制单文件 `100MB`。
- 真实 demo 建议每段素材 5-30 秒、H.264 MP4、1080p 或以下，避免上传和渲染时间过长。
- 如果目标部署平台还有更低 request body 限制，应改为客户端直传 Blob 或独立上传服务。

### FFmpeg 与部署环境

- 本地 demo 需要 `ffmpeg -version` 成功。
- Vercel Serverless 默认不适合作为真实 FFmpeg 渲染环境：二进制可用性、包体大小、`/tmp` 容量和函数超时都可能成为 blocker。
- 推荐把真实渲染放到本地 demo 机、持久化 Node 进程、容器 worker、队列 worker 或其他可安装 FFmpeg 的长运行环境。

### 临时文件处理

- renderer 会在系统临时目录创建 `aivora-render-*` 文件夹。
- 成功或失败都会在 `finally` 中递归删除临时目录。
- 若进程被平台强制中断，可能留下临时文件；长运行 worker 应加周期清理策略。

### Serverless 超时风险

- 多 clip 下载、转码、拼接和 Blob 上传可能超过 serverless 函数时间限制。
- 真实 demo 可以使用短素材降低风险；生产化建议改成异步 job：API 只入队，worker 渲染，前端轮询状态。

### MVP 推荐部署模式

Release-candidate demo 推荐：

1. Next.js Web/API 部署在 Vercel 或同类平台。
2. 数据库使用 Neon/Postgres。
3. 原始素材和渲染产物使用 Vercel Blob。
4. FFmpeg 渲染在本地 demo 机或独立 worker 运行。
5. 对外演示时开启 `ENABLE_FFMPEG_RENDER=true`，并先用短素材预跑一次完整链路。

## Release Candidate E2E 验证记录

验证时间：2026-04-29。

验证命令：

```bash
OPENAI_API_KEY= ENABLE_FFMPEG_RENDER=true ./node_modules/.bin/dotenv -e .env.local -- ./node_modules/.bin/tsx scripts/seed-real-footage-demo.ts
```

验证结果：

- DeliveryOrder: `cmoknfgkw0000lit8uxmut9y1`
- Round: `cmoknfjsn001rlit88zjgm4rx`
- RawAsset: `3` 个真实视频素材，全部 `INDEXED`
- FootageShot: `24`
- AdEditPlan: `5`
- ReviewerAgent / QA: `5` 个计划均完成 review
- Rendered MP4: `https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/cmoknflaj002nlit8o3n1efws.mp4`
- PublishRecord: `5`
- MetricsSnapshot: `5`
- ScoreReport: 已生成
- DistillationFeature: `1`
- Next-round suggestion: `{ optimization: 3, exploration: 2 }`

发现的边缘情况与处理：

- `.env.local` 未默认开启 `ENABLE_FFMPEG_RENDER`。真实 MP4 demo 需要在命令或部署环境中显式设置 `ENABLE_FFMPEG_RENDER=true`。
- 使用真实 `OPENAI_API_KEY` 的 seed 长时间无输出，release demo 为避免 LLM 网络等待，验证时临时清空 `OPENAI_API_KEY` 走 mock Director/Reviewer；真实模型路径建议加异步 job 状态和超时提示。
- 本机 FFmpeg 8.1 可转码，但编译时缺少 `drawtext` filter。renderer 已改为自动检测：如果 `drawtext` 不可用，仍导出真实 9:16 MP4，只跳过字幕和 overlay 烧录。
- 真实素材远端 URL 可被 FFmpeg 直接读取；若客户素材 URL 有鉴权、签名过期或不带文件扩展名，会触发可读错误，建议 demo 前使用 Vercel Blob 公共 URL。
