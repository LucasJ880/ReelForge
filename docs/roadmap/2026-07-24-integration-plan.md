# Aivora 整合实施计划 — 2026-07-24

> 状态：**待实施（下周开工）**。代码未动。
> 可视化路线图：https://claude.ai/code/artifact/274a5a1e-337a-470f-8040-5d6dd387498a
> 这份是可执行工作清单，开工时逐条勾。每个 workstream 的步骤按依赖排序。

---

## 0. 总览与约定

**主轴**：把 SunnyShutter 硬锁抽象成**通用电商模板引擎**，同时保留 3–4 帧抽卡锁一致性（该锁本来就产品无关，**不动地基**）。

**已定决策（前提，不再讨论）**
1. 成品库老旧/失败/不可播视频 → **物理删除**（删前必跑 dry-run 报数确认）。
2. 通用模板 → **行业标准双语命名**，不自造词。
3. 全局品牌包 → **永久，所有用户可选**；核心价值＝「已服务客户」展示墙。
4. 字幕/配音/BGM（#11）→ **本轮做，与 P1 并行**（独立轨道）。

**并行结构**

```
P0 快赢（先做，纯前端）
      │
      ├── 地基线：P1 通用引擎 ──→ P2 资产化
      └── 视频流线：P3 字幕/配音/BGM        （与 P1 同时启动）
```

**贯穿约束（每个 PR 都要守住）**
- 不回退 0722 的单条 mock 两根因修复、0722 故事板刷新恢复、SunnyShutter v2 出片路径。
- demo 账号**不跑付费生成**。
- 关键生成路径**不 import OpenAI**、不接受客户端任意 prompt（INV-B1）。
- 一律真实供应商生成，不做 mock 模拟测试。
- SunnyShutter prompt 骨架有合作方 5000 字符硬上限，改词表时复测长度。

**每条 workstream 完成的通用验收**
- [ ] `pnpm typecheck` / `pnpm lint` 通过
- [ ] 相关红/绿测试通过，无新增 skip
- [ ] 真机（真实供应商）跑通至少 1 条，非 mock
- [ ] 门控回归无新增失败

---

## P0 · 快赢（纯前端 · 低风险 · 1–2 天）

### P0-1 登录 hero 字体收敛（#1）
- 目标文件：`src/app/(auth)/layout.tsx`（巨型 hero「从一个想法，到稳定交付」在 layout，不在 login/page.tsx）。
- [ ] 定位 hero 标题的字号类，`clamp()` 上限下调一档，字重从超粗收到 semibold/700。
- [ ] 副文案与三栏指标（工作流 1→4 / JOB ID / 9:16）同步收敛字号与间距。
- [ ] 移动端断点复查不溢出。
- 验收：视觉「小而高级」；桌面/移动两档截图对比。

### P0-2 批量列表化（#9）
- 目标文件：`src/app/(platform)/app/batches/page.tsx`。
- [ ] 大卡两列 → **紧凑表格/列表**：每行 = 标题 · 状态 pill · 模板版本 · 完成/总数 · 成本快照 · 时间 · 「查看」。
- [ ] 表头 sticky；`tabular-nums` 对齐数字列；失败行状态色条。
- [ ] 保留进详情 `/app/batches/[id]` 的跳转。
- 验收：20+ 批次时可快速扫读；视觉基线 `visual-baseline/batch-monitor` 更新。

### P0-3 模板卡悬停预览（#2）
- 目标文件：`src/components/templates/template-library-grid.tsx`，复用 `src/components/library/hover-preview-video.tsx`。
- [ ] 卡片封面区：有 sample 视频则**悬停自动播放**，无则回退静态封面。
- [ ] 信息层级收敛：标题 + 一行叙事结构预览 + 稳定/时长/画幅 3 chip；去掉挤压的三列小字。
- [ ] 每个骨架配一张**真实样片**封面（临时可复用现有成片，P1 落库后替换为骨架专属）。
- 验收：卡片观感对齐 Arcads/Creatify；无 cutoff。

### P0-4 成品库删死卡 + 修 cutoff（#5a）
- 前端隐藏（立即）：`src/app/(platform)/app/library/page.tsx` — 过滤 `status === "failed"` 且无 `videoUrl` 的行不渲染。
- [ ] 卡片标题/信息固定行高 + 明确 `truncate`，消除 cutoff。
- **物理删除（决策 1，需二次确认后执行）**：
  - [ ] 写 `scripts/cleanup-dead-library.ts`，先 **dry-run** 输出：将删除的 video/order/batch 记录数、标题、账号分布。
  - [ ] 把 dry-run 结果发用户确认删除范围。
  - [ ] 确认后加 `--commit` 真删 DB 记录 + 关联存储对象。
  - [ ] 保留 showcase 样片与 ready 成片，勿误删。
- 验收：成品库只剩可播放成片；dry-run 报告存档 `qa/evidence/`。

---

## P1 · 地基：通用模板引擎（核心前提）

