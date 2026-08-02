# b-roll 第三条线路 · 编排层接通实施计划（2026-08-02）

> 前情：`broll-plan-service`（拆镜头段 + 图库选片）与 `stock-footage` 适配器 0801 已就绪，
> 但没有任何消费方 —— 「下载素材 → TTS 配音 → 字幕 → 合成出片」的编排层是缺口。
> 本计划把缺口补上，真机产出一条成片进成品库。Lucas 0802 拍板开工。

## 目标

口播稿（script）→ 图库实拍成片（MP4 + SRT），全程不生成一帧 AI 画面，
单条边际成本 ≈ TTS 数美分（Pexels 免费、ffmpeg 本地/runner）。
定位不变：主线（产品锚定）之外的第三条线路与 Shuyu 单点风险兜底；
讲流程/种草可用，展示 SKU 细节不可用（做不了产品一致性）。

## 复用面（不重造的部分）

| 环节 | 复用 |
|---|---|
| 拆段 + 选片 | `buildBrollPlan` / `pickFootageForPlan` / `missingSegments`（已有，含测试） |
| 归一化/拼接/字幕/BGM/SRT | `stitchFinalVideo` 状态机 + `runFfmpegNormalizeAndConcatWithPostProduction`（含 BGM 对人声 sidechain 闪避） |
| 入库/进度/取消/重试 | DeliveryOrder→Round→ContentAngle→VideoBrief→VideoJob→FinalVideo 既有数据链；成品库 `loadUnifiedLibrary` 自动可见 |
| 存储 | `getStorageProvider().uploadBuffer`（同产品锚点管线） |

## 新文件

1. **`src/lib/providers/openai-tts.ts`**
   - `isOpenAiTtsAvailable()`；`synthesizeVoiceover({ text, voiceId })` → mp3 Buffer
   - 产品音色 → OpenAI voice 映射：warm-confident→nova、natural-friendly→shimmer、
     energetic-creator→alloy（未识别一律 nova）
   - 失败抛类型化错误（含 HTTP 状态），日志不落 key 不落全文
2. **`src/lib/services/broll-assembly-service.ts`**
   - `composeBrollSegments({ script, aspectRatio, voiceId })`：
     plan → picks → **缺段即整单失败**（沿用 `BrollPlanError`，绝不出「缺一段的片」）→
     逐段：TTS → ffprobe 实测时长 → 下载首选素材 → ffmpeg 合成段 → 上传 Blob
   - `createBrollDelivery({ userId, script, aspectRatio, voiceId, bgmTrackId, captions })`：
     事务建数据链（`productInput.source = "broll_route"` 供审计识别）→
     段任务 = `VideoJob(provider: FFMPEG_EDIT, status: SUCCEEDED, outputVideoUrl)` →
     `FinalVideo(PENDING, postProduction 快照)` → `stitchFinalVideo()` 收尾

## 关键决策

- **段时长由口播驱动**：每段 = max(2s, TTS 实测时长 + 0.35s 呼吸)；素材比所需短时
  `-stream_loop -1` 循环补长再 `-t` 截断。`maxClipDurationSec` 本期只约束计划层。
- **段音轨 = TTS，丢弃素材原声**（图库素材环境声嘈杂且版权音乐风险）；
  BGM 由现有后期在成片层闪避混入，**不在段内混**。
- **字幕不重造**：交给现有后期从 script 确定性生成（与主线同一套样式/位置/SRT 导出）。
- **取消语义**：段合成发生在建数据链之前，用户可见的任务从建链起即挂在既有
  order 取消路径上；段合成中途失败不留半截记录（先合成、后建链）。
- **不动 dispatch 路由**：本期不改 `/api/video-generation/dispatch` 的巨事务；
  b-roll 走独立 service 入口，UI 接线（创作页第三条「实拍图库」通道）留下期，
  避免一次改动同时碰生成主线。

## 验收

1. `npm run typecheck` / `lint` / `npm test` 全绿（新增单测：音色映射、时长夹取、
   缺段 gate、后期快照通过 `postProductionPlanSchema` 校验）。
2. 真机：Lucas 账号产出一条 9:16 遮阳帘话术样片，FinalVideo READY，
   成品库可见可播，SRT 存在。（TTS 数美分 + Pexels 免费 + 本地 ffmpeg）

## 明确不做（本期）

- 创作页 UI 通道与批量接入（下期，需要产品侧定文案与位置）
- 多候选择优 / 换词重试自动化（缺段直接失败并报缺哪段）
- Pixabay 备胎（key 未配；配上即自动进选片池，代码无需改）
