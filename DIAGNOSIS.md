# DIAGNOSIS — 卡在「正在合成最终视频 85%」的真实任务

诊断时间：2026-07-08 （全程只读，未改任何代码 / 数据）

## 卡住的任务标识

| 实体 | ID | 状态 |
|---|---|---|
| VideoBrief | `cmrcbuaji000rl404hzi2gzht` | `RENDERING` |
| FinalVideo | `cmrcbuald000sl404w9j4cvd0` | `PENDING`，`ffmpegError="awaiting external stitcher"`，`stitchAttempts=0`，`startedAt=null` |
| VideoJob（唯一分镜段） | `cmrcbuam4000ul404ns0ryqo3` | `SUCCEEDED`，`externalJobId=cgt-20260709010337-r2djs`（Seedance 真实任务） |

## 时间线（全部来自 DB 行，UTC）

| 时间 | 事件 | 证据 |
|---|---|---|
| 17:03:36 | brief / FinalVideo / VideoJob 创建，段提交 Seedance | `createdAt`、`submittedAt=17:03:36.519` |
| 17:11:04 | 分镜段生成成功（1/1），拿到签名 mp4 URL | `VideoJob.finishedAt=17:11:04.264`，`lastProviderStatus="succeeded"` |
| 17:11:04 之后 | FinalVideo 进入「等待合成」：状态保持 `PENDING`，被打上 `ffmpegError="awaiting external stitcher"` 占位 | `FinalVideo.status=PENDING`，`startedAt=null`（从未被领取） |
| 18:06:54 | 最后一次状态触碰：前端轮询 POST `/render-status` → `maybeTriggerStitch` 再次走 external 分支重写占位 | `FinalVideo.updatedAt=18:06:54.170`，内容无变化 |
| 之后 ~1h+ | 无任何状态变更。**下一步本应发生的环节：外部 stitch runner claim 该任务并合成** —— 从未发生 | `startedAt=null`，`stitchAttempts=0` |

分镜段产物（已付费资产）验证：签名 URL 仍可下载（HTTP 200，`video/mp4`，17,511,777 字节），
ffprobe 确认 h264+aac、1080x1920、15.09s，完好。已保全至
`tmp/recovery/cmrcbuald000sl404w9j4cvd0/seg-0.mp4`。
⚠️ 该 URL 是 `X-Tos-Expires=86400`（24 小时）的临时签名地址，**将于 7 月 9 日 ~17:08 UTC 过期**。

## 结论：情况 (a) —— 孤儿任务，合成 worker 从未领取

不是 worker 崩溃，而是**两段路由逻辑互相矛盾，导致该任务落入没有任何 worker 会处理的死区**：

1. 生产环境（Vercel，`NODE_ENV=production` → `stitchRuntimeMode()="external"`）下，
   `stitchFinalVideo` 对**带 unified assemblyPlan 的 brief** 先做 external 判定并直接返回占位：

```145:159:src/lib/services/stitch-service.ts
  if (await briefHasUnifiedAssembly(fv.brief?.id)) {
    /// external runtime 仍然不在本进程跑 ffmpeg —— 保留占位让外部 runner 拉
    if (stitchRuntimeMode() === "external") {
      await db.finalVideo.updateMany({
        where: { id: fv.id, status: FinalVideoStatus.PENDING },
        data: { ffmpegError: AWAITING_EXTERNAL_STITCHER },
      });
      return {
        finalVideoId,
        ok: false,
        status: FinalVideoStatus.PENDING,
        awaitingExternal: true,
        error: AWAITING_EXTERNAL_STITCHER,
      };
    }
```

   注意：`segmentCount === 1` 的单段捷径（第 176 行）排在这个判定**之后**，unified brief 永远到不了。

2. 而外部 runner（GitHub Action，每 5 分钟）通过 `claimStitchTask()` 领任务时，**显式跳过单段任务**：

```324:331:src/lib/services/stitch-service.ts
  for (const fv of candidates) {
    const allSucceeded =
      fv.segments.length === fv.segmentCount &&
      fv.segments.every(
        (s) => s.status === VideoJobStatus.SUCCEEDED && !!s.outputVideoUrl,
      );
    if (!allSucceeded) continue;
    if (fv.segmentCount <= 1) continue; // 单段不需要外部 runner
```

结果：**单段 + unified assemblyPlan + 生产环境**的任务，serverless 侧说「等外部 runner」，
外部 runner 侧说「单段不归我管」——没人认领，永远 `PENDING`。
`business-status.ts` 把「`PENDING` + 全部段成功」映射为 `assembling`（`progressHint=0.85`），
所以用户看到的就是「正在合成最终视频 85%」永久不动，且无错误信息。

## 排除其他假设

- (b) 合成已完成但回写失败 —— 排除：`stitchedVideoUrl=null`、`stitchAttempts=0`、`startedAt=null`，从未开始。
- (c) ffmpeg 静默失败 —— 排除：同上，ffmpeg 从未运行；`ffmpegError` 里只有占位字符串。
- (d) 前端未更新 —— 排除：后端状态确实停在 `PENDING/assembling`，前端如实展示；且 `updatedAt` 随每次轮询更新，说明轮询链路是通的。

## 附带发现（进入第三阶段审计清单）

1. **85% 假进度**：`progressHint` 是状态映射的常量（assembling 恒等于 0.85），不是真实进度。
2. **无超时**：FinalVideo 层没有任何「PENDING/STITCHING 超过 N 分钟转失败」的机制（VideoJob 层有 `timeoutAt`，但只用于 UI 提示，也不 fail）。
3. **单 clip 直通路径复用临时 URL**：`assembly-executor` 的单 clip 快速路径直接把 Seedance 24h 签名 URL 写进 `stitchedVideoUrl` —— 即便当时成功，24 小时后视频也会 403 无法播放。恢复本任务时必须转存到持久存储。
4. **外部 runner 不认识 assemblyPlan**：`claimStitchTask` 只返回 AI 段 URL 列表，unified brief 的 end card / 上传素材 clip 会被外部 runner 静默丢弃。
5. **孤儿 STITCHING**：若 runner claim 后崩溃（未调 complete），FinalVideo 卡在 `STITCHING` 且无人清扫。
