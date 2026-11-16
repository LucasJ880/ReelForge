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
   没有了就照 `tmp/director/_assets/make-blanket-assets.ts` 的做法重出一套：先文生图出整件，再以整件为参考出细节。
2. **先定片种，再写 `job.json`。** 片种决定节奏，见下一节。写之前用一句话说清这条片（`logline`）：说不清就还没想好。
3. **`check`，直到零错误。** 提醒逐条看，认了才往下走。把拼好的出片提示词通读一遍：一个没看过素材的人照着它拍，会不会拍错？
4. **`frames`，然后逐张看图。** 这是抽卡的地方（一张图几美分，一条片 1,500 点）。不合格就改提示词或 `--more 1` 再抽，合格才 `select`。
5. **`video`。** 先不带 `--confirm-spend` 看估算，再带上限提交。
6. **看片。** 抽帧（每个镜头至少一帧，加最后一秒）加查音轨，按下面的验收单过一遍，再向用户交付或说明为什么重拍。

`frames` 和 `video` 都能随时中断重跑：进度在 `state.json`，有任务号的只续查、不重提。

## 先定片种

第一条毛毯片的教训（2026-11-16）：用户要的是快销广告，交出去的是暖色调、慢动作、四个长镜头的生活方式片。商品和台词都对，节奏错了。

| | 快销广告 `fmcg` | 生活方式片 `lifestyle` |
|---|---|---|
| 目的 | 三秒内留住人，讲清卖点，催下单 | 营造向往的氛围 |
| 结构 | 钩子（≤2 秒）→ 2–3 个卖点（每个一个镜头）→ 使用场景 → 商品定格 + 行动指引 | 首态 → 一两个舒展的动作 → 定格 |
| 镜头 | 15 秒 5–7 个，每个 1–3 秒，硬切 | 15 秒 2–4 个，每个 3–6 秒 |
| 钩子 | 镜头 1 直接放最抓人的那一下：触感、前后对比、结果。不铺垫 | 可以从安静的首态开始 |
| 画面 | 明亮干净的光，特写多，商品占画面大 | 可以暗、可以暖、可以留白 |
| 口播 | 短句、带劲、每句一个卖点，最后一句是行动指引 | 一两句，慢 |
| 配乐 | 有节拍，切点跟拍子 | 铺底即可 |
| 运镜 | 快而稳（fast but controlled），慢动作只留给一个镜头 | 慢推、慢移 |

`check` 会按片种查节奏：快销片钩子超过 2 秒、镜头数不够、单个镜头超过 4 秒、没写配乐或口播都会提醒。

商品片的通用规律，两种片种都适用：

- **材质写成「材质 + 质感」，再加一个看得出效果的互动。** 不写「很软」，写手按下去绒面陷到指根、松手慢慢回弹；不写「好看」，写布料顺着扶手垂下来、褶子自然。
- **商品镜头从环境走到细节，光要有来处。** 每盏灯说得出是窗、是台灯还是顶灯。
- **动作会威胁到手、logo、文字的时候，简化动作，让光去做变化。** 大幅度的动作最容易把商品弄走样。
- **一条片一种主运镜。** 前面是推，后面就别突然环绕。

## job.json

```json
{
  "id": "blanket-fmcg-02",
  "title": "双面绒毛毯 · 快销版",
  "genre": "fmcg",
  "aspectRatio": "9:16",
  "durationSec": 15,
  "references": [
    { "id": "blanket-hero", "source": "tmp/director/_assets/blanket/hero.png", "kind": "product",
      "role": "the blanket itself: sage velvety face, cream sherpa reverse, stitched hem; ignore its studio background" }
  ],
  "frames": [
    { "id": "opening", "references": ["blanket-hero"], "variants": 2,
      "prompt": "…这一帧的画面，英文…" }
  ],
  "video": {
    "openingFrame": "opening",
    "references": ["blanket-hero"],
    "logline": "A hand sinks into a double-sided sherpa blanket on a bright sofa in a punchy product ad.",
    "look": "Handheld phone-style product ad, bright window daylight, fast but controlled hard cuts.",
    "openingState": "…主动作发生之前的清楚状态…",
    "voice": "a bright young female voice speaking Mandarin, upbeat and close-mic",
    "music": "upbeat pop beat around 120 bpm with claps and plucked bass, lifts on the last shot",
    "shots": [
      { "fromSec": 0, "toSec": 2,
        "action": "…", "space": "…", "framing": "…", "camera": "…", "light": "…", "sound": "…" },
      { "fromSec": 2, "toSec": 4, "action": "…", "framing": "…", "camera": "…", "sound": "…" }
    ],
    "endState": "…",
    "throughout": ["the blanket stays solid sage green with a cream sherpa reverse"]
  }
}
```

