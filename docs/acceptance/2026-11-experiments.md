# 2026-11 核心链路做稳轮 · 实验记录

计划：`docs/roadmap/2026-10-26-core-round-plan.md` §2。每个实验一节：命令 / 样本 / 结果 / 结论 / 解锁或否决的任务。数据落 `tmp/experiments-2026-11/<E>/`。预注册判据以计划 §2.2 为准，跑之前不得改。

## 前置：账号与额度现状（2026-10-26）

| 项 | 现状 | 需要 |
|---|---|---|
| Shuyu 余额 | **11,964 点**（`getShuyuBalance`，2026-10-26） | 预留线 ≈7,000 点不动；本轮按 1080P 验收估算需 ≈340k 点（见计划 §8 与下表），建议充到 **≥350k** |
| OpenAI | `/v1/models` 200（23 个模型），`chat/completions` **429 no credits**（2026-10-26） | 充值；E13/E17、P01 系列真机、TTS 参考轨都等它 |
| OpenAI 模型清单 | **无** `gpt-realtime-2.1-mini`；TTS 只有 `tts-1 / tts-1-hd / *-1106`（2027-01-06 关停） | → E3a 结论：Realtime TTS 在此 key 不可用，TTS 供应商只能选第三方 |
| 新视频通道（fal / BytePlus / 阿里国际站） | **全部搁置**（2026-10-26 决策 D-2 三次修订：Shuyu 是唯一视频通道） | — |
| Shuyu Seedance 2.5 档 | 创始人已向 Shuyu 提出上线；时间未定 | 上线后跑 E2″ → E7′ 2.5 臂 → G2′ 决策；`/prices` 出现含「2.5」的档位即触发（X-SCAF-4 探针） |
| Sync Labs | 无 | `SYNC_API_KEY`，D-13 后置口型（E8′ 与 P04-F） |
| TTS 试用 key | 无 | ElevenLabs 或 MiniMax 任一（带逐词时间戳） |
| remove.bg / Clipdrop | 未配 | E14 与 P02-E 需要 |
| Sync Labs | 无 | E8 需要（可后置） |

**Shuyu 点数估算（1080P 验收口径：240 点/秒 × 15s = 3,600 点/段 + 故事板帧 ≈300 点）**

| 用途 | 条数 | 估算 |
|---|---|---|
| E12 1080P 排队（3 时段 × 3+3） | 9 × 720P + 9 × 1080P | ≈45k |
| E14 切片对照 | 9 条（720P 即可） | ≈12.6k |
| E15 真人脸拒单（帧为主）+ 6 条视频 | 24 run 帧 + 6 条 | ≈14.4k |
| P0-1 验收：34 模板重跑 | 34 × 1080P | ≈133k |
| P0-1 验收：批量 20 条 | 20 × 1080P | ≈78k |
| P0-2 验收：3 模板 × 3 次 | 9 × 1080P | ≈35k |
| P0-5 验收：重做/重拼 | ≈6 段 | ≈22k |
| E7′ 2.0 臂（现在可跑，兼 E13 标注集） | 20 × 1080P | ≈72k |
| E8′ Shuyu + TTS + Sync 后置口型 | 4 × 1080P | ≈14.4k |
| **第一笔合计** | | **≈426k**（预留线 ≈7k 另计；建议按 450k 充） |
| E7′ 2.5 臂 + E11（Shuyu 上 2.5 后） | 20 × 15s + 6 × 30s | ≈173k（按 ≤1.5× 2.0 估，待报价） |
| E4″ 音频参考对口型（仅当 2.5 档收音频参考） | 12 条 | ≈97k（同上） |
| **第二笔合计**（2.5 上线后再充） | | ≈170k–270k |

## E1 · Shuyu `/prices` 只读核对（2026-10-26，已完成）

命令：`npx tsx --env-file=.env.local <scratch>/shuyu-prices-probe.ts`（只 GET `/prices`，57 档）。

结果：
- 图像档：GPT Image 2.5 Flare / Sunburst（Low/Medium/High × 1K/2K/4K，32–80 点/张）、Seedream 5 Pro（1K 56 / 2K 72）、Seedream 5 Lite 4K 64；**所有图像档 `input_images_max = 6`**。
- 视频档：全部 `model=studio-video`、`unit=second`、durations 4–15、`input_images_max = 9`、无音频字段。Seedance 2.0 Fast VIP 720P 84 / VIP 720P 104 / 480P 64–80；**1080P 240 点/秒**（`video-plan-13` 集合线路、`video-plan-15` 推荐1）；4K 640（`video-plan-14/16`）。另有 Grok 1.5/1.0 720P 24–32（仅 image2video）、Gemini Omni Flash 720P 300 点/条（固定 10s）。

结论：图像档上限 6 → **P02-B2 可把故事板入参上限 5 → 6**；视频档 9 张 → 切片/主播图进视频参考要在 9 张内排位（P02-F2 按套餐取）；1080P 在售且价稳定 → **P03-A2 的成本基数 = 3,600 点/15s 段**。

解锁：P02-B2、P02-F2、P03-A2（E12 仍需跑）。

## E3a · OpenAI 模型清单（2026-10-26，已完成）

