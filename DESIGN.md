---
name: Aivora
description: 小商家的内容获客与增长操作系统 —— Aivora Exchange 深海交易所（行情终端 + 行情大屏）
colors:
  abyss: "#04070e"
  abyss-deep: "#020409"
  hull: "#08101d"
  deck: "#0d1729"
  well: "#03060c"
  bridge: "#102340"
  seam: "rgb(110 160 230 / 0.13)"
  seam-strong: "rgb(110 160 230 / 0.24)"
  seam-bright: "rgb(120 210 255 / 0.42)"
  grid-line: "rgb(110 160 230 / 0.05)"
  # 2026-10-28 晚学 Runway 工作台深色模式：场与面板（tokens.css --bg / --bg-deep / --surface*）
  field: "#000000"
  side: "#0c0d11"
  panel: "#131416"
  raised: "#1b1e23"
  active: "#2c3037"
  sunken: "#0b0c0e"
  nav-selected: "rgb(207 213 255 / 0.12)"
  text-primary: "#ffffff"
  text-secondary: "#a1afc5"
  text-tertiary: "#818a9d"
  # 信号色（实时 / 当前 / 链接 / 焦点）：信号青换成长春花蓝
  signal: "#7497fc"
  signal-strong: "#a9bdff"
  signal-soft: "rgb(116 151 252 / 0.14)"
  signal-line: "rgb(116 151 252 / 0.45)"
  # 主行动：唯一的电光蓝紫实底，上面用白字
  primary-fill: "#2c22fa"
  primary-fill-hover: "#4339ff"
  on-primary: "#ffffff"
  azure: "#4d8dff"
  azure-soft: "rgb(77 141 255 / 0.15)"
  iris: "#a08cff"
  iris-soft: "rgb(160 140 255 / 0.14)"
  gold: "#ffc542"
  gold-soft: "rgb(255 197 66 / 0.14)"
  fill: "#2fe39b"
  fill-soft: "rgb(47 227 155 / 0.13)"
  fault: "#ff5577"
  fault-soft: "rgb(255 85 119 / 0.14)"
  popover: "#1b1e23"
  overlay: "rgb(1 3 8 / 0.74)"
  edge-light: "rgb(170 215 255 / 0.06)"
  beam-tail: "rgb(116 151 252 / 0.15)"
  sweep: "rgb(116 151 252 / 0.55)"
  glow-signal: "rgb(116 151 252 / 0.55)"
  glow-fill: "rgb(47 227 155 / 0.6)"
  glow-gold: "rgb(255 197 66 / 0.55)"
  scrim: "rgb(2 4 9 / 0.88)"
  shadow-ink: "rgb(0 0 0 / 0.85)"
  well-shadow: "rgb(0 0 0 / 0.5)"
  mask-ink: "#000000"
  brand-tile: "#0d1729"
typography:
  display:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "clamp(40px, 5.2vw, 76px)"
    fontWeight: 300
    lineHeight: 1.04
    letterSpacing: "-0.035em"
  display-desk:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "clamp(34px, 3.8vw, 60px)"
    fontWeight: 300
    lineHeight: 1.04
    letterSpacing: "-0.035em"
  figure:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "clamp(30px, 3vw, 46px)"
    fontWeight: 250
    lineHeight: 1
    letterSpacing: "-0.02em"
  wall-figure:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "clamp(44px, 5.6vw, 112px)"
    fontWeight: 200
    lineHeight: 1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.2
  subhead:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: "Archivo, Noto Sans SC, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Martian Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.06em"
  data:
    fontFamily: "Martian Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
  scale:
    micro: "10px"
    label: "10.5px"
    data: "11px"
    meta: "12px"
    body-desk: "13px"
    clip: "14px"
    body: "15px"
    wordmark: "15px"
    subhead-desk: "15px"
    subhead: "18px"
    wordmark-wall: "18px"
    title-desk: "20px"
    title: "24px"
    section-desk: "26px"
    section: "32px"
rounded:
  sm: "3px"
  md: "6px"
  lg: "10px"
  brand-icon: "14px"
  pill: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
  space-8: "32px"
  space-10: "40px"
  space-12: "48px"
  space-16: "64px"
