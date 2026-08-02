---
name: Aivora
description: 小商家的内容获客与增长操作系统 —— Aivora Glass 深色毛玻璃工作台
colors:
  graphite-air: "#0a0809"
  text-primary: "#f7f4f2"
  text-secondary: "#b0a8a4"
  accent: "#ff4d00"
  accent-soft: "rgb(255 77 0 / 0.14)"
  on-accent: "#140801"
  glass-surface: "rgb(255 255 255 / 0.045)"
  glass-surface-raised: "rgb(255 255 255 / 0.08)"
  glass-surface-sunken: "rgb(0 0 0 / 0.3)"
  glass-pane: "rgb(24 20 21 / 0.78)"
  glass-card: "rgb(22 18 19 / 0.52)"
  glass-well: "rgb(0 0 0 / 0.28)"
  hairline: "rgb(255 255 255 / 0.1)"
  hairline-strong: "rgb(255 255 255 / 0.2)"
  popover-solid: "rgb(30 25 26 / 0.94)"
  overlay: "rgb(8 6 7 / 0.62)"
  success: "#58c08a"
  warning: "#e9b658"
  danger: "#ff6f5b"
typography:
  display:
    fontFamily: "Schibsted Grotesk, Noto Sans SC, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "clamp(32px, 5vw, 56px)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Schibsted Grotesk, Noto Sans SC, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.2
  subhead:
    fontFamily: "Schibsted Grotesk, Noto Sans SC, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: "Inter, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.05em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  sm: "10px"
  md: "14px"
  lg: "20px"
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
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-secondary:
    backgroundColor: "{colors.glass-surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-ghost:
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-destructive:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.glass-surface}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  input:
    backgroundColor: "{colors.glass-well}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.glass-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "24px"
  panel:
    backgroundColor: "{colors.glass-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
  dialog:
    backgroundColor: "{colors.popover-solid}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: Aivora

> 2026-08-02 用户决策：全站视觉世界替换为 **Aivora Glass（毛玻璃）**，同时取代旧 Editorial
> 浅色主题与「剪辑台」方向（PRD §11 圆角 0 / 无阴影等硬规矩作废）。作用域是整站，
> 含下线中的 `(internal)` 区（那里只做 token 继承，不做新装置）。
> 唯一 token 来源：`src/styles/tokens.css`；材质层：`src/app/globals.css`；
> 方向契约：`src/app/layout.tsx` 内嵌注释（`data-design-contract="aivora-glass"`）。

## Overview

**Creative North Star: "玻璃工作台 (Aivora Glass)"**

小商家的整条出片生产线悬在一块深色玻璃工作台上。一块近黑的暖石墨空气（#0a0809）里，
右上方挂着一枚品牌橙光源，左下一记冷石板对光，表面铺一层胶片颗粒；三档玻璃悬在这片
空气中——backdrop 真模糊的结构 pane、薄膜反光的内容卡、吸光的下沉 well。玻璃后透出的
光就是正在发生的生成任务：环境光的亮度由进行中的批次数实时抬升。这是一个专业出片台，
不是「白底卡片格 SaaS 仪表盘」——后者是本世界明确拒绝的范式。

整站只做深色（`color-scheme: dark`，无浅色主题）。工作区 `/app`（.studio-theme）与
登录面（.auth-studio-theme）共用同一套颜色与材质，只在**密度**上收紧：字号、控件高度、
间距整体下调一档，因为工作台是数字密集面。数字信息（积分、批次进度、时长、比分）
一律等宽 tabular-nums，用 JetBrains Mono 承载，是制片单据的语气。

**Key Characteristics:**
- 暖石墨空气 + 单一品牌橙光源，光强随进行中的任务数变化（活的环境光）
- 三档玻璃材质分层：pane（真模糊）/ card（薄膜反光）/ well（吸光下沉）
- 白透明 hairline 边 + 镜面高光边（inset 1px 白 8%）是所有玻璃的封边
- 圆角三级 10/14/20，阴影有偏移有羽化、承担深度而非装饰
- 中英双语等价排版，中文标题绝不落回系统默认字体
- 全部颜色/圆角/阴影字面量只住在 tokens.css（有回归测试把关）

## Colors

一块近黑暖石墨里的白透明玻璃阶梯，加一枚克制到只出现三处的品牌橙光源。