> 顺序严格：B1 → B2 → B3 → B4，之后 #7、#8 才能接。

### B1 · 通用运镜词表（拆窗帘专属）
- 目标文件：新建 `src/lib/video-generation/generic-shot-policy.ts`；参照 `shutter-shot-policy.ts`。
- [ ] 定义通用 `ShotMotion`：`static_product` / `reveal_transition` / `operate_demo` / `presenter_point`。
- [ ] `PRODUCT_MECHANICS_PRECONDITIONS` 参数化：按**品类**注入「允许运镜 + 几何约束」，窗帘的 louver/tilt/panel 成为 shutter preset。
- [ ] `renderSafeProductPrompt()` 泛化 `renderSafeShutterPrompt()`：productLock/motion/beats 参数化，unsafe 校验按品类规则。
- [ ] 保留 shutter preset 走原有 unsafe 正则；通用品类用通用护栏。
- 验收：shutter preset 输出与旧 `renderSafeShutterPrompt` **逐字等价**（快照测试防回退）。

### B2 · 通用模板引擎 + 8 骨架落库
- 目标文件：新建 `src/lib/video-generation/generic-commerce-template.ts`；参照 `sunnyshutter-commerce-template.ts`。
- [ ] 抽出 `COMMERCE_FRAME`（目标锁）、`STYLE_LANE_LOCK`、叙事结构锁、`SHARED_NEGATIVE` 为**产品无关**版本（去 plantation/louver/tilt 字样）。
- [ ] 定义 **8 个通用骨架**（见 §附录 A），每个含 `motion / styleLane / conflictAngle / beats`。
- [ ] `category` 通用化：`SunnyShutter电商` → `电商带货`（i18n 同步）。
- 验收：8 骨架 seed 全部渲染成功、含 `{IMAGE_REFS}` / `{PRODUCT_NAME}` 占位、长度 < 5000。

### B3 · SunnyShutter 降级为可插拔 brand pack / lock profile
- 目标文件：`client-lock-profiles.ts`、`sunnyshutter-commerce-template.ts`、`batch-style-templates.ts`、`generation-supervisor.ts`。
- [ ] SunnyShutter 专属词表/尾卡/安全正则收进 `sunnyshutter` profile；通用路径不再默认继承。
- [ ] `BATCH_STYLE_TEMPLATE_SEEDS` = 通用 8 骨架 ∪ SunnyShutter 骨架（后者保留供该客户批量）。
- [ ] `resolveClientLockProfile` 命中 sunnyshutter 时才叠加窗帘硬锁。
- 验收：非 SunnyShutter 客户走通用骨架不带窗帘词；SunnyShutter 客户出片路径与 v2 **完全一致**（真机复测 1 条）。

### B4 · 抽卡一致性锁泛化措辞（不改逻辑）
- 目标文件：`storyboard-gacha.ts`。
- [ ] `JUDGE_SYSTEM` 已是 "shades/shutters/curtains"，泛化成通用电商产品措辞（房间/产品不漂移 + 零文字 + 几何不变形），**逻辑与 fail-open 行为不动**。
- 验收：SunnyShutter 择优行为不变；通用产品也能锁一致性（真机各测 1 条）。

### #7 · 高级下拉共用数据源
- 目标文件：`src/components/video-generation/streamlined-video-studio.tsx`、`src/app/api/batch-style-templates/route.ts`。
- [ ] 高级「创意模板」下拉从**同一份 8 骨架数据源**读取（替换现在寥寥几个硬编码项）。
- [ ] 模板库 / 高级下拉 / 批量 new 三处指向同一 template id 集合。
- 验收：三处模板列表一致；选择后带对应 lockedParams。

### #8 · 一键灌入提示词
- 目标文件：`template-library-grid.tsx`（跳转带参）、`create/page.tsx`、`unified-creative-input.tsx`。
- [ ] 「单条套用」跳转 `?styleTemplate=` 时，把骨架的**人类可读提示词**灌进提示词框。
- [ ] 顶部提示：「你正在用【XX 模板】，系统会自动锁一致性 / 裁尾 / 加尾卡」。
- [ ] 不用模板时：提示词框下「帮我打包成规范提示词」按钮——白话 + 工作流约束（画幅/时长/不出文字/参考图一致）合成（走已有 prompt-intelligence，勿在关键路径 import OpenAI）。
- 验收：套用后提示词非空且可读；打包按钮产出符合约束。

---

## P2 · 资产化（接在 P1 之后）

### #6 · 全局品牌包（永久）
- 目标文件：`workspace-brand-package-service.ts`、`brand-packaging.ts`、`prisma/schema.prisma`。
- [ ] 品牌包增加**全局 scope**（`isGlobal` 或 `workspaceId = null` 约定），所有用户可见可选。
- [ ] 种子 SunnyShutter 全局品牌包（logo + 尾卡 + 联系方式，复用现有硬编码常量）。
- [ ] 第 4 步「品牌封装」下拉合并 workspace 品牌包 ∪ 全局品牌包。
- 验收：demo/新账号也能看到并选择 SunnyShutter 全局品牌包；选中后尾卡正确拼接（真机 1 条）。

