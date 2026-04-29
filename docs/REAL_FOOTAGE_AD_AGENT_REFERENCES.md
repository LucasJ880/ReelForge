# 真实素材广告视频智能体参考项目研究

本文档沉淀 MVP 第一周参考结论：参考架构与能力边界，不复制项目代码。

## 参考顺序

1. `poseljacob/agentic-video-editor`
2. `harry0703/MoneyPrinterTurbo`
3. `gyoridavid/short-video-maker`
4. `WyattBlue/auto-editor`
5. `linyqh/NarratoAI`

## 可借鉴点

### agentic-video-editor

核心价值是把真实素材广告剪辑拆成明确的多智能体 pipeline：

- `Preprocess`：扫描素材，做场景检测、转写、镜头索引。
- `Director`：基于 footage index 与 creative brief 生成 `EditPlan`。
- `TrimRefiner`：收紧镜头边界，让节奏更适合广告。
- `Editor`：用 FFmpeg/MoviePy 渲染时间线。
- `Reviewer`：从广告一致性、节奏、画面质量、可看性等维度打分，低于阈值时把反馈回传给 `Director` 重试。

我们采用这套抽象，但数据结构落到 Aivora 自己的 `RawAsset`、`FootageShot`、`AdEditPlan`、`QAReview`。

### MoneyPrinterTurbo

适合借鉴后台产品体验和生成 pipeline：

- Web UI + API 双入口。
- 批量生成多个候选视频。
- 字幕、TTS、背景音乐、横竖屏配置。
- 多模型供应商配置。

它的主路径是“主题生成视频”，不是“客户真实素材广告”，所以只借鉴后台和媒体处理能力。

### short-video-maker

适合借鉴服务化边界：

- REST API 创建视频任务。
- MCP Server 暴露 `create-short-video` 等工具。
- 可被 n8n / AI Agent 调用。

我们的 V2 可以把“为交付单生成 5 条广告”暴露为 REST/MCP 工具，MVP 先在 Next.js API 内部跑通。

### auto-editor

适合素材预处理：

- 按 audio threshold 自动剪掉静音。
- 按 motion threshold 剪掉低运动/静止片段。
- 用 margin 保留切点前后缓冲，避免剪掉有效口播。

MVP 先实现 auto-editor 风格参数记录与镜头索引 POC，后续再接真实命令行处理。

### NarratoAI

适合后续扩展：

- 自动解说文案。
- 配音与字幕同步。
- 影视/短剧类素材理解和剪辑。

MVP 默认以字幕/overlay 为主，TTS 与自动解说放到 V1.5。

## Aivora MVP 对应结构

- `RawAsset`：用户上传的真实素材。
- `FootageShot`：素材切出的可检索镜头。
- `AdEditPlan`：Director Agent 产出的广告剪辑计划。
- `VideoJob(provider=FFMPEG_EDIT)`：本地剪辑渲染任务。
- `QAReview`：Reviewer Agent 和人工审核结果。
- `MetricsSnapshot`、`ScoreReport`、`DistillationFeature`：发布数据复盘与下一轮优化。

## MVP 默认阈值

- 音频静音阈值：`-28dB`
- 低运动阈值：`0.02`
- 切点缓冲：`300ms` 前置，`500ms` 后置
- Reviewer 重试阈值：`overall < 0.65`
- 单轮广告数量：`3` 条优化型 + `2` 条探索型
