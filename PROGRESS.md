# PROGRESS — 合成卡死修复 & 可靠性审计

## 第 1 轮 — 诊断（只读）

**改了什么**：无代码改动。新增只读诊断脚本 `scripts/diagnose-stuck-final-videos.ts`、
`scripts/diagnose-stuck-brief-detail.ts`、资产保全脚本 `scripts/preserve-paid-segment.ts`。

**验证了什么**：
- 定位卡住任务：brief `cmrcbuaji000rl404hzi2gzht` / FinalVideo `cmrcbuald000sl404w9j4cvd0`，
  单段 SUCCEEDED、FinalVideo 永久 PENDING（`startedAt=null`、`stitchAttempts=0`）。
- 根因：unified assemblyPlan 单段任务在生产环境被标「awaiting external stitcher」，
  而外部 runner `claimStitchTask` 跳过 `segmentCount<=1` → 无人认领死区（详见 DIAGNOSIS.md）。
- 已付费分镜段（17.5MB，15.09s，h264/aac 完好）已保全到
  `tmp/recovery/cmrcbuald000sl404w9j4cvd0/seg-0.mp4`（签名 URL 24h 过期）。

**下一步**：实现 AIVORA_DRY_RUN + 修复死区。

## 第 2 轮 — AIVORA_DRY_RUN 计费保险丝 + 根因修复

**改了什么**：
- 新增 `src/lib/config/dry-run.ts`（`isDryRun()` / `dryRunRefusalError()`）。
- 接入全部计费 provider：seedance（强制 mock）、openai LLM（强制 mock + 真实调用点拒绝）、
  volcengine Ark LLM（同）、openai-image（视为不可用→占位 mock）、volc-tts（fail-closed 拒绝）、
  omnihuman（fail-closed 拒绝）、apify（视为不可用）、frame-qa（自动禁用）。
- 根因修复 1：`claimStitchTask` 不再跳过 `segmentCount<=1` —— 单段任务也可被外部 runner
  领取，消除死区（`src/lib/services/stitch-service.ts`）。
- 根因修复 2：新增 `isEphemeralSignedUrl()`；`stitchFinalVideo` 单段 fast path 与
  `assembly-executor` 单 clip 直通不再把 24h 过期的 TOS/S3 签名 URL 直接写成
  `stitchedVideoUrl`（否则成片一天后 403），这类任务必须走真实 stitch 转存持久存储。

**验证了什么**：
- `npm run typecheck` 通过。
- 新增 `tests/dry-run-guard.test.ts`（9 条：每个计费 provider 的 dry-run 守门）、
  `tests/stitch-orphan-regression.test.ts`（6 条：死区回归 + 签名 URL 直通禁止 + 行为不回退）。
- 更新 `tests/stitch-service-runtime.test.ts` 的旧契约（单段现在必须可被领取）。
- 全部 29 条在 `AIVORA_DRY_RUN=1` 下通过，零计费调用。

**下一步**：从已保全的付费资产恢复卡住的任务（本地 ffmpeg + 持久存储转存，零计费）。

## 第 3 轮 — 恢复卡住的真实任务（零计费）

**改了什么**：
- 新增 `scripts/recover-stuck-final-video.ts`：强制要求 `AIVORA_DRY_RUN=1 + STITCH_RUNTIME=local`，
  复用已付费段（URL 过期时用 `--local-seg` 注入本地保全文件），走修复后的真实代码路径
  `stitchFinalVideo()` 完成本地 ffmpeg 合成 + 持久存储上传 + 状态推进，并补缩略图。
- 新增 `scripts/persist-recovered-segment.ts`：把段资产从 file:// 转存持久 Blob URL 回写 DB。

**验证了什么**（唯一动真实数据的验证）：
- 段签名 URL 已过期（HEAD 403）→ 用保全文件恢复成功。
- FinalVideo `cmrcbuald000sl404w9j4cvd0`：status=READY，stitchedVideoUrl= 持久 Blob URL，
  ffprobe 确认 h264/aac 1080x1920 15.03s 可播放；缩略图已生成上传。
