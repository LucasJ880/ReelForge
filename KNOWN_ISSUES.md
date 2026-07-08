# KNOWN_ISSUES — 可靠性审计遗留项

第三阶段审计中发现但**未在本轮修复**的问题。均已评估为不阻塞发布；
严重级别：P1（尽快修）/ P2（排期修）/ P3（记录在案）。

## P2 — 清扫调度依赖 GitHub Actions cron，最坏延迟不可控

`sweepStuckTasks` 挂在 `/api/cron/poll-videos` 上，由 GitHub Actions 每 5 分钟触发。
GitHub 的 schedule 是 best-effort，高峰期可能延迟 10–30 分钟甚至跳过。
含义：超时任务转为失败态的时间 = 配置阈值 + 调度延迟，用户最坏可能多等半小时。
缓解：阈值本身留了裕量；Vercel Pro 后应把 crons 写回 `vercel.json`（`/api/cron/sweep-stuck-tasks`
已就绪，接上即用）。

## P2 — B 端（business）详情页未展示具体失败原因

本轮错误上浮只做了 personal 详情页（事故用户所在面）。business 详情页失败态
仍只显示通用文案「视频未能成功生成，请重新生成或联系客服」，未读取
`brief.errorMessage` 的人话版。B 端重试按钮链路（render-retry）已覆盖合成续跑，
仅缺文案展示。修法与 personal 相同（读 errorMessage + `containsBannedCustomerTerm` 过滤）。

## P2 — STITCHING 执行期间无细粒度心跳

FinalVideo 只有 `startedAt`，runner 执行中不上报心跳；清扫器只能按 30 分钟整体
超时兜底。若 runner 在第 1 分钟就崩溃，任务仍要等满 30 分钟才被重新排队。
修法：runner 每 N 秒回写 `lastHeartbeatAt`（需加列 + `/api/internal/stitch/heartbeat`），
清扫按心跳缺失判死，超时可收紧到 ~5 分钟。

## P3 — assembling/active（合成执行中）的进度是阶段值，非 ffmpeg 实时进度

进度真实性修复后，90% 表示「合成已被领取、正在执行」，文案与状态一致（不是假动画），
但执行内部没有更细的百分比（ffmpeg -progress 未接）。对 15–60 秒的合成时长，
阶段级真话已够用；接实时进度需要 runner→DB 的流式回写，收益低。

## P3 — 数字人渲染（OmniHuman）链路未纳入清扫器

`digital-human-render.yml` 走独立链路。OmniHuman 提交在 dry-run 下 fail-closed
（不会计费），但其任务卡死场景（提交后 provider 永不回调）未纳入 `sweepStuckTasks`。
该链路目前无真实付费用户流量；接入时把对应任务表加进清扫器即可。

## P3 — 老的 `hasStuckJob` 展示逻辑与清扫器语义重叠

`summarizeBriefRender` 里 `isStuck`（超过 timeoutAt 即标 stuck）早于清扫器存在。
现在清扫器会在宽限期后把这类 job 直接失败化，`stuck` 展示态只会短暂出现
（timeoutAt 到期 → +10min 宽限被清扫）。语义无冲突，但两处阈值需要一起调，
建议后续统一到 sweep-service 的配置。
