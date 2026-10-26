# 2026-11 视频核心链路做稳轮（P0-1 ~ P0-5）实施计划（v2，经三视角对抗审查修订）

> **For agentic workers:** 本文件是本轮总计划（排序、实验、验收门、热点文件合入顺序）。每条代码链开工前，按 `writing-plans` 格式在 `docs/superpowers/plans/2026-11-<chain>.md` 展开成带代码的 TDD 任务，再用 `executing-plans` / `subagent-driven-development` 执行。本文件不含代码。

**Goal：** 在接 CEO 下一轮新功能之前，把每条片都会经过的四块核心链路做稳——质检查漂移、参考图锚定、供应商/分辨率/口播对齐、成片后局部重做。

**依据：** `docs/roadmap/2026-10-26-video-pipeline-gap-analysis.md`（§4 真实状态、§6 P0、§7 必测清单）+ 6 路只读侦察（231 条改点）+ 3 路对抗审查（9 blocker / 38 major·minor，已全部吸收）。

**原则：**
1. **先实验后代码**：承重墙没有结论之前，不写依赖该结论的代码；不依赖结论的代码链与实验并行。
2. 只动每条片必经的点；复用已有但没接上的代码优先于新写。
3. 每项有可量化、有真值来源、有测量工具的验收；真实扣费验收但不碰试点预留线；demo 账号不跑付费生成。
4. 铁律不变：迁移只加不删、只走 `db:migrate:deploy`；`'use client'` 不引服务端值；每轮任务可取消；删除 PR 单独提。
5. **热点文件串行、一人负责**（§5 是硬约束）。
6. **所有写库的实验优先跑 Neon rehearsal 分支**（配真 key，轮询式管线不需要 webhook）；必须写生产库的用 `exp-2611-` 前缀并在三处读数里排除。

---

## 0. Context

1026 调研把问题钉死在四块：① 发片前质检只查「烧字」，商品/人物/场景漂移零覆盖（12 条样片 5 条因漂移不过，全在批量路径，批量故事板零审帧）；② 单供应商、720P 拉伸成 1080P（Shuyu 其实在卖 1080P，是我们自家 `auditShuyuVideoPlan` 拦的）、单段 15s、无原生音频；③ 成片后没有任何局部重做；④ 口播是 prompt「尽力说」、字幕按字重均分、卡拉 OK 只是类型名。CEO 发的参考片靠的是多参考一致 + 原生口播 + 逐词字幕，不是 3D。

本轮只做 P0-1 ~ P0-5。第二轮核实改变了采购路径：Seedance 2.5 走 **BytePlus 国际站**（加拿大在官方可售名单），Wan 3.0 走**阿里云国际站**，Kling 4.0 只有 **fal** 有 API；`tts-1` 与 `gpt-4o-mini-tts` 2027-01-06 同日关停。

---

## 1. 决策（D-1、D-2 已于 2026-10-26 拍板；其余为默认值，交审时可改）

| # | 决策 | 定 |
|---|---|---|
| D-1 | 推翻 `storyboard-gacha.ts:115-117`「Shuyu 公共路径不用未审计 judge」 | **已拍板：推翻**。AI 审帧三档 `STORYBOARD_AI_REVIEW=off\|shadow\|block`，默认 **off**；**shadow 不改状态机**（AUTO 仍直接 APPROVED，审帧结论旁路写 `aiReview`）；只有 block 才插 AWAITING_APPROVAL 闸。SunnyShutter 两条锁定管线不动 |
| D-2 | 视频供应商范围、实验账号与充值 | **已拍板（2026-10-26 三次修订）：Shuyu 是唯一视频通道，本轮不开任何新视频通道**（fal、BytePlus、阿里国际站全部搁置）。创始人已向 Shuyu 提出上 Seedance 2.5；E7 改为 **E7′「Shuyu 2.0 vs 2.5」对照**，等 Shuyu 上线 2.5 后跑。仍需：**Shuyu 充值**（§8，当前余额 11,964 点，一段 1080P 15s 即 3,600 点；建议分两笔）；一家带逐词时间戳的 TTS 试用 key（ElevenLabs 或 MiniMax，供 E3b/E16 与 D-13）；Sync Labs key（D-13）；remove.bg 或 Clipdrop key（E14 / P02-E）；OpenAI 充值（已充 100 刀，2026-10-26 晚仍 429，待生效核验） |
| G2′ | **Seedance 2.5 上线后的决策点** | Shuyu 上线 2.5 后跑 E7′；若 2.5 档在人工 QA 上相对 2.0 均分高 ≥0.3 且成本可接受，Phase 2 进入「2.5 任务组」（Shuyu 适配器支持 2.5 档、30s 段、音频/视频参考透传、P04-E 音频参考驱动）；2.5 迟迟不上线则本轮全程 2.0，口型维持 D-13。**原二线任务组（P03-F/G/H/I/C2 的多供应商部分）整体搁置，不在本轮** |
| D-13 | P0-4 口型路线（本轮默认） | **Shuyu 出片 + TTS + Sync Labs 后置对口型**（sync-3 $0.107–0.133/s，对任意视频可用）：E8′ 直接在 Shuyu 1080P 成片上验；「音轨参考驱动」（P04-E）只在 G2′ 通过后、经 Shuyu 2.5 档才做 |
| D-3 | 1080P 对客户定价 | 创始人定。代码先做 tier 管线，**final 档对客户不可见、不可选**（routes API 过滤、显式 planId 非员工拒绝），P03-A2 解除 |
| D-4 | 只重拼状态机 | 方案 A：READY → CAS PENDING 复用现有管线；**回滚做成统一出口**（合成失败、两个清扫超时、客户取消都走它）；`stitchAttempts:0 / startedAt:now` 照抄 `retryStitch`；旧 URL 存新列 `FinalVideo.previousStitchedVideoUrl`（不塞会被覆盖的 postProduction） |
| D-5 | bake-off 怎么跑 | 新脚本 `scripts/bakeoff-runner.ts` 直连供应商、**不写库**、固定 20 条输入与同一份 prompt；需要写库的实验走 rehearsal 分支 |
| D-6 | 超分 | 本轮不接；E9 照跑留结论；P01-H 移 P1 |
| D-7 | 换口播 | 本轮「只重拼」只放行字幕/BGM；换口播等 P0-4 定路线（P05-E） |
| D-8 | 命名 | 本轮启用：`SYNC_API_KEY`、`TTS_PROVIDER` + 对应 key（如 `ELEVENLABS_API_KEY` / `MINIMAX_API_KEY`）、`REMOVE_BG_API_KEY` 或 `CLIPDROP_API_KEY`；实验批次前缀 `exp-2611-`；Shuyu 1080P 成片档脚本开关 `SHUYU_ALLOW_FINAL_TIER=1`。**不启用**：任何 fal / 阿里 / BytePlus 的线路 id、adapter、env |
| D-9 | CEO 的 Blender→SD 止损实验 | **本轮不做**（调研已给结论并告知 CEO）；CEO 坚持再按文档 §2.3 单独排 2 天 |
| D-10 | 漂移相似度判据 | 校准阶段用**本地 onnx DINOv2-small**（免采购）与 vision rubric 对照；**上线判据以 vision 为主**，embedding 只在 E13 证明有增益时进 Phase 2 |
| D-11 | 实验输入素材 | E7 只用 34 模板产品集 + **已在公开广告露出过的** SunnyShutter 图；住户室内实拍不外发；experiments.md 记各供应商数据保留政策 |
| D-12 | 1080P 成片档触发方式 | 显式选择（UI 套餐选项），不按模板 `lockedParams.resolution` 自动升档 |

