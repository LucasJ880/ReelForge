# Seedance 重复扣费保护清单

> 范围：Aivora 多段视频生成流（30s = 2 段、60s = 4 段）以及单段兼容流（15s / Sunny Shutter）。
>
> 目标：**任何一次「视频生成 / 重试 / 状态刷新」操作都最多创建 1 次 Provider 任务**，
> 即使用户连点按钮、cron 同时触发、或后端被并发请求轰炸。

---

## 1. 何时会创建第 1 次 Seedance task

入口只有 **2 个函数**，其它路径都是这两个的下游：

| # | 函数 | 文件 | 触发时机 |
|---|---|---|---|
| 1 | `dispatchMultiSegmentGeneration(briefId)` | `src/lib/services/video-service.ts` (L75-168) | 用户在 wizard step-6-render 点「生成视频」且 `targetDurationSec > 15` 且 `directorPlan` 已就绪 |
| 2 | `dispatchVideoGeneration(briefId)` | `src/lib/services/video-service.ts` (L229-339) | 旧单段流（15s 或 Sunny Shutter brief）—— 没有 `directorPlan` |

两条路径的总入口都封装在 `dispatchVideoForBrief(briefId)` (L42-61)，调用方**不应**直接调底层路径，
保证「单段 vs 多段」的分流逻辑只有一处。

**第一次扣费的 SQL 顺序**（多段路径）：

```
db.videoJob.create({ status: QUEUED, externalJobId: null })   ← 占位行，无副作用
↓
submitSeedanceJob(...)                                         ← 真正的钱：调用 Provider
↓
db.videoJob.update({ externalJobId: <providerJobId>, status: RUNNING })
```

→ 只要 `submitSeedanceJob` 抛错，行被立刻 update 成 `FAILED`（L207-218），
   **绝不会留下「DB 没记录但 Provider 已收钱」的悬空任务**。

---

## 2. 何时绝对不会再创建第 2 次 task

下面四道闸门，按顺序触发：

### 闸门 A：dispatch 入口的 inflight 检测

```ts
// dispatchMultiSegmentGeneration (L92-103)
const inflightExisting = await db.videoJob.findMany({
  where: {
    videoBriefId: briefId,
    finalVideoId: { not: null },
    status: { in: [QUEUED, RUNNING] },
    externalJobId: { not: null },          // ← 关键：必须有 Provider ID
  },
});
if (inflightExisting.length > 0) {
  await reconcileBriefRenderStatus(briefId);   // 复用已在跑的任务
  return inflightExisting;
}
```

**dispatchVideoGeneration (L247-258)** 用同一逻辑（少了 `finalVideoId` 条件，因为旧流没有）。

→ 用户连点 3 次「生成视频」按钮时，第 2、3 次都直接 `return inflightExisting`，
   **不再调 `submitSeedanceJob`**。

### 闸门 B：retryFailedVideoJob 的「先查 Provider」双保险

```ts
// retryFailedVideoJob (L466-499)
if (job.externalJobId) {
  const r = await getSeedanceStatus(job.externalJobId);
  if (r.status === "completed") {
    return db.videoJob.update({ status: SUCCEEDED, ... });   // ← 修正状态，不重提交
  }
  if (r.status === "processing" || r.status === "pending") {
    return db.videoJob.update({ status: RUNNING, ... });     // ← 恢复 RUNNING，不重提交
  }
  // 只有 status=failed 或查不到（catch 分支）才走重新提交
}
```

→ 即使 DB 标 `FAILED` 但 Provider 其实在跑（轮询暂时失败 → pollErrors 阈值触发），
   **重试按钮也不会重复扣费**。

### 闸门 C：retryFailedSegmentsForBrief 段感知

```ts
// retryFailedSegmentsForBrief (L647-672)
const failed = await db.videoJob.findMany({
  where: {
    videoBriefId: briefId,
    status: VideoJobStatus.FAILED,           // ← 仅查 FAILED
  },
  orderBy: { segmentIndex: "asc" },
});
for (const job of failed) {
  await retryFailedVideoJob(job.id);          // ← 走闸门 B
}
```

→ 只重提 `FAILED` 段；`SUCCEEDED` 段绝不会被重新生成（钱已花值得，画面也不能换）。

### 闸门 D：CANCELLED 孤儿清理

```ts
// dispatchMultiSegmentGeneration (L146-153)
await db.videoJob.updateMany({
  where: {
    videoBriefId: briefId,
    status: { in: [QUEUED, RUNNING] },
    externalJobId: null,                    // ← 没拿到 Provider ID 的孤儿
  },
  data: { status: VideoJobStatus.CANCELLED },
});
```

→ 上一次 `submitSeedanceJob` 抛错且更新失败（极罕见的 DB 写竞争）留下的孤儿行
   会先被标 CANCELLED，再创建新行，**不会被 reconcile 当成"在跑"误判**。

---

## 3. 重试按钮走哪条分支

| UI 按钮 | 调用函数 | 走的闸门 |
|---|---|---|
| `<RenderProgress>` 中的「重试该段」（每段独立按钮） | `retryFailedVideoJob(jobId)` | A（不适用，因为 status=FAILED）+ B（先查 Provider）+ C（不适用） |
| 渲染卡片的「重试失败片段」（聚合按钮，一次重试所有失败段） | `retryFailedSegmentsForBrief(briefId)` | C → 对每个失败段走 B |
| 「刷新状态」按钮 | `reconcileBriefRenderStatus(briefId)` | **不**会创建新 Provider 任务，只查询现状 |
| 「重新生成视频」按钮 | `dispatchVideoForBrief(briefId)` → `dispatchMultiSegmentGeneration` | A（如果还有 inflight 直接复用） |

