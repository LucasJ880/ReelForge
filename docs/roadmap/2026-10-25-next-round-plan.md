# 下一轮更新方向（2026-10-25）：先「可靠、可申请试点」，再「多出片」

> 依据：四路只读调研（买单意愿与竞品 / 成片质量 / 跨模块 UI / 隐藏 bug）+ 创始人截图，
> 再经四个视角（可行性 / 钱与数据安全 / 产品价值 / 完整性）对抗式复审后修订。
> 证据（会话临时目录，结论已摘入本文）：`scratchpad/plan/reports/{research,quality,ui,bughunt}.md`。
> 创始人已授权本轮直接执行到落地（含真实扣费的端到端测试）。本文既是执行计划，也是验收清单。

## 0. 结论

**下一轮不主攻「画质」，主攻「可靠 + 可申请试点」。**

1. **买单卡在「证明不了效果」和「没有购买路径」，不在画质。** TikTok Symphony、Meta、Google Pomelli 已把「AI 产品视频」免费化；上门服务商按线索付费（Google LSA ≈ US$53/线索）。我们零付费客户、零「发布→回流」数据，`/` 直接跳登录。
2. **收费之前先得算对钱。** 批量额度先扣、失败不退；清扫器把从未提交的队尾判死；单条「取消」是假取消；后台「删除用户」物理级联删光客户数据；生产帧质检从没真跑过；0804 的清扫修复一直没合进 main（已于 `de8f698` 合入）。
3. **界面在「同一件事给出不同答案」。** 「生成中」五套口径、终身失败徽标、暂停显示生成中、同一状态多种叫法、壳层数据冻在首次加载。
4. **画质够做「产品主场 / 氛围」片，不够做收费带货广告。** 差的是良率工程和广告结构，不是换模型。

**本轮顺序：① 钱和数据不出错 → ② 每条线路真的通 → ③ 数字和状态是真的、各模块像一个产品 → ④ 成片地板 → ⑤ 试点申请与获客证明的最小闭环。** 「可收费」本轮不写代码：首个试点用手工 Stripe 发票或 Payment Link。

## 1. 本轮已定的口径（复审后拍板，执行以此为准）

| # | 决定 |
|---|---|
| D1 额度 | **客户只为已交付的成片计数。** 失败（含已提交后供应商失败、质检拦截）与取消一律返还。按条记账：`VideoJob.quotaRefundedAt` / `VideoBrief.quotaRefundedAt` 防重；同一个 Serializable 事务里递减扣费当月（取授权那条 UsageLog 的月份）的 `UserUsagePeriod`（VIDEO_DISPATCH 与 SEEDANCE_SEGMENT）并写负数 UsageLog；没有正向授权记录（豁免会话、脚本、历史回填）的只打标记不动计量；**只处理本轮上线之后才进入终态的数据**，历史不追溯；已返还的条目再重试，先重新扣 1 条，扣不到就拒绝。返还由清扫器里的对账函数做，不嵌进 tick 热路径，异常不抛进 tick。 |
| D2 帧质检 | 文字门禁照旧拦截（设计如此），单段质检拦截后的免费重试上限 2 次；新增黑边 / 近静止检查**只记录不拦截**（影子模式，写 `frameQaDetail`）；质检只在有预算的 cron 上下文里跑，用户面轮询遇到「供应商已完成」时 `defer`，由 cron 收尾（最多晚 1 分钟）；cron 设 `maxDuration` 与每次调用的质检条数 / 时长预算。 |
| D3 批次互斥 | 放弃 advisory lock（pooler 会泄漏，CLAUDE.md §4.1），改用 `BatchJob.tickLeaseUntil/tickLeaseOwner` 做 CAS 租约。 |
| D4 公开获客面 | 询盘页与追踪链接**只对管理员开通的工作区生效**（`leadPageEnabled` 由超管打开，slug 有保留词表）；追踪链接目标只允许本工作区询盘页或超管登记的 https 商家域名（不做开放跳转）；`/t` 过滤爬虫 UA、HEAD 不计数、按访客哈希去重；公开提交只走 `/api/public/leads`、`/api/public/pilot-applications` 两个精确端点（蜜罐 + 按访客哈希限流 + 人话报错与备用联系方式）。 |
| D5 新注册 | 本轮上线后新注册的自助账号进入「试用」额度：每月 3 条视频 / 6 段画面，产品图与内容计划按小时限流；**存量账号不变**（SunnyShutter 等）。登录页主行动改为「申请试点」，注册入口保留但降为次要。 |
| D6 发布与回滚 | 迁移已于本轮开工前应用到生产（只加不删，旧代码不受影响）。新代码写出 `CANCELLED` 后**不做 Vercel 回滚，只前滚修复**。 |
| D7 青砚游标 | 不改现有 `since / next_since` 语义；新增可选 `cursor`（时间 + id 复合、升序）与 `has_more`，青砚确认后再切换。 |
| D8 线索通知 | 新线索与试点申请 60 秒内通知：配置了 `RESEND_API_KEY` + `EMAIL_FROM` 时发邮件（直接调 REST，不引 SDK）；未配置时站内角标 + 每日汇总脚本兜底。**发信 key 与域名 DNS 是创始人要提供的外部依赖。** |
| D9 展位线索 | 写一个把本机 `~/.aivora-booth` 线索导入 `PilotApplication`（`source=canton-fair`，`externalRef` 幂等）的脚本，由主线程在 10/27 前跑。 |
| D10 开发隔离 | 并行工作流的 worktree 里**不放 `.env.local`、不调真实供应商、不写生产库**；需要数据库的测试与开发服务器一律连本地 Docker 库。真实扣费只在第 5 节验收阶段由主线程做。 |