---

## 2. Phase 0 · 实验（10 个工作日；采购并行）

### 2.1 脚手架（零成本，第 1–3 天）

| id | 做什么 | 落点 / 注意 |
|---|---|---|
| X-SCAF-0 | **实验护栏**：① 所有走管线的实验改到 Neon rehearsal（`NEON_REHEARSAL_DATABASE_URL`，配真 key）；② 必须写生产库的，`BatchJob.idempotencyKey` 前缀 `exp-2611-`，在 `founder-digest-service.ts:150,171` / `exchange-readings.ts:144` / `first-pass-rate-service.ts:46-48` 三处统一排除；③ 直连实验单独记录供应商任务 id 与点数（供 §7 对账）；④ 实验时段避开客户高峰，实验批次并发 ≤2，不挤 `batch-service.ts:997-1018` 的全局槽 | 健康报表 `--run-key/--md` 只是看表方便，不是护栏 |
| X-SCAF-1 | 样片脚本多线路化：`REAL_SAMPLES_ROUTE` 放开；`ReportItem` 补 `submittedAt/firstProcessingAt/finishedAt/costUsd/costPoints/qa{商品,人物,口型}`；预算闸改实时点数 / USD 单价（去 900 常量）；幂等键 routeSuffix `:${routeId}` 且 **`BATCH_KEY_REV` 升 v4**（否则续跑会重建批次重复扣点） | `scripts/real-template-samples-expansion.ts:49-61,227-254,353-379,449-458,492-530` |
| X-SCAF-3 | **whisper 词级对齐模块（新写，不是抽取）**：`scripts/lib/whisper-align.ts`，`-ojf -dtw small`，中文按 UTF-8 字符合并 token offsets，英文 `-sow`；读 ASS 实际 cue 时间比对；输出逐词起点偏差 P50/P95；单测用带已知时间戳的 TTS 夹具 | 本机 whisper-cli 1.9.1 + ggml-small |
| X-SCAF-4 | 真值表探针加齐：`SYNC_API_KEY`、TTS 试用 key、`REMOVE_BG_API_KEY`；Shuyu `/prices` 里是否出现 Seedance 2.5 档（display_name 含「2.5」、durations 含 30、是否出现音频/视频参考能力字段）——这是 E7′ 的触发器；OpenAI 侧 E3a 已完成（无 realtime 模型） | `scripts/e2e-1025/route-truth-table.ts:132-137`、`summarizeShuyuCatalog` |
| X-SCAF-5 | 吞吐演练修正：**护栏改为 `DATABASE_URL` 必须等于 `NEON_REHEARSAL_DATABASE_URL` 的 endpoint（`ep-shiny-silence`）且 ≠ 生产 owner host**（现在 `us-east-1` 子串判断会放行生产库）；参数化并发/条数/批数；加 tick 间隔与 maxTicks；延迟从实测分布抽样；只用于验证我方调度不超槽 | `scripts/phase5a-mock-capacity.ts:6-9,33,76,106` |
| X-SCAF-6 | **撤下**（不开新视频通道，不写 fal / dashscope 客户端） | — |
| X-SCAF-7 | 校准脚手架：接触表 `VIDEO_DIR` 可配；`scripts/drift-calibrate.ts` **直接 import 生产同一组纯函数**（P01-B 的 `FRAME_DRIFT_SYSTEM` + `decideDriftVerdict`、P01-D 的逐帧评审），抽帧 → vision 评分 + 本地 onnx DINOv2-small 相似度 → 与人工标签比召回/误杀；标注集建设见 E13 | `tmp/real-template-samples/template-samples-20260803-v1-videos/`、`qa-1025/` 接触表 |
| X-SCAF-8 | **`scripts/bakeoff-runner.ts`（Shuyu 内部对照版）**：固定 20 条输入（商品图 + 已出好的 Shuyu 故事板帧 + 用 `prompt-intelligence` 纯函数生成的同一份 prompt）；臂 = Shuyu 套餐 plan_id（2.0 1080P 现在就能跑；2.5 档上线后加一臂），走 `createShuyuVideoTask` 显式 plan_id，不走批量管线、不写库；结果写 `tmp/experiments-2026-11/E7/*.json`；内置点数单价与硬预算上限 | E7′ / E12 共用 |
| X-SCAF-9 | 验收工具补齐：`scripts/ops/reconcile-provider-spend.ts`（有逐任务明细就按 externalJobId 对，没有就独占时段余额差，文档注明）；`scripts/frame-qa.ts` 加 `--refs --json`；`report-video-route-health.ts` 加积分列；`scripts/ops/qa-first-pass.ts`（按 batchId 的人工 QA 首过率只读统计） | §7 要用 |
| P03-D-lite | **撤下**（不开直连） | — |

### 2.2 实验清单（判据预注册；每行写「条数 × 时长 × 分辨率 × 单价来源」）