命令：`GET /v1/models`（生产 key）。
结果：23 个模型；无任何 `realtime` 模型；TTS 仅 `tts-1`、`tts-1-hd`、`tts-1-1106`、`tts-1-hd-1106`（官方 2027-01-06 关停）。`chat/completions` 429「no credits remaining」。

结论：`gpt-realtime-2.1-mini` 在此 key 不可用 → **P04-A2 的第二家 TTS 直接选第三方**（ElevenLabs / MiniMax / BytePlus TTS，优先带逐词时间戳）；E3b 改为只比第三方三家；E16 的真值来自第三方 TTS 的逐词时间戳。

解锁：P04-A2 选型范围；E3b 范围收窄。

## E2″ · Shuyu Seedance 2.5 参数实证（2026-10-27，已完成）

只读部分：真值表 + `/prices` 原样快照（夹具 `tests/fixtures/shuyu-prices-live-20261027.json`）。

- 目录从 57 档涨到 **110 档**；视频档里 Seedance 2.0 / 2.5、Kling 3.0/4.0、Wan 3.0、Grok、MiniMax H3、Gemini Omni **全部 `model=studio-video`**，只能靠 display_name 区分。几乎每档都多了 `21:9`；2.5 / Wan / Kling 的 `input_images_max` 为 10–30。
- **生产事故**：旧 schema 外层 `max(100)` + 严格枚举 → `getShuyuPrices` 整表 `invalid_response`，视频与故事板线路停机（发现时 `resolveShuyuVideoPlans` 真机复现）。热修复 #27：放宽结构校验 + 按 display_name 锁家族（不锁的话最便宜的 720P 会是 Kling 4.0，成片被静默换模型）；图像档同时排除「GPT Image 2.5 Flare / Sunburst」。
- Seedance 2.5 档：标准 480P 76 / 720P 130 / 1080P 360 点/秒（`video-plan-76/77/78`）；VIP 三组 480P 90–180 / 720P 144–300 / 1080P 420–560；durations **4–30**；`input_images_max = 30`；`input_videos_max = 10`、`input_audios_max = 10`；modes 仍是 text2video / image2video；无 4K。
- OpenAI：chat / moderation 恢复；TTS 生产模型 `tts-1` / `tts-1-hd` 200（真值表原先测的是未开通的 `gpt-4o-mini-tts`，误报 403，已改成测生产模型）。
- Shuyu 余额：**10-27 仍是 11,964**，充值尚未到账（下表扣点从这个数起算）。

试提交（全部 5s、9:16、`exp-2611-e2pp-*` 幂等键、并发 ≤2）：

| 套餐 | 参考图 | 结果 | 成片 | 耗时 | 扣点 |
|---|---|---|---|---|---|
| 2.5 1080P `video-plan-78` | 2 张（一张 `.png` 实为 JPEG） | 预检拒：`invalid_reference_image`（Content-Type 与内容不符） | — | — | 0 |
| 2.5 1080P `video-plan-78` | 2 张 JPEG | `generation_failed`（could not start this task） | — | — | 0 |
| 2.0 Fast VIP 480P `video-plan-82`（对照） | 2 张 JPEG | completed | 496×864 · 24fps · AAC | 328s | 280 |
| 2.5 480P `video-plan-76` | 无（text2video） | completed | 496×864 · 24fps · AAC | <25min | 380 |
| 2.5 480P `video-plan-76` | 1 张 | completed | 496×864 · 24fps · AAC | <25min | 380 |
| 2.5 1080P `video-plan-78` | 1 张 | `generation_failed` | — | — | 0 |
| 2.5 VIP 1080P `video-plan-88` | 1 张 | `generation_failed` | — | — | 0 |
| 2.5 720P `video-plan-77` | 1 张 | completed | **720×1280** · 24fps · AAC | 474s | 650 |

合计 1,690 点，余额 11,964 → 10,274（与单价逐条吻合，失败的提交零扣点）。

结论：
- **2.5 的 1080P 目前在 Shuyu 侧启动不了**（标准版与 VIP 都是，价目表却标 available）；480P / 720P 正常出片且自带原生音轨。需向 Shuyu 反馈。
- 默认线路先落 **Seedance 2.5 · 720P**（实测可出片的最高档，15s = 1,950 点，是原默认 2.0 Fast 720P 的 1.55×）；1080P 修好后设 `SHUYU_DEFAULT_VIDEO_LANE=seedance-2.5-1080p`（15s = 5,400 点）。
- `.png` 扩展名、JPEG 内容的图会被 Shuyu 预检拒单——客户素材走 blob 时 Content-Type 必须按真实内容写（待查上传链路）。
- 参考图仍按 9 张硬顶提交（>9 张未实证）；单段仍切 15s（30s 单段待 E11 验证再放开规划器）。

## 待跑

现在就能跑（等 Shuyu 充值 / OpenAI 生效 / TTS、Sync、remove.bg key）：E12、E14、E15、E8′、E7′ 2.0 臂（兼 E10）、E3b、E16、E13、E17、E9。
Seedance 2.5 已上线（E2″ 已完成，创始人已拍板默认用 2.5，G2′ 视为通过）：E7′ 2.5 臂（含 E11）、可选 E4″ 待 1080P 修好与充值到账。
已搁置：E5、E6（Wan / Kling）、原 E2 / E2′（BytePlus / fal 参数实证）。