- Brief `cmrcbuaji000rl404hzi2gzht`：status=QA_PENDING（用户视角「已完成」），finalVideoUrl 已写。
- UI 截图验证（puppeteer + 本地 dev server，AIVORA_DRY_RUN=1）：列表页显示「已完成」+缩略图，
  详情页播放器正常加载成片、显示「视频已完成 · 分镜进度 1/1」。
- 全程零计费调用：无任何生成 API 外呼（Seedance/LLM 均被 dry-run 拦截，仅本地 ffmpeg + Blob 存储上传）。

**下一步**：第三阶段可靠性审计（超时/心跳、幂等重试、错误上浮、进度真实性、孤儿清扫器）。

## 第 4 轮 — 第三阶段：可靠性审计五项落地（全部 dry-run）

**改了什么**：

1. **超时与心跳 + 孤儿清扫器（审计项 1、5）**——新增 `src/lib/services/sweep-service.ts`：
   - RUNNING/QUEUED VideoJob 超过 `timeoutAt` + 10min 宽限 → FAILED + 人话 `userSafeError`，
     并 `syncBriefStatus` 上浮到 brief。
   - STITCHING FinalVideo 超过 30min（runner 失联）→ 还有尝试预算转回 PENDING 续跑，
     预算耗尽转 FAILED。
   - PENDING 且所有段 SUCCEEDED 但 45min 无人领取（本次事故形态）→ FAILED + 人话错误。
     锚点用「最后一段完成时间」而非 updatedAt（后者被轮询刷新，不可靠）。
   - 所有状态迁移用 CAS（updateMany + status 条件）防并发冲突；FAILED 时 brief →
     RENDER_FAILED + 用户可读 errorMessage。超时阈值可用 `SWEEP_*_MIN` 环境变量调。
   - 接入调度：`/api/cron/poll-videos`（GitHub Actions 每 5 分钟）顺带执行清扫；
     另有独立入口 `/api/cron/sweep-stuck-tasks` 供手动触发。
2. **幂等重试/续跑（审计项 2）**——`render-retry` `all:true` 现在覆盖合成失败：
   无 FAILED job 且 FinalVideo=FAILED + 段全成功时调用 `retryStitch` 纯续跑
   （复用已付费段，零生成计费）。修复了「合成失败时重试按钮是空操作」的漏洞。
   `retryStitch` 同时重置 `stitchAttempts`（否则预算耗尽的任务重试后永远不被领取，回到死区）。
3. **错误上浮（审计项 3）**——personal 详情页失败卡片展示 `brief.errorMessage` 的人话版
   （经 `containsBannedPersonalTerm` 过滤，技术错误退回通用文案）；重试按钮在合成失败
   （无失败分镜）时文案从「重试失败片段」改为「重试」。
4. **进度真实性（审计项 4）**——`deriveBusinessStatus`：
   - generating 阶段进度改为按真实段完成数插值（0.2 → 0.8），不再固定 55%。
   - assembling 拆出 `assemblingPhase: waiting|active`：段全成但未被领取时 UI 显示
     「画面已生成，正在排队合成」(85%)，真正 STITCHING 时才显示「正在合成最终视频」(90%)。
     C 端 `progressHint_text` 同步。85% 的含义从此和界面文案一致。

**验证了什么**：
- 新增 `tests/sweep-service.test.ts`（8 条）、`tests/progress-truthfulness.test.ts`（5 条）、
  `tests/retry-stitch-resume.test.ts`（1 条），全部 monkey-patch Prisma、零 DB/零计费。
- 修正 3 个被 dry-run 开关暴露的既有测试：`frame-qa-gate`（dry-run 也关门禁，补断言）、
  两个 seedance 请求组装测试（stub fetch 零计费，显式 `AIVORA_DRY_RUN=0` 退出强制 mock）；
  另修正 2 条早已过期的 business 文案审计测试（页面已 i18n 化，改为校验字典 key + zh 文案）。
- 追加 timeoutAt=null 兜底清扫（部分创建路径不设 timeoutAt，按 createdAt + 60min 兜底），
  确保「任何任务都不会永远进行中」没有豁免通道。
- 全量 `AIVORA_DRY_RUN=1 npm test`：**522 条（521 过 / 1 skip）零失败**；
  `npm run typecheck` + eslint 干净。
- 全程零计费调用。

**下一步**：无（三阶段完成）。遗留低危项见 KNOWN_ISSUES.md。