| id | 实验 | 上法 | 样本 / 预算 | 预注册判据 → 产出 | 解锁 |
|---|---|---|---|---|---|
| **E1** | Shuyu `/prices` 只读：图像档 `input_images_max`（是否都 = 6）、视频档各套餐上限、1080P plan_id 与点数 | `summarizeShuyuCatalog`（本轮已探过一次：1080P=240 点/秒，4K=640） | 0 | 写入 experiments.md | P02-B2、P02-F2、P03-A2 |
| **E3a** | OpenAI `/v1/models` 是否列出 `gpt-realtime-2.1-mini`（零成本） | X-SCAF-4 | 0 | 候选表 | — |
| **E3b** | TTS 实出：Realtime ws 出一段；ElevenLabs / MiniMax（试用 key）中英西各一句，比音质、价格、**是否带逐词时间戳** | 需 OpenAI 额度到位 + 试用 key | ≈ $10 | 选定 TTS 供应商与时间戳来源 | P04-A2、P04-H、E16 |
| **E16** | whisper 基线：以 E3b 选出的**带逐词时间戳 TTS** 为真值，中英各 2 条；另取 2 条 Shuyu 原生口播片，人工标 ≥200 个词起点作金标 | X-SCAF-3 | 0（人工标注约 2 小时） | **P95 \|偏差\| < 150ms** 能否达成（中文以字为词） | P04-G、§7 P0-4 |
| **E13** | 漂移校准：**先建标注集**——E7 ≈60 条 + E14/E15 + 历史生产批量漂移片，2 人标注，目标 ≥30 个漂移正例、≥60 个负例，按 SKU 留 hold-out；另从 1025 批量导出 ≥50 张 StoryboardFrame 人工标过/不过（给 P01-D）；用 X-SCAF-7 跑**冻结后的生产函数**（4/6 帧 × low/high detail 记耗时与 token；DINOv2-small 相似度） | **需 OpenAI 额度**；排在 E7 QA 之后 | ≈ $20 | hold-out 召回与误杀；阈值表；「漏检 < 10%」能否判定（样本内自证不算） | P01-G、P01-B2、P01-D(block) |
| **E17** | 备援 vision：E13 同一标注集跑一家非 OpenAI vision（火山方舟若已充值 / 其他），比召回、误杀、单价 | X-SCAF-7 | ≈ $10 | OpenAI 失效时的备援可行性 | P01 系列降级策略 |
| **E14** | 切片形式：RGBA 透明 / 白底 flatten / 只实拍，**每种 3 个 SKU**，各 4 帧故事板 + 1 段视频；**直调 `createShuyuImageTask/createShuyuVideoTask`**（不走批量管线，入参顺序才可控） | 需 `REMOVE_BG_API_KEY`（≈$0.2/张） | 9 条 × 15s × 720P ≈ 9 × 1,400 = 12.6k 点 + $2 | 2 人 0–2 分；切片形式选优 | P02-E、P02-G |
| **E15** | 真人脸参考：(1 张 vs 4 张) × (首帧 vs 每帧) × 3 模板 × 2 次 = 24 个故事板 run **只出帧测拒单率**（便宜）+ 6 条视频看人物一致；人脸素材用 AI 生成人像或已授权照片 | 直调图像/视频任务 | 24 × 4 帧 × ≈60 点 ≈ 6k + 6 × 1,400 = 8.4k 点 | 拒单率、人物一致分 | P02-D2 |
| **E12** | Shuyu 1080P 排队：**3 个时段 × (720P 3 条 + 1080P 3 条)**，记 queued→processing→completed | 脚本直接传 1080P plan_id | 9 × 15s × 95 + 9 × 15s × 240 ≈ 45k 点 | 两档排队中位数与 P95；1080P 能否进批量 SLA | P03-A2 |
| **E2″** | Shuyu Seedance 2.5 档参数实证（上线后）：`/prices` 新档的 durations（是否到 30）、`input_images_max`、是否出现参考视频/音频字段、`generate_audio` 是否可控、1080P 点数；几条 5s 试提交 | X-SCAF-4 + X-SCAF-8 | ≈ 2k 点 | 参数实证表 | E7′、E4″、2.5 任务组 |
| **E4″** | Shuyu 2.5 音频参考对口型（**仅当 E2″ 证实 2.5 档收音频参考**）：**15s / 30s × 近景 × 中 / 英 × 3 次 = 12 条** | E2″ 之后；X-SCAF-3 | 12 条 ≈ 270s × 2.5 档单价（待报价；按 ≤1.5× 2.0 估 ≈ 97k 点） | 2 人 0–2 口型分 + whisper WER + 起点偏差；**达标 = ≥80% 条目口型分 ≥1 且 15s 内无 0 分** | P04-E（G2′ 后） |
| ~~E5 / E6~~ | Wan 3.0 / Kling 4.0 对照 | **搁置**（不开新通道） | — | — | — |
| **E8′** | **D-13 默认口型路线端到端**：Shuyu 1080P 成片（原生「尽力说」或静音段）+ TTS + Sync Labs sync-3 后置对口型，4 条 15s × 近景 | Shuyu + `SYNC_API_KEY` | 4 × 3,600 点 + 60s × $0.133 ≈ 14.4k 点 + $8 | 同 E4 判据；这是**没有二线时 P0-4 的主路线**，必须过 | P04-F |
| **E7′** | **Shuyu 2.0 vs 2.5 对照（配对设计，等 Shuyu 上线 2.5）**：同一批 20 条（D-11 素材），2.0 1080P 臂 vs 2.5 1080P 臂，各 20 × 15s；2.5 臂另加 6 条 30s 多镜头 + logo 近景参考（兼作 E11，前提是 2.5 档 durations 含 30）；记成功率、P50/P95、每条点数、人工 QA（商品/人物/口型 0–2，2 人独立，kappa < 0.6 加第三人）。**2.0 臂现在就可以先跑**（它同时是 E13 标注集的来源） | X-SCAF-8 | 2.0 臂 20 × 3,600 = **72k 点**；2.5 臂 20 条 + E11 6 × 30s 按 ≤1.5× 估 ≈ **173k 点**（待 Shuyu 报价） | **G2′ 判据预注册**：2.5 臂相对 2.0 臂人工 QA 均分高 ≥0.3 且每条成本 ≤1.5×，才进入 2.5 任务组。**E11 默认保留「logo 永不过 I2V」**，只有 6 条 30s 片在 `runLogoFidelityGate` + 人工全过才进入复核 | G2′ → 2.5 任务组；E13 标注集 |
| **E9** | 保真档超分对 logo：`tmp/brand-logo-e2e-v2/` 3 段过 ByteDance Upscaler / SeedVR2 / Proteus，`runLogoFidelityGate` before/after + 人工 | fal | < $5 | logo 区域阈值 | P01-H（P1） |
| **E10** | 批次吞吐**真实测量**：E7′ 2.0 臂同时提交「并发上限」条（Shuyu 全局槽 `PROVIDER_CONCURRENCY` 默认 10），记供应商侧排队；mock 演练只验我方调度 | 搭 E7′ / E12 的车；X-SCAF-5 | 0 | Shuyu 排队分布 → 批次 SLA | P03-A2、批次 SLA 文案 |

**Phase 0 预算（Shuyu 单通道口径）**：USD ≈ **$60**（E3b 10 + E13 20 + E17 10 + E14 2 + E8′ 8 + E9 5）+ 三家小额订阅（TTS、Sync Labs、remove.bg）；Shuyu **现在就能跑的** ≈ **158k 点**（E14 12.6k + E15 14.4k + E12 45k + E8′ 14.4k + E7′ 2.0 臂 72k）；**Shuyu 2.5 上线后再加** ≈ 173k（E7′ 2.5 臂 + E11）+ 可选 E4″ ≈ 97k（2.5 档单价待报价，均按 ≤1.5× 2.0 估）。
**产出物**：`docs/acceptance/2026-11-experiments.md`（每个 E 一节：命令、样本、结果表、结论、解锁/否决）；数据在 `tmp/experiments-2026-11/<E>/`。

### 2.3 时间表

