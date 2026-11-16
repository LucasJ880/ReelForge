# 代码瘦身计划（2026-11-16）

起因：用户要求把架构收到「目前质量最满意、最稳定」的那一套上——Shuyu 出图出片、OpenAI 出方案、导演线路，其余杂项删掉；Runway 全面下架。
本文是两份只读审计的汇总和分批方案。**写下本文时一行代码都没删**；每一批动手前要用户点头。

审计方法：按真实解析的 import 图（src / scripts / tests / e2e，静态 + 动态 import）算「从 Next.js 入口走不到的文件」。
局限：用 `readFileSync` 按路径读源码的测试不算引用方；活文件内部的死函数没量。

## 规矩

- 铁律 8（PRD §10.4）要求旧代码按「A 下线入口 → B 冻结 → C 删除」走，每级隔一个迭代。用户 11-16 明确要求直接删，
  这是用户的决定；本计划里凡是跳级的批次都单独标了「跳级」，动手前逐批确认。
- 数据库只加不删：表、列、枚举值一律不动。本计划没有任何迁移。
- 历史记录必须照样能打开：旧成片、旧线路快照读不出来算事故。
- 每一批单独一个提交，不和功能改动混；每一批都跑 `typecheck` + `lint` + 全量测试 + `next build`，推上去后看发布后冒烟。
- 删之前先查生产库里有没有在途任务指向要删的线路（只读查询）。

## 批次

### 第 0 批：零风险的外围（不碰产品代码）

| 内容 | 规模 | 备注 |
|---|---|---|
| 一次性脚本 79 个 + 对应的 44 条 npm scripts | 约 19,400 行 | 演示搭建、SunnyShutter 批跑、各轮验收、7 月迁移审计、排障一次性脚本。**留下**：导演线路、codemap / context、迁移与确认闸、`stitch-runner`、反馈报表、`eval/*`、`ops/soak-run`、Logo 贴印三件（`imprint-logo-composite`、`logo-imprint-compositor`、`still-motion-clip`——Logo 搁置但这是唯一保真的做法） |
| 没人 import 的依赖 | `apify-client`、`framer-motion`、`next-themes` | `puppeteer-core` 随它唯一的两个一次性脚本走 |
| 没有任何引用方的源码 | `src/lib/labels.ts`、`src/lib/providers/sync-labs.ts` + 它的测试、`tests/_aiusage_check.ts`、`tests/_videojob_check.ts` | |
| 旧原型与过期文档 | `designs/aivora-ops-workbench`（6.9M）、`designs/aivora-os`、根目录 `DIAGNOSIS.md` / `KNOWN_ISSUES.md` / `PROGRESS.md` / `design-qa.md` / `editorial-design-tokens.generated.json` / `artifacts/`、`.cursor/rules/` 里 34 个通用人设规则（留 `ai-context-workflow.mdc`） | |
| 跟着脚本一起失去引用方的源码 | 约 14 个文件 3,000 行（creative-evidence、business-insights、sunnyshutter 模板与流水线等） | 要改约 8 个测试 |
| 文档改正 | CLAUDE.md 的数字（route 96 个、scripts 数）、`.cursor` 那条过期警告、`docs/AI_CONTEXT_WORKFLOW.md` 里指向已删页面的内容 | |

### 第 1 批：Runway（跳级：11-16 才做 A 级）

整删 11 个文件约 2,600 行（5 个源码 882 行、6 个测试 1,731 行），另改约 39 个文件。没有 npm 依赖，Prisma 里没有任何 Runway 字样。

- 整删：`providers/runway.ts`、`video-generation/providers/runway-video-provider.ts`、`runway-rollout.ts`、`runway-fallback.ts`、
  `runway-storyboard-images.ts`；测试 `runway-{fallback,provider,route,storyboard-images}`、`kling-storyboard-prompt`、`customer-route-failover`。
- 「Shuyu 失败改交备用线路」两层一起删：事后改交写死了只在 runway / buddy 之间换；事前切换的唯一备用来源也只会给出 runway。删完是一个普通的可用性检查。
- **必须留下的读旧记录的部分**：`video-route-registry.ts` 里的 `"runway"` 线路 id、适配器名和那条线路定义（改成 `enabled: false`）；
  `video-route-cost.ts` 的 `runway: null`；故事板帧的 `"runway:gpt_image_2"` 旧 planId 守卫（不交给 Shuyu，提示重新生成这一帧）。
- **行为变化**：旧的 Runway 成片不能再「重做一段」「重试失败的段」，要给明确的拒绝（指到「用同样的素材再做一条」），不能是 500。只重新合成不受影响。
- 顺序（每步之后类型检查都是绿的）：① 线路目录契约、选择器组件、创作台 → ② `video-service` 的改交 / 转存 / Kling 分支 + `storyboard-beats` 的 Kling 提示词
  → ③ `storyboard-service` 的 Runway 分支 + 旧 planId 守卫 + soak 脚本 → ④ `video-route-selection`、dispatch 路由、`batch-service` → ⑤ provider 工厂与类型、线路定义停用、重做拒绝 → ⑥ `.env.example`、CLAUDE.md、codemap。
- 动手前只读查两个数，都要是 0：在途的 `VideoJob`（`videoProviderAdapterSnapshot = 'runway'`）、在途的 `StoryboardFrame`（`planId LIKE 'runway:%'`）。
- 上线后可从 Vercel 删的环境变量：`RUNWAYML_API_SECRET`、`RUNWAYML_BASE_URL`、`RUNWAY_VIDEO_RESOLUTION`、`RUNWAY_PREMIUM`、
  `RUNWAY_PILOT_ACCOUNTS`、`SHUYU_FALLBACK_TO_RUNWAY`、`VIDEO_CUSTOMER_ROUTE`。
