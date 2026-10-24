---
name: Aivora 增长交易台（Exchange）
description: 提案 · 待 CEO 批准 —— 零彩度终端黑的增长交易台：1px 接缝拼板、唯一的余烬信号、实时成交带。生产仍运行 Aivora Glass。
colors:
  ink-0: "#0a0b0d"
  ink-1: "#101215"
  ink-2: "#15181c"
  ink-3: "#1c2025"
  ink-4: "#262b32"
  seam: "rgb(226 232 240 / 0.075)"
  seam-2: "rgb(226 232 240 / 0.14)"
  seam-3: "rgb(226 232 240 / 0.22)"
  bone: "#ecebe7"
  ash: "#a3a9b1"
  dust: "#7c828b"
  ember: "#ff4d00"
  ember-hi: "#ff6a26"
  ember-ink: "#140801"
  ember-08: "rgb(255 77 0 / 0.08)"
  ember-16: "rgb(255 77 0 / 0.16)"
  ember-40: "rgb(255 77 0 / 0.42)"
  steel: "#8fa1b9"
  steel-30: "rgb(143 161 185 / 0.3)"
  paper: "#f3f2ee"
  paper-2: "#e7e5df"
  paper-ink: "#16181b"
  paper-mute: "#5b6068"
  paper-line: "rgb(22 24 27 / 0.12)"
  paper-card: "#fcfbf8"
  ember-hot: "#ffd2b8"
  key-bevel-hi: "rgb(255 255 255 / 0.32)"
  key-bevel-lo: "rgb(0 0 0 / 0.22)"
  shadow-deep: "rgb(0 0 0 / 0.9)"
  qr-white: "#ffffff"
typography:
  display-figure:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "clamp(64px, 7vw, 112px)"
    fontWeight: 200
    lineHeight: 0.84
    letterSpacing: "-0.035em"
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 80"
  figure:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "46px"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 84"
  headline:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13.5px"
    fontWeight: 500
    letterSpacing: "-0.01em"
    fontFeature: "'tnum'"
  data-sm:
    fontFamily: "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "-0.01em"
    fontFeature: "'tnum'"
  led:
    fontFamily: "Doto, IBM Plex Mono, monospace"
    fontSize: "16px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.02em"
  booth-ui:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  booth-input:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1.4
  booth-sub:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.35
  booth-lead:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.45
  booth-h3:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.3
  booth-title:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.25
  booth-phone-h:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.2
  booth-hub-h:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 500
    lineHeight: 1.15
rounded:
  tag: "4px"
  xs: "5px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  frame: "12px"
  booth-card: "14px"
  booth-bubble: "16px"
  booth-phone: "28px"
  pill: "999px"
spacing:
  seam: "1px"
  gap-xs: "6px"
  gap-sm: "8px"
  gap-md: "12px"
  row-y: "14px"
  panel-x: "16px"
  head-x: "20px"
  board-x: "24px"
components:
  button-key:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.ember-ink}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-key-hover:
    backgroundColor: "{colors.ember-hi}"
    textColor: "{colors.ember-ink}"
  button-key-go:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.ember-ink}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 16px"
  button-key-commit:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.ember-ink}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 12px"
  button:
    backgroundColor: "{colors.ink-3}"
    textColor: "{colors.bone}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-hover:
    backgroundColor: "{colors.ink-4}"
    textColor: "{colors.bone}"
  button-ghost:
    textColor: "{colors.ash}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-ghost-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.bone}"
  button-sm:
    rounded: "7px"
    height: "28px"
    padding: "0 10px"
  chip:
    textColor: "{colors.ash}"
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 8px"
  chip-ember:
    backgroundColor: "{colors.ember-08}"
    textColor: "{colors.ember}"
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 8px"
  chip-steel:
    textColor: "{colors.steel}"
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 8px"
  level-tag:
    textColor: "{colors.bone}"
    rounded: "{rounded.xs}"
    height: "20px"
    padding: "0 6px"
  badge:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.ember-ink}"
    rounded: "{rounded.pill}"
    height: "18px"
    padding: "0 6px"
  input-search:
    backgroundColor: "{colors.ink-1}"
    textColor: "{colors.bone}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 10px"
  nav-item:
    textColor: "{colors.ash}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 10px"
  nav-item-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.bone}"
  nav-item-active:
    backgroundColor: "{colors.ink-3}"
    textColor: "{colors.bone}"
  segmented:
    backgroundColor: "{colors.ink-0}"
    rounded: "{rounded.md}"
    padding: "2px"
  segmented-active:
    backgroundColor: "{colors.ink-3}"
    textColor: "{colors.bone}"
    rounded: "{rounded.sm}"
    height: "26px"
    padding: "0 10px"
  seam-wall:
    backgroundColor: "{colors.seam}"
    rounded: "{rounded.frame}"
  panel:
    backgroundColor: "{colors.ink-1}"
    textColor: "{colors.bone}"
    padding: "16px"
  page-header:
    backgroundColor: "{colors.ink-0}"
    textColor: "{colors.bone}"
    padding: "18px 20px"
  tape:
    backgroundColor: "{colors.ink-1}"
    textColor: "{colors.ash}"
    height: "34px"
  status-bar:
    backgroundColor: "{colors.ink-0}"
    textColor: "{colors.dust}"
    height: "30px"
  toast:
    backgroundColor: "{colors.ink-3}"
    textColor: "{colors.bone}"
    rounded: "{rounded.lg}"
    padding: "11px 14px"
---