- **第 1–3 天**：X-SCAF-0/1/3/4/5/7/8/9；E1、E3a（已完成）；Shuyu 充值第一笔 + TTS 试用 key + Sync Labs key + remove.bg key；OpenAI 100 刀生效核验。
- **第 3–6 天**：Shuyu 点数到账 → E12、E14、E15、E8′、E7′ 2.0 臂（兼 E10 吞吐）；额度到位 → E3b → E16；E9。
- **第 6–10 天**：E7′ 2.0 臂 QA 完成 → E13、E17（标注集 = 2.0 臂 20 条 + E14/E15 + 历史漂移片）。
- **Shuyu 上线 2.5 后（时间不定）**：E2″ → E7′ 2.5 臂（含 E11）→ 可选 E4″ → **G2′ 决策**。
- Phase 1 代码链从第 1 天起并行，不等任何实验。

---

## 3. Phase 1 · 不依赖实验结论的代码（与 Phase 0 并行；按热点文件串行）

每个任务 = 一个 PR；链内严格按序合入；链间可并行，**跨链边见 §5**。标「⚠ OpenAI」的任务代码可合入，真机验收等额度到位后补。

### 链 M · 迁移（先于一切，一人负责）

- **M1**（全部纯新增、可空或带默认值）：`StoryboardFrame.aiReview Json?`、`StoryboardFrame.inputAssetIds String[] @default([])`（P05-A 写 sourceAssetIds，供审计与 resume）、`StoryboardFrame.inputImageUrls String[] @default([])`；`StoryboardRun.personAssetIds String[] @default([])`、`StoryboardRun.anchorCutoutUrls String[] @default([])`（**按角色显式存，不靠位置推断**）、`StoryboardRun.aiReviewSummary Json?`（状态/轮次/warning，不复用 errorCode）；`VideoJob.replacesJobId String?` **+ `@@index`，不加 @unique**（同一旧行可多次重做；「只有一个在途候选」由事务 + `logicalJobKey` 保证）、`VideoJob.supersededAt DateTime?`、`VideoJob.providerPlanId String?`；`FinalVideo.previousStitchedVideoUrl String?`。
- **P01-F0 通过率口径（紧跟 M1，必须先于 P05-C）**：`first-pass-rate-service.ts:46-48` 排除 `replacesJobId` 非空与 `supersededAt` 非空的行、排除 `WOULD_BLOCK`；实验 run key 的排除归 X-SCAF-0。新 `tests/first-pass-rate.test.ts`。

### 链 T · 合成与重做入口（P05-D → P05-B → [P05-C 在链 V] → P01-E1 → P01-E）

- **P05-D render-retry 错误码**：404/403/400 改 `RESOURCE_NOT_FOUND / FORBIDDEN / VALIDATION_FAILED / INVALID_STATE`。
- **P05-B 只重拼（D-4 方案 A）**：新 `restitchReadyFinalVideo(finalVideoId, patch)`：zod 只放行 `captions` / `bgm`；CAS READY → PENDING 时写 `previousStitchedVideoUrl`、`stitchAttempts:0`、`startedAt:now`（照抄 `retryStitch:827-839`）；会走 `reuse_single_segment / reuse_first_segment_demo`（`stitchFinalVideo:337-362`）的行**直接拒绝**；**统一回滚出口 `rollbackRestitch`**（READY + 旧 URL + 清 `previousStitchedVideoUrl`，不改 brief）被四处调用：`finishStitchTask` 失败分支（:542-566）、`sweepStuckStitching`（sweep-service :379-434）、`sweepAwaitingStitchTimeout`（:441-483）、`single-video-cancel-service:89-96`，识别依据 `previousStitchedVideoUrl != null`；`markBriefReady`（:864-879）对 QA_APPROVED / PUBLISH_PENDING / PUBLISHED 不打回 QA_PENDING，`brandedVideoUrl` 清空并提示重新封装；**`video-service.ts:1744-1757 onAllSegmentsSucceeded` 对已交付状态的 brief 不改为 RENDERING**（这一处排进链 V 的顺序）；`render-retry` 加 `{ restitch: {captions?, bgm?} }` 分支；详情页「换字幕样式 / BGM」表单；限流 action `restitch`。测试：新 `tests/restitch-post-production.test.ts`（含清扫超时与取消的回滚、单段复用拒绝）；`tests/retry-stitch-resume.test.ts`、`tests/stitch-attempt-token-race.test.ts`、`tests/single-video-cancel.test.ts` 回归。
- **P01-E1 qa-service 合并写**：`qa-service.ts:97-103` 合并写 `aiScoreBreakdown/aiIssues`。
- **P01-E 成片级复检（影子，⚠ OpenAI）**：成功 CAS 之后写「待复检」标记（`FinalVideo.postProduction` 之外——用 `QAReview` 桩的 `aiScoreBreakdown.finalFrameQa = {status:"pending"}`），由 `poll-videos` cron 在 frame-qa 预算内消费（Vercel 函数里不 await 的异步会被冻结）；专用 prompt 允许后期字幕与尾卡 logo，查假字 / 假字标 / 与首帧同一商品；只改 `stitch-service.ts:881` 这一份 `ensureQAPendingStub`，`video-service.ts:2036` 副本留给 C4；运维页统计「未跑复检」比例。`frame-qa.ts` 复用 `extractFrames/framesToDataUrls`（P01-B 之后合入）。新 `tests/final-frame-qa.test.ts`。

### 链 V · `video-service.ts`（P03-B → P05-B(v) → P05-C → P02-F(v) → P01-B）