components:
  button-primary:
    backgroundColor: "{colors.primary-fill}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-outline:
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-secondary:
    backgroundColor: "{colors.deck}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-destructive:
    backgroundColor: "{colors.fault-soft}"
    textColor: "{colors.fault}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  input:
    backgroundColor: "{colors.well}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "8px 12px"
  panel:
    backgroundColor: "{colors.hull}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "20px"
  quote-cell:
    backgroundColor: "{colors.hull}"
    textColor: "{colors.text-primary}"
    padding: "16px 20px"
  dialog:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: Aivora

> **2026-10-28 晚 工作区配色改学 Runway 工作台（CEO 点名喜欢；逆向分析 `docs/reference/taste/app.runwayml.com.md`）——与下文冲突处以本条为准。**
> - **场与面板**：纯黑场 `--bg #000` + 分层冷调蓝灰：面板 `--surface #131416`、抬升 `--surface-raised #1b1e23`、按下 `--surface-active #2c3037`、下沉 `--surface-sunken #0b0c0e`。
>   结构条与侧栏 `--bg-deep #0c0d11`（黑上 6.7% 长春花紫叠色），比场**略亮**而不是更深：分层靠亮度，不靠分隔线。
> - **文字**：白 / `#a1afc5` / `#818a9d`，偏蓝的灰，不再是中性灰。
> - **主行动**：唯一的电光蓝紫 `--primary-fill #2c22fa` 实底白字，8px 圆角（不再是白色胶囊）；一屏一个。侧栏选中项是 `--nav-selected`（长春花白 12%）。
> - **信号色**：实时 / 当前 / 链接 / 焦点从信号青换成长春花蓝 `--accent #7497fc`（黑底 7.6:1）。成片绿、赢家金、失败玫红、AI 鸢尾紫语义不变。亮色实底（如失败玫红）上的字用 `--background`。
> - **圆角**：控件 6 / 8 / 12，卡片 20，主创作卡 `--radius-prompt` 24。
> - 未做：浅色模式（Runway 跟随系统明暗；我们仍只有深色，`color-scheme: dark`）。

> **2026-10-28 方向调整（Evan：首页学 Seedance 2.5 官网，工作台学 LibTV；「现在的交互和 UI 落伍、复杂」）——进行中。**
> 逆向分析：`docs/reference/taste/seed.bytedance.com.md`、`docs/reference/taste/liblib.tv.md`；计划：`docs/superpowers/plans/2026-10-28-ui-seedance-libtv.md`。
> 已落地（P-UI-1/2）：
> - **场换成中性近黑**：`--bg #141414` / `--bg-deep #111` / `--surface #1a1a1a`，白 8% 发丝线；冷蓝色调与工程网格退役。信号色语义（青 / 绿 / 金 / 玫红 / 鸢尾紫）不变，「颜色只给数据与成片」不变。
> - **公开首页「展厅」**（`src/components/landing/`）：第一幕全屏静音视频轮播，文字只在底部（一个大标题、一句话、三个等宽胶囊，唯一实心主行动是白色胶囊）；第二幕浅灰画廊 `--show-canvas`，每节 = 标题 + 一句话 + 「输入 → 成片」横向轮播。展厅 token 全部以 `--show-*` / `--reveal-*` 住在 `tokens.css`。
> - **毛玻璃只允许出现在视频之上**：`globals.css` 里以 `.on-media` 开头的规则（门禁测试守着），其它地方仍禁止。展厅入场 / 轮播用 `--reveal-*`（600–1200ms，减少动效时关闭）；界面动效 `--motion-*` 仍 ≤300ms。
> - **工作区外壳**：240px 分组侧栏（创作 / 资产 / 获客）+ 顶部唯一白色实心「新建视频」+ 细顶栏（搜索、帮助、头像）；行情条、状态栏时钟、编号键帽退役（快捷键 1–7 仍在）。
> 未做（P-UI-3/4）：各页的「行情头读数墙」简化、`/app` 做成 LibTV 式开始页、创作页按 商品 / 人物 / 场景 分组的故事板视图、本文件正文重写与视觉基线。下文是 2026-10-24 Exchange 原文，**与上面冲突处以上面为准**。


> 2026-10-24 用户决策：旧版「暖石墨 + 品牌橙 + 毛玻璃」（Aivora Glass）整体退役，不留痕迹；
> 全站换成 **Aivora Exchange（深海交易所）**——交易所行情终端 + 行情大屏，追求科技感与高级感。
> 旧数据保留，旧风格不保留。作用域是整站（含下线中的 `(internal)` 区，只做 token 继承）。
> 唯一 token 来源：`src/styles/tokens.css`；材质层：`src/app/globals.css`；
> 交易所组件：`src/components/exchange/`；方向契约：`src/app/layout.tsx` 内嵌注释（`data-design-contract="aivora-abyss-exchange"`）。