> **提案状态：待 CEO 批准。** 本文件记录的是「增长交易台 / Exchange」视觉世界，事实来源是同目录下的原型 `designs/aivora-v2-exchange/index.html`。
>
> **生产环境仍然运行 Aivora Glass。** 它由三处共同定义并守护：根目录 `DESIGN.md`（唯一事实来源）、`CLAUDE.md` §6、以及玻璃门禁测试。采纳本提案，意味着在**同一个变更**里把这三处一起改写；在那之前，`src/` 里的任何代码都不得照本文件实现，本文件的 token 也不得写进 `src/styles/tokens.css`。

# Design System: Aivora 增长交易台（Exchange）

## Overview

**Creative North Star: "增长交易台（The Growth Exchange）"**

增长被当成一张实时交易台来读：每条成片是一笔持仓，每条询盘是一笔成交回报。界面的骨架是交易终端 —— 顶栏和实时成交带横跨全宽，左栏是导航与「自选 Mission」，右侧主盘由石墨面板以 1px 接缝拼成一面墙，底部状态栏常驻写明数据口径。信息密度高，数字多，但每个数字都要说清它从哪来：实测、估计、AI 建议，还是缺失。

材质是不透明的机加工石墨：零彩度墨阶由暗到亮分层，面板之间不留空隙只露接缝，面板顶缘一道 1px 高光。颜色几乎全部退出界面：唯一的信号色是余烬橙，静止时只说「上涨」或「需要你处理」，动起来（呼吸脉冲、沿边光束）时只说「Agent 正在为你干活」；钢灰是它的反面，说「下跌 / 闲置」。屏幕上其余的颜色只来自真实成片画面。

这个世界明确拒绝「发光渐变 + 卡片格」的 AI 仪表盘，也拒绝白底 SaaS 模板。它与生产中的 Aivora Glass 是两个世界：Glass 靠半透明模糊材质和随批次抬升的环境光场；Exchange 不透明、不做 backdrop 模糊、没有环境光。两套 token 和规矩不能混用。

**Key Characteristics:**
- 零彩度终端黑墨阶（ink-0 → ink-4），只有极轻的冷偏。
- 接缝拼板墙：面板之间只有 1px 接缝，整面墙只有一个 12px 圆角外框。
- 面板顶缘一道机加工高光（`--edge`），不靠投影分层。
- 唯一的余烬信号；钢灰做反信号；涨跌靠「颜色 + 三角」成对表达，不用红绿。
- 细而窄的 Archivo 大数字、IBM Plex Mono 数据列、只在成交带出现的 Doto 点阵数字。
- 每个指标都带数据口径标记；「已发布」必须指得到平台回传的帖子 ID。
- 动效只服务实时性：成交带滚动、引擎脉冲、生成光束、领先成片的静音循环。

## Colors

零彩度墨阶加一个余烬信号、一个钢灰反信号；除此之外的颜色只来自成片画面。

