# Phase 1 入口执行报告

状态：**GATE 0 已通过；Phase 1 按人工冲突裁决继续。测试迁移对照表已由 Final Sprint 批准，当前停在 Neon 分支迁移 Gate。**

## 1. 历史任务隔离栏

- 决议截止线：`2026-07-13T14:35:00.000Z`。这是恢复执行时捕获的保守时间，可能多隔离决议后数分钟内创建的任务，但不会漏放更旧任务。
- 真实模式判定：`VIDEO_PROVIDER!=mock` 且 `VIDEO_ENGINE_MOCK=false`。
- 三层保护：`BatchJob` tick 入口、`VideoJob` claim 查询、provider `createVideoJob` 调用前最后守门。
- 人工决策：`RELEASED` / `EXPIRED`，记录操作者与时间；批次操作要求 `id + RUNNING + createdAt<=cutoff + updatedAt + decision IS NULL` compare-and-swap，并在同一事务处理旧 `QUEUED` 子任务。
- 迁移：`20260713_phase1_historical_dispatch_quarantine` 为 expand-only nullable 字段；未在生产库执行。
- 测试证据：mock 关闭且存在占位测试密钥时，隔离栏旧任务 provider 调用计数为 0；共 4 条隔离语义测试通过。

## 2. 北京 TOS 只读 manifest

- 生成位置：`.aivora-private/storage-migration-manifest.json`（git 忽略、权限 `0600`）。
- 生成时间：`2026-07-13T14:40:12.720Z`。
- 扫描方式：数据库 public schema 所有含 `id` 表的 text/text[]/json/jsonb 字段 + 仓库文本引用；只执行 `SELECT`。
- URL 查询参数与 hash 未持久化，避免泄漏签名 token。
- 总引用 2,030：数据库 871、仓库 1,159。
- 北京 TOS 67：其中数据库为 `VideoJob.outputVideoUrl` 36、`VideoBrief.finalVideoUrl` 10、`FinalVideo.stitchedVideoUrl` 7；其余 14 为文档、provider 与测试引用。
- Vercel Blob 234；人工证据已确认目标 store `aivora-blob` 为 IAD1/Public，region Gate 已解除。
- manifest 中 46 个北京 TOS canonical URL 去重对象均预计算 `migrations/beijing-tos/<sha256>/<filename>` 目标 key。
- 非 CEO 数据库对象 HEAD-only 预检：34 个对象，34/34 HTTP 403；未请求 body、未复制对象、未更新 Neon。后续需要 TOS 源凭证或签名读取。
- `migrationStarted=false`；公开 store 的受控访问升级已写入 backlog。
- Final Sprint 自主识别扫描共评估 15 组真实 Seedance/TOS 记录：1 组由脚本来源明确排除，14 组因历史数据没有 `requestOrigin=web_app` 而无法证明来自前端，且涉及两个匿名创建者指纹。按修订规则不得自行挑选，确认表见 `docs/s5-ceo-video-confirmation-table.md`。
- 新前端派发已写入 `requestOrigin=web_app`，后续可确定性识别。人工选定两条后，演练链固定为：迁移源段 → SHA-256 校验 → IAD1 Blob → Neon 分支库重拼/CAS 演练 → ffprobe → 成品库 → CEO 前端播放后置验收。

## 3. Volcengine 依赖审计

按最新人工裁决执行后的状态：

| 能力 | 仍在使用的位置 | 处置 |
|---|---|---|
| Volcengine LLM | `src/lib/ai/index.ts`、`src/lib/config/env.ts`、health 路径 | 实现保留且不是默认；活动调用点与 OpenAI 提案见 `docs/phase-1-llm-provider-inventory.md`，等待人工确认再改写 |
| Volcengine TTS | 活动路径仅保留 fail-closed compatibility stub；原实现与脚本已移入 `deploy/china-future/` | digital human 全 plan 封存，触发路径在 DB/provider 前失败 |
| OmniHuman | 活动路径仅保留 fail-closed compatibility stub；原实现、workflow、demo 脚本已移入 `deploy/china-future/` | 替代选型仅入 backlog |
| 北京 TOS | storage provider、health、迁移测试 | 依 GATE 0 决议保留至迁移验收完成 |

## 4. Phase 1 指令—测试冲突（已裁决）

Phase 1 要求统一 `/app` 信息架构、删除 B/C 平行页面、清除 B/C 通道分支；但当前测试把旧实现写成必须保留的契约，包括：

- `tests/auth-register-validation.test.ts`：注册成功必须跳 `/personal`，且注册必须硬编码 `PERSONAL`。
- `tests/persona-page-onboarding.test.ts`：必须保留 BUSINESS/PERSONAL 两张 persona 卡及不同入口。
- `tests/business-products-customer-strings.test.ts`：直接读取 `/business/products` 页面源码并要求 BUSINESS/PERSONAL 数据隔离。
- `tests/personal-customer-strings.test.ts`：直接读取 `/personal/*` 页面源码。
- `tests/business-locale-regression.test.ts`：固定枚举 `/business/*` 页面文件。
- `tests/final-acceptance/*` 与 E2E：固定访问 `/personal/*` 路径。
- `tests/brief-access-ownership.test.ts`、`src/lib/api-auth.ts` 相关测试：把 persona 隔离本身作为权限模型。

人工已批准逐测试的旧断言→新断言→实质保留对照表；统一旅程与 plan 权限矩阵测试已先行转绿。认证、ownership、客户安全文案、无内部术语泄漏四类实质必须 1:1 保留。旧测试仍须等统一 `/app` 在迁移后的数据库上可运行且 308 就位后再迁移。

删除顺序锁定：统一 `/app` 五区可运行 → 308 → 迁移后测试全绿 → 独立 deletion-only commit 删除旧页面。当前已完成 `/app` 五区代码与设计系统，并在 Neon 演练分支完成真实数据浏览器验收；生产迁移仍等待人工 Gate，因此 308 不提前落地。

## 5. 当前 Phase 1 实现状态

- Workspace / PlanEntitlement schema 与三份 expand-only 数据迁移已在 Neon `phase1-rehearsal-20260713` 分支成功执行并核验；生产分支尚未应用。
- `/app` 五区统一 shell、深色 Studio token、胶片计数条、成品库共享 actions 与 shell i18n 已实现；旧路径 308 尚未执行。
- starter/studio 已接入月生成配额与批次派发并发限制；digital human 两 plan 均关闭。
- 新统一旅程与 plan 权限矩阵测试已新增并通过；全量 Node 测试 633 passed、1 existing skipped、0 failed，typecheck/build 通过，lint 0 errors（7 warnings）；旧测试未迁移。
- 五区 1440/390 截图与移动无溢出复验已完成；待完成生产迁移、Lighthouse，然后按锁定顺序执行 308 与旧测试迁移。
- Buddy SL-A（仍锁定在 GATE 1 之后）。