## Overview

**Creative North Star: 「增长交易所」**

小商家的出片与获客是一面交易所行情墙：批次是正在成交的委托，成片是持仓，赢家是该加仓的标的，
Agent 的每个动作滚动在成交带上。打开任何一页，商家第一眼看到的是自己的生产线在成交——
什么在生成、什么已成交、什么失败了、哪条在赢——下一笔该下什么单一目了然。

场是一块冷蓝近黑的交易大厅（`abyss` #04070e），铺一层极淡的 56px 工程网格；面板是不透明的
hull，以 1px 冷蓝接缝拼成行情墙。**颜色只来自数据与媒体**：信号青是实时、当前与主行动，成交绿是
已完成，赢家金是赢家与需要你处理的数字，玫红只给失败，鸢尾紫只做 AI 标注。光只出现在边缘与
「正在生成」的那一格，不铺在背景里。

整站只做深色（`color-scheme: dark`）。工作区 `/app`（`.desk-theme`）与登录门（`.gate-theme`）共用
同一套颜色与材质，只在**密度**上收紧。`/wall` 是同一个大厅放大到 3–5 米外可读的行情大屏。

**Key Characteristics:**
- 冷蓝近黑大厅 + 极淡工程网格；不做毛玻璃、不铺光晕、不用颗粒
- 不透明面板 + 1px 接缝的行情墙（`.x-wall`），只有外框一个圆角
- 大而轻的标题与读数（Archivo 200–300），数字一律等宽 tabular-nums
- 颜色只给数据：信号青 / 成交绿 / 赢家金 / 失败玫红 / AI 鸢尾紫
- 壳层是行情终端：顶部行情条 + 实时生产带 + 编号导轨 + 状态栏（实时时钟）；市场状态、徽标与生产带是每 30 秒自刷新的脉搏小岛
- 每页以「行情头」开场：标题 + 真实读数墙，零就写零，不放示例数字

## Colors

场是冷蓝近黑，颜色是信号：每一种彩色都对应一种数据状态，不做装饰。

