# Aivora — AI agent 工作须知

小商家的内容获客与增长操作系统（Next.js 16 App Router + Prisma/Neon + Vercel Blob）。
当前实施依据：[PRD v3.3](docs/roadmap/2026-07-29-ecommerce-workflow-prd.md)，从 **M0** 起做。

> ⚠️ `.cursor/rules/reelforge-project-context.mdc` 描述的是已废弃的「代运营中台 / 只有 AdminUser」
> 模型，与当前 PRD 冲突，**不要拿它当事实来源**。

## 1. 找代码：先查索引，别扫 repo

600+ 个 src 文件、100+ 个 API route、70+ 个 npm scripts（2026-10-25 实数：src 下 608 个文件 / 604 个 .ts·tsx，
`src/app/api` 下 109 个 `route.ts`，package.json 71 个 scripts）。全 repo grep 是本项目最大的 token 漏斗。

```bash
npm run context:find -- "关键词1 关键词2"   # 0.3s，给 top 10 文件 + 阅读顺序
```

索引在 `ai-context/`（`npm run codemap:build` 重建，改动大之后跑一次）。
定位不到再升级到 grep。大文件用行号区间读，别整文件吞。
细节协议见 skill `aivora-dev` 与 [docs/AI_CONTEXT_WORKFLOW.md](docs/AI_CONTEXT_WORKFLOW.md)。

## 2. 目录约定

| 位置 | 内容 |
|---|---|
| `src/app/(platform)/` | 客户自助面 —— 新定位的主战场 |
| `src/app/(internal)/` | 只剩帧质检运维页 `/internal/frame-qa`（旧代运营中台 16 页 2026-10-28 已删），别加新功能 |
| `src/app/page.tsx` · `(public)/` · `(auth)/` · `(wall)/` | 公开首页「展厅」/ 法务页（/persona、/showcase 2026-10-28 已删）/ 登录注册 / 行情大屏 `/wall` |
| `src/app/l/[slug]` · `src/app/t/[code]` | 商家询盘页（匿名可访问）/ 追踪链接跳转（`route.ts`） |
| `src/app/api/` | 路由只做鉴权 + 参数校验，业务委托 `src/lib/services/` |
| `src/lib/services/` | 业务层（80+ service），Provider 层封装外部 API |
| `src/lib/contracts/` | 对外契约（`customer-api` / `batch-api` / …），M0 的 `/api/videos` 在这层定 |

## 3. 常用命令

```bash
npm run dev            # 真机模式（predev 会跑 mode:check）
npm run typecheck      # tsc --noEmit —— 提交前必过
npm run lint
npm test               # node --test tests/*.test.ts；要 Node 22+（pretest 会核对，旧版本有假失败）
npm run db:migrate:deploy  # 迁移唯一正路（owner 直连生产，见 §4）
# db:migrate / db:push / db:seed 有确认闸：CONFIRM_PRODUCTION_DB=<脚本名> 才放行
# npx playwright test 的视觉夹具默认不写生产库：给专用库 E2E_DATABASE_URL，或 CONFIRM_PRODUCTION_DB=e2e:seed
npm run context:find -- "..."
```

## 4. 铁律（违反会打穿生产，不是风格问题）

1. **`.env.local` 直连生产库。** 任何 `db:*` 命令都是对生产执行。
   - **迁移只能用 `npm run db:migrate:deploy`**，它已切到 `NEON_PRODUCTION_OWNER_DATABASE_URL`
     （直连 + owner 角色）。用默认 `DATABASE_URL` 会报 `42501 must be owner of table`，
     且失败记录会卡住后续所有部署 —— 恢复要先 `prisma migrate resolve --rolled-back`。
   - 走 pooler 跑迁移还会**把 advisory lock 泄漏在 pgbouncer 的复用连接上**，
     之后每次迁移都 `P1002` 超时。真遇到了用 `npm run db:migrate:deploy:unlock`
     绕过（仅当迁移本身幂等时），不要去 kill 生产连接。