- **P03-B 单条提交回写**：`submitVideoJob`（:137-157）返回 `{jobId, providerPlanId?, providerUnitPoints?}`（USD 单价从 `resolveVideoRouteCostSnapshot` 取，**不动 `providers/types.ts`**）；`persistAcceptedSubmission`（:269-299）有值才写；4 处调用点；批量 `acceptJobSubmission` 补 `providerPlanId`。新 `tests/video-service-cost-writeback.test.ts`。
- **P05-B(v)**：`onAllSegmentsSucceeded:1744-1757` 已交付状态保护（见 P05-B）。
- **P05-C 成功段重做**（依赖 P05-B、P01-F0）：抽 `buildSegmentSubmitInput`（从 `retryFailedVideoJob:1376-1400`）；新 `redoSucceededSegment(briefId, segmentIndex, {promptOverride?})`，**顺序：限流 `segment-redo` → 事务内 CAS 建候选行（`finalVideoId=null`、`replacesJobId=旧行`、`logicalJobKey=${briefId}:segment:${i}:redo:${n}`，唯一约束挡双击）→ 扣 1 个 `SEEDANCE_SEGMENT`（metadata 带 `candidateJobId`，phase `segmentRedoAuthorization`）→ 提交**；提交失败走 `segmentRedoRefund`；`reconcileVideoJob` 成功分支（:1085-1096）事务内摘旧行（`finalVideoId=null + supersededAt`）、挂新行、FinalVideo → PENDING 触发重拼（走 P05-B 的 restitch 路径以获得回滚保护）；**`retryFailedVideoJob` 加候选行分支**（`replacesJobId` 非空 → `buildSegmentSubmitInput` 重做参数，不掉进 :1464-1470 的旧 ScenePlan 分支）；`render-retry` 的 `all:true` 与 `summarizeBriefRender`/`retryFailedSegmentsForBrief`（:1572-1580）排除 `supersededAt` 非空的旧行、候选行单独处理；`syncBriefStatus`（:1656-1712）排除候选行与旧行；不走 :1442-1451 的 FinalVideo 重置；frameQa `blockCount` 从旧行继承；`quota-refund-service` 新 phase + `refundFailedSegmentRedo` + `reconcileUndeliveredQuotaRefunds` 加候选类；`single-video-cancel-service` 只取消候选行不动订单；`assembly-executor.ts:285` 断言每 segmentIndex 只挂一行；`unified-library` 契约与行加 `segments[] / redoInFlight / canRestitch`；详情页「重做这一段」面板；**重做的 prompt 从 plan 重新生成，不在旧 prompt 上累加**。测试：新 `tests/render-retry-segment-redo.test.ts`（含：候选行被帧质检拦截后重试、`all:true` 遇到候选行、重做失败后再次重做同一段、双击只扣一次）；`tests/multi-segment-retry.test.ts:126`、`tests/quota-refund-single.test.ts`、`tests/stitch-composer-integration.test.ts`、`tests/unified-library-contract.test.ts`。
- **P02-F(v)**：`dispatchVideoForBrief:363-402` 把 `anchorCount/personCount` 传 `groundSegmentPromptInStoryboard`（写回 `brief.referenceImageUrls` 现有代码已做）；重试路径 `:1386 slice(0,8)` 与 `:542-545` 的上限改为参数（默认 8，P02-F2 接线路值）。
- **P01-B 段级漂移判据（影子，⚠ OpenAI）**：`FrameQaVerdict.drift`；新 `FRAME_DRIFT_SYSTEM`（只复用 `storyboard-gacha.ts:28-34` 的扣分条目，**自己写 system 与 JSON 信封**：逐帧 `{index, productMatch, personConsistent, score, issues}`）；漂移 vision 调用**放在 45s race 之外、自带 30s 超时、`Promise.allSettled` 分开等**，超时只记 `drift.skipped`，不影响烧字结论；时长计入 `PER_CHECK_RESERVE_MS`；`decideDriftVerdict` 纯函数，`FRAME_QA_DRIFT_MODE=shadow` 不改 ok；**参考图按行类型取**：批量行 `assignedAssets.assets[].url`，单条段行 `videoBrief.referenceImageUrls` 按 P02-F 的张数切出实拍 + 故事板首帧；gate deps 加 `references`。新 `tests/frame-qa-drift.test.ts`（两种行都覆盖、drift 超时不影响烧字）；`tests/frame-qa-gate*.test.ts`、`tests/frame-qa-overlap-claim.test.ts` 跟签名。

### 链 S · `storyboard-service.ts`（P02-A → P02-C → P02-D(s) → P02-B → P05-A → P02-F(s) → P01-D）

- **P02-A AssetRole 加 `person`**：`types/video-generation.ts:87-109`、`schemas/unified-input.ts:58-70`、`clip-placement-planner.ts:89-93`（不进时间轴）、`input-classifier.ts:21`（hasImage 排除 person/logo）、`visual-reference-analysis.ts:67`（过滤 person/logo）。
- **P02-C bible 与提示词保留**：`storyboard-beats.ts:46-47` `KEEP_TEMPLATE_LINE` 追加 `CHARACTER (|PRODUCT(?: \(|:)|NO on-camera person`，**补单测断言 `Audio:` / `Spoken dialogue` 行在 grounding 后仍保留**（P04-E 依赖）；`consistency-bible.ts` 有 person 图时 characterProfile 必须描述该主播；`prompt-intelligence.ts:437-444` characterLine。
- **P02-D(s) 主播参考图（service + 契约，开关 `STORYBOARD_PERSON_REFS=internal`，非员工传 `personAssetIds` 返回 400）**：`storyboards/route.ts:37-44` `personAssetIds ≤4`；`CreateStoryboardRunInput` / `requestHash`（非空才入 hash）；`createStoryboardRun` 写 `StoryboardRun.personAssetIds`（M1 列），`inputImageUrls` 仍只放实拍；`resume`（:937-959）按新列恢复；`productPhotoCount`（:1294,1304）不再把主播图算成实拍。UI 露出与默认开启留 P02-D2。
- **P02-B 故事板入参纯函数**：`composeStoryboardFrameInputImages({productImages, anchorCutouts, personImages, priorFrames, max})`（默认 max=5，E1 后 6）：前帧只留 1 张放最后、实拍至少 `min(上传数, 3)` 张、主播图只进首帧（E15 前）；`buildStoryboardFramePlans`（:173-196）REFERENCE ROLES 行与首帧 PRESENTER LOCK；`shuyu-catalog.ts` 解析图像档 `inputImagesMax`（解析不到回落）；`planSnapshot` 兜底。`createShuyuImageTask:894` 硬拒绝改截断留 P02-B2。
- **P05-A 故事板帧 regenerate 接 body**：路由 zod `{ promptOverride?: ≤1000 字, sourceAssetIds?: ≤5 }`；**重抽时从 plan 重新生成 prompt（不在旧 prompt 后累加），故事上下文按 5000 字总预算截断，USER DIRECTION / 审帧 issues 只保留最新一条**；新帧行存 `inputAssetIds` + `inputImageUrls`（M1），用 P02-B 的生成器重算 REFERENCE ROLES；`submitStoryboardFrame:466-469` 优先帧级 `inputImageUrls`；前端带 body + 输入框。新 `tests/storyboard-regenerate-body.test.ts`。
- **P02-F(s)**：`composeSingleVideoReferenceImages`（:1256，已有 `limit` 参数）扩 `anchorCutoutUrls / personUrls` 分组，顺序 实拍 → 切片 → 主播 → 帧（切片在 P02-E 前恒为空）；`requireApprovedStoryboardVideoInputsForBrief`（:1284-1310）按新列切分并返回各类张数。`tests/storyboard-cancel.test.ts:540-563` 扩充。
- **P01-D 批量故事板 AI 审帧（D-1 三档，默认 off，⚠ OpenAI）**：`storyboard-gacha.ts` 新 `reviewStoryboardFrames`（逐帧 `{index, pass, score, issues}`，只复用 rubric 条目，不复用 `judgeStoryboardCandidates` 的 N 选 1 解析）；**off/shadow：`advanceRun:780-794` 保持 AUTO → APPROVED，shadow 在批量 tick 预算内旁路写 `aiReview`**；**block：** AUTO 全成功迁 AWAITING_APPROVAL，`advanceBatchStoryboards:1481-1503` **与** `pollPendingStoryboardRuns:1312-1323` 都加 `{status: AWAITING_APPROVAL, approvalPolicy: AUTO}` 分支调 `reviewAutoStoryboardRun`（覆盖 API 建的单条 AUTO run）；不过的帧以 issues 作 `promptOverride` 重抽，**重抽次数单独记 `aiReview.regenCount`（不占 `frame.attempt` 与 `BATCH_FRAME_MAX_ATTEMPTS`）**，`FRAME_REGENERATION_LIMIT` 显式当「用满」处理；兜底批准**按时长判定**（停留 > 20 分钟或预算连续不足 3 个 tick → CAS APPROVED + `aiReviewSummary.warning`），不依赖本 tick 有预算；预算：审帧与帧质检**共用总预算 ≤200s/tick、审帧 ≤60s/tick**，审帧后检查 `batch-service.ts:1932` 续租返回值，租约丢了直接返回；`batch-monitor.tsx:548-552` 从 `aiReviewSummary` 显示「AI 审帧中 / 重抽第 N 次」。测试：`tests/storyboard-service.test.ts:511` 按三档改；新 `tests/storyboard-auto-review.test.ts`（API 单条 AUTO 在 off/shadow/block 都能到 APPROVED；预算耗尽后下一 tick 仍能批准；AI 用满后供应商失败不判死）；`tests/shuyu-image2-routing.test.ts:110-111` 保持。

