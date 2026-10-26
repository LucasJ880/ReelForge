# 2026-11 核心链路做稳轮 · 验收记录

计划：`docs/roadmap/2026-10-26-core-round-plan.md`（§3 Phase 1、§7 验收门）。实验记录：`docs/acceptance/2026-11-experiments.md`。

口径（计划 §7.0）：额度 / key 到位前，状态机、计费退额、回滚、幂等、降级用单测 + mock 全路径验；**质量判据只能真机验**，本文件里凡是「待真机」的项，都不得写成通过。

## 1. 生产库迁移

| 迁移 | 内容 | 执行 |
|---|---|---|
| `20261026120000_core_round_m1` | M1 全部新列（StoryboardFrame.aiReview / inputAssetIds / inputImageUrls；StoryboardRun.personAssetIds / anchorCutoutUrls / aiReviewSummary；VideoJob.replacesJobId(+index) / supersededAt / providerPlanId；FinalVideo.previousStitchedVideoUrl） | 2026-10-26 15:40（owner 直连 `prisma migrate deploy`）。**注意：M1 代码随 #5 早已合入 main，但迁移此前未在生产执行**，期间读写这些列的路径会报错 |
| `20261026190000_restitch_previous_post_production` | M1b：FinalVideo.previousPostProduction | 同上，先迁移后合 #16 |

## 2. Phase 1 代码落地

每个 PR 合入前：`npm run typecheck`、`npm run lint`、相关测试、全量 `npm test` 全绿，Vercel preview 构建成功。全量测试唯一的环境性失败是 worktree 里缺被 gitignore 的 `public/brand/`（`global-brand-pack-assets`），在主仓同一测试通过。

| 链 | 任务 | PR | 开关 / 默认 | 验证方式 | 待真机 |
|---|---|---|---|---|---|
| M | M1 迁移 | #5 | — | 迁移已执行 | — |
| M | P01-F0 一次通过率口径 | #19 | — | 单测 | — |
| T | P05-D render-retry 错误码 | #16 | — | 单测 | — |
| T | P05-B READY 只重拼 + 统一回滚（四处回滚边 + b-roll 取消） | #16 | `FINAL_FRAME_QA_MODE=off` | 单测（含清扫超时 / 取消回滚、单段复用拒绝、已交付 brief 不打回） | P0-5 成功路径：真机换字幕 / BGM 零生成计费 |
| T | P01-E1 QAReview 按归属合并 + 整列 CAS 写 | #16 | — | 单测（并发冲突后保留对方写入） | — |
| T | P01-E 成片级复检（影子） | #16 | `FINAL_FRAME_QA_MODE=off` | 单测 + 注入 vision | **待 OpenAI 额度** |
| P | P03-A1 Shuyu 分档，final 档对客户不可见 | #8 | `SHUYU_ALLOW_FINAL_TIER`（生产忽略） | 单测（客户传 1080P planId → 422，零提交） | E12 排队分布 |
| P | P03-C1 `resolveRouteWithFailover`，批量禁止降级 | #20 | — | 行为测试（批量快照永不变） | — |
| P | P03-D0 provider 能力位定型 | #20 | — | 单测（Shuyu 收到参考音视频 preflight 拒绝，零请求） | — |
| V | P03-B 单条提交回写套餐与积分 | #13 | — | 单测 | 独占时段余额差对账（X-SCAF-9） |
| V | P05-B(v) 已交付 brief 不打回 RENDERING | #16 | — | 单测 | — |
| V | P05-C 成功段重做 | #25 | — | 单测 17 条（双击只扣一次、提交失败退 1 段、候选被帧质检拦截后重试、all:true 遇候选行、取消只取消候选、成功换挂走只重拼回滚） | P0-5 成功路径：真机重做一段只扣 1 段并换挂重拼 |
| V | P02-F(v) 参考图分组接线 + 张数传 grounding | #26 | 分组默认随派发打开 | 单测 + 无主播 / 切片时派发输出哈希与改动前一致 | — |
| V | P01-B 段级漂移判据（影子） | #26 | `FRAME_QA_DRIFT_MODE=off` | 单测（两种行、超时不影响烧字、off 不调 vision、shadow 不改 ok） | **待 OpenAI 额度 + E13**；阈值（3 张实拍、单帧 <4 分、detail low）为校准前保守值 |
| S | P02-A/C/D(s)/B 主播角色、bible 保留、主播参考图 service、入参纯函数 | #15 | `STORYBOARD_PERSON_REFS`（内部） | 单测 | E15 人物一致 |
| S | P05-A 帧重抽接补充要求与参考图 | #21 | — | 单测 10 条（提示词从 plan 重建不累加、参考图归属校验） | 浏览器点一遍（dev/preview 连生产库，点击即真实出图） |
| S | P02-F(s) 单条视频参考图分组 | #21 | 分组默认关，P02-F(v) 打开 | 单测 | — |
| S | P01-D 批量故事板 AI 审帧三档 | #24 | `STORYBOARD_AI_REVIEW=off` | 单测 19 条（三档都能到 APPROVED、预算耗尽兜底、vision 不可用直接批准、SunnyShutter 锁定管线不受影响） | **待 OpenAI 额度**；阈值（每帧 2 次重抽、6 分、detail low）待 E13 |
| Q | P01-A vision 参数化与回退链 | #12 | — | 单测 | — |
| Q | P01-C `/internal/frame-qa` 运维页 | #12 | — | 单测 | — |
| Q | P01-F + P03-K 能力文案 | #12 | — | 单测 | — |
| A | P04-C 口播按段时长切分 | #10 | — | 单测 | — |
| A | P04-B 字幕逐词与段窗口对齐 | #10 | — | 单测 + 夹具实烧 | 真实逐词来源（P04-A2 / P04-G）接入后实烧 |
| A | P04-A1 TtsProvider 抽象 | #22 | `TTS_PROVIDER=openai` | 单测（注入 fetch） | 第三方 TTS key（E3b） |
| A | P04-D `voiceover.drive` 派发入口能力闸 | #22 | 非 native 一律 422 | 单测 | 等 P04-F / P04-E |
| 其它 | P02-E0 锚点接线 | #12 | `PRODUCT_ANCHOR_CUTOUT_CRON` 关 | 单测 | remove.bg key |
| 脚手架 | X-SCAF-0/5、3/9、1/4/7/8 | #6、#9、#23 | 默认 dry-run | 单测 + `--help` / dry-run | 全部实验等 Shuyu 充值与各家 key |
| 修复 | Shuyu 价目表逐条校验 | main `6401af5` | — | 单测 | — |