### #10 · 品牌封装独立模块 + 客户展示墙
- 目标文件：新增 `src/app/(platform)/app/brand/`（页面 + 路由）、`platform-shell.tsx`（导航项）、复用 `logo-generator-dialog.tsx`。
- [ ] 新导航「品牌封装」：品牌包列表（= 客户展示墙）、上传 logo、生成尾卡、管理多套、设默认。
- [ ] 列表卡片展示每个品牌 logo + 名称，直观呈现「已服务客户」。
- 验收：可新建/编辑/删除品牌包；导航可达；展示墙视觉成立。

### #5b · 成品库详情「制作过程」区块
- 目标文件：`src/app/(platform)/app/library/[id]/`、`unified-library-service.ts`。
- [ ] 详情页新增区块：4 帧一致性故事板缩略 + 抽卡择优说明 + 所用模板 + 锁一致性文案。
- [ ] showcase 样片对所有账户只读开放 + 下载（扩展 `LIBRARY_SHOWCASE` 为全局）。
- 验收：客户能看到「怎么抽卡锁一致性」，把护城河显性化。

---

## P3 · 视频流增强（与 P1 并行 · 独立轨道）

### #11a · 数据模型迁移
- 目标文件：`src/types/video-generation.ts`、`prisma/schema.prisma` + migration。
- [ ] `UnifiedVideoGenerationRequest` 增：
  - `audio?: { voiceover?: { enabled; voiceId; language }; bgm?: { trackId; volume } }`
  - `captions?: { enabled; style: "word_by_word" | "karaoke" | "plain"; language; position }`
- [ ] 默认值保守（全 off），不破坏现有请求。
- 验收：迁移可回滚；旧请求无需字段仍工作。

### #11b · 规格第 3 步音频/字幕栏（UI）
- 目标文件：`streamlined-video-studio.tsx`、`glass-create-workflow.tsx`。
- [ ] 「视频规格」加一栏：配音（语言 + 音色）、字幕（开关 + Hormozi 逐字/卡拉OK/纯文本 + 语言 + 位置）、BGM（曲库选择 + 音量）。
- [ ] 画幅 9:16 / 16:9 / 1:1 已有，归入同栏统一呈现。
- 参考同行：Revid / Invideo / VEED（逐字/卡拉OK 字幕、多语言配音、BGM 曲库、烧录或导出 .srt）。
- 验收：选项写入请求；预览区反映所选。

### #11c · ffmpeg 落地（配音 / 字幕 / BGM）
- 目标文件：`assembly-executor.ts`、`brand-overlay-renderer.ts`、`stitch-service.ts`。
- [ ] 复用已有 ffmpeg overlay 流水线（尾卡在用），扩展：字幕烧录（逐字时间轴）、配音混音、BGM 铺底 + ducking。
- [ ] 字幕可选导出 `.srt` 附件。
- 验收：真机产出 1 条「英文配音 + Hormozi 英文字幕 + BGM」成片，音画同步。

---

## 附录 A · 8 个通用模板骨架（去 SunnyShutter 化）

| # | 通用名 | 行业标准名 | motion | styleLane | 来源 | 锁 |
|---|--------|-----------|--------|-----------|------|----|
| 1 | 氛围美学 | Aesthetic / Mood | static_product | product_hero_proof | vid1 | 无人·慢揭示·光影 |
| 2 | 真人口播测评 | UGC Testimonial | presenter_point | hard_sell_presenter | vid2 | 真人+逐字字幕+特写 |
| 3 | 上手演示 | Demo-First Reveal | operate_demo | product_hero_proof | vid3 | 手部操作·满足系 |
| 4 | 单卖点证明 | Single-Feature Proof | static_product | product_hero_proof | vid4 | 钩子前置·一卖点 |
| 5 | 开箱到改造 | Unboxing → Transform | reveal_transition | pov_before_after | vid5 | 开箱→安装→前后揭示 |
| 6 | 平价高级感 | Value Proof | static_product | cozy_warm_lifestyle | vid6 | 价值/价格文案贯穿 |
| 7 | 痛点到方案 | Problem–Solution | reveal_transition | pov_before_after | 已有 lane | before/after 对比 |
| 8 | 硬广口播 | Hard-Sell Presenter | presenter_point | hard_sell_presenter | 已有 lane | 高能口播 + CTA |

> 叙事结构统一：`0–3s 钩子 → 冲突/强对比 → 回到产品 + CTA/尾卡`。产品名与参考图是变量。

## 附录 B · 关键不回退清单
- 单条 mock 两根因修复（0722）· 故事板刷新恢复（0722）· SunnyShutter v2 出片路径 · INV-B1 关键路径不 import OpenAI · demo 账号不跑付费生成 · prompt 5000 字符上限。