- 不是 Runway、不要动：`bgm-catalog` 与曲库文件、首页那段在 Runway 网页里做的背景视频、设计稿里的「Runway 风格」、Shuyu 上的 Kling 套餐代码。

### 第 2 批：已下线的线路和判过不值得的开关（跳级）

| 内容 | 源码规模 | 还连着哪些活代码 | 备注 |
|---|---|---|---|
| 实拍图库 + 配音（b-roll） | 12 个文件 2,512 行 | 创作页入口判断、`stitch-composer` 的 b-roll 分支、能力探针 | 旧的 b-roll 成片不能再只重新合成（决策 13） |
| 商品链接抓取 | 3 个文件 287 行 | `product-link-service` 另被「本周内容」用着，跟决策 1 走 | |
| 抠图 | 7 个文件 2,218 行 | **每分钟的 `poll-videos` 定时任务还在调 `sweepProductAnchorCutouts`**；品牌页 | `ProductAnchor` 表留着；`remove-bg.ts` 是个永远返回「没处理」的空壳 |
| 能力探针里的下线线路 | `capability-probe-service.ts:556-661` | 每小时的定时任务 | 配音和审核的探针用 OpenAI 密钥，可能还在发请求（推断） |
| `STORYBOARD_DIRECTION` | 207 行 + 一处调用 | 可干净拿掉 | |
| `STORYBOARD_SHOT_CARDS_VISION` | 约 125 行 | 基本可拿掉 | 11-10 盲评与纯文字卡打平 |
| 旧的 director-service（不是导演线路） | 4 个文件 912 行 | 没有源码引用，7 个测试借它的内部函数 | |
| 没人调的旧 brief 路由 + publish | 17 个文件 2,080 行 | `render-status` 被旧的 golden-path 用例用着 | |
| `(internal)` 侧栏的三个死链接 | | 指向不存在的页面 | 整页去留跟决策 2 走 |

`tests/retired-api-lines.test.ts` 断言五个下线文件还在，随这一批一起改。

### 第 3 批：要用户拍板的（见下表，答了才动）

## 要拍板的 13 件事

| # | 问题 | 规模 | 我的建议 |
|---|---|---|---|
| 1 | 「本周内容」「战绩」「投放赛马」「产品图工作台」四个已从菜单撤掉的页面，彻底删还是以后放回来？ | 约 47 个文件 6,650 行；表留着 | 删。直接输网址还能进，等于没人维护的入口 |
| 2 | 成片画面质检（默认关、20 条 0 拦截）整套删？ | 13 个文件 3,303 行 + 测试约 2,600 行 | 删，但放最后做：它和两个定时任务缠在一起，旧成片上存的质检标记要照样读得出来 |
| 3 | 内容审核留不留将来能打开的口子？ | 4 个文件 454 行 | 留。很小，关着就是空操作，合规随时可能要 |
| 4 | BytePlus / 火山直连出片这条旧线路还用吗？ | 3 个文件 1,039 行，13 个测试 | 留。Shuyu 现在没有备用，这是唯一一条能顶上的直连线路 |
| 5 | 国内版部署（火山大模型、TOS 存储、短信登录）还做不做？ | 约 700 行 + 文档 | 你定。不做就删 |
| 6 | Stripe 收款近期上不上？ | 2 个文件 155 行 | 你定。不上就删，要用时一百多行重写不费事 |
| 7 | 抖音发布助手还在用吗？ | 5 个文件 1,116 行 | 你定 |
| 8 | 每天发给创始人的日报邮件还发吗？ | 2 个文件 639 行，每天定时跑 | 你定 |
| 9 | 7 月那批卡单排查 / 恢复脚本留着应急吗？ | 约 10 个脚本 | 删。是为旧管线写的，现在的卡单路径已经变了，git 历史里找得回 |
| 10 | 旧的整套浏览器验收（黄金路径、phase34、最终验收、视觉基线）还留吗？ | 28 个文件 4,640 行 + 16MB | 删。线上只跑发布后冒烟，这些用例测的页面有一半已经不存在 |
| 11 | 广交会展台套件、`public/demo` 的宠物店演示素材还留吗？ | 约 30MB | 展台套件你定；`public/demo` 先查库里有没有品牌包指着它，没有再删 |
| 12 | 出方案「完整模型链路」这条退路（`PLANNING_FULL_LLM`）删不删？ | 分散在三个文件里 | 留。精简版没和它在真实成片上比过，这是唯一的退路 |
| 13 | 历史上用实拍图库线路做的成片，以后不能再「只重新合成」，可以接受吗？ | 第 2 批的前提 | 接受 |

## 不删的

- mock 引擎（`dev:mock`、三套 Playwright 配置、5 个测试在用；生产环境被 `env.ts` 拦着）。
- 询盘后台 `/app/leads`（`/l/[slug]` 进来的询盘只有这一个界面）。
- `api/performance`（青砚那边在调）。
- TikTok 域名验证文件。
- 看着没用其实在用的依赖：`shadcn`、`tw-animate-css`、`@expo-google-fonts/noto-sans-sc`。

## 量

| | 文件 | 行 |
|---|---|---|
| 第 0 批 | 约 95 个脚本与源码 + 约 45 个设计 / 文档文件 | 约 23,000 |
| 第 1 批 Runway | 整删 11，改 39 | 约 2,600 + 改动 |
| 第 2 批 | 约 45 个源码 + 约 20 个测试 | 约 9,000 + 3,000 |
| 第 3 批（全按「删」算） | 约 80 个源码 + 28 个 Playwright | 约 14,000 + 4,640 |

本机磁盘上还有不进仓库的 `tmp/`（1.5G）、`test-results/`（262M），清不清不影响仓库。
