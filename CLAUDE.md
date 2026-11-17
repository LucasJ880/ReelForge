# Aivora — AI agent 工作须知

小商家的内容获客与增长操作系统（Next.js 16 App Router + Prisma/Neon + Vercel Blob）。
当前实施依据：[PRD v3.3](docs/roadmap/2026-07-29-ecommerce-workflow-prd.md)，从 **M0** 起做。


## 1. 找代码：先查索引，别扫 repo

约 420 个 src 文件、59 个 API route、29 个 npm scripts（2026-11-17 锁定导演线路之后的实数：src 下 418 个文件 / 415 个 .ts·tsx，
`src/app/api` 下 59 个 `route.ts`，package.json 29 个 scripts；11-16 瘦身前是 608 / 109 / 71）。全 repo grep 是本项目最大的 token 漏斗。

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
| `src/app/page.tsx` · `(public)/` · `(auth)/` | 公开首页「展厅」/ 法务页（/persona、/showcase 2026-10-28 已删）/ 登录注册（行情大屏 `/wall` 2026-11-17 随批量生产删除） |
| `src/app/l/[slug]` · `src/app/t/[code]` | 商家询盘页（匿名可访问）/ 追踪链接跳转（`route.ts`） |
| `src/app/api/` | 路由只做鉴权 + 参数校验，业务委托 `src/lib/services/` |
| `src/lib/services/` | 业务层（40 多个 service），Provider 层封装外部 API |
| `src/lib/contracts/` | 对外契约（`customer-api` / `videos-api` / …） |

## 3. 常用命令