## 2. 执行编排

| 阶段 | 内容 |
|---|---|
| 0 ✅ | 合入 0804 清扫修复（`de8f698`）；一次性只加不删的迁移（本地库 → 演练分支 → **生产已应用**）；接缝提交：`rate-limit-service`、middleware 精确放行公开入口、`frame-qa-gate` 决策点、公开面零瑕疵样片名单 |
| A | 七条工作流在各自 worktree 并行：A1a 钱、A1b 运维、A2 单条与故事板、A3 媒体运行时、A4 安全与成本、A5 获客闭环、A6 成片地板 |
| A′ | 主线程逐个合入（A6 先于 A5），处理胶水：批次取消联动故事板取消、导航新增「询盘」图标；每次合入跑 typecheck + lint + 全量测试 |
| B | 界面两条**串行**：B1 真相层先合，B2 页面骨架与控件层基于 B1 再做 |
| C | 对抗式复审（钱与数据 / 安全 / 回归 / 界面一致性），修完再发 |
| D | 推 main → Vercel 部署 → 冒烟；模板框架版本 2 重新入库（先 dry-run 列出将归档的 slug，跑完核对 ACTIVE 仍为 34） |
| E | 生产真机验收：试点商家全旅程 + 线路真值表，发现问题即修即发 |

## 3. 工作流条目

P0 = 钱 / 数据 / 安全；P1 = 用户可见的错误行为；P2 = 潜在问题与打磨。每条都带回归测试。

### A1a 钱（P0）
归属：`quota-service.ts`、`sweep-service.ts`（仅新增对账函数）、`src/app/api/batches/route.ts`、`batch-create-wizard.tsx`、`batch-service.ts`（取消 / 授权失败 / 重试计费段）、`src/app/api/video-generation/dispatch/route.ts`（仅补偿分支）

| # | 修法 |
|---|---|
| 1.1 | D1 按条返还：批量与单条两条路径；对账函数挂在清扫器里；重试已返还条目先重新扣费 |
| 1.2 | 额度授权失败的批次 CAS 改已取消，幂等键改写为 `cancelled:<id>:<原key>` |
| 1.3 | 多分组提交：每组独立稳定 key，成功的组出队；取消后再提交不 replay 已取消批次 |
| 1.4 | 单条派发扣费后异常抛出：零任务证据分支补偿（`compensateDirectDispatchQuota` 新增分支） |
| 1.5 | 「完成 + 取消」不再显示部分失败；取消单独成态 |

### A1b 运维（P0/P1）
归属：`batch-service.ts`（tick、槽位、计数同步段）、`sweep-service.ts`（既有清扫段）、`batch-style-templates.ts`、`src/lib/providers/shuyu.ts`、`video-generation/providers/shuyu*`、`capability-probe-service.ts`、`vercel.json`（仅 cron 计划）、`videos-sync-service.ts` 与 `src/lib/contracts/videos-api.ts`

