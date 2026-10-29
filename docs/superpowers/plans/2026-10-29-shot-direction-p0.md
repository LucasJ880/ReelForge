# 2026-10-29 · 镜头导演 P0（借鉴朋友的 ai-video-workflow 方法包）

来源：朋友分享的 `ai-video-workflow` v1.0.0（纯方法文档，无代码）。对照我们的链路后定的 P0 四项，
分析见本轮会话；样例实测（纯函数，不调供应商）确认了两处硬伤：Kling 线路把镜头卡的「动作 / 尾态」截掉，
提示词里同时挂着互相打架的锁。

## 范围与不变量

- **只改镜头卡模式。** 没有镜头卡（LLM 不可用 / 超时 / 批量）时，出帧与派发提示词逐字节不变——
  `storyboard-grounded-video-prompt` / `video-reference-layout` / 镜头卡测试里的「无卡」用例原样守着。
- 台词只在 `Spoken dialogue` 一处逐字给模型：镜头卡里不写台词原文（避免念两遍；出图提示词里有中文会被画成字幕）。
- 口播稿只是设计镜头卡的参考，不进故事板幂等哈希、不入库：改口播稿不会悄悄重出一套付费故事板。
- `STORYBOARD_SHOT_CARDS=off` 仍能整体退回模板节奏。

## P0-1 镜头卡：首态 / 地点 / 谁说话，字段按重要性排序

`shot-cards.ts`

- 新字段 `startState`（开拍那一刻：人在哪、朝向、哪只手拿什么、商品在哪——出帧就画这一刻）、
  `location`（同一地点用同一个短名，换名 = 硬切到新地点）、`voice`（`on_camera` / `voice_over` / `none`）。
- 连续性约定：第 N+1 张没写首态、且没换地点时，用第 N 张的尾态补上；换地点不补。
- 格式化顺序改为 `New location → Starts on → Action → Ends on → Voice → Shot（焦段景别）→ Camera → Composition → Sound`，
  截断从尾巴丢（先丢声音 / 构图），动作和尾态最后才丢。
- 系统提示词按方法包改写：一镜一个主要变化、写看得见的动作不写情绪词、景别要容纳动作的证据、
  商品只做商家说过的事（不开合、不变形）。

## P0-2 拆掉互相打架的要求

- 出帧（`storyboard-service.ts` / `storyboard-frame-inputs.ts`）：带 `New location` 的帧换用「换地点版」
  CONTINUITY LOCK（保留人物 / 衣着 / 商品 / 光线风格，不保留上一帧的房间），REFERENCE ROLES 里前帧的说明同步换成
  「只管人、衣着、光线」。判据写在帧提示词自己身上，提交与重做都不需要新列。
- 派发（`storyboard-beats.ts`，Shuyu 与 Kling 两版）：
  - 段内有换地点 → SCENE GEOMETRY LOCK 换成「每个地点之内不变，只在标明新地点的硬切处换」；镜头行标 `hard cut to a new location`。
  - 按卡上的 `voice` 定口播方式：全是画外音 → 删 LIP-SYNC LOCK，SPEECH TIMING 写明「画外音，画面里没人开口」；
    有出镜说 → 保留 LIP-SYNC LOCK 并写明哪几镜出镜说。卡上没有 voice（旧卡）→ 与之前一致。

## P0-3 参考图写清「锁什么、不管什么」，镜头从关键帧开始演

- 实拍：只取商品本身（形状、颜色、印字），不继承背景、台面、手、道具、价签、水印。
- 主播照：锁身份（脸、发型、肤色、体型），衣着与场景跟关键帧。
- 关键帧：每张是本镜开头那一刻；镜头行从「recreate storyboard keyframe N」改成「从关键帧 N 开始、在运动中演完」。
- 去掉镜头行里的通用节奏句（「faithful product reveal」等）——卡里已经写了这一镜拍什么。
- Kling（2500 字）预算顺序：必留行 → 商家原话保底 200 字 → 镜头卡 → 商家原话其余 → 质感行与锁行。

## P0-4 镜头卡读到口播稿

- 创作台建故事板时把口播稿一起带上（`voiceoverScript`，≤2000 字）；路由 → service → `designStoryboardShotCards`。
- LLM 按台词顺序排镜头、给每镜标 `voice`；台词原文不进卡。

## 验收

- `npm run typecheck`、`npm run lint`、`npm test` 全绿。
- 真机 A/B（铁律：只走真实供应商）：同一输入、同一线路，改动前后各出一条对比；开跑前先报条数与费用，经 Evan 同意再跑。