```bash
npm run dev            # 真机模式（predev 会跑 mode:check）
npm run typecheck      # tsc --noEmit —— 提交前必过
npm run lint
npm test               # node --test tests/*.test.ts；要 Node 22+（pretest 会核对，旧版本有假失败）
npm run db:migrate:deploy  # 迁移唯一正路（owner 直连生产，见 §4）
# db:migrate / db:push / db:seed 有确认闸：CONFIRM_PRODUCTION_DB=<脚本名> 才放行
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
| 商品档案（侧栏「商品」：名字、卖点、尺寸、商品图存一次；独立新表 `ProductProfile`，没有外键，归档不删除） | 契约 `src/lib/contracts/product-profile.ts`，服务 `product-profile-service.ts`，页面 `/app/products`，接口 `/api/products`；创作页 `/app/create?product=<id>` |
| 接着拍这些商品（空白创作页那一行：存好的商品在前，不够四格用最近拍过、还没存的补） | `loadCreateShortcutsOrNone`（`product-profile-service.ts`）、`listRecentCreateSources`（`create-retry-prefill-service.ts`） |
| 商品尺寸（描述末尾补一行「商品实际大小：…」） | `src/lib/create/product-size.ts` |
| 品牌页的片尾落款预览（与合成同一套版式） | `src/components/brand/signoff-preview.tsx` |
| 配乐曲库（8 首；7 首由 Runway 生成配乐接口一次性生成、随仓库带，出片不调接口。11-17 起只在成片详情「只重新合成」里给以前没有原生配乐的片用：导演线路的配乐随片子出，创作页不摆曲库） | 目录 `src/lib/video-generation/bgm-catalog.ts`，文件 `public/audio/bgm/`，选曲组件 `bgm-picker.tsx`；加曲子：放文件 + 目录加一行 |
| 字幕跟着人声走（按语音识别对齐） | `alignCuesToSpeech`（`src/lib/video-generation/audio-post-production.ts`）、`src/lib/providers/openai-transcription.ts`；日志搜 `[captions]` |
| 上传卡住超时（直传存储一直没进展时中止并明说「上传卡住了」；存储客户端自己会不报错地重试十几分钟） | `src/lib/upload/stall-watchdog.ts`，接在 `uploadBlobWithProgress`（`blob-xhr.ts`）的直传那一步；日志搜 `[upload] direct upload stalled` |
| 导演线路（Claude 写镜头脚本 → GPT Image 2 出故事板（11-17 起缺省走 Shuyu，`frames --provider openai` 可直连 OpenAI）→ Shuyu Seedance 2.5 · 720P 出片；不走创作台、不碰库） | skill `aivora-director`；`npm run director -- check\|frames\|select\|video\|review\|post\|status tmp/director/<任务名>`（`post` = 本地烧字幕 / 角标 Logo / 落款 / 切条，复用线上合成器，不花点数）；纯逻辑 `src/lib/video-generation/director-plan.ts`（scripts 下那份只是转出）；让模型写镜头脚本的「导演写手」在 `director-writer.ts`，`npm run director -- draft` 可试 |
| 线上的导演线路（**11-17 起创作台唯一的出片方式**，和上一行用同一套规则、同一个提示词拼法：一份镜头脚本 → 一张开场帧 → 15 / 30 秒整条一次生成；字幕按每句台词的时间烧。要有商品实拍图；写手没写成就明说、让商家再点一次，不退回别的线路） | 判断（做不了的原因）与风格卡 `director-line-policy.ts`（客户端也用），写脚本 / 存脚本 / 参考图顺序 / 字幕时间 `director-line.ts`；脚本存在 `StoryboardRun.visualReference`（JSON，没加列），派发时抄进 `brief.directorPlan.directorLine`；接线在 `storyboard-service.ts`（`createStoryboardRun`、`expectedStoryboardFrameCount`）、`dispatch/route.ts`（没有脚本的旧故事板回 422）、`generation-supervisor.ts`（`buildPlan` 必须带脚本，不调模型）、`video-service.ts` 的 `dispatchVideoForBrief`、`stitch-composer.ts`；日志搜 `[director-line]` |
| 风格卡（创作页「创意模板」：21 种分五组——带货 / 种草 / 质感 / 剧情 / 场景，分类参照 Shuyu 创作台公开的预设清单；「自动匹配」= 由导演写手按商品定。每种 = 片种 + 一段交给写手的拍法要求，可以自己定开场；线上、新人向导（只摆 6 种）、命令行 `draft --style` 用同一张表。真机出过片的只有电商快销和探厂） | `DIRECTOR_STYLES`（`director-line-policy.ts`）；加一种风格在这里加一行，再回 skill `aivora-director` 的「风格卡」表补一行 |
| 右上角 Logo（创作页可选；透明的白色图形角标，全程挂着；图取自己默认品牌包的 Logo） | 快照里的 `cornerLogo` 开关；`stitch-composer.ts` 的 `resolveCornerLogoUrl`、`stitch-service.ts` 的 `overlayCornerLogo`；版式 `cornerLogoGeometry` / `cornerLogoFilter`（`director-plan.ts`，透明底 PNG 按透明度取形状，白底线稿按深浅） |
| 只重新合成（换字幕 / BGM / 落款，不扣额度） | `src/lib/video-generation/restitch-patch.ts`、`stitch-service` 的 `prepareRestitch` / `commitRestitch` |

供应商现状（2026-11-17）：生产只留 Shuyu（出图、出片）、OpenAI（写镜头脚本、出方案这类文字与看图的调用；开关打开时另做字幕的语音识别）两把付费密钥。
出图统一走 Shuyu 的 GPT Image 2（11-17 用户定：能统一用 Shuyu 就用 Shuyu）：导演线路的开场帧（线上和命令行）点名高质量档（`quality: "high"`，2K 约 48 点一张）。
**Runway 出片 11-16 由 CEO 决定彻底下线，出片与出图的代码当天已全部删除**（适配器、「高质量」选项、Shuyu 失败改交、灰度账号故事板出图、全员切换）。
只留读旧记录用的部分：`video-route-registry.ts` 里的 `runway` 线路定义（`enabled: false`，建不出新快照、供应商调用一律拒绝），
以及故事板帧旧 planId `runway:` 的守卫（`storyboard-service.ts`，不交给 Shuyu，提示重新生成这一帧）。
当初走 Runway 的旧成片照常看、照常只重新合成；「重做一段」「重试失败的段」会被明确拒绝，指到「用同样的素材再做一条」。
Shuyu 现在没有备用线路，明确失败就是失败（可重试、可免费取消）。
抠图、商品链接抓取、实拍图库与配音这几条线路的代码 11-17 已删（瘦身第 2 批）。
关着不用的那几样 11-17 也删了（瘦身第 4 批）：BytePlus / 火山直连出片（线路定义留在 `video-route-registry.ts` 里标成停用，只为读旧记录；
**11-17 锁定出片能力（甲方与 CEO 认可了导演线路的出品之后）**：创作台只走导演线路，围绕出品稳定与质量；别的都删了——
批量生产与模板库（页面、接口、定时任务、服务，旧网址由 `next.config.ts` 转走；以前做的批量成片仍在成品库，卡片直接打开成片文件）、
行情大屏、出方案预览与 AI 起口播稿两个接口、老的分帧故事板与镜头卡、原话英译、看图盘点、创意简报的模型调用、老的 34 个模板与一致性锁、
60 秒与纯文字创作、主播参考图、老的评测与压测脚本。`prompt-intelligence.ts`、`consistency-bible.ts`、`storyboard-beats.ts` 这几份还在：
它们拼的是方案 / 分段记录的形状（派发、合成、成品库都在读），段提示词已整段换成脚本拼出来的那一份；要删得连方案格式一起重写，并重新真机验证。
旧值 `VIDEO_PROVIDER=byteplus` 按 shuyu 处理并提醒删掉）、内容审核、出方案的完整模型链路（`PLANNING_FULL_LLM`）、故事板 AI 审帧（`STORYBOARD_AI_REVIEW`）。

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
  副标题一句话说清这页干什么，内部口径与规则解释不进页面正文。状态用 `StatusTick`（符号 + 颜色成对）。
- 壳层是 240px 分组侧栏（顶部「新建视频」就是创作页入口，下面是资产（成品库、商品、品牌）/ 帮助，不再重复列「创作」）+ 细顶栏（搜索、帮助、头像），移动端底部 tab 条；行情条、生产带、状态栏已退役，`/wall` 行情大屏 2026-11-17 删除。
  壳层数字来自同一个脉搏（`/api/exchange/pulse`），读数口径只从读数注册表取；状态词只从 `state-vocab` 取，「成交」只留给询盘。
- **对客户怎么称呼模型（2026-11-17 用户定）**：写明实际用的模型——出片是 Seedance 2.5，出开场画面是 GPT Image 2，写脚本是 AI 导演。
  不写「Shuyu」「合作方」「视频通道」这类说法（有门禁测试）；唯一的例外是隐私政策里披露数据处理方的那一段。客户页面上也不摆线路卡和模型清单。
- 眉题/kicker 一律禁止；页面标题自己承重。
- 要用户再点一次确认的事用 `ConfirmDialog`（`src/components/ui/confirm-dialog.tsx`），按钮写动作本身；`window.confirm` / `alert` 禁用（有门禁测试）。工作区正文 14px。
- `.x-wall` 名字是 10-24 的，样子早换了：现在是有间距的卡片网格，现行材质可以用。`.x-beam`（生成中的边框光束）与 `.x-hatch`（已取消的斜纹）只表示状态，不当装饰。`.x-frame` 已删。
- 方向契约在 `src/app/layout.tsx` body 首子节点的 HTML 注释里（grep `aivora-abyss-exchange`）。
