---
name: aivora-director
description: Aivora 的导演线路——由 Claude 当导演和编剧写镜头脚本，OpenAI gpt-image-2 出故事板，Shuyu Seedance 2.5 出片。用户说「出一条视频」「给这个商品做片」「从你这边生成」「写镜头脚本 / 故事板」「重拍这一条」时使用。不走前端创作台，不碰数据库。
---

# Aivora 导演线路

2026-11-16 定的线路：**Claude 写脚本与提示词 → OpenAI `gpt-image-2` 出故事板 → Shuyu Seedance 2.5 出片**。
Runway 已下线。前端创作台继续给客户自助用，这条线路是我们自己把控质量的出片方式。

你是导演和编剧：提示词好不好由你负责，出图、出片之前都要自己确认过。

## 流程

一条视频一个任务目录 `tmp/director/<任务名>/`（`tmp` 不进仓库），里面放商品实拍图和你写的 `job.json`。

```bash
npm run director -- check  tmp/director/<任务名>                 # 校验脚本、打印提示词、按实时价目估算。不花钱
npm run director -- frames tmp/director/<任务名> --confirm-spend  # OpenAI 出故事板帧
npm run director -- select tmp/director/<任务名> --frame opening --variant 2
npm run director -- video  tmp/director/<任务名> --confirm-spend --max-points 2000
npm run director -- status tmp/director/<任务名>
```

1. **看素材。** 逐张看商品实拍图（Read 图片），弄清结构、材质、颜色、有没有 logo 和文字。没有实拍图就先向用户要，不凭空画商品。
   测试 / 样片例外：默认用毛毯类（2026-11-16 定，别再用保温瓶）。测试商品图在 `tmp/director/_assets/blanket/`（`hero.png` 整件、`detail.png` 面料细节）；
   没有了就跑 `tmp/director/_assets/make-blanket-assets.ts` 的做法重出一套：先文生图出整件，再以整件为参考出细节。
2. **写 `job.json`。** 结构见下。先想清楚这 15 秒讲哪一件事，再分镜头。
3. **`check`，直到零错误。** 提醒逐条看，认了才往下走。把拼好的出片提示词通读一遍：一个没看过素材的人照着它拍，会不会拍错？
4. **`frames`，然后逐张看图。** 这是抽卡的地方（一张图几美分，一条片 1,500 点）。不合格就改提示词或 `--more 1` 再抽，合格才 `select`。
5. **`video`。** 先不带 `--confirm-spend` 看估算，再带上限提交。
6. **看片。** 抽帧（开头、每个镜头中段、最后一秒）加听音轨，按下面的验收单过一遍，再向用户交付或说明为什么重拍。

`frames` 和 `video` 都能随时中断重跑：进度在 `state.json`，有任务号的只续查、不重提。

## job.json

```json
{
  "id": "zebra-blind-01",
  "title": "斑马帘晨光",
  "aspectRatio": "9:16",
  "durationSec": 15,
  "references": [
    { "id": "product-front", "source": "photos/front.jpg", "kind": "product",
      "role": "product shape, slat spacing and fabric texture; ignore its background" }
  ],
  "frames": [
    { "id": "opening", "references": ["product-front"], "variants": 2,
      "prompt": "…这一帧的画面，英文…" }
  ],
  "video": {
    "openingFrame": "opening",
    "references": ["product-front"],
    "look": "Photorealistic handheld commercial, natural morning daylight, shallow depth of field.",
    "openingState": "…主动作发生之前的清楚状态…",
    "shots": [
      { "fromSec": 0, "toSec": 5,
        "action": "…", "space": "…", "framing": "…", "camera": "…", "light": "…", "sound": "…" }
    ],
    "endState": "…",
    "constraints": ["…"]
  }
}
```

`source` 是本地文件（相对任务目录或仓库根目录）或 https 地址。本地图在出片时会传到我们自己的存储，换成公开地址给 Shuyu。

## 写脚本的规矩