---

## 4. 并发请求时哪一层 CAS / 锁兜底

> 场景：用户点了「生成视频」按钮（HTTP 请求 #1），同一秒 Vercel cron `pollRunningJobs` 也在跑（HTTP 请求 #2）。

| 并发场景 | 兜底机制 | 风险评级 |
|---|---|---|
| **2 个 dispatch 同时进入** | 闸门 A 是 `findMany + return` 模式，**没有数据库锁**，理论上有 race。但因为：<br>① 第 1 次 `submitSeedanceJob` 之前已经先 `db.videoJob.create({ externalJobId: null })`，第 2 次进入时会同时创建占位行；<br>② 闸门 A 检测的是 `externalJobId != null` 的行，2 个占位行都不会触发跳出；<br>③ 两个请求都会调 `submitSeedanceJob` —— **真的有重复扣费风险**。 | ⚠️ **需要补**：见下方 "未来加强" 第 1 项 |
| **dispatch 与 cron pollRunningJobs 并发** | `pollRunningJobs` 只查询 + reconcile，**不创建新任务**；reconcile 走 `getSeedanceStatus`，不写新行。安全。 | ✅ 安全 |
| **2 个 retry 同时进入（用户连点 + cron 都触发同一段）** | 闸门 B 的 `getSeedanceStatus` 是幂等查询；如果 Provider 状态已是 `completed/processing/pending` → 两个请求都只更新 DB 不重提交；只有当两个都看到 `failed` 时才会双提交。 | ⚠️ 极小窗口期 |
| **stitch 与 retry 并发** | `maybeTriggerStitch` 用 `updateMany({ where: { status: PENDING } })` 的 CAS（L785-790）；只有 PENDING → STITCHING 的 transition 会被一个请求拿走，另一个 noop。 | ✅ 安全 |
| **dispatch 与 stitch 并发**（旧 FinalVideo 重置） | `dispatchMultiSegmentGeneration` L107-121 用 `db.finalVideo.update` 把状态强制重置 PENDING + 清 stitchedVideoUrl，这一刻如果 stitch cron 正在跑会 race。但 stitch 服务会在每次写入前用 CAS 检查（见 stitch-service —— 由 DevOps 维护），实际不会双拼。 | ✅ 已由 stitch-service 自身的 CAS 兜底 |

---

## 5. 未来加强（含 webhook 时怎么避免重复 reconcile）

### 5.1 当前架构必须先补的 P1（不在本次 PR 范围）

1. **dispatch 入口加唯一索引或 advisory lock**：
   - 方案 A：给 `VideoJob` 加 `@@unique([videoBriefId, segmentIndex, externalJobId])` 然后用 upsert；
   - 方案 B：用 PostgreSQL `pg_try_advisory_xact_lock(briefId)` 在 dispatch 入口取 transaction-scoped 锁，`return` 已 inflight 的列表；
   - 方案 C：把 dispatch 整体放进 `db.$transaction`，并在最前面 `SELECT ... FOR UPDATE` 锁定该 brief 的所有 VideoJob 行。
   - 推荐方案 C，最少侵入且语义清晰。

### 5.2 未来加 webhook 时

> Seedance 目前是 polling 模式（cron 每 N 秒拉状态）。
> 如果加 webhook（`POST /api/webhook/seedance`）：

1. **去重 key**：webhook payload 里的 `taskId / requestId` 必须能反查到唯一一条 `VideoJob.externalJobId`，
   先 `findFirst({ externalJobId })`；找不到就直接 200 OK 丢弃（防止恶意回放）。
2. **幂等 update**：用 `db.videoJob.updateMany({ where: { externalJobId, status: { in: [QUEUED, RUNNING] } }, data: ... })`
   而不是 `update`；多次收到同一 webhook 时只有第一次会更新行，后面的 `count=0` 直接 noop。
3. **webhook + cron 并发**：在 `reconcileVideoJob` 入口加状态判断 `if (job.status not in [QUEUED, RUNNING]) return`（已有，L351-355），
   webhook 处理完转 SUCCEEDED 之后，cron 即使又来一次也只是 noop。
4. **签名校验**：所有 webhook handler 必须先校验 Seedance 签名再走业务逻辑，不能裸跑。
5. **不要在 webhook handler 里调 `submitSeedanceJob`**：webhook handler 只做「读 → update DB → 触发 stitch」，
   不应该回调 Provider 创建新任务，否则重试逻辑会从 webhook 路径再触发一次扣费。
6. **加 `WebhookEvent` 审计表**：记录 raw payload + processed=true，便于调查重复 / 漏处理。

---

## 附录：测试覆盖

| 文件 | 覆盖契约 |
|---|---|
| `tests/multi-segment-lifecycle.test.ts` | segmentPlan ↔ segment-planner 一致性 + classifyUserStatus |
| `tests/multi-segment-retry.test.ts` | DirectorPlan.segmentPlan 是 retry 唯一来源 + 错误文案不暴露内部 ID |
| `tests/single-direction-flow.test.ts` *(本 PR 新增)* | `ensureSingleDirectionRound` 幂等 + 不创建赛马 5 angle |
| `tests/segment-planning.test.ts` | 30s → 2 段 × 15s + 兜底切片 |

> 凡是涉及真实 Prisma 写入的并发竞态，应在集成层（需 PostgreSQL）补 e2e 用例 ——
> 单元测试只验证「逻辑契约」，不验证「DB 锁是否真的工作」。