| # | 修法 |
|---|---|
| 2.1 | **重试路径的清扫修复**：排队豁免与绝对上限按 `COALESCE(availableAt, createdAt)` 计时（`de8f698` 只修了首次排队）；回归：13 小时前的批次「重试全部」后第 2、3 波 60 分钟内不被杀、已提交行先 reconcile |
| 2.2 | 批次 tick 租约（D3）；`syncBatchCounts` 带租约 / updatedAt 条件 |
| 2.3 | 参考图：实拍放第一位、槽位按真实顺序编号、按套餐上限截断；Shuyu 审计上限 / 适配器上限 / 能力探测要求三处统一（与 2.6 同一次提交） |
| 2.4 | 等待合成的 FinalVideo：只筛「分段全成功」并排序；孤儿改为失败（只改状态） |
| 2.5 | 单条派发中途异常留下的「无任务 brief」：只处理由自助派发产生、对应派发请求已不在处理中、且在本轮上线之后创建的；内部代运营流程的 brief 不受影响 |
| 2.6 | 能力探测 cron 每小时一次 |
| 2.7 | 青砚游标（D7） |
| 2.8 | 停用账号的排队批次不再推进（`processBatchTick` 与故事板轮询跳过 `disabledAt` 非空的用户） |

### A2 单条创作、故事板与真取消（P0）
归属：`storyboard-service.ts`、`video-service.ts`（除帧质检门禁段以外）、`src/app/api/video-generation/**`（除 dispatch 补偿分支）、`src/app/api/storyboard*/**`、`src/app/api/briefs/**`、`streamlined-video-studio.tsx`（仅取消 / 重试 / 高亮逻辑）、`create/page.tsx`

| # | 修法 |
|---|---|
| 3.1 | 故事板真取消：只取消 GENERATING / AWAITING_APPROVAL；QUEUED 帧不再提交，已提交与 ACK_UNKNOWN 的帧继续对账收回素材；有派发预留或已挂 brief 的拒绝取消；解绑 brief / job / reservation，幂等键改写墓碑值；所有状态写入改成显式源状态的 `updateMany`；导出 `cancelStoryboardRun` 与 `cancelStoryboardRunsForVideoJobs(jobIds)` |
| 3.2 | 单条「取消这一轮」调用服务端取消，不再只写浏览器存储 |
| 3.3 | 故事板创建与单帧重生成：按用户直接发起的次数限流（批量内部准备不计）；单帧封顶 3 次 |
| 3.4 | 单条路径实拍与故事板帧并存，实拍优先 |
| 3.5 | 成品库 `?retry=` 预填原订单素材与方向；`?highlight=` 在成品库高亮 |
| 3.6 | `pollRunningJobs` 排除批量任务、按上次检查时间排序 |

### A3 媒体运行时：ffmpeg、帧质检、品牌封装（P0）
归属：`frame-qa-gate.ts`、`frame-qa.ts`、`brand-overlay-renderer.ts`、`brand-packaging-service.ts`、`brand-end-card-renderer.ts`、`tail-trim.ts`、`stitch-service.ts`、`scripts/stitch-runner.ts`、新增 `src/lib/media/ffmpeg-bin.ts`、`next.config.ts`、`package.json`、`src/app/api/cron/**`（`maxDuration` 与质检上下文）、新增 `src/app/api/health/media`、字体与 BGM 资产

| # | 修法 |
|---|---|
| 4.1 | 打包静态 ffmpeg（`serverExternalPackages` + `outputFileTracingIncludes` 精确到 linux-x64 单个二进制），只给真正需要的函数（poll-videos、process-batches、品牌封装、健康探针）；`ffmpeg-bin` 找不到静态二进制时回退 PATH；GitHub Actions 的拼接 runner 不引用 `ffmpeg-static` |
| 4.2 | 中文字体 + fontconfig、BGM 文件随函数打包；品牌封装验收抽帧人眼看字幕与尾卡文字 |
| 4.3 | D2：质检结果落库（PASSED / BLOCKED / WOULD_BLOCK / SKIPPED）；非 cron 上下文 `defer`；cron 预算；拦截后免费重试上限 |
| 4.4 | 黑边（cropdetect）与近静止（freezedetect）影子检查 |
| 4.5 | 拼接（runner 与品牌封装两处）保留源帧率，不再强转 30fps |
| 4.6 | `/api/health/media`：handler 内 fail-closed 机器鉴权；返回 ffmpeg 版本 + 1 秒合成（含中文字幕与尾卡文字）探针 |
| 4.7 | 构建后核算各函数体积 ≤ 250MB（`.next` trace 统计） |