2. **数据库只加列 / 加表，不 DROP。** 业务数据只归档不物理删除（PRD §10.4 D 级）。
3. **只走真实供应商。** 不做 mock 模拟测试来充当验收；`dev:mock` 只用于纯前端联调。
4. **demo 账号不跑付费生成。**
5. **`'use client'` 文件不得引用服务端 service 的模块级值**（曾导致整页 500，
   有 `client-bundle-safety` 回归测试守着）。
6. **`public/brand/` 被 gitignore。** 真实客户资产走 blob，禁止用 `/brand/*` 静态 URL。
7. **每一轮任务都必须可取消**，取消要清幂等键、保留素材。失败不能只给「重试」。
8. **旧代码清理顺序 A→B→C 不跳级**，删除 PR 单独提，不与功能改动混。

## 4.5 运行开关与 2026-11 新增功能的落点

改这些行为先找开关，别直接改代码路径。环境变量只在部署那一刻读入，改完要重新部署才生效。

| 开关（Vercel 环境变量） | 缺省 | 作用 |
|---|---|---|
| `PLANNING_FULL_LLM=on` | 关 | 出方案退回完整模型链路（缺省是精简版：一条片最多 7 次模型调用） |
| `STORYBOARD_SHOT_CARDS_VISION=on` | 关 | 看着商品图写镜头卡。11-10 盲评与纯文字卡打平，线上已关 |
| `STORYBOARD_DIRECTION=on` | 关 | 建故事板时合并一次看图调用。首次真机只成功一部分，所以缺省关 |
| `FRAME_QA_ENABLED=on` | 关 | 成片画面质检（依赖 OpenAI 看图）。20 条真跑 0 次拦截后缺省关 |
| `SHUYU_FALLBACK_TO_RUNWAY=off` | 开（配了 Runway 密钥时） | 关掉「Shuyu 失败后改交 Runway」 |
| `CAPTION_SPEECH_ALIGN=on` | 关 | 合成时把 AI 段人声交给 OpenAI `whisper-1` 识别，字幕跟着人声走。要求这把 `OPENAI_API_KEY` 有 whisper-1 权限（11-10 实查没有，需在 OpenAI 项目里开通）；识别不到就照旧按字数摊，不影响出片 |
| `OPS_ALERT_WEBHOOK_URL` | 未配 | 运维告警的群机器人地址；没配只进日志（`[ops-alert]`） |
| `PROGRESS_SEGMENT_EXPECTED_MIN` | 10 | 进度条估算用的出片典型分钟数（实测中位数） |

| 功能 | 从哪看起 |
|---|---|
| 等待体验（进度估算、预计时间、做好了提示） | `src/lib/video-generation/business-status.ts`、`src/components/exchange/use-ready-announcement.ts` |
| 登录失效后自动回登录页 | `src/components/exchange/use-pulse.ts`（脉搏接口回 401 就整页跳转） |
| 成片评价（满意 / 不满意 + 原因） | `src/lib/contracts/video-feedback.ts`，表 `VideoFeedback`，`npm run report:feedback` |
| 换个开头（同一商品换一种开场） | `src/lib/create/hook-angles.ts` |
| 用同样的素材再做一条 | 成片详情 → `/app/create?retry=<订单 id>` |
| 片尾落款（品牌名 + 行动指引 + 可选 Logo） | `src/lib/video-generation/brand-signoff.ts`；存在后期快照的 `signoff` 键；Logo 由 `stitch-composer` 按成片主人取 |
| 不满意之后的下一步（按原因指到重拼 / 重做一段 / 再做一条） | `src/lib/library/feedback-next-steps.ts`、`video-feedback-panel.tsx`；详情页锚点 `#captions-music` / `#segment-redo` |
| 换个开头再做一条（详情页直达） | 成片详情 → `/app/create?retry=<订单 id>&hook=<开头 id>`，创作页用 `applyHookAngle` 换上 |
| 接着拍这些商品（空白创作页复用以前那一单的商品图和描述，不建新表） | `listRecentCreateSources`（`create-retry-prefill-service.ts`） |
| 商品尺寸（描述末尾补一行「商品实际大小：…」） | `src/lib/create/product-size.ts` |
| 品牌页的片尾落款预览（与合成同一套版式） | `src/components/brand/signoff-preview.tsx` |
| 字幕跟着人声走（按语音识别对齐） | `alignCuesToSpeech`（`src/lib/video-generation/audio-post-production.ts`）、`src/lib/providers/openai-transcription.ts`；日志搜 `[captions]` |
| 只重新合成（换字幕 / BGM / 落款，不扣额度） | `src/lib/video-generation/restitch-patch.ts`、`stitch-service` 的 `prepareRestitch` / `commitRestitch` |

