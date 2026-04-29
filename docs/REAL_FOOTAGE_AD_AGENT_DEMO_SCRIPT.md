# Real-Footage Ad Agent Demo Script

本文档用于 release-candidate demo。目标听众是业务负责人、客户、销售或运营团队，不需要理解代码实现。

## 一句话产品故事

Aivora 可以把客户已经拍好的真实门店、产品、服务或 UGC 素材，自动整理成可测试的短视频广告版本：先理解素材，再生成 5 条不同广告剪辑计划，导出至少 1 条 9:16 MP4，发布后导入表现数据，最后总结下一轮应该放大什么、避免什么。

这不是“从零生成一条漂亮视频”的演示，而是“用真实素材建立可复用的广告迭代机器”的演示。

## Demo 前准备

- 准备 3 段以上真实视频素材，建议每段 5-30 秒。
- 素材最好覆盖不同画面：开场 hook、产品或服务证明、用户/场景/结尾 CTA。
- 文件格式使用 mp4、mov 或 webm；单文件建议低于 100MB。
- 本地或部署环境需要开启 `ENABLE_FFMPEG_RENDER=true`，并确认 FFmpeg 可运行。
- 如需上传到云端，配置 `BLOB_READ_WRITE_TOKEN`。

## 现场讲解流程

1. 创建交付单

   进入新建订单页，输入客户、产品、目标市场和平台。讲解重点是：这是一次广告投放项目，不是一条孤立视频。

   预期输出：订单详情页出现一张 `MVP Demo Pipeline` 卡片，展示上传、预处理、计划、Review、渲染、数据和迭代状态。

2. 上传真实素材

   上传至少 3 个真实视频素材。每个素材会登记为 RawAsset。

   预期输出：真实素材区域显示素材名称、类型、状态和 shot 数量。此时状态可能还不是 indexed。

3. 预处理素材

   点击「预处理并打标签」。系统会把素材切成 FootageShot，记录可用于剪辑的片段、标签和备注。

   预期输出：素材状态变为 `INDEXED`，每个素材有 1 个或更多 shots。Pipeline 卡片的「预处理」变绿。

4. 生成策略与第一轮

   运行调研/卖点，然后启动第一轮赛马。进入轮次页，生成 5 条 Angle。

   预期输出：一轮中出现 5 个广告方向，通常包含 3 条优化型和 2 条探索型。

5. 生成 5 条广告剪辑计划

   点击「生成 5 条广告」。DirectorAgent 会从素材索引里选择镜头，输出 5 个 AdEditPlan；ReviewerAgent 会自动打分并写入 QA。

   预期输出：每个 Brief 下都有真实素材剪辑计划，计划里包含 clips、captions、overlays、music 和 render hints。

6. 渲染真实 9:16 MP4

   打开任意 Brief，点击「渲染剪辑计划」。在 FFmpeg 开启时，系统会按 AdEditPlan 裁剪、竖屏适配、烧录字幕/overlay，并导出 MP4。

   预期输出：Brief 页面出现成片播放器；VideoJob 状态为成功；AdEditPlan 有 output video URL。

7. 导入表现数据

   进入 metrics 页面，导入 mock CSV。CSV 至少包含 `external_post_id`、`window_hours` 和 views 等指标。

   预期输出：每条 PublishRecord 关联 MetricsSnapshot，订单 Pipeline 的「数据」阶段变绿。

8. 生成复盘与下一轮建议

   回到轮次页点击「复盘 + 下一轮」。系统会生成 ScoreReport、DistillationFeature 和下一轮建议。

   预期输出：可以向客户解释哪条广告赢了、为什么赢、下一轮要保留什么创意特征，以及还要探索什么。

## Demo 讲解重点

- Aivora 使用客户真实素材，不依赖纯模板或纯 AI 幻觉画面。
- 同一批素材可以一次生成多条广告版本，适合做赛马测试。
- ReviewerAgent 不是最终审批者，而是给运营和客户一个初审依据。
- 指标回流后，系统从“生成工具”变成“迭代系统”。
- MVP 已能跑通闭环，但高级素材理解、自动发布和大规模渲染还属于后续版本。

## 预期输出清单

- 1 个 DeliveryOrder。
- 至少 3 个 RawAsset，且是视频素材。
- 多个 FootageShot。
- 5 个 AdEditPlan。
- 5 个 ReviewerAgent 结果或 QAReview。
- 至少 1 个真实导出的 9:16 MP4。
- 若导入数据，至少 1 个 ScoreReport 和 1 个 DistillationFeature。
- 下一轮建议，包括优化位和探索位。

## 已知 MVP 限制

- 素材预处理是规则化 POC，不是完整视频理解模型。
- FFmpeg renderer 支持基础裁剪、拼接、竖屏适配和文字烧录，不是专业时间线编辑器。
- 当前输出默认不做复杂音频混音。
- 发布和 CSV 数据回流仍需要人工操作。
- LLM 生成 JSON 可能失败；系统会给出可读错误，需要重试或使用 mock fallback。
- Serverless 环境可能不适合长视频渲染，正式 demo 建议在本地或持久化 Node worker 里跑。

## V1.5 路线图

- 接入真实视频理解：镜头分类、OCR、人物/产品检测、语音转写。
- 增加 TrimRefiner，让镜头切点更自然。
- 支持背景音乐、音量 ducking、字幕样式模板。
- 给运营提供计划预览和手动替换 clip 的轻量编辑界面。
- 增加失败重试和 render job 队列。

## V2 路线图

- 平台自动发布与 TikTok 数据自动回流。
- 多平台版本化：TikTok、Reels、Shorts、小红书、视频号。
- 多智能体协作：Director、Reviewer、Editor、Performance Analyst 持续闭环。
- 基于历史表现自动推荐下一批素材拍摄清单。
- 独立渲染服务或队列化 worker，支持更长视频和并发 demo。

## 推荐 Demo 部署模式

Release-candidate MVP 推荐使用“Next.js 应用 + 数据库 + Blob + 独立或本地 FFmpeg worker”的部署方式。

如果只在 Vercel Serverless 里运行，上传、计划生成、Review 和 metrics 回流适合保留在 API Routes；真实 FFmpeg 渲染建议放在本地 demo 机、持久化 Node 服务、容器 worker 或后台队列中执行，避免命中 serverless 包大小、二进制依赖、临时磁盘和函数超时限制。