`source` 是本地文件（相对任务目录或仓库根目录）或 https 地址。本地图在出片时会传到我们自己的存储，换成公开地址给 Shuyu。

## 写脚本的规矩

- **全程英文。** 台词例外：放在英文双引号里，写商家要的原文，模型会逐字念。
- **六项都要想，不必都写。** `action` 主体与表演、`framing` 构图、`camera` 摄影机、`sound` 声音每个镜头必写；
  `space` 空间与调度、`light` 光色镜头 1 必写，后面的镜头没变就不写（等于沿用），变了才写。
- **一拍一个主动作、一个机位意图。** 出现 then / after that 就该拆成两个镜头。
- **时间用整数秒，首尾相接，正好铺满。** 留空档模型会自己加戏，塞太满会多切或丢拍。
- **硬切写明白。** 镜头开头写 Hard cut；要特别的转场就写清触发时刻和做法。常见运镜（push、pull、pan、track、orbit、handheld）直接写名字，
  冷门的要写出看得见的效果（rack focus：什么变虚、什么变实）。写了镜头高度更稳（at sofa-seat height）。
- **只写「快」会乱。** 写 fast but controlled。又快又稳这类互相矛盾的要求别同时给。
- **首帧放在主动作发生之前。** 开场帧和 `openingState` 都不提前露出结果。
- **参考图各管一件事。** `role` 写清这张图管什么、不继承什么。参考图已经说清的，提示词里指过去就行，别再用文字描述一遍。
- **抽象形容词模型拍不出来。** beautiful、cinematic、premium、dynamic 这些词换成看得见的东西：光从哪来、材质怎么动、镜头在哪。
- **全程要求用正面描述写（`throughout`）。** 否定句模型只在字幕和声音上听话。不写 never show a face，
  写 only hands, arms and the back of the head are seen。「不要字幕、不要画面文字」脚本会自动加。
- **避开清晰正脸。** 我们的故事板帧里有清楚正脸时 Seedance 整单拦下过（10-29 评测 5 条全败）。用手部、侧背、过肩或商品主体。
- **商品上的字和 logo 不要让模型重画。** 别给特写到能看清每个字的镜头：重画的字会糊。
- **提示词紧凑。** 目标每秒不超过 240 字（15 秒约 3,600 字；六镜头的快销片压到 3,300 字上下就没有重复内容了），硬上限 4,800。超了就删重复的空间与光色、并镜头，不靠截断。

## 声音

- **口播的声音只描述一次**，写在 `voice`：语言、性别与年龄感、语气、收音感（close-mic）。
- **台词写在它被念出来的那个镜头的 `sound` 里**，一个镜头一句短的。中文按每秒 4 个字估，快销片最多每秒 5 个字；念不完 `check` 会提醒。
- **一条片一个说话的人。** 说话的时候别给这个人写点头、转身这类动作。
- **配乐写在 `music`**：风格、速度、乐器、走向。快销片的切点跟拍子。
- **音效对着画面写**：每个声音都对应一个看得见的东西（按下去的布料声、抖开的呼声），想卡点就写在对应镜头里。
- 最后一句台词别贴着片尾：给结尾留半秒以上，不然会被截断。

## 看故事板帧（定稿之前）