供应商现状（2026-11-10）：生产只留 Shuyu（出图、出片）、Runway（备用出片、出故事板图）、OpenAI（出方案；开关打开时另做字幕的语音识别）三把付费密钥；
抠图、商品链接抓取、素材库、配音、内容审核这几条线路已下线（`RETIRED_CAPABILITY_KEYS`）。

## 5. 交付门

改完代码，**先自己验证再报完成**：`npm run typecheck` + `npm run lint` + 相关 test 全绿，
把命令输出贴出来。失败就说失败，不要用「应该没问题」代替证据。

## 6. 界面：纯黑工作台 + 展厅首页（2026-11-10 对着代码核过）

完整规矩见根目录 **`DESIGN.md`**；它叠着三段历史（10-24 Exchange、10-28 白天 LibTV、10-28 晚 Runway），
**以顶部「现行规矩速览」为准**。逆向参考在 `docs/reference/taste/`。速记：

- 工作区是纯黑场（`--bg #000`）+ 冷调蓝灰不透明面板（`.x-panel`，下沉面 `.x-well`，结构条 `.x-pane`），白 8% 发丝线，没有工程网格。
  公开首页是「展厅」（全屏视频 + 浅灰画廊，token 以 `--show-*` 开头）。**不做毛玻璃、不铺光晕**，只有视频之上的 `.on-media` 规则例外，
  有门禁测试守着（`backdrop-filter`、`#ff4d00`、glass/editorial 材质名一律禁止回流）。
- 主行动是电光蓝紫实底白字（`--primary-fill`），一屏一个。颜色只来自数据与媒体：长春花蓝 `--accent`（实时/当前/链接/焦点）、
  成片绿 `--success`、赢家金 `--gold`（赢家与需要你处理的数字）、失败玫红 `--danger`、AI 鸢尾紫 `--iris`（只做标注）。
- 颜色/圆角/阴影字面量只住 `src/styles/tokens.css`；圆角：控件 6/8/12、卡片 20、主创作卡 24；数字一律 tabular-nums。
- 字体：Archivo（标题与读数）+ Noto Sans SC（中文）/ Martian Mono（代码、时间、计数）。
- 页面开场用 `WorkspacePage` / `QuoteHeader`（`src/components/exchange/`），创作页例外（对话框优先）。
  读数只放能让人接着做点什么的真实数字（零就写零，不放示例数字）；没有就传空数组，不硬凑。口径写进 `scope`，悬停可见，不单占一行。
  副标题一句话说清这页干什么，内部口径与规则解释不进页面正文。状态用 `StatusTick`（符号 + 颜色成对），批次进度用 `FillBar`。
- 壳层是 240px 分组侧栏（创作 / 资产 / 帮助）+ 细顶栏（搜索、帮助、头像），移动端底部 tab 条；行情条、生产带、状态栏已退役，`/wall` 行情大屏仍在。
  壳层数字来自同一个脉搏（`/api/exchange/pulse`），读数口径只从读数注册表取；状态词只从 `state-vocab` 取，「成交」只留给询盘。
- 眉题/kicker 一律禁止；页面标题自己承重。
- `.x-wall` / `.x-beam` / `.x-hatch` / `.x-frame` 是 10-24 的旧材质，存量还在约 15 个组件里：新界面不要再用，清理单独提。
- 方向契约在 `src/app/layout.tsx` body 首子节点的 HTML 注释里（grep `aivora-abyss-exchange`）。