### Primary
- **品牌橙 Brand Ember** (#ff4d00, `--accent`): 全站唯一光源色，只用于三处——品牌标记
  （含登录门主标题的品牌宣言行）、当前项（激活导航、选中 clip、今日播放头）、需要行动的
  数字（待处理计数、失败数）。主行动按钮是它的实心形态。
- **橙雾 Ember Haze** (rgb(255 77 0 / 0.14), `--accent-soft`): 品牌橙的 14% 透明形态——
  激活导航底色、选区 ::selection、生成中的批次格、播放头的羽化光。
- **橙上深字 On-Ember Ink** (#140801, `--primary-foreground`): 品牌橙上的唯一前景色。
  #ff4d00 配白字仅 3.32:1，不达 AA；深色前景是无障碍硬约束，不是风格偏好。

### Neutral
- **暖石墨空气 Warm Graphite Air** (#0a0809, `--bg`): 整站唯一的底色，环境光场画在它上面。
- **主文本 Porcelain** (#f7f4f2, `--text-primary`): 暖白，正文与标题。
- **次文本 Warm Ash** (#b0a8a4, `--text-secondary`): 暖灰，辅助说明；再弱一档用
  `color-mix(… 72%, transparent)` 表达（mono 标签、占位符）。
- **玻璃阶梯 Glass Ladder**: 白透明覆盖三级——`--surface` (白 4.5%，内容卡底) /
  `--surface-raised` (白 8%，hover 与次级钮) / `--surface-sunken` (黑 30%，muted 区)。
- **玻璃材质底 Glass Materials**: `--glass-pane-bg` (rgb(24 20 21 / 0.78)，结构面) /
  `--glass-card-bg` (rgb(22 18 19 / 0.52)，内容面) / `--glass-well-bg` (rgb(0 0 0 / 0.28)，
  下沉井) / `--popover` (rgb(30 25 26 / 0.94) 实底，模糊可用时降到 0.78)。
- **发丝边 Hairline** (rgb(255 255 255 / 0.1), `--border`; 强调 0.2, `--border-strong`):
  所有玻璃的封边与分隔线。
- **遮罩 Fog** (rgb(8 6 7 / 0.62), `--overlay`): 弹层遮罩，配 6px backdrop 模糊把后景推进雾里。

### Status
- **成功绿 Ready Green** (#58c08a, `--success`): 就绪态（clip ready 边、维度表达标）。
- **警示黄 Caution Amber** (#e9b658, `--warning`): 图表与警示。
- **危险红 Fail Coral** (#ff6f5b, `--danger`): 失败格、破坏性按钮、校验错误。

### Named Rules
**The One Light Source Rule（唯一光源律）.** #ff4d00 只出现在三处：品牌标记、当前项、
需要行动的数字。环境光场右上的橙辉是它唯一的氛围性使用，且强度与进行中的批次数挂钩
（`--ambient-glow` 0.2 → 0.36）——光不是装饰，是正在发生的工作。

**The Dark Ink on Ember Rule（橙上无白字律）.** 品牌橙上的前景永远是 #140801，
永远不是白色。WCAG AA 是底线（PRODUCT.md 无障碍承诺）。

**The Token Closure Rule（token 闭环律）.** 颜色、圆角、阴影字面量只允许出现在
`src/styles/tokens.css`；组件与页面只引用 token。由 `tests/design-system-closure.test.ts`
与 `tests/editorial-source-compliance.test.ts` 机器把关，违例即红。

## Typography

**Display Font:** Schibsted Grotesk（weights 500/600/700）+ Noto Sans SC（500/700，
中文标题声音，绝不落回系统默认；fallback PingFang SC / Microsoft YaHei）
**Body Font:** Inter（fallback PingFang SC / system-ui）
**Mono Font:** JetBrains Mono（400–700, fallback ui-monospace）

**Character:** 几何有力的双语标题声音配克制的正文，加一层贯穿全站的等宽「制片单据」语气。
中英文标题同权重排版，负字距（-0.03em）让 Schibsted Grotesk 收紧成块。

### Hierarchy

默认档（营销/公开面）与 studio 密度档（`/app` 工作区与登录面）并列如下：

- **Display** (600, clamp(32px, 5vw, 56px), lh 1.1, ls -0.03em): 页面主标题。
  studio 档收紧为 700 / clamp(28px, 3vw, 34px) / ls -0.035em。页面模块（plan/wins）的
  头题实测用到 44px/700。
- **Section** (32px / studio 28px, `--font-size-section`): 区块标题。
- **Title** (24px / studio 20px, `--font-size-title`): 弹层标题（DialogTitle 用 display 家族）。
- **Subhead** (18px / studio 16px, `--font-size-subhead`): 卡片标题（CardTitle 用 display 家族）。
- **Body** (400, 15px / studio 13px, lh 1.6 / 1.48): 正文；长段说明限宽约 62ch。
- **Label/Meta** (500, 13px / studio 11px, ls 0.05em, uppercase): `.studio-label`，
  表单标签与元信息。
- **Mono 镜号** (JetBrains Mono, 9.5–11.5px, ls 0.08–0.14em, uppercase): 镜号标签
  (shot slug)、轨道刻度、操作条按钮文字——数据的语气，不是装饰。

### Named Rules
**The Tabular Ledger Rule（等宽台账律）.** 一切数字（积分、进度、时长、比分、计数）
一律 `tabular-nums`，密集数字面用 JetBrains Mono。列必须对得齐，这是制片单据的质感来源。

**The Bilingual Parity Rule（双语等价律）.** 中英文案同权重排版；中文标题必须吃到
Noto Sans SC 的 display 声音，不为英文优化而牺牲中文可读性。

## Layout

- **壳层**: 左侧固定 224px（w-56）玻璃侧栏（`.glass-pane`，md 以上显示）+ 顶部 sticky
  48px（h-12）玻璃工作条；主区为内容玻璃卡阵列。移动端侧栏折叠为底部 64px 玻璃 tab 条。
- **内容宽度**: `--content-max-width` 默认 75rem，studio 档放宽到 82rem；页面容器
  `.studio-page` / `.editorial-page` 水平居中，窄屏 padding 收到 space-4。
- **间距韵律**: 4px 基（space-1 至 space-16 = 4/8/12/16/20/24/32/40/48/64），studio 档
  把 space-5 及以上整体下调一档（如 space-8: 32→24px）。卡片内边距 24px（studio 18px），
  卡间 gap 16px（studio 12px）。
- **控件高度**: `--control-height` 40px，studio 档 36px，但移动端 studio 回到 40px
  保触控热区。
- **断点**: 640px（页面 padding 换挡）、768px（Tailwind md，侧栏/底部导航切换）；
  页面装置各自持有内容断点（时间线详情 720px、战绩三栏 900px）。
- **横向滚动**: 宽装置（时间线轨道等）在自身容器内 `overflow-x: auto`，页面本身永不横滚。
- **页面标题由排版承载**：不加标尺、不加眉题（kicker/eyebrow 是被禁装置，见 Don'ts）。

## Elevation & Depth

深度由「玻璃的物理」承担：每一块玻璃 = hairline 边 + 镜面高光边 + 有偏移有羽化的投影。
不做无偏移的光晕装饰——唯二的例外是品牌橙从背后点亮玻璃的两处（完成的批次格、今日
播放头），那是光源叙事，不是投影装饰。

三档玻璃材质（只在 `globals.css` 材质层定义，组件不写 blur 工具类）：

- **pane（结构面）**: 侧栏 / 顶栏 / 移动 tab 条 / 弹层 / toast。真 backdrop 模糊
  `blur(24px) saturate(1.5)`，底色 rgb(24 20 21 / 0.78)，配 `--shadow-float`。全站少数几处。
- **card（内容面）**: 内容卡不付 backdrop-filter 的性能成本，质感由薄膜反光渐变
  `--glass-sheen`（165deg 白 7%→2%→透明）+ 高光边 + `--shadow-card` 合成。
- **well（下沉井）**: 输入框、轨道、空档。底色黑 28%，`--shadow-well` 内影把光吸进去。

### Shadow Vocabulary
- **glass-edge** (`inset 0 1px 0 rgb(255 255 255 / 0.08)`): 镜面高光边，所有玻璃面的第一层
  box-shadow，玻璃感的最小单元。
- **shadow-card** (`glass-edge + 0 1px 2px rgb(0 0 0 / 0.35) + 0 16px 40px -24px rgb(0 0 0 / 0.7)`):
  内容卡：贴地细影 + 远距柔影。
- **shadow-float** (`glass-edge + 0 4px 12px rgb(0 0 0 / 0.35) + 0 32px 80px -24px rgb(0 0 0 / 0.75)`):
  浮空层（pane、弹层、dropdown、sheet）。
- **shadow-well** (`inset 0 1px 2px rgb(0 0 0 / 0.32) + inset 0 -1px 0 rgb(255 255 255 / 0.04)`):
  下沉井的吸光内影。

### 环境光场（唯一的一块「空气」）
`body` 与 `.studio-canvas` 共用同一组 background：胶片颗粒（内联 SVG fractalNoise）
+ 右上品牌橙辐射光（强度 = `--ambient-glow`，由 PlatformShell 按进行中批次数写入，
`0.2 + activeBatches × 0.04`，封顶 0.36）+ 左下冷石板对光（rgb(84 100 138 / 0.24)）
+ 底部微橙地光，`background-attachment: fixed`。

### Named Rules
**The Three-Glass Rule（三档玻璃律）.** 全站只有 pane / card / well 三种玻璃，
不发明第四种。backdrop-filter 只住在 globals.css 材质层（结构面与浮层），
组件文件永远不写 blur 工具类；内容卡永远用 sheen + edge 模拟，不开真模糊。

**The Living Light Rule（活光律）.** 环境橙光的亮度耦合进行中的生成任务数。
玻璃后透出的光就是正在发生的工作——这是 STORY 承诺的唯一表达点，不另加进度装饰。

**The Feathered Shadow Rule（羽化投影律）.** 投影必须有偏移有羽化，承担深度；
无偏移光晕只允许出现在品牌橙从背后点亮玻璃的地方（点亮的批次格、播放头）。

## Shapes

圆角三级，层级随容器尺度上升：**sm 10px**（小玻璃片：clip、批次格外框、行内搜索、
小标签）→ **md 14px**（控件：按钮、输入框、计量条、导航项）→ **lg 20px**（卡片、
面板、弹层）。药丸形（999px/rounded-full)只用于计数徽章、标签 chip、头像钮。
封边一律 1px hairline（白 10%），hover 升到白 20%；不描粗边、不做斜切。
分段装置（操作条、计量条）用外框圆角 + 内部 1px 分隔线切格，格子本身在容器内裁切。

## Components

组件基座：shadcn/Base UI，样式经 tokens.css 语义桥（--primary/--card/--popover 等）
全部落回玻璃 token。

### Buttons
- **Character:** 实心、紧凑、立即可按；按下有 0.98 缩放的物理反馈。
- **Shape:** 控件圆角（14px），高 40px（studio 36px），text-meta 加粗（600）。
- **Primary:** 品牌橙实心 + #140801 深字——页面上最亮的可按物，一页通常只一枚。
- **Hover:** 统一 `brightness(0.94)`（120ms ease-out）；ghost 为 bg-secondary。
- **Focus:** 2px 品牌橙外描边，offset 2px（全站 :focus-visible 统一）。
- **Secondary / Outline / Ghost / Destructive / Link:** 白 8% 玻璃底 / hairline 边卡底 /
  透明 / 危险红实心 / 下划线文字。
- **Reduced motion:** 缩放与过渡全部关掉。

### Inputs / Fields
- **Style:** 下沉井材质（`.glass-well`：黑 28% 底 + 吸光内影 + hairline 边），
  圆角 14px，高 40px。
- **Focus:** 边框转品牌橙 + 2px 橙外描边；错误态 `aria-invalid` 边框转危险红。
- **Select:** `studio-select` utility，同一井材质。
- **组合槽:** 「一句话入口”把输入框与橙色实心行动钮装进同一条下沉玻璃槽
  （竖 hairline 分隔，行动钮文字用 mono 全大写）。

### Cards / Containers
- **Corner Style:** 20px。
- **Background:** shadcn Card 用白 4.5% 玻璃底；页面级 panel（`.studio-panel` /
  `.editorial-card`）用 rgb(22 18 19 / 0.52) 内容玻璃底。两者都自动叠薄膜反光
  `--glass-sheen`（打在 `[data-slot="card"]` 与卡类容器上）。
- **Shadow Strategy:** `--shadow-card`（含镜面高光边）。
- **Border:** 1px hairline；可交互卡 hover 时升到白 20%（120ms）。
- **结构:** CardHeader 白 8% 底 + 下边线；CardFooter muted 底 + 上边线。

### Navigation
- **侧栏:** `.glass-pane` 结构玻璃；导航项高 36px、圆角 14px、text-meta 500；
  激活态 = 橙雾底 + 主文本色（aria-current="page"），非激活 hover = muted 底。
  计数徽章 = 药丸 mono tabular-nums（batches 进行数；library 失败数着危险红）。
- **顶栏:** sticky 48px 结构玻璃：工作区切换钮、全局搜索（白 8% 底、圆角 10px）、
  帮助与头像圆钮（头像底为橙雾 + mono 首字母）。
- **移动端:** 底部 64px 玻璃 tab 条，图标 + 10px 文字，徽章浮于图标右上。
- **图标:** Lucide 全套 stroke-width 1.5、尺寸 16px（size-4）。

### Dialog / 浮层
- **Style:** 弹层玻璃全站统一在材质层声明（dialog/dropdown/select/sheet/toast 共用）：
  backdrop `blur(24px) saturate(1.5)` + 薄膜反光 + `--shadow-float`，圆角 20px，
  popover 底色带 @supports 回退（模糊不可用时 0.94 实底保可读）。
- **Overlay:** 雾遮罩（rgb(8 6 7 / 0.62)）+ 6px backdrop 模糊，把后景推进雾里。
- **Motion:** fade + zoom-95 进出（120ms）；reduced-motion 全关。

### Batch Film Strip（签名装置：磨砂分段计量条）
批次进度的玻璃语言（取代旧胶片齿孔）：外层是一条下沉玻璃井（圆角 14px、4px 内衬、
3px 格距），每格是一枚 6px 圆角的小玻璃片（白 4.5% 底 + sheen + 高光边）。
**completed** = 被品牌橙从背后点亮（橙实底 + 强薄膜反光 + 橙雾投影）；
**generating** = 橙雾底 2.4s 呼吸脉动（reduced-motion 时定格 0.72 不透明度）;
**failed** = 危险红 + 强反光；**cancelled** = 沉底灰 60% 不透明。

### Timeline Track（签名装置：下沉玻璃轨道）
一周内容不是 7 张卡片，是一条下沉玻璃轨道：mono 全大写刻度尺、7 泳道 hairline 分隔、
今天是一根 1px 品牌橙**播放头**光针（橙雾羽化 + 顶部三角）；空档画成**真的缺口**
（更深的下沉井 + mono「空档」标签），不是留白；排期条目是轨道上的小玻璃片 clip
（选中 = 橙边、就绪 = 绿边、废弃 = 虚线边 55% 不透明）。窄屏时轨道自身横滚。

### Motion（全站动效语法）
- **Tokens:** `--motion-fast` 120ms（状态过渡）、`--motion-base` 200ms（入场）、
  `--ease-out` cubic-bezier(0.16, 1, 0.3, 1)。
- **唯一入场动作:** `.editorial-page-enter`——玻璃从一点雾里升起（opacity 0 /
  translateY 6px / blur 6px → 清晰），每个新页面整体一次，不逐节重复。
- **prefers-reduced-motion:** 全站一律压到 1ms 并停用入场与脉动（既有覆盖，重构不得回退）。

## Do's and Don'ts

### Do:
- **Do** 从 `src/styles/tokens.css` 取一切颜色/圆角/阴影；新值先进 tokens 再被引用
  （closure 测试把关）。
- **Do** 用三档玻璃现成材质类（`.glass-pane` / `.studio-panel`（卡） / `.glass-well`）
  拼新界面；签名装置（分段计量条、下沉轨道、播放头、镜号标签）全站复用，不各自发明。
- **Do** 数字一律 `tabular-nums`，密集数字与镜号用 JetBrains Mono 全大写小字距。
- **Do** 品牌橙上永远用 #140801 深字；全站文本对比守 WCAG AA。
- **Do** 长任务状态诚实可读：进行/失败/取消/恢复各有玻璃语言（脉动橙雾/危险红/沉灰），
  失败永远伴随出路，任务永远可取消。
- **Do** 宽装置在自身容器内横滚（`overflow-x: auto`），页面永不横向滚动。

### Don't:
- **Don't** 在组件或页面里写 backdrop-filter / blur 工具类——模糊只住在 globals.css
  材质层；内容卡不开真模糊。
- **Don't** 把品牌橙用到三处（品牌标记/当前项/需行动的数字）之外；不给装饰性图标、
  普通链接或静态数字上橙。
- **Don't** 使用胶片/场记板装置（齿孔封边、场记板镜号牌、时间线剪辑台隐喻的装饰件）——
  2026-08-02 起已整体退役，只留纯玻璃语言；也不要复活 PRD §11 的圆角 0 / 无阴影规矩。
- **Don't** 加眉题（kicker/eyebrow）、标尺装饰或无偏移光晕；页面标题由排版本身承载，
  光晕只属于被橙光点亮的玻璃。
- **Don't** 做浅色主题或白底卡片格仪表盘布局；本世界只有深色暖石墨空气。
- **Don't** 让中文标题落回系统默认字体，或为英文排版牺牲中文可读性。
