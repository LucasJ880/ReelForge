# Phase 1 · 旧测试迁移对照表（待人工 review）

状态：**APPROVED_BY_FINAL_SPRINT — 2026-07-13 总攻指令要求“按已批策略+对照表”执行。仍遵守统一 `/app` 可运行 → 308 → 迁移测试全绿 → deletion-only commit 的顺序。**

先行条件证据：`tests/unified-platform-journey.test.ts` 与 `tests/workspace-plan-permissions.test.ts` 已新增；最新 Phase 1 焦点测试 50/50 通过；全量 Node 测试 625 passed、1 existing skipped、0 failed。认证、ownership、客户安全文案、无内部术语泄漏的目标断言均按 1:1 实质保留。

## 1. 注册与公开入口

| 被迁移的测试 | 旧断言 | 新断言 | 保留的实质 |
|---|---|---|---|
| `auth-register-validation` · “register route…仅创建 PERSONAL” | 注册写死 `userType=PERSONAL`，不创建 BUSINESS | 注册显式写 `role=CUSTOMER`，原子创建唯一 starter Workspace；请求不能注入 role/plan；过渡期 persona 字段不作为授权依据 | **认证 1:1**：公开注册永远不能获得系统角色或 studio 权限 |
| `auth-register-validation` · “成功后 router.push('/personal')” | 注册登录后进入 `/personal` | 注册登录后进入 `/app/create` | 陌生用户注册后有唯一、可继续创作的落点 |
| `persona-page-onboarding` · “PERSONAL 自助注册入口” | persona 页 PERSONAL 卡指向 `/register`，BUSINESS 卡指向 invite-only login | 统一入口直接提供 `/register` 与 `/login`；不再让用户先选 B/C persona | 公开注册与已有账号登录都可达，未认证用户不能进入产品 |
| `persona-page-onboarding` · “BUSINESS invite-only / PERSONAL free” | B/C 两卡分别展示 invite-only/free | 自助注册只发 starter；studio 必须由受信任的 entitlement/支付流程授予 | **认证/授权 1:1**：公开请求不能自授高 plan |
| `persona-page-onboarding` · “PersonaCard 支持 ctaLabel/secondaryNote” | B/C 卡组件文案可配置 | 统一认证页 CTA 与 plan 说明可配置，且源码不含 persona 选择 | 保留可理解的 onboarding 文案，不保留 B/C UI |
| `persona-page-onboarding` · “登录/注册双向打通” | `/login`↔`/register` | 原断言不变，无需迁移 | 登录与注册互相可达 |

## 2. 认证与权限矩阵

目标矩阵只使用 `AdminRole`（CUSTOMER / REVIEWER / OPERATOR / SUPER_ADMIN）与 Workspace plan；starter/studio 不授予内部权限。

| 被迁移的测试 | 旧断言 | 新断言 | 保留的实质 |
|---|---|---|---|
| `api-auth-persona-matrix` · SUPER_ADMIN 全通行 | SUPER_ADMIN persona 可进 internal、B、C、generation | SUPER_ADMIN 可进 internal/reviewer/platform/generation | **认证 1:1**：最高系统角色能力不回退 |
| 同文件 · OPERATOR 全通行 | OPERATOR persona 可进 internal、B、C、generation | OPERATOR 可进 internal/reviewer/platform/generation | **认证 1:1**：运营角色能力不回退 |
| 同文件 · REVIEWER 受限 | REVIEWER 可进 reviewer/B/C/generation，不可 operator/internal | REVIEWER 可进 reviewer/platform/generation，不可 operator/internal | **认证 1:1**：reviewer 不越权 |
| 同文件 · PERSONAL customer | OPERATOR+PERSONAL 仅 personal/generation | CUSTOMER+starter 仅 platform/generation | **认证 1:1**：客户不可得到 admin/reviewer 权限 |
| 同文件 · BUSINESS customer | OPERATOR+BUSINESS 仅 business/generation | CUSTOMER+studio 仍仅 platform/generation | **认证 1:1**：高 plan 不提升系统权限 |
| 同文件 · userType=null 拒绝 | 未选 persona 不能生成 | CUSTOMER 缺默认 Workspace/plan 时 fail-closed；不再依赖 persona | **认证 1:1**：账号状态不完整时拒绝执行 |
| 同文件 · 未登录全拒绝 | 所有 surface 返回未登录 | platform/generation/internal/reviewer 均返回未登录 | **认证 1:1**：401 边界不变 |
| 同文件 · 跨 persona 防护 | BUSINESS 不能进 personal，反之亦然 | 两类旧客户都进入同一 platform；隔离改由 owner/workspace 强制 | persona 隔离被有意移除；**ownership 隔离 1:1 保留并成为唯一客户边界** |
| 同文件 · 旧 OPERATOR 回归 | legacy OPERATOR 全通行 | role=OPERATOR 的旧内部账号全通行；迁移不得把 `userType=OPERATOR/SUPER_ADMIN` 改成 CUSTOMER | **认证 1:1**：内部存量账号不降权也不误转客户 |
| `quota-service` · staff exemption | OPERATOR/SUPER_ADMIN persona 豁免 | 仅 OPERATOR/SUPER_ADMIN role 豁免；CUSTOMER 无论 plan 均不豁免 | **认证 1:1**：客户不能借字段伪装 staff |