### Primary
- **长春花蓝 Signal** (#7497fc, `--accent`；2026-10-28 晚取代信号青 #22e0ff): 实时、当前项、链接。实时点、
  生成光束、焦点环、选中边。黑底对比约 7.6:1。
- **电光蓝紫 Primary Fill** (#2c22fa, `--primary-fill`): 主行动实心（一屏一个），前景白字 `on-primary`，对比约 7.7:1；
  hover `--primary-fill-hover` (#4339ff)。
- **亮长春花 Signal Strong** (#a9bdff, `--accent-strong`): 链接 hover。
- **长春花雾 Signal Soft / Line** (`--accent-soft` 14% / `--accent-line` 45%): 选中底、计数徽章底、角标线、选中边。

### Data Signals
- **成交绿 Fill** (#2fe39b, `--success`): 已成片、已完成、正向读数（「成交」一词只留给询盘）。
- **赢家金 Gold** (#ffc542, `--gold` / `--warning`): 赢家结构、需要你处理的数字（待出图、待处理），也承担警示。
- **失败玫红 Fault** (#ff5577, `--danger`): 失败与破坏性动作。只给失败，不给装饰。
- **鸢尾紫 Iris** (#a08cff, `--iris`): AI 标注（「AI Generated」合规标签、排期依据左缘）。不做渐变。
- **蔚蓝 Azure** (#4d8dff, `--azure`): 次级数据序列与话题标签。

### Neutral
- **大厅 Abyss** (#04070e, `--bg`) / **深底 Abyss Deep** (#020409, `--bg-deep`): 场与结构条（行情条、导轨、状态栏）。
- **面板 Hull** (#08101d, `--surface`) / **甲板 Deck** (#0d1729, `--surface-raised`) /
  **下沉井 Well** (#03060c, `--surface-sunken`) / **舰桥 Bridge** (#102340, `--surface-active`): 面板、hover、输入、选中行。
- **文本** 冰白 #e8f0fc / 钢灰 #91a3bf / 板岩 #7889a8（主 / 次 / 三级，三级只给标签与代码）。
  三级色在面板上 ≥5.3:1、甲板上 ≥5:1、舰桥上 ≥4.4:1——它承载 10.5px 的读数标签，不许再调暗。
- **接缝** `--border` 13% / `--border-strong` 24% / `--border-bright` 42% 的冷蓝发丝线。

### Named Rules
**The Data-Only Color Rule（颜色只给数据）.** 任何彩色都必须对应一种数据状态或一个当前项；
背景、装饰、标题强调不用彩色（登录门宣言的后半句是唯一例外，用信号青）。
**The Dark Ink on Signal Rule（亮色上深字）.** 信号青、成交绿、赢家金上的前景永远是 `--primary-foreground`。
**The Token Closure Rule（token 闭环）.** 颜色、圆角、阴影字面量只允许出现在 `src/styles/tokens.css`。
由 `tests/design-system-closure.test.ts`、`tests/editorial-source-compliance.test.ts`、
`tests/exchange-design-system.test.ts` 机器把关；旧世界残留（`#ff4d00`、backdrop 模糊、glass/editorial
材质名）也有专门的门禁。

## Typography

**Display / UI Font:** Archivo（可变字宽 wdth 62–125，wght 100–900）+ Noto Sans SC（中文，标题与正文同一声音）
**Mono Font:** Martian Mono（可变字宽 75–112.5）——一切代码、时间、计数、标签
**Character:** 大而轻的标题（300）与更细的读数（200–250）配紧凑的等宽数据，舞台感来自尺寸而不是字重。

### Hierarchy
- **Display** (300, clamp(40px, 5.2vw, 76px)，desk 档 clamp(34px, 3.8vw, 60px), lh 1.04, ls -0.035em, wdth 108%): 页面标题 `.x-display`。
- **Figure** (250, clamp(30px, 3vw, 46px), wdth 112%): 行情头读数 `.x-figure`；大屏读数 200, clamp(44px, 5.6vw, 112px)。
- **Title / Subhead** (500, 24/18px，desk 20/15px): 区块与卡片标题。
- **Body** (400, 15px，desk 13px, lh 1.6/1.5): 正文；长段说明限宽约 62ch。
- **Label** (Martian Mono 500, 10.5px, ls 0.06em, uppercase, 三级色): `.x-label`，读数与列头的标签。不是眉题。
- **Data** (Martian Mono 11px, `text-data`) / **Micro** (10px, `text-micro`): 表格、代码、计数、成交带。

### Named Rules
**The Big-and-Light Rule（大而轻）.** 标题与读数靠尺寸承重，字重 200–300；只有小号的界面文字用 500–600。
**The Tabular Ledger Rule（等宽台账）.** 一切数字 tabular-nums；代码、时间、ID 用 Martian Mono。
**The Bilingual Parity Rule（双语等价）.** 中英文案同权重排版；中文永远吃到 Noto Sans SC。

## Layout

- **壳层（/app）**: 顶部 sticky 行情条（48px：▲ 标记、AIVORA 字标、工作区芯片、搜索、市场状态、大屏、帮助、账户）
  + 实时生产带（32px，本工作区最近 12 笔批次，悬停暂停）；左侧 224px 编号导轨（文档流里 sticky，与顶栏共用 `--shell-top`，矮屏内部滚动）（1–7 是真快捷键：焦点不在输入框、
  没有打开的对话框时按数字直达；激活项信号青左缘 + 舰桥底）；底部 28px 状态栏（数据口径 + 本地时钟）。
  移动端导轨折叠为底部 64px tab 条（两字短名，计数徽标贴在图标右上），状态栏隐藏。
- **页面开场**: 每个工作区页面都用 `WorkspacePage`（内含 `QuoteHeader`）——标题 = 导航名（传 `nav`，从字典取，口号进副标题）+ 副标题（≤62ch）
  + 主行动插槽（必填，可显式为 `null`）+ 模式切换插槽（与行动分开）+ 读数墙（2–6 格）+ 一行统计口径（必填）。详情页（批次 / 成片）直接用 `QuoteHeader`，标题是这一条的名字。
  没有数据的页也要开场读数（零就写零）：没有读数墙的页面只剩黑底与青色，就是「黑青单色」，等于没改。
- **读数口径唯一**: 成片 / 失败 / 成功率 / 生成中等跨页读数只从 `src/lib/services/exchange-readings.ts` 取（DB 计数），
  名字与口径只从 `src/lib/exchange/readings-registry.ts` 取；状态词只从 `src/lib/exchange/state-vocab.ts` 取；
  同一个名字在两页出现，口径必须相同（批量页的「完成率」= 已成片 ÷ 下单条数，大屏的「成片成功率」= 成片 ÷（成片 + 失败））。
- **内容宽度**: desk 档 96rem；页面容器 `.x-page`，窄屏 padding 收到 space-4。
- **行情大屏 /wall**: 全屏，无导轨；读数墙 5 格 + 成交带（最近 6 批）+ 最新成片墙（竖版静音循环）+ 大号时钟 +
  底部滚动的「成交回报」带（最近 16 条成片 / 失败 / 生成中，尾部写数据口径与 30 秒刷新节拍）。
  ≥1280px（电视、展位屏、笔记本全屏）整屏定格不滚动：成交带等分剩余高度、成片一排三条占满高度；更窄时自然滚动。
- **断点**: 640px（页面 padding）、768px（md，导轨 / 底部 tab 切换）、1024 / 1280（读数墙列数）。
- **横向滚动**: 宽装置（一周时段带、表格）在自身容器内滚动，页面永不横滚。
- **页面标题由排版承载**：不加标尺、不加眉题（kicker/eyebrow 是被禁装置）。

## Elevation & Depth

交易大厅不靠投影分层，靠**接缝**与**亮度阶梯**（abyss → hull → deck → bridge）：
- **x-pane（结构条）**: 深底 abyss-deep，1px 接缝分隔。
- **x-panel（内容面）**: hull + 1px 接缝 + 顶缘 1px 冷光 `--edge`（inset 0 1px 0 白蓝 6%）。
- **x-well（下沉面）**: well + 吸光内影 `--shadow-well`。
- **浮层**: popover 实底 + `--shadow-float`（接缝外框 + 远距深影），不做 backdrop 模糊。

### Signature Light（只给正在发生的事）
- **生成光束** `.x-beam`: 沿边框转动的 conic 光（`--beam`），只套在「正在生成」的那一格（独立的卡 / 格）。
- **行光束** `data-beam="row"`: 光束在列表与表格里的形态——左缘 2px 信号青 + 左起淡青雾 + 底边一条从左扫到右的光。
  挂在生成中的批次行（批量页、大屏成交带）、生成中的任务行（批次详情）、成品库生产线行；暂停的不挂。
  减少动态时扫光静止，光束退成一圈静止的信号青细线。
- **扫光** `--sweep`: 成交梯里生成中的格子、分段成交条里生成中的那一段。
- **实时点** `.x-live`: 信号青圆点向外扩散的脉冲；空闲时变板岩色、不动。
- **今天光针**: 一周时段带上的信号青光针（`--glow-accent`）。

### Named Rules
**The No-Glass Rule（不做毛玻璃）.** 全站不写 `backdrop-filter`；面板一律不透明。
**The Light-Is-Work Rule（光就是工作）.** 光只出现在边缘与正在发生的那一格；不铺背景光晕。

## Shapes

终端的精密感：**sm 3px**（标签、计数徽章、tick、刻度）→ **md 6px**（按钮、输入框、芯片、导航项）→
**lg 10px**（面板、读数墙外框、弹层）。药丸形只用于实时点。行情墙只有外框一个圆角，格子之间是 1px 接缝。
**角标** `.x-frame`: 读数墙与登录终端的左上 / 右下各一道信号青 L 形角线——大屏的边框语言，只给主读数区与登录门，不给每张卡。

## Components

组件基座：shadcn / Base UI，经 tokens.css 语义桥（`--primary` / `--card` / `--popover` 等）落到交易所 token。

### Buttons
- **Primary**: 信号青实心 + 深字，hover 变亮青；一页一枚。
- **Outline**: 透明底 + 强接缝，hover 转信号青边与字。
- **Secondary / Ghost**: 甲板底 / 透明，hover 甲板。
- **Destructive**: 玫红雾底 + 玫红字，hover 实心玫红 + 深字。
- 高 40px（desk 36px，移动端回 40px），按下 0.98 缩放；reduced-motion 关闭。

### Inputs / Fields
下沉井材质（well + 吸光内影 + 强接缝），圆角 6px；占位符三级色；聚焦信号青边 + 2px 焦点环；错误态玫红边。

### Exchange Kit（`src/components/exchange/`）
- **QuoteHeader**: 行情头（标题 + 读数墙 + 主行动 + 统计口径）。读数色调：live 青 / filled 绿 / winner 金 / fault 玫红 / ai 紫。
- **StatusTick / TickGlyph**: 记号 + 状态词成对（空心圈=排队中、上涨三角=生成中、实心圆=已成片 / 已完成、半圆=部分失败、
  下跌三角=失败、双竖=已暂停、叉=已取消），不只靠颜色。StatusTick 只接收「实体 × 状态」，词从状态词典取；
  不是状态的标签（样例、草案、攒样本）用中性的 `MonoTag`。记号是一套 12 格自绘 SVG（`TickGlyph`，跟随字号），不用 ▲●◐▼‖× 字符——
  字体回退会让它们大小粗细各异。成交带、表格、大屏、错误页共用这一套。
- **FillBar**: 分段成交条（成交绿 / 生成中扫光 / 暂停板岩 / 失败玫红 / 取消斜纹 / 余下为排队空档）。
- **SectionHead**: 区块抬头（标题 + 等宽计数 + 一句说明与行动，说明与行动并成一组贴右）。
- **EmptyState**: 统一空态（`x-panel` + 一句人话 + 至多一个**描边**行动）；不加角标、不用虚线框。
- **Segmented / FilterChip**（`src/components/ui/segmented.tsx`）: 选中态 = `aria-pressed` + 信号青细线 + 舰桥底；
  实心信号青只给主行动，从不表达「选中」（门禁测试扫全仓库 `variant={…? "default"`）。
- **ExchangeTape**: 无限滚动的生产带（悬停暂停、减少动态时静止）；壳层里放本工作区最近批次（空时写明「还没有生产记录」
  并给新建批次入口），大屏底部放成交回报。时间用 `LocalTime` 按访问者时区显示（服务端先渲染占位，避免水合不一致）。
- **Wall controls**: 大屏的秒级时钟（共享 `useNow`）、30 秒自动刷新、全屏、减少动态时不自动播放的成片。

### Batch Fill Ladder（批次成交梯）
`batch-film-strip.tsx` 渲染 `.x-fill-strip`：每格一条成片；已成交=成交绿实心 + 绿光，生成中=青雾 + 扫光，
失败=玫红，排队=甲板空格，取消=斜纹。五态齐全，reduced-motion 下扫光关闭。

### Week Session Strip（一周时段带）
`plan-timeline`：7 个交易日的刻度 + 每日的委托（帖子，左缘一道状态色）；今天是信号青光针；空档画成带斜纹的下沉缺口。

### Media
成片是舞台：成品库竖版 9:16 原比例展示，底部读数遮罩 `--scrim`；AI 合规标签是等宽鸢尾紫标签，不用 ✨ 图标。
登录门放一排三条模板库真机样片（静音循环，标「样例」，并写明不是用户数据）+ 模板与样片的真实计数；
取数失败或超时（1.5 秒）整块不显示，登录表单照常可用。样片只从真机验收白名单（`template-sample.ts`）里取。

### Motion
唯一入场：整页一次 300ms 从 4px 下方升起（不做模糊）。其余动效都是「工作」：成交带滚动、实时点脉冲、
生成扫光与光束、时钟。全站尊重 `prefers-reduced-motion`。

## Do's and Don'ts

### Do:
- **Do** 用 `QuoteHeader` 开场，读数墙只放真实数字，零就写零，并写明统计口径。
- **Do** 让颜色对应数据状态：信号青=实时/当前，成交绿=完成，赢家金=赢家与需要处理，玫红=失败，紫=AI 标注。
- **Do** 状态用 `StatusTick`（符号 + 颜色成对），进度用 `FillBar` / 成交梯。
- **Do** 把成片放上舞台：竖版原比例，媒体本身就是这页的颜色。
- **Do** 一切数字等宽，代码、时间、ID 用 Martian Mono。

### Don't:
- **Don't** 回到旧世界：不用 `#ff4d00` 品牌橙、不写 backdrop 模糊、不用 glass / editorial 材质类、不铺环境光晕（有门禁测试）。
- **Don't** 用紫蓝 AI 渐变、发光球、✨ 图标、满屏毛玻璃、三列图标特性卡。
- **Don't** 在标题上方加眉题或 kicker。
- **Don't** 放示例数字或编造的读数；大屏与成交带只读本工作区数据（成品库样片不计入）。
- **Don't** 在亮色（信号青 / 成交绿 / 赢家金）上用白字。
- **Don't** 给非交互卡片加 hover 高亮，或一页放两枚实心主按钮。