### A4 安全与成本护栏（P0）
归属：`src/app/api/admin/users/**`、`(internal)/internal/settings/admin-row.tsx`、`src/lib/auth.ts`、注册路由、`quota-tiers.ts`、`content-post-render-service.ts` 与其路由、内容计划 / 链接抓取 / 产品锚点 / b-roll 路由、`product-link-service.ts`、`product-image-service.ts`（仅取消 CAS）、Stripe 成功页链接

| # | 修法 |
|---|---|
| 5.1 | 删除用户改停用：`disabledAt`，DELETE 返回 405，后台按钮改「停用」；停用时同一事务取消该用户排队任务与生成中故事板；停用检查在 `requireSession` / API 层查库（不放 middleware） |
| 5.2 | D5 新注册试用额度；付费入口按用户直接发起次数限流（复用 RateLimitBucket） |
| 5.3 | 图文出图：按 slide 补缺、写状态带 CAS、`renderStartedAt` 渲染锁 |
| 5.4 | 链接抓取 SSRF：解析 DNS 校验 IP 段，手动逐跳复检 |
| 5.5 | 产品图取消加 CAS；Stripe 成功页死链顺手修 |
| 5.6 | 本周内容兜底文案不再编造「免费上门量尺」「实拍」，CTA 指向询盘页或「点主页链接预约」 |

### A5 试点申请与获客证明的最小闭环（P1）
归属：`src/app/page.tsx`、新增 `src/app/(public)/l/**`、`src/app/t/**`、`src/app/(platform)/app/leads/**`、`src/app/api/leads/**`、`src/app/api/public/**`、新增 `lead-service.ts`、`tracked-link-service.ts`、`notification-service.ts`、`src/lib/platform-routes.ts`、新增 `src/i18n/growth-copy.ts`、`scripts/import-booth-leads.ts`

| # | 做什么 |
|---|---|
| 6.1 | `/` 最小公开首页：讲试点结构（30 天、失败不计费、结果承诺，数字待拍板），不讲效果主张；样片只用公开面零瑕疵名单；「申请 30 天试点」表单；已登录直达工作台 |
| 6.2 | 商家询盘页 `/l/[slug]`（D4）：预约量尺 / 询价表单（姓名、电话、服务、期望时间、「您从哪里看到我们」、同意条款 + 版本号），去重键，落库 `Lead` |
| 6.3 | 追踪链接 `/t/[code]`（D4）：按渠道手工建（IG 主页、Google 商家主页、Facebook、二维码），点击日志区分爬虫 |
| 6.4 | 工作台「询盘」：列表 + 状态流转（时间戳）+ 手工录入（电话来的）+ 读数墙先只放询盘 / 点击 / 来源；超管可见试点申请只读列表与询盘页开通开关 |
| 6.5 | D8 通知；D9 展位线索导入脚本 |

### A6 成片地板（P1）
归属：`commerce-template-catalog.ts`、`generic-commerce-template.ts`、`style-templates.ts`、`template-sample.ts`、`audio-caption-controls.tsx`（仅隐藏未实现选项）

| # | 修法 |
|---|---|
| 7.1 | 框架版本 2：只许硬切，负面词加 crossfade / dissolve / double exposure / ghosting |
| 7.2 | 收尾静止段缩到 2 秒；钩子 beat 改「第一秒就是产品最强的一面」 |
| 7.3 | 人物 / 宠物模板写死单一主体特征 |
| 7.4 | 8 个 commerce-* 模板的预览与旧模板 md5 相同（16 对文件）：两份白名单都撤；门禁测试：白名单内预览文件 md5 两两不同 |
| 7.5 | 「逐词强调 / 跟读高亮」渲染层未实现：先隐藏控件 |
| 7.6 | BGM 署名随交付 |

### B1 真相层：一个脉搏 + 一本词典（先做，先合）
归属：`exchange-readings.ts`、新增 `src/lib/exchange/state-vocab.ts`、`readings-registry.ts`、`status-tick.tsx` 及其**全部调用方**、`local-time.tsx`、`exchange-tape.tsx`、`platform-shell.tsx`、`(platform)/app/layout.tsx`、新增 `/api/exchange/pulse`、`unified-library-service.ts`、`library/page.tsx`、`batches/page.tsx`、`batches/new/page.tsx`、`wall/page.tsx`、`making-process-timeline.tsx`、`templates/page.tsx`（仅读数）、`platform-copy.ts` 的状态词段