## 3. Ownership / IDOR

| 被迁移的测试 | 旧断言 | 新断言 | 保留的实质 |
|---|---|---|---|
| `brief-access-ownership` · PERSONAL owner allow | userId 相同且 persona 匹配才 allow | CUSTOMER 的 user/workspace 是 owner 即 allow，plan 无关 | **ownership 1:1**：owner 可访问 |
| 同文件 · PERSONAL other forbid | 其他 PERSONAL brief forbidden | 其他 workspace 的 brief forbidden | **ownership 1:1**：跨客户拒绝 |
| 同文件 · BUSINESS owner allow | BUSINESS owner allow | studio CUSTOMER owner allow | **ownership 1:1** |
| 同文件 · BUSINESS owner + PERSONAL brief forbid | 同 owner 但 persona 历史值不同也拒绝 | 同 owner 的历史 PERSONAL/BUSINESS/null brief 均允许 | 删除 persona 数据孤岛；owner 判断仍严格，不扩大到其他用户 |
| 同文件 · OPERATOR bypass | OPERATOR 对所有 persona allow | OPERATOR role 对客户 brief allow | **ownership 1:1**：受信任运维 bypass |
| 同文件 · SUPER_ADMIN bypass | SUPER_ADMIN allow | 原断言不变，仅移除 persona 入参 | **ownership 1:1** |
| 同文件 · not-found | 客户查不存在 brief 得 not-found | 原断言不变 | 不泄漏不存在/他人资源差异 |
| 同文件 · missing caller | callerUserId 缺失 forbidden | 原断言不变 | fail-closed |
| 同文件 · legacy persona=null owner | owner 可看旧 brief | owner 可看任何历史 persona/null brief | 历史数据兼容且不放宽 owner 边界 |

## 4. 客户安全文案与成品库

以下测试文件保留，不删除；读取目标从两套页面改为统一 `/app/create`、`/app/library`、详情与共享 actions。