### 链 Q · vision（P01-A → [P01-B 在链 V] → P01-C → P01-F）

- **P01-A vision 参数化**：`ai/types.ts:99-103,154` + `ai/index.ts:76-81` 透传 `detail / maxTokens`（mock provider 同步）；`openai.ts:422-428` 去写死；回退沿用 `MODEL_FALLBACK_CHAIN.vision`（`:90`），要用 `gpt-5.6-terra` 就加进链。`tests/openai-model-chain.test.ts`。
- **P01-C 运维页 `/internal/frame-qa`**：SKIPPED 比例、`drift/shadow` 明细、WOULD_BLOCK 列表、未跑复检比例。`(internal)` 目录唯一允许新增的页面；Phase 3 随 internal 迁或删。
- **P01-F 能力文案**：vision 文案 + feature `storyboardReview`（并入 copy PR）。

### 链 P · 供应商与计价（P03-A1 → P03-C1 → P03-D0 → P03-K）

- **P03-A1 Shuyu 分档管线（final 档对客户不可见）**：`AuditedShuyuVideoPlan.tier`；`VIDEO_PLAN_POINT_SANITY` 按分辨率分区间；`auditShuyuVideoPlan:317-321` 加 1080P；`listAuditedShuyuVideoPlans` RANK{720P:0,480P:1,1080P:2}（plans[0] 仍是最便宜 720P，六处默认成本不变）；`resolveShuyuVideoPlans/resolveShuyuVideoPlan({planId, tier?, allowFinal?})`：**默认只返回 draft；显式 final planId 且非员工/实验标记 → 拒绝**；`warm[0]`（:502-503）与提交级降级（`shuyu-video-provider.ts:226-231`）只在同 tier 内跳；`routes API:17-58` 对客户过滤 final；`createBatchJob:574-590` 显式 planId 走同一校验；`capability-probe:97-103` EXPECTED 加 1080P；契约 `video-route-options.ts:11` / `video-provider-routes.ts:22` 加 1080P，**修 `plans.max(1)` 现存 bug**（:66）。测试：`tests/shuyu-video-plans.test.ts:81` 翻转 + 多档 + 「全部草稿档在冷却」；`tests/capability-probe.test.ts:85-95`；`tests/buddy-route-discovery.test.ts`；`tests/shuyu-video-provider.test.ts`；新增「客户选 1080P planId 返回 400」。
- **P03-C1 抽 `resolveRouteWithFailover`**：从 `dispatch/route.ts:565-583` 抽出；**批量调用 `{allowFailover:false}`，行为与现状逐字节一致**（现状是不可用直接 throw）；`tests/customer-route-failover.test.ts:76-96` 改行为测试；新 `tests/batch-route-failover.test.ts` 断言批量快照永不变。
- **P03-D0 provider 类型定型（不等 E2）**：`providers/types.ts` 一次加 `referenceVideos? / referenceAudios?: {url, durationSec?}[]`、`qualityTier?`、`VideoProvider.supportsReferenceAudio / maxReferenceImages` 能力位，`id` 联合加 `"alibaba_wan" | "fal"`；Shuyu adapter 收到 `referenceAudios` 在 preflight 拒绝；BytePlus adapter 透传（wire 层在 P03-D）。
- **P03-K 文案**：`registry.ts:204-216` 只在真的降级时说「已切换备用线路」（并入 copy PR）。

### 链 A · 口播与字幕（P04-C → P04-B → P04-A1 → P04-D）

- **P04-C 切分按段时长加权**：`prompt-intelligence.ts:273-313`；`director-plan.ts` `segmentPlanSchema` 加 `voiceoverChunk?`。
- **P04-B 字幕逐词与对齐**（Phase 1 只要求单测 + 带夹具的实烧；真实逐词来源等 P04-A2/P04-G）：`CaptionCue.words?`；`buildTimedCues` / `buildWindowedCues`（按段窗口）；`renderAssCaptions` 加 `language`，karaoke `{\kf}`、word_by_word 逐词 Dialogue，无 words 回退；**修 Style 配色方向**（`:268`）；`stitch-pipeline.ts:686-701`；`scripts/stitch-runner.ts:562-573` 同步；`audio-caption-controls.tsx:70-87` 恢复真分档（仅有逐词来源时显示）；`streamlined-video-studio.tsx:1027-1047` 语言按口播稿检测。测试：`tests/audio-post-production.test.ts`（`\kf` 合计 = cue 时长、转义后插标签、无 words 回退）；`tests/caption-font-family.test.ts` 保持；`tests/audio-caption-controls.test.ts:42-53` 重写；`tests/stitch-pipeline.test.ts` 夹具实烧。
- **P04-A1 TtsProvider 抽象**：`src/lib/providers/tts/`，`synthesize({text, voiceId, language}) → {audio, mime, durationMs?, words?}`；OpenAI 实现迁入；`TTS_PROVIDER`；`VOICE_MAP` 分表并补 `calm-premium`；`probeTts` 按 provider；`capability-status-service.ts:227`、`registry.ts:554,572` 按 provider 联动；b-roll 改接；不碰封存护栏（文件不叫 `volc-tts`、无 `synthesizeSpeech` 字样）。新 `tests/tts-provider.test.ts`。
- **P04-D `voiceover.drive`**：schema 加 `drive`（默认 native，旧快照可解析）；`generation-supervisor.ts:46-76 normalizePostProductionSettings` **透传** drive；**能力闸落在派发入口**（拿得到 routeSnapshot 与 voice 能力的地方：`dispatch/route.ts` 与 `createBatchJob`），不写进归一化函数。

### 其它（Phase 1）

- **P02-E0 锚点接线（开关默认关，不等 E14）**：`findReadyAnchorCutoutsForImages`（`userId + sourceImageUrl`，`sha256` 兜底）；`processPendingAnchors` 接 cron；切片是否进参考图由 P02-E 决定。
- **copy PR**：P01-F + P03-K 文案一次合入 `registry.ts`。

