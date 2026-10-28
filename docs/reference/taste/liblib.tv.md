# Design Map

Source: https://www.liblib.tv/ (workspace home, logged out) and a public read-only canvas (`/creation/process?id=…`, both 画布 and 故事板 views) — captured 2026-10-28 at 1440×900.

## Spacing Scale
- 4px base (107 uses) — the dominant rhythm
- 2 / 6 / 8 / 12px — inside controls and between list rows
- 16px — between tool tiles
- 28 / 40 / 48px — between home sections (new-canvas card → tools → 最近上新 → 创作精选)

## Font Hierarchy
- System stack only (`-apple-system`, PingFang on macOS)
- 20px / 600 — section titles (最近上新, 创作精选)
- 14px / 400–500 — primary UI and nav
- 13px — secondary UI
- 12px — meta, asset names
- 11px / 500 — badges (大奖开放, 全网爆款, New)

## Color Palette
- #121212 — sidebar (240px)
- #141414 — page (72.6% of painted area)
- #171717 — panels
- rgba(255,255,255,0.05–0.06) — raised surfaces (tool icon boxes, inputs)
- #363636 — chips
- 1px rgba(255,255,255,0.08) — hairlines
- #F7F7F7 / #A8A8A8 / rgba(255,255,255,0.6) — text primary / secondary / tertiary
- #04CAF6 on rgba(8,182,221,0.12) — badges only
- #FFFFFF pill with dark text — the one primary CTA per screen (注册/登录, 复制项目)

## Image Ratios
- New-canvas card: 1120×160 with one 56px "+" button
- Quick tools: 8 tiles, 133×86, icon box 98×56, radius 16px
- 最近上新: 5 cards, ~16:9 thumbnails, radius 16px
- 故事板 image wall: square-ish thumbnails, 9 per row
- 故事板 video wall: 16:9 thumbnails, 5 per row, duration badge top-right ("4秒", "14秒"), centered play glyph

## Component Tokens
- Radii: 9999px (pills), 20px (cards), 16px (tiles), 8 / 6 / 4px (inputs, chips)
- Shadows: none
- Motion: color/background 0.15s cubic-bezier(0.4,0,0.2,1); sidebar width 0.2s; card transform 0.45s
- Canvas: near-black field, group frames one step lighter with a 12px label top-left, curved grey edges, bottom-left zoom % readout, an "当前视窗没有节点 · 返回节点" toast when the viewport is empty
- Top bar on canvas: title left, two view toggles centered (画布 / 故事板), status text + white pill CTA right

---

# Taste DNA

### One giant verb, then shortcuts
- **Trigger**: A returning creator lands on the workspace home.
- **Decision**: One 1120×160 "新建画布创作" card with a single + button, followed by 8 equal model/tool tiles — rejecting a dashboard of stats, onboarding checklists or a project table.
- **Reason**: On arrival a creator wants to start making something; models, recent work and community are shortcuts into that same act, so they sit below it at equal weight.
- **Evidence**: the card is the first block in the content column; tiles 133×86 with 98×56 icon boxes at rgba(255,255,255,0.05), radius 16px; no numbers or charts anywhere on the home.

### Grey chrome, media carries the color
- **Trigger**: The workspace is full of thumbnails and generated clips.
- **Decision**: Four near-black neutrals (#121212 / #141414 / #171717 and 5–6% white surfaces) with #F7F7F7 / #A8A8A8 text, keeping a single cyan (#04CAF6) for 11–12px badges — rejecting tinted panels or colored section headers.
- **Reason**: Hundreds of colorful thumbnails already compete for attention; a neutral frame lets the creator judge each output's color without a tint around it.
- **Evidence**: 72.6% of painted area is #141414; zero box-shadows in use; cyan appears only on badges with a 12% tint background.

### Assets sorted by role, not by date
- **Trigger**: A project accumulates dozens of generated images and clips.
- **Decision**: A 故事板 view that groups images into 角色 / 场景 / 物品 and videos into 视频片段 / 成片, each with a duration badge — rejecting one chronological stream.
- **Reason**: When assembling a shot the creator asks "which character sheet, which scene plate"; the wall answers in the same roles that the generation prompts reference.
- **Evidence**: "图片 43" with tabs 全部 / 角色 / 场景 / 物品 / 其他; "视频 16" with tabs 全部 / 视频片段 / 成片 and 4秒 / 14秒 badges; text nodes and audio (背景音乐 03:06, 旁白音色 00:02) in a left rail.

### Dense controls, no decoration
- **Trigger**: Setting the density of a tool people keep open for hours.
- **Decision**: 11–14px system type, a 4px spacing base and no shadows — rejecting a spacious, marketing-style interface.
- **Reason**: The controls sit next to large media all session long; small, quiet controls leave the pixels to the work.
- **Evidence**: sizes 14 / 13 / 12 / 11px cover 101 of 118 sampled text nodes; 4px is the most frequent spacing value; system font only.