| 被迁移的测试 | 旧断言 | 新断言 | 保留的实质 |
|---|---|---|---|
| `personal-customer-strings` · 客户表面无内部术语 | 扫 personal 页面与统一输入组件 | 扫全部 platform 客户页面、shell、统一输入与共享 actions | **无内部术语泄漏 1:1**，覆盖面不缩小 |
| 同文件 · 列表不展示 raw enum | personal list 走 `derivePersonalStatus` | unified library service 只返回 customer-safe status/label，页面不渲染 Prisma enum | **客户安全文案 1:1** |
| 同文件 · 不展示 file:// / dead URL | list 用 `customerSafeFinalVideoUrl` 且 ready+URL 守门 | unified library service 同样过滤；只有 http(s)+ready 才显示播放/下载 | **URL 安全 1:1** |
| 同文件 · failed 有 retry CTA | personal list 显示重新生成与下一步 | unified list/detail 必须显示重新生成/重试入口及人话引导 | **客户安全文案 1:1**；当前统一页需在迁移时补齐 |
| 同文件 · 空态可理解 | personal 空态引导创建第一支 | `/app/library` 空态链接 `/app/create` 并有明确下一步 | **客户安全文案 1:1** |
| 同文件 · plan preview 不泄漏 raw prompt | 共享组件不渲染原 prompt | 原断言不变，无需路径迁移 | **无内部术语泄漏 1:1** |
| 同文件 · plan preview 用 Scene | 不展示 Segment | 原断言不变 | **无内部术语泄漏 1:1** |
| 同文件 · detail safe status/URL | personal detail 使用安全映射 | unified detail 使用同一安全映射且不渲染 enum | **客户安全文案 1:1** |
| 同文件 · detail ownership | createdById + staff bypass | unified detail query 必须带 owner/workspace 条件；staff bypass 走显式系统角色路径 | **ownership 1:1** |
| 同文件 · actions 文案/endpoint | 刷新、重试失败片段调用既有 API | unified detail 复用共享 actions 与相同 owner-checked API | **客户安全文案 + ownership 1:1** |
| 同文件 · render API ownership | API 使用 `checkBriefAccess`，不只看 OPERATOR role | 原语义不变；`checkBriefAccess` 改为 role+owner，不看 persona | **ownership 1:1** |
| `business-products-customer-strings` · 客户表面无内部术语 | 扫 business 页面 | 与 personal 审计共同扫描统一 platform 页面；两份测试都保留 | **无内部术语泄漏 1:1** |
| 同文件 · ready URL 守门 | business list 要 ready+URL | unified list/detail 要 ready+安全 URL | **URL 安全 1:1** |
| 同文件 · file:// 拦截 | business list 过滤非 http(s) | unified service 过滤非 http(s) | **URL 安全 1:1** |
| 同文件 · failed retry/support | business list 有重新生成/联系客服 | unified list/detail 有重新生成与可执行支持提示 | **客户安全文案 1:1**；当前统一页需补齐 |
| 同文件 · 过滤 PERSONAL persona | business list 排除 PERSONAL | unified list 不按 persona 过滤，只按 `createdById/workspace`；测试改为他人数据永不返回 | 删除 B/C 分支；**ownership 1:1** |
| 同文件 · detail status/URL | `deriveBusinessStatus`+safe URL | unified customer status adapter+safe URL | **客户安全文案 1:1** |
| 同文件 · detail ownership/persona redirect | owner guard + PERSONAL 重定向 | owner guard保留；历史 persona 不再重定向，非 owner 404/forbidden | **ownership 1:1**，移除 persona 分流 |
| 同文件 · actions 文案/endpoint | i18n 文案与 refresh/retry API | unified detail 复用相同 i18n/actions/API | **客户安全文案 1:1** |

## 5. i18n 与设计系统

| 被迁移的测试 | 旧断言 | 新断言 | 保留的实质 |
|---|---|---|---|
| `business-locale-regression` · 页面无硬编码英文页头 | 枚举 business 页面 | 枚举五个 `/app` 区及详情页，客户文案走字典 | 本地化覆盖不缩小 |
| 同文件 · zh/en 页头不同 | business products 字典有中英文 | unified nav/library/create 字典有中英文且内容不同 | 本地化语义保留 |
| `shell-i18n-wiring` · B/C shell 使用翻译 | 两套 sidebar/表单调用 `useTranslation` | PlatformShell 与统一输入调用 `useTranslation` | 客户导航可本地化 |
| 同文件 · 不硬编码 Home/Billing | 两套 sidebar 无英文硬编码 | 五区导航及 plan 文案无硬编码客户字符串 | 客户文案治理保留 |
| `editorial-source-compliance` · FOUNDATION_FILES | foundation 含 `/(personal)/design/page.tsx` | foundation 改为 platform layout/shell/create/library；所有颜色、emoji、视觉反模式断言原样 | 设计系统门禁 1:1 |

## 6. Final Acceptance / Playwright