---

## 4. Phase 2 · 依赖实验结论的代码

| 任务 | 等 | 做什么 |
|---|---|---|
| P02-B2 | E1 | 入参上限 5 → 6；`createShuyuImageTask:894` 硬拒绝改截断；`shuyu-image-provider.ts:90-139 submitShuyuImageTask` 选套餐后截断 |
| P02-F2 | E1 / P03-H | 单条视频参考图上限按线路/套餐取（`storyboard-service.ts:1256`、`video-service.ts:542-545,1386`） |
| P02-E | E14 + key + P02-E0 | 切片进故事板与视频参考（形式按 E14）；非 Shuyu 线路在 E14 补非 Shuyu 臂之前不放切片 |
| P02-D2 | E15 | 主播槽位对客户开放（UI 露出、默认开、合规声明） |
| P02-G | E14 | 批量参考图插入切片：`orderBatchReferenceImages({productUrls, anchorUrls, storyboardUrls, max})`，Shuyu 上限 9（按线路取上限的 P03-I 并入 G2 之后） |
| P03-A2 | E1 + E12 + D-3 | 开放 1080P 成片档（显式选择，D-12），计费与额度按档位 |
| P04-A2 | E3b | 第二家 TTS adapter（第三方，优先带逐词时间戳；OpenAI 无 realtime 模型） |
| **P04-F（D-13 默认口型路线）** | E8′ | Sync Labs adapter（`src/lib/providers/sync-labs.ts`，`SYNC_API_KEY`）+ `stitch-composer.ts` 段替换：Shuyu 段成片 → 外部 TTS 音轨 → sync-3 对口型 → 换 `outputVideoUrl` 后重拼；失败回退到原段 + `audioUrl` 叠音轨；成本进额度口径 |
| **G2′ 通过才进入（Shuyu 2.5 任务组）** | E7′ 判 2.5 值得 + 创始人同意 | P03-D0 已在 Phase 1 定型（类型与能力位）；之后：**P03-D″ Shuyu 适配器支持 2.5 档**（`auditShuyuVideoPlan` 识别新档、durations 到 30、`input_images_max` 按档、参考视频/音频字段透传——以 E2″ 实证的请求体为准，`shuyu.ts:1007-1018`）→ `director-plan.ts:44` 段时长上限按档放开到 30 与分段规划器切段 → P03-I 批量/单条参考图上限按套餐取 → P04-E 音频参考派发链（依赖 E4″ + P04-A1 + (P04-A2 \| P04-G) + P04-C + P04-D + P05-C）。**多供应商任务（P03-F/G/H/C2、M2 enum）本轮搁置**；`CUSTOMER_FAILOVER_ROUTE_ID` 保持现状，批量仍禁止降级 |
| P04-G | E16 | Shuyu 线字幕对齐：whisper 达标 → GH runner；否则托管 ASR |
| P04-H | E3b + P04-B | 口播完整性 gate `VOICEOVER_TRUNCATED` |
| P01-G | E13 | drift shadow → block（计入 `blockCount ≤ 2`） |
| P01-B2 / P01-D(block) | E13 | detail 档位、抽帧数、审帧阈值 |
| P01-H | E9（P1） | 超分后 logo 区域对比 |
| P05-E | P04-F（或 G2′ 后的 P04-E） | 换口播：重做全部 AI 段 + 重新 TTS + Sync 后置口型，按段计费 |

---

## 5. 热点文件合入顺序（硬约束）与跨链边

| 文件 | 顺序 |
|---|---|
| `video-service.ts` | P03-B → P05-B(v) → P05-C → P02-F(v) → P01-B → Phase 2：P02-F2 → P04-E |
| `storyboard-service.ts` | P02-A → P02-C → P02-D(s) → P02-B → P05-A → P02-F(s) → P01-D → Phase 2：P02-B2 → P02-E → P02-F2 → P01-D(block) |
| `batch-service.ts` | P03-B（ack）→ P03-C1 → P01-D（审帧调用）→ Phase 2：P02-G+P03-I → P03-C2；`startedAt:1174` 语义放 Phase 3 C5 |
| `stitch-service.ts` + `sweep-service.ts` + `single-video-cancel-service.ts` | P05-B（含回滚四处）→ P01-E1 → P01-E |
| `render-retry/route.ts`、成品库详情页、`quota-service.ts` 限流表 | P05-D → P05-B → P05-C |
| `frame-qa.ts` | P01-A → P01-B → P01-E |
| `providers/types.ts` | P03-D0 一次定型（P03-D / P03-F/G 允许追加 id 与 wire 细节，不再改形状） |
| `seedance.ts` | P03-D-lite（开关）→ P03-D（转正） |
| `byteplus-video-provider.ts` | P03-D0（透传）→ P03-D（wire） |
| `shuyu-video-provider.ts` | P03-A1 → P03-D0（referenceAudios 拒绝） |
| `shuyu.ts` | 图像档（P02-B / P02-B2）与视频档（P03-A1）分 PR；900 常量废弃放 C2 |
| `prompt-intelligence.ts` | P04-C → P02-C → P04-E |
| `storyboard-beats.ts` | P02-C → P02-F(v) |
| `director-plan.ts` | P04-C → P03-D |
| `prisma/schema.prisma` | M1 → M2 |
| `streamlined-video-studio.tsx` | P04-B → P05-A → P02-D(UI，P02-D2 才露出) |
| `registry.ts` | 一个 copy PR（P01-F + P03-K）；P04-A1 的逻辑随 TtsProvider PR |
| `first-pass-rate-service.ts` | X-SCAF-0（run key）→ P01-F0（重做行 + WOULD_BLOCK）；P01-F0 必须先于 P05-C |
| `capability-probe-service.ts` | P03-A1 → P04-A1 |
| `unified-input.ts` | P02-A → P04-D |

**跨链边**：P05-C 等 P05-B 与 P01-F0；P01-E 等 P01-B；P02-D(s) 先于 P02-B 与 P02-F(s)；P02-D(UI) 等 P02-F(s)。

---

## 6. Phase 3 · 清理（铁律 8，单独 PR）

C1 删 `remove-bg.ts` legacy 路径；C2 废弃 `SHUYU_VIDEO_POINTS_PER_GENERATION=900`；C3 去掉火山国内备用线与 `ARK_VIDEO_MODEL=2.0` 残留；C4 合并两份 `ensureQAPendingStub`；C5 `startedAt` 语义改为供应商首次报 processing（同步核对 sweep 与超时）；C6 §6 清理清单（`category-lock-registry` / `generic-shot-policy` 按 P0-2 结论、`director-methodology`、`logo-fidelity-gate` 若 P01-H 不接、旧中台 `asset-qa-service` / `director-service` / `brand-placement-policy`、数字人封存链整体处理）；C7 2027-01-06 前 OpenAI TTS 硬编码全迁走；C8 收敛对源码做正则断言的测试。

---

## 7. 验收门