| # | 修法 |
|---|---|
| B1.1 | `loadPulse()`：生成中视频条数 / 排队 / 暂停批次 / 待出图 / 需要处理；「生成中」只指真在生成的视频；批次数叫「进行中批次」不含暂停；顶栏状态、徽标、成交带改客户端小岛，可见时每 30 秒拉 `/api/exchange/pulse`，提交 / 取消后主动刷新 |
| B1.2 | 只收敛已互相矛盾的读数（生成中、失败、成片数截断、额度格）：DB count / groupBy，同名必同值；成片只数视频，短视频帖单列待生产；额度格读 `UserUsagePeriod` |
| B1.3 | `state-vocab`：排队中 / 生成中 / 已暂停 / 已成片（条）· 已完成（批）/ 部分失败 / 失败 / 已取消；**「成交」只留给询盘**，视频侧统一「已成片」，成交带改名「生产带」；StatusTick 只接状态（保留兼容层到调用方迁完）；加 `queued` 记号；「样例」「草案」不用状态记号 |
| B1.4 | 契约加 `paused` 与 `cancelled`；暂停不挂光束、不显示 0% |
| B1.5 | 徽标 = 近 7 天、未重试成功、未确认的失败；成品库「需要处理」列出失败行（原因 + 重试 / 联系支持），批量失败链到批次详情；「看过即清」用 `Workspace.failuresAckedAt` |
| B1.6 | 成品库每来源提到 300 条并显示截断提示；`safeParse` 丢坏行并上报（游标分页下一轮） |
| B1.7 | `LocalTime` 扩展日期 / 日期时间 / 相对时间；服务端只传 ISO；非今天显示月日 |
| B1.8 | 壳层：`overscroll-behavior-y: none` 止血；顶栏与导轨高度共用一个变量；导轨内部可滚；头像改账户菜单；工作区芯片去掉假下拉；套餐名映射（入门版 / 专业版） |

### B2 页面骨架与控件层（基于 B1 合入后的 main）
归属：`quote-header.tsx`、新增 `workspace-page.tsx`、`empty-state.tsx`、`customer-route-loading.tsx`、`customer-route-error.tsx`、`plan-timeline.tsx/.module.css`、`plan/page.tsx`、`wins/**`、`brands/**` 与 `components/brand/**`、`library/[id]/**`、`template-library-grid.tsx`、`first-run-onboarding-dialog.tsx`、`batch-monitor.tsx`（只读模式与移动布局）、`streamlined-video-studio.tsx` 与 `product-image-studio.tsx`（仅文案）、`platform-copy.ts`（非状态词段）、`public-copy.ts`、`not-found.tsx`、`(auth)/**`

| # | 修法 |
|---|---|
| B2.1 | 行情头：标题 = 导航名、口号进副标题、主行动显式插槽、模式切换独立插槽、读数与口径必填；迁本周内容、品牌、成片详情；新建批次、批次详情、成品库补统计口径 |
| B2.2 | 选中态统一 `Segmented / FilterChip`；空态按钮描边；统一 `EmptyState` |
| B2.3 | 本周内容：选择器止血 + 共享 Button；文案进 platform-copy（双语）；「今天」在客户端按计划起始日算 |
| B2.4 | 品牌页：一枚主钮；预览底色 token；去「TRUSTED BY」眉题 |
| B2.5 | 内部术语外泄（Image 2、workspace、旧 TTS、青砚、提示词原文、「项目」）；门禁测试：客户可见文案禁词表 + 英文界面不得出现中文 |
| B2.6 | 登录页口号与首页一致（不再「赛出赢家」）；隐私 / 条款正文去掉运营待办与环境变量名 |
| B2.7 | 404 双语、回到壳层；战绩页文案进 platform-copy |
| B2.8 | 创作流程步数统一；首用弹窗改共享 Dialog（Esc、焦点陷阱） |
| B2.9 | 批次详情：样片批次只读模式；窄屏两行卡片布局 |

## 4. 迁移（已应用到生产）