## 3. 本轮额外修复

- **Shuyu `/prices` 整表失效隐患**：此前整张价目表一次校验，任一档出现新 mode / 30s / 新字段（Seedance 2.5 上架几乎必然）都会让 `getShuyuPrices` 报 `invalid_response`，buddy 线路整体停摆。改为逐条校验：认不出的档单条丢弃并记 warn，单条仍严格（2.5 的 1080P 档与 2.0 同 model 名，放宽会被当成旧档计价）。
- **QAReview JSON 列并发覆盖**：runAIQA 与成片复检都整列写 aiScoreBreakdown / aiIssues，改为事务内整列 CAS + 冲突重合并。

## 4. 已知风险（合入时已评估，留待后续）

- P05-C：只重拼失败回滚后，成品库段列表显示新段、播放的仍是旧片，直到下一次重拼成功；含临时签名 URL 的老成片不能重做；取消恰逢提交在途时该段继续生成、不退款（与现有订单取消一致）。
- P01-D（block 档）：审帧调用瞬时出错直接带 warning 放行；API 建的单条 AUTO run 会多等一到几个 cron 周期才 APPROVED。
- P03-D0：BytePlus adapter 收到参考音视频静默忽略（无调用方传），P03-D 接 wire 时补拒绝或透传。

## 5. §7.2 P0 验收门状态

| P0 | 代码 | 判据状态 |
|---|---|---|
| P0-1 漂移 | P01-A/B/C/D/E/E1 已合入（P01-B 默认 off） | **待真机**：E13 标注集（需 OpenAI 额度 + E7′ 2.0 臂出片）；人工 QA 首过率 ≥16/20 需 Shuyu 充值 |
| P0-2 参考图锚定 | P02-A/B/C/D(s)/F(s)/F(v)/E0、P05-A 已合入 | **待真机**：三模板 × 3 次重出（Shuyu 充值） |
| P0-3 供应商 / 分辨率 | P03-A1/B/C1/D0 已合入 | 代码判据已过（客户 1080P → 422、多档不 500）；**待真机**：余额差对账、E12/E10、E7′ 2.0 臂 |
| P0-4 口播 / 字幕 | P04-A1/B/C/D 已合入 | **待真机**：E3b TTS key、E16 金标、E8′ Sync Labs |
| P0-5 局部重做 | P05-A/B/C/D 已合入 | 失败路径已由单测覆盖；**待真机**：成功路径（重做一段只扣 1 段、换字幕 / BGM 零计费） |