### 7.1 每个 PR
`npm run typecheck` + `npm run lint` + 相关 `tests/*.test.ts` 全绿并贴输出；前端在 preview 点一遍并查 console；合成/字幕跑 `tests/stitch-pipeline.test.ts`（本机 ffmpeg+libass）；函数体积以 preview 部署后 Vercel 实际尺寸为准。

### 7.0 额度不足期间的验收口径（创始人 2026-10-26 晚定）
代码先全部落地；额度 / key 未到位时，**mock 与真机结合**：状态机、计费与退额、回滚、幂等、降级文案这类逻辑用 mock provider（`VIDEO_PROVIDER=mock`，rehearsal 库）全路径验；**质量判据**（漂移漏检率、口型对齐、字幕偏差、商品/人物一致）只能用真机出片验，额度到位前只做小样本抽检并在验收文档里标「待全量真机」。这是对 CLAUDE.md 铁律 3「不做 mock 充当验收」的一次有记录的例外，仅限本轮额度到位之前，且 mock 结果不得写成「质量通过」。

### 7.2 每个 P0 项（写入 `docs/acceptance/2026-11-core-round-acceptance.md`；判据、真值、工具三者齐全才算门）

| P0 | 判据 | 真值 | 工具 |
|---|---|---|---|
| P0-1 | ① hold-out 上漂移**召回 ≥ 0.8 且 95% CI 下界 ≥ 0.6**（达不到则「漏检 < 10%」降为观测指标，不作门）；② **人工 QA 首过率**（首次成片商品/人物 0–2 分都 ≥1 且无重抽）从 1025 基线 **7/12** 提升到 20 条批量 **≥ 16/20**（2 人盲评，kappa 报告）；③ 运维页可见 SKIPPED 与未跑复检比例；只统计 buddy 批次 | E13 标注集（≥30 正例 / ≥60 负例，按 SKU hold-out）；1025 的 12 条人工 QA | X-SCAF-7、`scripts/ops/qa-first-pass.ts`、`frame-qa.ts --refs --json` |
| P0-2 | 三条此前漂移的模板各重出 **3 次**，商品/人物 ≥1 分的 **≥ 2/3**；故事板每帧入参 = `min(上传实拍数, 3)` 张实拍 + 1 前帧（E1 确认上限 6 后才要求 3 张） | 2 人盲评 | 从 `StoryboardFrame.inputImageUrls` / `planSnapshot` 读取核验 |
| P0-3 | Shuyu 1080P 成片档可被内部/脚本显式选中、对客户不可见不可选（测试 400）；`plans.max(1)` 修复后多档不 500；单条 `providerUnitPoints` 与供应商侧**独占时段余额差**一致；E12 排队分布与 E10 吞吐写进批次 SLA 文案；**E7′ 2.0 臂报表**（2.5 臂与 G2′ 结论等 Shuyu 上线后补） | E7′ JSON；Shuyu 余额 | X-SCAF-8、X-SCAF-9 对账脚本、健康报表积分列 |
| P0-4 | TTS 路径：逐词起点 **P95 \|偏差\| < 150ms**（真值 = 第三方 TTS 逐词时间戳，字幕侧读 ASS 实际 cue）；原生口播路径：人工金标 ≥200 词；karaoke 夹具实烧无报错（Phase 1），真实逐词来源接入后再实烧（Phase 2）；**口型：D-13 路线（Shuyu + TTS + Sync）按 E8′ 预注册判据过**（G2′ 通过时再加 E4″ 的音频参考路线）；完整性 gate 进生产 | E3b 供应商时间戳；E16 人工金标；E8′ 人工口型分 | X-SCAF-3 |
| P0-5 | 生产验成功路径：重做一段只扣 1 段并换挂重拼；换字幕/BGM 零生成计费；故事板帧换提示词/参考图；**失败路径在 rehearsal + mock 注入失败里验**：旧片保持 READY、退 1 段、清扫/取消期间不打成 FAILED；已审/已发布 brief 不被打回 | 额度流水 | 新测试 + rehearsal 演练 |

### 7.3 全局
清扫/退额/熔断回归全绿；`/app/status` 降级文案与事实一致；媒体函数 < 250MB；`npm test` 全绿。

---

## 8. 时间与预算

- **Phase 0**：10 个工作日（2.5 对照另计，等 Shuyu）；USD ≈ **$60** + 三家小额订阅；Shuyu 现在就能跑的 ≈ **158k 点**。
- **Phase 1 / §7 真机验收（全部 1080P 口径，3,600 点/15s 段 + 帧 ≈300）**：34 模板重跑 ≈ 133k + 批量 20 条 ≈ 78k + P0-2 9 条 ≈ 35k + P0-5 ≈ 22k ≈ **268k 点**（⚠ OpenAI 任务的真机验收等额度生效）。
- **Shuyu 充值（D-2）建议分两笔**：2026-10-26 余额 **11,964 点**。**第一笔**：预留线（≈7k）+ 158k + 268k ≈ 433k → 按 **450k** 充；**第二笔**（Shuyu 上线 2.5 后）：E7′ 2.5 臂 + E11 + 可选 E4″ ≈ 170k–270k，按 Shuyu 对 2.5 档的报价再定。实验与验收均不碰预留线。
- **Phase 2**：约 12–16 人天，按实验解锁。**Phase 3**：3–5 人天。

## 9. 主要风险与对策

- OpenAI 额度不到位 → P01 系列只能影子；E17 给出备援 vision；运维页把 SKIPPED 比例摆在明面。
- 口型只能后置（本轮默认） → D-13 路线（Shuyu + TTS + Sync）由 E8′ 先验证；「原生口播 + 后置口型」的双重嘴型可能打架，E8′ 要同时测「静音段 + 后置」与「原生 + 后置」两种，并记成本（Sync 按秒计费叠在 Shuyu 点数之上）。
- Seedance 2.5 何时在 Shuyu 上线不受我们控制 → 2.5 任务组与 E7′ 2.5 臂整体后置，不阻塞本轮其他 P0；2.0 臂与标注集先跑。
- **Shuyu 单点风险不变**（0728/0804 漂移史、曾有周成功率 28.6%、取消不到供应商、无音频字段） → 本轮接受；熔断 / 清扫 / 退额那层已是最可靠的部分，P03-C1 继续禁止批量降级；如果本轮验收期间 Shuyu 再出现整线不可用，重开二线议题。
- 把所有点数压在 Shuyu 上后，1080P 成本是实打实的 2.3–2.9× → P03-A2 之前客户看不到 1080P；验收点数按 §8 两笔充，不碰预留线。
- 实验行污染生产读数、挤客户并发槽、扣额度 → X-SCAF-0：优先 rehearsal；`exp-2611-` 前缀三处排除；并发 ≤2；避开高峰。
- 1080P 成本 2.3–2.9× → final 档对客户不可见，直到 P03-A2 + 定价。
- 只重拼期间被清扫/取消打成 FAILED → P05-B 统一回滚出口覆盖四处。
