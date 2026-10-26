# 2026-11 核心链路做稳轮 · 实验记录

计划：`docs/roadmap/2026-10-26-core-round-plan.md` §2。每个实验一节：命令 / 样本 / 结果 / 结论 / 解锁或否决的任务。数据落 `tmp/experiments-2026-11/<E>/`。预注册判据以计划 §2.2 为准，跑之前不得改。

## 前置：账号与额度现状（2026-10-26）

| 项 | 现状 | 需要 |
|---|---|---|
| Shuyu 余额 | **11,964 点**（`getShuyuBalance`，2026-10-26） | 预留线 ≈7,000 点不动；本轮按 1080P 验收估算需 ≈340k 点（见计划 §8 与下表），建议充到 **≥350k** |
| OpenAI | `/v1/models` 200（23 个模型），`chat/completions` **429 no credits**（2026-10-26） | 充值；E13/E17、P01 系列真机、TTS 参考轨都等它 |
| OpenAI 模型清单 | **无** `gpt-realtime-2.1-mini`；TTS 只有 `tts-1 / tts-1-hd / *-1106`（2027-01-06 关停） | → E3a 结论：Realtime TTS 在此 key 不可用，TTS 供应商只能选第三方 |
| fal | 未开户 | 开户拿 `FAL_KEY`——**本轮唯一的二线试验通道**（Seedance 2.5 `/us/`、Wan 3.0、Kling 4.0 各 20 条 bake-off） |
| BytePlus ModelArk / 阿里云国际站 | **撤下**（2026-10-26 决策 D-2 二次修订） | 等 E7 bake-off 的 G2 结论再议 |
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
| E7 Shuyu 1080P 对照臂 | 20 × 1080P | ≈72k |
| E8′ Shuyu + TTS + Sync 后置口型 | 4 × 1080P | ≈14.4k |
| 合计 | | **≈428k**（预留线另计；建议充到 450k） |

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

## 待跑

E3b、E16、E13、E17、E14、E15、E12、E2、E4、E5、E6、E7、E8、E9、E10（按计划 §2.3 时间表；外部账号到位后开跑）。