这些来自 10-29 吸收的 Kelin 团队经验与我们自己的真机教训（`docs/roadmap/2026-10-29-kelin-workflow-lessons.md`）。

- **全程英文。** 提示词只用一种语言，英文最准。台词例外：放在英文双引号里，写商家要的原文，模型会逐字念。
- **每个镜头六项都写：** `action` 主体与表演、`space` 空间与调度、`framing` 构图、`camera` 摄影机、`light` 光色、`sound` 声音与剪辑。
- **一拍一个主动作、一个机位意图。** 出现 then / after that 就该拆成两个镜头。每个镜头至少 2 秒。
- **首帧放在主动作发生之前。** 开场帧和 `openingState` 都不提前露出结果（帘子还没拉开、盒子还没打开）。
- **参考图各管一件事。** `role` 写清这张图管什么、不继承什么：商品图管款式结构，场景图管空间，人物图管服装体态。
- **限制只留当前风险。** 最多 6 条，不重复、不互相矛盾。想加第七条时，先删一条。
- **避开清晰正脸。** Seedance 会把带正脸的参考图整单拦下（10-29 评测 5 条全败，每次白等约 8 分钟）。开场帧用手部、侧背、过肩或商品主体；需要人就写明 no face in frame。
- **商品上的字和 logo 不要让模型重画。** 写进限制（keep the label exactly as in image 1），并且别给特写到能看清每个字的镜头：重画的字会糊。
- **提示词紧凑。** 拼好的出片提示词上限 4,800 字，超了就删限制、并镜头，不靠截断。

## 看故事板帧（定稿之前）

- 商品的结构、比例、颜色、材质和实拍图对得上，没有多出或少掉部件。
- 商品上的文字、logo 没有乱码或变形。
- 没有清晰正脸；手指数量和姿势正常。
- 构图给后面的动作留了空间，画面是首态，结果还没发生。
- 商品颜色没被场景光染偏（暖色台灯会把灰绿染成黄绿）：两张都合格时选颜色更贴近实拍图的那张。
- 没有画面内文字、水印、拼图边框。

有一项不过就不定稿。改提示词比多抽几张有用。

## 看成片（交付之前）

- 分辨率与时长：`video` 结束时会打印量出来的宽高、时长、有没有声音。
- 商品从头到尾没有走样，动作按时间线发生，没有多出脚本外的情节。
- 台词念对了，没有在片尾被截断；口型对得上。
- 最后一秒是 `endState`，不是动作中途。

向用户汇报时说清楚：用了哪一档、花了多少点、哪几项过了、哪里不满意。不满意就说不满意，并给出重拍打算改什么。

## 花钱的规矩

- **出片默认 Seedance 2.5 · 720P**，按这条片的时长取最便宜的一档（15 秒是特价方案 113，1,500 点按条计；5 秒以下是按秒的 VIP 档更便宜）。
  1080P 是 420 点/秒，15 秒 6,300 点，11-16 定了不用；用户明确要才加 `--resolution 1080P`。
- **`video` 每次都要 `--confirm-spend --max-points <上限>`**，脚本会估算、比上限、比余额（留 7,000 点预留线），三关都过才提交。
- **真机花点要用户点头。** 第一次给某个商品出片、或者要重拍第二次以上，先把估算告诉用户再提交。
- 当场被拒不扣点，脚本会自动换同分辨率的下一档；受理后失败会停下来等你看原因，不会自动再花一次。
- 故事板帧走 OpenAI 的余额，一次最多 8 张（`--max-images` 可改）。

## 边界

- 不碰数据库：脚本把 `DATABASE_URL` 换成了连不上的地址。成片要进成品库是另一件事，先问用户。
- 不用 demo 账号、不做 mock：这条线路只走真实供应商。
- 套餐与价目会漂移：以 `check` 当场打印的阶梯为准，不要照抄本文件里的数字。
- 纯逻辑在 `scripts/lib/director-plan.ts`（有 `tests/director-plan.test.ts`），命令在 `scripts/director/run.ts`。
