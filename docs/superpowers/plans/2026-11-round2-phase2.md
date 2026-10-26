# 2026-11 第二轮：Phase 2 代码先行（额度到位前只落代码，不开真机验收）

依据：`docs/roadmap/2026-10-26-core-round-plan.md` §4 Phase 2；Phase 1 六条链已全部合入 main（验收记录
`docs/acceptance/2026-11-core-round-acceptance.md`）。创始人 2026-10-26 决定：外部充值 / key 由 CEO 办，
本轮先把不等实验结论、或 E1 已解锁的 Phase 2 代码写好；额度到位后直接按 §7 验收。

## 范围（按热点文件顺序）

| 任务 | 解锁依据 | 做什么 | 验证 |
|---|---|---|---|
| P02-B2 | E1 已完成（图像档 `input_images_max` 全部 = 6） | 故事板入参上限 5 → 6；`createShuyuImageTask` 对 >上限 的参考图由硬拒改为按硬顶 6 截断；`submitShuyuImageTask` 选套餐后按套餐 `inputImagesMax` 截断 | 单测 |
| P02-F2 | E1（视频档 `input_images_max` = 9）+ D-2（只有 Shuyu） | 单条视频参考图上限按线路适配器取：buddy/Shuyu → 9，其它线路与历史行 → 8；写进 `referenceLayout.limit`，重试 / 重做沿用 | 单测；无切片 / 主播的 mock 线路派发摘要不变 |
| P04-A2 | E3a（OpenAI 无 realtime，第二家只能第三方） | ElevenLabs 适配器 `providers/tts/elevenlabs.ts`：`with-timestamps` 端点，字符对齐 → 逐词（中文逐字、英文按空白），`supportsWordTimestamps=true`；`TTS_PROVIDER=elevenlabs` + `ELEVENLABS_API_KEY`；能力探测按供应商 | 注入 fetch 的单测；真机等 key（E3b / E16） |
| P04-F（适配器层） | D-13 路线已拍板 | Sync Labs 客户端 `providers/sync-labs.ts`（`SYNC_API_KEY`，`POST /v2/generate` + `GET /v2/generate/{id}`，模型缺省 `sync-3` 可 env 覆盖）+ 纯函数状态映射；**不接派发**：`voiceover.drive=tts_lipsync` 仍对所有线路 422，直到编排（poll-videos 内的段级对口型 → 换 outputVideoUrl → 重拼）在下一步接上 | 注入 fetch 的单测；真机等 key（E8′） |

不做：P03-A2（等 D-3 定价）、P02-E / P02-G / P02-D2（等 E14 / E15 真机）、P01-G / P01-B2 / P01-D(block)（等 E13）、
P04-G / P04-H（等 E16 / E3b）、Shuyu 2.5 任务组（等 G2′）。Phase 3 清理按铁律 8 单独 PR。

## 验证结果

2026-10-26 晚，主仓 main 工作区：

- `npm run typecheck` → 退出 0；`npm run lint` → 退出 0。
- 新增 / 改动测试：`tests/storyboard-input-cap-p02b2.test.ts`（4）、`tests/single-video-reference-limit-route.test.ts`（3）、
  `tests/tts-elevenlabs.test.ts`（7）、`tests/sync-labs-provider.test.ts`（7）；`tests/storyboard-service.test.ts` 四处把上限 5 的断言改为 6。
- `npm test` 全量 → `tests 2449 / pass 2448 / fail 0`（首轮全量只挂 3 条钉死「≤5」的旧断言，已按 P02-B2 更新）。
- `tests/video-reference-layout.test.ts` 两个「与改动前逐字节一致」摘要未变：mock 线路仍按 8 截，P02-F2 只对 Shuyu 放到 9。
- 真机判据全部未验（E3b / E16 / E8′ / P0-2 入参核验），等 CEO 充值与 key；见验收记录 §6。

## 下一步（本轮未做，代码层仍可先写）

1. P04-F 段级编排：状态建议存 `VideoJob.assignedAssets.lipsync`（仿 b-roll `assignedAssets.broll.ttsAudioUrl`，免迁移）；
   `onAllSegmentsSucceeded` 判 drive=tts_lipsync → 不直接进拼接；poll-videos 推进 TTS → Sync → 换 outputVideoUrl（原 URL 留作回退）→ 全部完成再置 FinalVideo PENDING；
   失败回退原段 + 叠音轨；成本按 `estimateSyncLipsyncCostUsd` 进额度口径。合成器在 Vercel 内 300s 上限，对口型不能放进合成同步等。
2. words → 字幕逐词：stitch 管线目前不传 words（P04-B 纯函数入口已有），b-roll 与单条路径都要接。
3. Phase 3 清理 C2（900 常量）/ C4（两份 `ensureQAPendingStub`）单独 PR。