下表只改路由与账号 fixture；并发、状态机、QA、性能、可访问性、截图阈值不得放宽。

| 被迁移的测试 | 旧断言 | 新断言 | 保留的实质 |
|---|---|---|---|
| `final-acceptance/smoke` · route smoke | `/design`、`/batch-create`、`/batches/:id`、personal videos/templates 均 <400 | `/app/create`、`/app/batches/new`、`/app/batches/:id`、`/app/library`、`/app/templates` 均 <400 | 关键产品路由无死链 |
| `journeys` J1 | old batch create/detail 跑 100 条、93/7、虚拟化/播放/下载 | 路径换 `/app/batches/*`，其余数值与断言完全不变 | 批量能力 1:1 |
| `journeys` J2 | 旧路径刷新/历史/重开/幂等 | 统一批次路径，所有状态与幂等断言不变 | 稳健性 1:1 |
| `journeys` J3 | 旧详情单条/全部重试 | 统一详情执行相同操作 | 重试语义 1:1 |
| `journeys` J4 | 旧创建 UI 边界/非法输入/双击/上传/50 图/取消 | 统一批次创建页，所有上限和响应断言不变 | 输入安全与幂等 1:1 |
| `journeys` J5 | 两批次并行；单条生成回 `/personal/videos` | 两批次并行；单条生成回 `/app/library` | 并发隔离、统一旅程与 ownership 1:1 |
| `journeys` J8 | personal→batch 旧路由 + Slow 3G/LCP/FPS | 对应 `/app` 路由；预算阈值不变 | 性能门禁 1:1 |
| `resilience` J7 | 旧批次页可见 timeout/stall 人话 | 统一批次页显示同样客户安全文案，不调 cron | watchdog 与无内部术语 1:1 |
| `resilience` J6 | 旧批次页显示 breaker pause/recover | 统一批次页相同状态机和文案 | 熔断恢复 1:1 |

## 7. 视觉与可访问性参数化用例

`editorial.visual.spec.ts` 和 `editorial.a11y.spec.ts` 对每个 route 各生成一条测试。每条仍执行桌面/移动截图、横向溢出、axe critical/serious=0、键盘焦点、200% reflow、reduced-motion；只替换 route fixture：

| fixture key | 旧路径 | 新路径 |
|---|---|---|
| design | `/design` | `/app/create`（统一视觉 foundation） |
| agent | `/personal/agent` | `/app/create` |
| create-video | `/personal/create-video` | `/app/create` |
| batch-create | `/batch-create` | `/app/batches/new` |
| batch-monitor | `/batches/:id` | `/app/batches/:id` |
| videos | `/personal/videos` | `/app/library` |
| templates | `/personal/templates` | `/app/templates` |
| login | `/login` | 不变 |

## 8. 测试支持 fixture 同步（非断言删除）

- `tests/final-acceptance/auth.setup.ts`、`seed-fixture.ts`、`tests/e2e/seed-visual-fixture.ts`：客户账号角色改为 CUSTOMER，确保 starter Workspace 存在；登录后等待 `/app/*`。
- `tests/e2e/editorial-fixtures.ts`：认证探测从 `/personal/videos` 改 `/app/library`，批次详情改 `/app/batches/:id`。
- 旧路由另增独立 308 矩阵测试；不拿“能最终到新页”替代精确 `status=308 + Location` 断言。

## 9. Review 后的锁定执行顺序

1. 按本表补齐统一页尚缺的 retry/support、共享 actions、i18n 与 CUSTOMER-role auth。
2. 先加旧路径 308，并逐项验证 status/Location/动态 ID 透传。
3. 迁移上述旧测试与 fixture；全量 unit + Playwright + 两档截图转绿。
4. 独立 deletion-only commit 只删除 `src/app/(personal)/**` 与 `src/app/(business)/**`；不夹带重定向、测试或产品代码。

对照表已由 Final Sprint 指令批准。执行仍停在数据库 Gate：统一 `/app` 必须先在迁移后的数据库上可运行，之后才能按第 9 节顺序落 308、迁移旧测试与执行 deletion-only commit。