### Primary
- **余烬橙 Ember** (#ff4d00)：全站唯一的信号色。上涨的增量与三角、领先的成片（排名、行洗底、当日柱）、待你处理的数字与徽标、主操作键、审片警示标记、实测曲线、引擎脉冲与生成光束、品牌标记、焦点环、输入光标。在 ink-1 上对比 5.64:1。
- **余烬亮面 Ember Hi** (#ff6a26)：只用于余烬键的悬停态。
- **余烬墨 Ember Ink** (#140801)：余烬面上的一切前景 —— 键上文字、徽标数字、品牌标记图形。对比 5.93:1；白字只有 3.33:1，不许用。
- **余烬洗底 Ember 08** (rgb(255 77 0 / 0.08))：领先行的横向洗底、「等你批准」格的纵向洗底、等你处理的步骤图标底、余烬 chip 底、选中的审片变体、取消确认框。
- **余烬闪光 Ember 16** (rgb(255 77 0 / 0.16))：新成交回报到达时的一次性闪光、领先行悬停、警示刻度的填充。
- **余烬描边 Ember 40** (rgb(255 77 0 / 0.42))：余烬 chip、等级标签 L3、选中变体、进行中步骤图标的描边；文字选区底；脉冲扩散的起始色。

### Secondary
- **钢灰 Steel** (#8fa1b9)：余烬的反信号，不是第二强调色。下跌三角、「降低投放」、已暂停 / 已取消的 Mission、等平台审批的渠道；图表里的目标进度线（参照线）。`steel-30`（rgb(143 161 185 / 0.3)）只做钢灰 chip 的描边。在 ink-1 上对比 7.12:1。

### Neutral
- **地板 Ink 0** (#0a0b0d)：页面底、顶栏、状态栏、页头面板；所有「下沉井」—— 引用块、草稿框、分段控件槽、深度条轨道、节点底；已处理完的委托单退回地板色。
- **面板 Ink 1** (#101215)：所有面板、成交带、搜索框。
- **悬停 Ink 2** (#15181c)：表格行、导航行、收件项的悬停；对话气泡。
- **凸起 Ink 3** (#1c2025)：默认按钮、选中的导航 / 分段 / 收件项、未达成的进度轨、媒体加载前的底色、toast。
- **凸起悬停 Ink 4** (#262b32)：默认按钮悬停、滚动条滑块。
- **接缝 Seam** (rgb(226 232 240 / 0.075))：面板之间露出的接缝，以及面板内的一切分割线。
- **控件描边 Seam 2** (rgb(226 232 240 / 0.14))：按钮、chip、头像、渠道标签、草稿框的描边。
- **强描边 Seam 3** (rgb(226 232 240 / 0.22))：悬停按钮、强调 chip、等级标签、成交链连线、未激活的迷你柱。
- **骨白 Bone** (#ecebe7)：正文与数字的主色，也是一切「已完成」状态的颜色（已完成步骤、管线已过阶段、发布已完成段、预算进度条）。在 ink-1 上 15.73:1。
- **灰白 Ash** (#a3a9b1)：次级文字、元信息、默认 chip、AI 估计的虚线。在 ink-1 上 7.92:1。
- **尘灰 Dust** (#7c828b)：第三级文字 —— 时间戳、计数、表头、不可用或「以后再做」的项。在 ink-1 上 4.84:1，但在 ink-3 上只有 4.23:1。

墨阶并非绝对零彩度：OKLCH 彩度 0.005–0.015、色相约 256°，是一层几乎察觉不到的冷偏；骨白则微微偏暖。不要再往墨阶里加彩度。

### Named Rules
**The Two Words Rule.** 静止的余烬只说两件事：「上涨」或「需要你处理」；动起来的余烬（脉冲、光束、呼吸点）只说「Agent 正在为你干活」。此外它只出现在品牌标记、焦点环、输入光标和文字选区上。完成态一律用骨白，不用余烬。

**The Direction Not Verdict Rule.** 涨跌不用红绿。上涨 = 余烬 + 上三角，下跌 = 钢灰 + 下三角，颜色与形状永远成对出现。颜色编码的是数字的方向，不是好坏：本稿里「每条询盘成本下降」同样是钢灰下三角，好坏由标签说。（原型声明了 `.d-good` 却没有使用；成本类指标是否改用余烬，留给评审决定。）

**The Footage Is the Only Color Rule.** 除余烬与钢灰外，屏幕上的色彩只能来自真实成片与产品图：9:16 缩略图、领先成片的静音循环、成交链第一环、审片播放器。界面不为渠道、分类、状态另配色相 —— IG / FB 用等宽字描边标签和单色图标表示。

## Typography

**Display Font:** Archivo（可变字宽 wdth 62–125、字重 100–900），回退 Noto Sans SC / PingFang SC / Microsoft YaHei / system-ui
**Body Font:** Archivo 负责拉丁字形，Noto Sans SC（300 / 400 / 500 / 700）负责中文，同在一条字体栈里
**Label/Mono Font:** IBM Plex Mono（400–600）负责数据；Doto（900，点阵）只负责成交带里的数字

**Character:** Archivo 把大数字压窄、压细，像交易所报价板上的细体刻度；IBM Plex Mono 让每一列数字严格对齐；Doto 的点阵只在跑马带里亮起，像一块 LED 行情屏。中文不另设标题字体，由 Noto Sans SC 在同一条栈里承担。

### Hierarchy
- **Display Figure** (200, clamp(64px, 7vw, 112px), 0.84, 字宽 80%)：每个视图至多一个 —— 交易台的「本周有效询盘」、Mission 的「累计有效询盘」。尾随的单位（如「/ 40」）缩到 0.32em、字重 300、灰白。≤520px 时固定 76px。
- **Figure** (300, 46px, 1, 字宽 84%)：报价头其余各格；成交链总结放大到 60px，意向分 44px，预约时间 40px。前缀单位（C$）缩到 0.42em、灰白。需要你处理的数字改为余烬色。
- **Headline** (500, 28px, 1.15, -0.02em)：视图标题；Mission 标题放到 30px。用 `text-wrap: balance`，标题旁的编号（CR-2302 / M-0412）用 18px 等宽尘灰。
- **Title** (500, 14px, 1.5)：面板标题，后接 12.5px 尘灰计数。
- **Body** (400, 14px, 1.5)：正文；委托单、对话与假设说明用 13.5px / 1.55。
- **Label** (400, 12.5px, 1.5)：元信息行、面包屑、成交带文字。表头 11.5px / 500 / 字距 0.02em，不大写。
- **Data** (IBM Plex Mono 500, 13.5px, tabular)：表格数值。12px 用于 ID、时间戳、Mission 代号；10.5px 用于渠道标签和图表刻度。

### Named Rules
**The Thin Figure Rule.** 大数字一律细（200 / 300）、窄（字宽 80–84%）、负字距、等宽数字。不用粗体大数字，也不把大数字换成等宽字体。

**The Tape-Only LED Rule.** Doto 点阵只出现在实时成交带里，字重 900，字号不小于 16px。其他任何地方的数字都用 IBM Plex Mono 或带 tabular-nums 的 Archivo。

**The Every Digit Aligns Rule.** 所有数字都是等宽数字：数据单元格、ID、时间戳、金额用 IBM Plex Mono；以 Archivo 排出的数字（面板计数、大数字、收件箱时间）也必须开 tabular-nums。

**The Unambiguous Glyph Rule.** 用来排 ID、配方名、代号的等宽字体，在 11px 下必须让 i / 1 / l、M / H 一眼分得开。原型先用过 Azeret Mono，11–12px 时 `i` 读成 `1`（`tpl:demo-first` 显示成 `f1rst`），所以换成 IBM Plex Mono；Doto 点阵也出过 `M` 读成 `H`，所以点阵只写数字与 `+ / : , .`，从不写字母和 ID。换数据字体前，先在 11px 下核对这几组字形。

## Layout

**壳层。** 一张 CSS grid：两列（236px 左栏 + 主盘），四行（52px 顶栏 / 34px 成交带 / 主盘 / 30px 状态栏），顶栏、成交带、状态栏横跨全宽。主盘内边距 22px 24px 40px，最大宽 1640px，独立滚动。

**接缝拼板墙。** 每个视图是一面墙：外框 1px seam 描边、12px 圆角、`overflow: hidden`；墙内所有面板以 `gap: 1px` 排在 seam 色底上 —— 接缝就是露出来的底色。面板内部再分区时，用 1px seam 边线而不是间距。常用的墙内网格：报价头 2.3fr + 3×1fr；主网格 1fr + 372px（右侧待批委托）；双栏 1.25fr + 1fr；审片 124px + 1fr + 380px；收件箱 340px + 1fr + 300px。

**节奏。** 面板左右内边距 16px，列表行上下 14px；页头、报价头、Mission 头、线索头用 18–20px × 20px；控件之间 6–8px；面板标题栏最小 46px 高。

**响应式。**
- ≤1360px：主网格的待批委托、收件箱的上下文栏、审片的回执栏都落到下方整行。
- ≤1100px：报价头首格独占一行，其余三格并排；双栏变单栏；顶栏的预算条隐藏。
- ≤860px：壳层改为单列文档流；顶栏 sticky；左栏变为底部固定标签栏（52px 高、ink-0 96% 不透明、不模糊），自选 Mission 和状态栏隐藏；所有贴边内边距取 `max(16px, env(safe-area-inset-*))`。
- ≤520px：大数字固定 76px，漏斗列收窄。

状态栏在 ≤860px 隐藏后，口径图例目前没有移动端落点（只有示例数据声明以页脚文字补位），采纳前要补上。

### Named Rules
**The Seam Wall Rule.** 面板与面板之间不留空隙，单个面板不各自加圆角或投影：只有 1px 接缝，整面墙只有一个圆角外框。面板内部可以有媒体条带和单个下沉井（草稿框、引用块、取消确认框），但面板本身永远不浮起成卡片。

## Elevation & Depth

扁平 + 色阶分层。深度靠墨阶表达（ink-0 地板 → ink-1 面板 → ink-2 悬停 → ink-3 选中 / 凸起 → ink-4 凸起悬停），再加面板顶缘的一道机加工高光。没有 backdrop 模糊，没有环境光场，面板不投影。

### Shadow Vocabulary
- **机加工顶缘 Edge** (`box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.075)`)：每个面板、选中的导航项、选中的分段按钮、审片变体栏、toast。
- **实体键斜面 Key Bevel** (`box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.32), inset 0 -2px 0 rgb(0 0 0 / 0.22), 0 1px 2px rgb(0 0 0 / 0.5)`)：只给余烬键。品牌标记用同一语法的内斜面（`inset 0 1px 0 rgb(255 255 255 / 0.3), inset 0 -2px 0 rgb(0 0 0 / 0.25)`），不带外投影。
- **浮层投影 Float** (`box-shadow: 0 18px 40px -18px rgb(0 0 0 / 0.9), inset 0 1px 0 rgb(255 255 255 / 0.075)`)：只给 toast。
- **画面投影 Player** (`box-shadow: 0 24px 60px -30px rgb(0 0 0 / 0.9)`)：只给审片播放器 —— 成片浮在墙面之上。

### Named Rules
**The Machined Edge Rule.** 面板靠顶缘一道 7.5% 白高光显出厚度，不靠投影。投影只属于真正浮在墙外的东西：toast 与审片播放器。

## Shapes

圆角是一条短阶梯，按物件的尺度取值：
- **外框** (12px)：接缝墙外框，以及墙内独立的大容器 —— 草稿框、发送回执、审片播放器、对话气泡（气泡左上角收成 4px，指向发言人）。
- **瓦片** (10px)：审片变体、成交链节点、toast、取消确认框。
- **控件** (8px)：按钮、搜索框、工作区切换、导航行、分段槽、引用块、胶片框。小按钮 7px。
- **小件** (6px / 5px / 4px)：分段按钮、事实标签、小媒体框 / 表格缩略图、键帽、等级标签、深度条轨 / 渠道标签、进度条、审片标记的文字签。
- **药丸** (999px)：只给 chip、徽标、示例数据标记；头像正圆。

墙内面板本身是直角，它们的圆角由外框裁出来。原型 `:root` 里声明的 `--r-sm / --r-md / --r-lg`（6 / 10 / 14px）没有被任何规则使用，14px 从未出现；以上阶梯以实际用值为准。

反复出现的几何：
- **9:16 竖幅** 是媒体的唯一比例：表格缩略图 34×60、委托单来源 18×32、胶片 112 宽、审片变体、成交链第一环 54×96、播放器最大 380 宽。
- **涨跌三角**：7×6px 的 clip-path 三角，跟随文字颜色，贴在增量数字前。
- **口径符号**：实心圆、空心圆、旋转 45° 的虚线方块（菱形）、短横 —— 只靠形状区分，不靠色相。
- **灰白虚线 = AI 推测**：口径菱形、图表的 AI 预测线、图例里的 AI 估计样线都用灰白虚线。

## Components

### Buttons
干净的机加工按键，只有主键像一颗真实的键帽。
- **Shape:** 控件圆角（8px），32px 高，内边距 0 12px，Archivo 500 13px，1px seam-2 描边。
- **余烬键 Key:** 余烬底、余烬墨字、字重 600、实体键斜面；悬停换余烬亮面。三个尺寸：32px（默认）、36px / 内边距 0 16px（委托单里那一件主批准）、40px / 14px 字（发布回执的「批准并发布」，可横向伸展）。
- **默认 Default:** ink-3 底、骨白字；悬停 ink-4 + seam-3 描边；按下下沉 1px；禁用 42% 不透明度。
- **幽灵 Ghost:** 无底无边、灰白字；悬停 ink-2 底 + 骨白字。用于退路与次级跳转：「转人工」「不发，保留素材」「全部 12 条 →」。
- **线框 Line:** 透明底但保留 seam-2 描边，用于次级入口（新建 Mission、取消 Mission）。
- **Small:** 28px 高、0 10px、12.5px 字、7px 圆角。

**The One Key Rule.** 每个面板同一时刻最多一颗余烬键，它就是店主此刻最该按的那一下：批准发送、批准并发布、去审片、标记已上门量尺、确认取消。同一列表里其余的批准按钮降为默认小按钮。

**The Way Back Rule.** 每颗余烬键旁边都有退路：「不发，保留素材」「只重抽镜头 2」「转人工」「继续运行」「先不动」。取消确认框要写清停掉什么、照实记账多少、保留哪些成片与素材、清掉哪个提交标识。

### Chips
- **Style:** 22px 高药丸，11.5px / 500，1px seam-2 描边，灰白字；内嵌图标 12px。
- **余烬 chip：** 余烬字、ember-40 描边、ember-08 底 —— 领先、购买意向、运行中、待审。
- **钢灰 chip：** 钢灰字、steel-30 描边 —— 降低投放、已暂停、已取消、等平台审批。
- **骨白 chip：** 骨白字、seam-3 描边 —— 赛马中、生成中。生成中的 chip 写等宽进度「生成中 3/4」，前置 6px 余烬呼吸点（1.6s）。
- **等级标签 L2 / L3：** 20px 高、5px 圆角、IBM Plex Mono 600 11px、seam-3 描边骨白字；L3（价格 / 售后转人工）改余烬字 + ember-40 描边。
- **渠道标签 IG / FB：** IBM Plex Mono 600 10.5px、4px 圆角、seam-2 描边、灰白字。
- **徽标：** 余烬药丸、余烬墨 IBM Plex Mono 600 11px、行高 18px —— 只计「待你处理」的件数。

### Inputs / Fields
- **Style:** 搜索框 32px 高、ink-1 底、1px seam 描边、8px 圆角，占位符尘灰；右侧 ⌘K 键帽为 IBM Plex Mono 11px、seam-2 描边、5px 圆角。
- **草稿框：** 一个下沉井（ink-0 底、seam-2 描边、12px 圆角），内含透明 textarea（骨白 14px / 1.6，可纵向拉伸）、中文对照、引用的已核验事实标签、护栏说明、操作行，各段之间 1px seam。
- **Focus:** 全局 2px 余烬描边、偏移 2px（焦点即当前项）；输入光标余烬；文字选区 ember-40 底 + 骨白字。
- **Checkbox:** `accent-color` 取余烬；不可用的渠道整行尘灰、`not-allowed`，并写明原因（「未授权 · 待平台审批」）。

### Navigation
- **左栏（236px）：** 导航项 34px 高、13.5px 灰白字、16px Lucide 图标（描边 1.6）；悬停 ink-2 + 骨白；当前项 ink-3 + 骨白 + 机加工顶缘。右侧挂徽标（待处理件数）或尘灰计数；尚未开放的项整行尘灰，点击给提示而不是跳转。
- **自选 Mission：** 每行四件事 —— 等宽代号（12px 灰白）、等宽进度值（12px 骨白，领先时用余烬上三角）、标题（13px 骨白，单行省略）、3px 进度条（灰白；正在运行的 Mission 用余烬）。
- **顶栏（52px, ink-0）：** 26px 余烬品牌标记（7px 圆角、键帽内斜面、余烬墨图形）、工作区切换（带真实缩略图）、搜索、引擎状态（7px 余烬脉冲 + 「引擎运行中 · N 条生成中」）、本月预算（196px 宽、整行不换行，等宽金额 + 4px 骨白进度条；≤1100px 隐藏）、头像。
- **状态栏（30px, ink-0, 11.5px 尘灰）：** 口径图例、同步时间、回复模式、生成队列，用 1×12px seam-2 竖线分组。
- **移动端：** 左栏变为底部固定标签栏，每项 52px 高、图标在上文字在下、11px 字，徽标浮在右上角。

### Seam Wall & Panels
- **墙：** 见 Layout 的 The Seam Wall Rule。视图切换时整面墙 0.42s 入场（不透明度 0.4 → 1、上移 6px，`cubic-bezier(0.16, 1, 0.3, 1)`）。
- **面板：** ink-1 底 + 机加工顶缘。标题栏最小 46px、左右 16px、底部 1px seam，左起标题（14px / 500）+ 尘灰计数，工具组靠右。面板体 16px。
- **页头面板：** ink-0 底、18px 20px，标题 + 一行灰白副标题，右侧放分段控件或线框按钮。
- **下沉井：** ink-0 底 + 1px seam 描边，8px（引用块）或 12px（草稿框、发送回执）。

### 实时成交带 Live Tape
本世界的签名部件：一条 LED 行情屏，只播真实的业务事件。
- 34px 高、ink-1 底、底部 1px seam。左端固定标签格（余烬脉冲 + 「实时成交」），右侧以 1px seam 隔开。
- 轨道 70s 匀速左移、内容复制一份无缝循环；悬停暂停；两端 32px / 48px 渐隐遮罩。
- 每条回报：左右 18px、12.5px 灰白字、之间 1px seam；人名与编号骨白 500；数字用 Doto 16px（新询盘的「+1」为余烬）；方向词前带涨跌三角。
- 新回报插到最前，1.4s 内从 ember-16 底闪回透明。
- 内容只能是业务事件：询盘、预约、播放、预算调整、发布确认、报价、分诊。
- 减少动效时停止滚动，改为可横向滚动的静态条。

### 报价头 Quote Header
- 一个面板内四格，格间 1px seam；首格 2.3fr，放 Display Figure 与本周曲线并排，其余三格各一个 Figure。
- 每格的标签行都以口径标记开头；下方元信息行放涨跌增量和来源拆分。
- 末格「等你批准」整格是链接：ember-08 → 透明（70%）的纵向洗底，数字为余烬色，元信息拆分到回复 / 上架 / 预算。

### 成片赛马榜 Race Table
- 粘性表头 36px、11.5px 尘灰、数值列右对齐；行内边距 10px 12px、底部 1px seam、悬停 ink-2，整行可点。
- 成片列：34×60 的 9:16 缩略图（5px 圆角）+ 14px / 500 标题 + IBM Plex Mono 11.5px 尘灰的「编号 · 时长」（如 `CR-2291 · 15s`）+ 一行渠道标签，配方名跟在渠道标签后面（11px 等宽尘灰，去掉 `tpl:` 前缀，如 `warm-living@v3`）。
- 本周询盘列：5 根 5px 宽的迷你柱（seam-3，当日骨白）+ 合计数字。
- **领先行：** 横向 ember-08 洗底（到 46% 消失）、排名余烬、当日柱余烬，缩略图常驻播放静音循环。其余有循环片的缩略图在悬停时才换成视频。
- **已暂停行：** 整行尘灰。**生成中行：** 缩略图套生成光束，排名与数值为尘灰「—」，询盘列写「等待发布」。
- 实时更新的数字用 1s 闪光（余烬字 + ember-08 底 → 透明）提示变化。

### 数据口径标记 Provenance Marks
- 7px 符号：**实测** = 骨白实心圆；**估计** = 1.5px 灰白空心圆；**AI 建议** = 1.5px 灰白虚线方块旋转 45°（菱形）；**缺失** = 9×1.5px 尘灰短横。
- 出现位置：报价头每格标签、日志每行行尾、知识条目、需求判断的证据列表、成交链每一环（「平台回传」「系统记录」）、面板工具区的口径声明 chip、状态栏图例。

**The Say Where It Came From Rule.** 每个指标、每条日志、每条知识、每条证据都带口径标记。图表里实测是实线，AI 估计是灰白虚线外加 8% 灰白区间带；图例常驻状态栏。

### 发布三态 Publish State
- 回执面板里一行三段：已提交 / 平台接收 / 已发布。每段一根 4px 条 + 12px 文字：未到为 ink-3 条 + 尘灰字，已过为骨白条 + 骨白字，正在等待的那一段为余烬条。
- 下方说明行逐段改写（「已提交给发布服务，等待平台接收…」→「IG 与 FB 已接收，正在处理视频…」→「已发布 · IG 帖子 ID …」）。
- 主键在流程中禁用，完成后变为「已发布」并联动关闭对应委托单、插入一条成交回报。

**The Post ID Rule.** 只有拿到平台回传的帖子 ID 才能写「已发布」；回复同理，拿到回复 ID 才能写「平台已确认」。在那之前最多写「已提交」或「平台接收」。成交带、日志、委托单结果、成交链里任何一处写「已发布」，都必须指得到那个 ID。

### 生成光束 Beam
- 套在元素的 `::after` 上：1.5px 的环（`mask-composite` 镂空内容区），填充为从 `--beam` 角度起算的锥形渐变 —— 0–62% 透明，72% 处余烬 20%，86% 处纯余烬，92% 处淡橙高光（#ffd2b8），然后回到透明；`@property --beam` 驱动 2.4s 匀速旋转，圆角继承宿主。
- 用在：生成中的缩略图、胶片框、审片变体，以及 Mission 里正在实时推进的步骤图标。
- Mission 暂停时光束停转并降到 45% 不透明度；减少动效时变成静态余烬环（60% 不透明度）。

**The Beam Means Working Rule.** 光束只套在机器此刻正在干活的东西上，完成即撤；不用于装饰、悬停或强调。

### 委托单 Approval Ticket
- 待批委托的一张单：首行（类型 灰白 500、等级标签或「AI 建议」chip、靠右的等宽时间）、正文 13.5px / 1.55 骨白、可选引用块（下沉井）、来源行（18×32 缩略图 + 尘灰说明）、操作行（主批准 / 改一下 / 幽灵退路）。
- 处理后整单退回 ink-0 底，操作、引用、来源隐藏，正文转灰白，出现结果行（勾 + 结果文字 + 等宽时间）；所有「待批准」计数（徽标、报价头、副标题）同步减一并闪光。结果行的勾应为骨白（见 The Two Words Rule）。

### Charts
- 内联 SVG，不引图表库。实测序列：余烬 1.75–2px 折线 + 余烬 22–26% → 0 的面积渐变；当前点 4–4.5px 余烬实心 + 9–10px 35% 余烬光环 + 余烬数值标签。
- AI 预测：灰白 1.25px 虚线（3 4）+ 8% 灰白区间带。目标进度：钢灰 1.25px 实线，端点钢灰数值。
- 网格线 seam 色（7%）；刻度 IBM Plex Mono 10.5px 尘灰，「今天」那一格刻度为骨白。

### Toast
- 固定在右下、状态栏之上；ink-3 底、seam-3 描边、10px 圆角、浮层投影；13.5px 字、内边距 11px 14px、最大宽 420px。
- 0.4s 自下而上入场，3.2s 后自动消失，`aria-live="polite"`。文案说清做了什么、保留了什么（「已撤下，素材保留」）。

## Do's and Don'ts

### Do:
- **Do** 把每个视图做成接缝墙：外框 1px seam + 12px 圆角 + `overflow: hidden`，墙内 `gap: 1px` 铺在 seam 底上。
- **Do** 给每个面板 ink-1 + 机加工顶缘（`inset 0 1px 0 rgb(255 255 255 / 0.075)`）；页头面板与下沉井用 ink-0。
- **Do** 给每个指标、日志、知识与证据带口径标记（实测 / 估计 / AI 建议 / 缺失）；AI 推测一律灰白虚线。
- **Do** 让涨跌永远「颜色 + 三角」成对：余烬上三角、钢灰下三角。
- **Do** 让真实成片承担色彩：9:16 缩略图进赛马榜、委托单、成交链；领先成片常驻静音循环，其余悬停才播。
- **Do** 在每颗余烬键旁给退路（不发并保留素材、只重抽一个镜头、转人工、继续运行），取消说明写清保留什么、清掉什么。
- **Do** 把尘灰文字只放在 ink-0 到 ink-2 上；落到 ink-3 及更亮的面（选中行、选中导航）时改用灰白。
- **Do** 尊重 `prefers-reduced-motion`：成交带停止并可横向滚动，光束变静态余烬环，循环视频只留首帧，闪光与过渡近乎瞬时。

### Don't:
- **Don't** 用 backdrop-filter 毛玻璃或环境光场 —— 那是 Aivora Glass 的材质，两个世界不混用。
- **Don't** 在面板之间留间距，也不给单个面板加圆角或投影做成卡片格。
- **Don't** 引入第二个强调色相，也不用红绿表示涨跌；渠道、分类、状态都不配色。
- **Don't** 把余烬用在装饰、完成态或普通进度上：预算条、已完成步骤、管线已过阶段、发布已完成段都用骨白。
- **Don't** 在余烬面上放白字（3.33:1），一律用余烬墨（#140801）。
- **Don't** 用 Doto 点阵写成交带以外的数字、写字母或 ID，或把它用在 16px 以下。
- **Don't** 用比例数字排任何数据，也不用粗体大数字。
- **Don't** 在拿到平台回传的帖子 ID / 回复 ID 之前写「已发布」或「平台已确认」。
- **Don't** 用渐变做装饰或发光；渐变只允许是余烬 8% 洗底（领先行、待批准格）、图表面积填充、深度条的骨白质感、成交带两端遮罩和生成光束。
- **Don't** 把光束或脉冲用在机器此刻没有在干活的元素上。
- **Don't** 给已完成的成片加色调、滤镜或彩色蒙层；画面上的叠加只能是中性的工具标记（安全区虚线、审片标记、ink 底的 chip）。
- **Don't** 用纯黑或纯白做界面面与文字（审片播放器底的 #000 属于画面，不属于界面）。
- **Don't** 在标题上方加眉题或 kicker；面包屑和指标自带的标签不算。

## Booth 展台

> 状态同上：提案，待 CEO 批准。展台套件放在 `booth/`（大屏、客户 iPad、店主 iPad、单屏演示、扫码结果页、局域网中继），
> 对应 2026-10-23 定下的路径 C：产品用户仍是海外家居服务经销安装商；广交会用来招工厂渠道、让经销商现场亲手试；
> 不排除国内商家，所以中英文同等重要。

展台是 Exchange 世界的一个场景，不是另一个世界：零彩度墨阶、1px 接缝、余烬只表示「待你处理 / 上涨」全部沿用。
下面只写展台额外要守的规矩。

### 距离可读 · The Three-Metre Rule
大屏按 1920×1080、3–4 m 视距排字，单位是 `--u = min(1vw, 1.7778vh)`（1080p 下 1u = 19.2px）。
主张行 4.7u（≈90px），成交链节点名 2.1u（≈40px），**任何必读文字不小于 1.5u（≈29px）**。
大屏上的必读文字只用骨白；第二语言行用灰白；尘灰不上大屏。

### 触屏字阶 · Booth touch ramp
iPad 与枢纽页按手持/触屏距离排字，用 frontmatter 里的 `booth-*` 字阶（15 / 17 / 18 / 20 / 22 / 24 / 26 / 34px），
不沿用交易台 11–14px 的终端密度；输入框与主按钮 17px 起（iOS 不缩放），触控目标不小于 44px。

### 中英等权 · The Two-Language Rule
- 每一条面向访客的文字都有 EN 和 中文 两份，按钮、提示、错误、预约时段、结果页、Offer、安全阀都不例外。
- 大屏同时给两种语言：主张屏每次出现换一种语言（英文、中文交替）；其余屏英文在上、中文在下，同一字号层级。
- 大屏 Offer 只上四条收费结构（2×2），「客户确认的预约」的定义写在下方；席位、导出等写在结果页。
- 开展前在真大屏上开 `screen.html?fitcheck`：它把每一屏和中英实时链路各渲染一次，列出被裁切的元素，必须显示 FIT OK。
- 回复语言跟着客户的留言走，与手机界面语言无关；店主界面语言不同时给「对照」，对照是同一份回复计划换语言渲染，
  不是机器翻译，所以内容和引用的事实一一对应。
- 回复里的链接文字跟回复的语言走（[booking link] → Book a visit，[预约链接] → 点此预约，繁体回复里是「點此預約」；不要和前面的「选个时间」重复）。

### 不放示例数字 · The Real-Count Rule
- 对外屏幕（大屏、客户 iPad、结果页）上不出现任何示例经营数字。大屏底栏只在主张屏出现，只有三格真实计数：
  今天在本展位亲手跑通的人数（为 0 时写「第一个来试」）、上一位从评论到预约的用时（标「模拟渠道」）、真实试点已约上门数。
- 结果页的 ROI 估算只留空输入框（占位写「你的数字」），由访客自己填；不预填任何行业均值。
- 没有真实试点链路之前，证据屏写「进行中」并显示 0；`booth/config.json` 只在拿到平台 ID 和书面同意后才填真实链路。
- 计数可以是 0。0 比漂亮的示例数更可信。
- 成交链的前两节（成片、帖子）在展台这一轮并没有真的生成和发布，实时链路、店主台和结果页上一律画成虚线并标「示例」。

### 模拟设备 · The Simulated Device Rule
客户 iPad 用纸色面（`paper` / `paper-2` / `paper-card` / `paper-ink` / `paper-mute` / `paper-line`）表现「这是另一台设备、另一个人」，
与店主的墨色台面一眼分开。气泡、输入框、时段卡用 `paper-card`，不用纯白；唯一的纯白是二维码底（扫码对比度优先）。模拟评论区顶上常驻一行「展台用的模拟评论区，正式版走 Instagram / Facebook 官方接口」；
不用任何平台的 logo、配色或界面样式，回复送达写「模拟送达」，绝不写「平台已确认」。
客户手机上的主按钮用纸墨实心，不用余烬：余烬留给店主那颗「批准并发送」。

### 一颗余烬键 · The One Key Rule（展台版）
店主台每个状态只有一颗余烬键（批准并发送 / 发送 / 去批准回复），旁边永远有退路：我亲自回、不回复、回到草稿、下一位访客。
大屏不放可点的余烬键，余烬只用于「你只需要点批准」这句主张、「需要你确认」的转人工标记、生成光束和实时脉冲。

### 动效与声音 · Motion
- 待机时成交链每 2 秒点亮一节；光束只套在「此刻正在发生」的那一节。
- 场景停留：主张屏 8 秒（英文、中文交替）穿插在证据 / Offer / 安全阀 / 渠道现状之间，这四屏各 11 秒，一轮 76 秒，
  过道里的人任何时候抬头都有约一半概率看到主张；访客开始跑时立刻切到实时链路，约好后停 15 秒再回轮播；
  实时链路超过「闲置秒数 + 30 秒」没有新动静就自动收掉。
- 减少动效：停留时间翻倍、成交链直接全亮、光束变静态余烬描边、客户手机里的样片不自动播放。
- 全程无声；样片字幕烧录在画面里。

### Doto 在展台的例外
修订 The Tape-Only LED Rule：Doto 点阵除了成交带，还可以写**大屏上非零的真实计数**，只写数字，不小于 4u（≈77px）。
计数为 0 时改用 IBM Plex Mono 写「0」，不让点阵把零渲染成一个醒目的大数字。ID、字母、示例数仍然不用 Doto。

### 店员控制
- 大屏地址加 `#claim` / `#proof` / `#offer` / `#safety` / `#channels` 可固定一屏（对着一群人讲时用），去掉 `#` 恢复轮播。
- 结果页公网地址、提交失败时的直接联系方式、征求同意的法律主体都写在 `booth/config.json`，所有设备从中继读同一份；
  枢纽页（`booth/index.html`）只读显示当前生效的结果页地址，地址是展台局域网时给出警告；清零当天计数要二次确认，并同步到所有设备。
- 客户 iPad 闲置 90 秒（`idleSeconds`）自动回到开头，约好或不回复之后 30 秒；任何一步都有「重新开始」。
  店主台每一步都能「结束本轮」；约好的那一屏受保护，下一位访客开始时先排队提示，不会把它冲掉。
- 彩排用 `owner.html?rehearsal`，不计数。店员标签（A/B/C 三档）存在店主 iPad 本机，可一键复制当天的记录。

### 离线
字体、图标、二维码库全部本地打包（`booth/assets`、`booth/vendor`）；改了页面文字后重跑 `tools/build-fonts.py`。
设备之间走笔记本上的 `relay.mjs`；没有中继时同一台设备的多个窗口用 BroadcastChannel 配对，`demo.html` 一屏跑完全流程。

### 展台 Don't
- **Don't** 在对外屏幕上放示例数字、客户数、提升百分比，或把关联方试点说成独立客户。
- **Don't** 在模拟评论区里用平台 logo 或仿平台界面；不写「平台已确认」。
- **Don't** 把访客自己打的字放上过道大屏：大屏只显示内置建议问题的原话，其余显示「访客用自己的话问了一个问题」，旁边照常显示 AI 草稿（访客可能打出私人信息、同行广告或脏话，离线草稿库读不全）。
- **Don't** 让大屏上任何必读文字小于 1.5u，或用尘灰。
- **Don't** 只做一种语言的文字；也不要让中文只是英文旁边的小注。
- **Don't** 在 Offer 上写具体价格或收款条款：只写结构（首个确认预约前不收费、月费 + 按确认预约计费 + 月度封顶、广告费直付 Meta、随时取消可导出）。
- **Don't** 把规划中的渠道（WhatsApp、小红书、抖音、微信）写成已支持；一律标「规划中 · 未上线」。渠道现状单独占一屏（试点中 / 等平台审核 / 规划中），
  内容只从 `config.json` 的 `channels` 读。