`prisma/migrations/20261025010000_reliability_growth_round`：只加列 / 加表 / 加枚举值，开头 `SET lock_timeout = '5s'`。
- `AdminUser.disabledAt/disabledReason`；`StoryboardRunStatus.CANCELLED`
- `VideoJob.frameQaStatus/frameQaCheckedAt/frameQaDetail/quotaRefundedAt`；`VideoBrief.quotaRefundedAt`
- `BatchJob.quotaRefundedAt/quotaRefundedCount/tickLeaseUntil/tickLeaseOwner`；`ContentPost.renderStartedAt`
- `Workspace.publicSlug/leadPageEnabled/leadPageConfig/failuresAckedAt`
- 新表 `Lead`（含状态时间戳、去重键、自报来源、同意版本）、`TrackedLink`（含渠道）、`LinkClick`（含爬虫标记）、`PilotApplication`（兼容展位：邮箱 / 公司可空，WhatsApp、微信、externalRef、逐渠道同意）；外键一律 Restrict
- 演练分支先跑（修复了演练分支上 08-04 迁移因非 owner 角色失败留下的记录），再走 `npm run db:migrate:deploy` 应用生产；生产冒烟正常。

## 5. 真机验收（本轮放行门槛）

**账号**：脚本创建的 CUSTOMER / BUSINESS、starter 套餐、非豁免、本月有余量的验收账号；所有验收数据打 `source=e2e-1025` 标签，结束后归档并停用账号。不用 demo 账号；不用任何物理删除脚本。
**预算**：Shuyu ≤ 20,000 点，gpt-image ≤ 40 张；脚本每次提交前累计核对，超出就拒绝。

1. **试点商家全旅程（生产）**：未登录手机提交试点申请 → 创始人收到通知 → 脚本开通验收工作区 → 品牌包 → 1 条单条视频（`frameQaStatus` 由生产 cron 写入）→ 一句话排一周、1 条轮播出图 → 渠道追踪链接 → 未登录访问并提交询盘 → 商家收到通知 → 工作台改状态 → 脉搏与大屏数字一致。
2. **线路真值表**：Shuyu、gpt-image、OpenAI 文本 / TTS / 审核、Firecrawl、Pexels、火山引擎、Vercel 上的 ffmpeg（健康探针）、各 cron、青砚同步——逐条标「通 / 不通 / 阻塞（原因）」，已知不通的标红。
3. **钱**：3 条批量（核对 `UserUsagePeriod` 前后差值只扣已交付条数）；提交后立即取消（未交付条数返还、不重复返还）；单条故事板生成中取消（不再出帧、素材保留）。

验收页做成 artifact，每步附记录 ID、时间、花费和截图；文字版写入 `docs/acceptance/2026-10-25-reliability-round-acceptance.md`。

## 6. 不在本轮

- 完整 AI 销售 Agent、IG 评论链（等每周 ≥5 条购买意图评论的实测）；来电追踪（Twilio 号码）——下一轮明确依赖。
- 公开价格与 Stripe 计费代码（等定价拍板）；首个试点手工开发票。
- 平台出钱的自动重抽；鬼影 / 换人拦截级质检（先影子模式攒数据）。
- 1080P / 换模型（等 BytePlus 凭证或火山充值）。
- 广告结构层（大字钩子、商家卖点进口播、逐词高亮字幕、扩曲库）——下一轮质量主题。
- 成品库游标分页；导轨结构重构；逐页 `generateMetadata`；骨架屏重做；投放与赛马页面迁移（赛马已 A 级下线，内核有统计错误，见 `recipe-racing-service.ts:146`）。
- 剩余 6 个模板样片重出（等框架版本 2 上线后一起）。

## 7. 需要创始人提供 / 拍板

1. 发信：`RESEND_API_KEY` 与发信域名 DNS（没有就先站内 + 每日汇总）。
2. 隐私政策：法律主体名称与隐私联系邮箱；询盘页同意文案（商家是收集方、Aivora 是处理方）。在此之前询盘页只在验收工作区开启。
3. 试点报价与结果承诺的具体数字（附录是调研建议）。
4. 「成交」一词改归询盘、视频侧改「已成片」——本轮按此执行，如不同意可回改文案。
5. 首个真实开通询盘页的工作区：建议 SunnyShutter（对外标明关联方）。

## 附录：定价与试点建议（调研，待创始人拍板）

- 不卖积分；失败、取消、迭代永远不计数。
- 试点 30 天 CAD 750（可抵首月），附结果承诺：按约定发帖并投入 ≥ CAD 300 推广，30 天内追踪到的询盘 < 3 条，退一半或免费续一个月。
- 月费并测：A 包干 CAD 1,200；B 底费 CAD 400–500 + 每个核实的量尺预约 CAD 60–90（封顶）。
- 广交会二期（10/23–27）展位线索 48 小时内跟进，每次交谈当价格访谈。