- 商品的结构、比例、颜色、材质和实拍图对得上，没有多出或少掉部件。
- 商品颜色没被场景光染偏（暖色台灯会把灰绿染成黄绿）：两张都合格时选颜色更贴近实拍图的那张。
- 商品上的文字、logo 没有乱码或变形。
- 没有清晰正脸；手指数量和姿势正常。
- 构图给后面的动作留了空间，画面是首态，结果还没发生。
- 片种对得上：快销片的开场帧要亮、商品要大。成片的气质在这一帧就定了，暗的开场帧出不了明快的片。
- 没有画面内文字、水印、拼图边框。

有一项不过就不定稿。改提示词比多抽几张有用。

## 看成片（交付之前）

- 分辨率与时长：`video` 结束时会打印量出来的宽高、时长、有没有声音。
- **节奏对不对片种**：快销片数一下实际切了几个镜头，有没有哪一段拖。
- 商品从头到尾没有走样，颜色在暗处没有发白或偏色，动作按时间线发生，没有多出脚本外的情节。
- 每个镜头是不是脚本写的那个镜头（模型常把最后一个镜头拍回开场帧的样子）。
- 画面里没有死黑、大块空白这类废掉的区域。
- 台词：你听不了，只能查音轨有没有在片尾被截断。**念得对不对请用户听**，汇报里要说明这一点。
- 最后一秒是 `endState`，不是动作中途。

向用户汇报时说清楚：用了哪一档、花了多少点、哪几项过了、哪里不满意。不满意就说不满意，并给出重拍打算改什么。重拍一次只改一个方向，不然分不清是哪一处起的作用。

## 花钱的规矩

- **出片默认 Seedance 2.5 · 720P**，按这条片的时长取最便宜的一档（15 秒是特价方案 113，1,500 点按条计；5 秒以下是按秒的 VIP 档更便宜）。
  1080P 是 420 点/秒，15 秒 6,300 点，11-16 定了不用；用户明确要才加 `--resolution 1080P`。
- **`video` 每次都要 `--confirm-spend --max-points <上限>`**，脚本会估算、比上限、比余额（留 7,000 点预留线），三关都过才提交。
- **真机花点要用户点头。** 第一次给某个商品出片、或者要重拍，先把估算告诉用户再提交。
- 当场被拒不扣点，脚本会自动换同分辨率的下一档；受理后失败会停下来等你看原因，不会自动再花一次。
- 故事板帧走 OpenAI 的余额，一次最多 8 张（`--max-images` 可改）。

## 边界与没验证的事

- 不碰数据库：脚本把 `DATABASE_URL` 换成了连不上的地址。成片要进成品库是另一件事，先问用户。
- 不用 demo 账号、不做 mock：这条线路只走真实供应商。
- 套餐与价目会漂移：以 `check` 当场打印的阶梯为准，不要照抄本文件里的数字。
- **开场帧只是近似。** Seedance 2.5 的首帧严格匹配要靠接口里的首帧角色，Shuyu 的接口只收一串参考图、没有角色字段；
  我们把开场帧排在最后并在提示词里说明，11-16 实测成片的第一个画面接近开场帧但不逐像素一致。Shuyu 有没有首帧模式还没问过。
- 提示词规则里有一部分来自 Seedance 2.0 的经验或转述的官方 2.5 指南（2026-08 的快照），没有逐条在我们这条线路上验证过。
  成片和规则对不上时，以成片为准，并回来改这份文件。

## 来源

- 10-29 吸收的 Kelin 团队做法：`docs/roadmap/2026-10-29-kelin-workflow-lessons.md`。
- Seedance 2.5 官方提示词指南的转述（提示词顺序、整数秒时间码、否定句的适用范围、转场写法）：`EVZheng-Lab/h3-seedance-prompt`。
- 开源 skill 里借鉴的做法，只取做法、不搬原文：`liangdabiao/ecom-video-seedance-prompt`（带货片结构、材质写法）、
  `LeoYeAI/seedance-skills`（MIT；商品镜头与出片前自查）、`zhouwei713/seedance-prompt`（MIT；抽象词换成物理现象、声音对着画面写）、
  `op7418/seedance-product-video` 与 `timkoda/seedance-skill`（口播与运镜的写法）。
- 纯逻辑在 `scripts/lib/director-plan.ts`（有 `tests/director-plan.test.ts`），命令在 `scripts/director/run.ts`。
