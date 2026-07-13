# Phase 0 · 完成度审计与航向校正

审计日期：2026-07-13（America/Toronto）  
当前部署语境：加拿大公司与运营、北美 Neon/托管栈、国际英语市场、B2B 优先。中国大陆部署不在当前路线图。

## 1. 旧六阶段完成度

| 旧阶段 | 状态 | 证据 | 缺口与承接 |
|---|---:|---|---|
| 数据库恢复 | ✅ | `prisma validate` 通过；连接 Neon `us-east-1` pooler；10 个 migration，`Database schema is up to date`。只读聚合可正常返回。 | 数据库本身已恢复。88 个 QUEUED VideoJob 与 6 个非终态 FinalVideo 是流水线/运维积压，不是数据库不可达；承接 Phase 5a 与上线终检。 |
| 分镜一致性 | ⚠️ | 已有 `DirectorPlan`、多段 lifecycle、首末帧、reference mode、拼接与重试测试；BytePlus 迁移后的 payload 聚焦测试已通过。 | 尚无“同一主体跨多段”的真实视觉回归证据；真实 provider 测试受成本 Gate 约束。承接 Phase 2 模板样例与 Phase 5b 金丝雀。 |
| 批量三层信息架构 | ⚠️ | `/batch-create`、`/batches/[id]`、`BatchJob → VideoJob` 数据层、monitor/cancel/retry/status API 已存在；200 卡片虚拟化、15s 单聚合轮询、上传/批次 API 契约测试通过。数据库中 13 个历史批次（11 RUNNING、2 FAILED），VideoJob 为 87 SUCCEEDED / 88 QUEUED / 16 FAILED / 6 CANCELLED。 | 历史 mock 批次没有完成闭环；尚未证明 L1/L2/L3 在统一平台 IA 下完整可用。承接 Phase 1 统一 IA 与 Phase 5a 压测。 |
| UI 质感 | ⚠️ | persona 入口与冻结 Showcase 已采集 1440/390 两档基线；DOM 可访问性树完整。见 `docs/evidence/phase-0/`。 | persona 截图暴露严重的窄列逐词换行/版面留白问题；同时 UI 仍按 `/personal` 与 `/business` 分裂。Phase 1 统一 IA 时必须修复并重新截图。 |
| 200 条批量验证 | ❌ | 实库无一笔完成的 200 条验收批次；现有历史记录不能证明完成率、耗时、幂等或 QA 双层门禁。 | 按 v2 改为 Phase 5a：500 条 × 3 轮 mock；Phase 5c 再做 200 条真实批次，均受 Gate 约束。 |
| 上线终检 | ❌ | 当前 typecheck 可通过、Neon schema 正常；但全量测试/构建/安全与演示 runbook 尚未形成一次性全绿证据。 | 承接 Phase 6。当前不能宣称 production-ready。 |

## 2. 本轮数据健康快照（只读）

- Neon：`ep-…-pooler.c-5.us-east-1.aws.neon.tech`，10/10 migration 已应用。
- BatchJob：11 RUNNING，2 FAILED。
- VideoJob：88 QUEUED，87 SUCCEEDED，16 FAILED，6 CANCELLED。
- FinalVideo：47 READY，2 STITCHING，4 PENDING。
- 两条真实 Seedance 成功段仍停在 STITCHING，源 URL 位于北京 TOS；另有 4 条 PENDING 绑定历史失败任务。
- 没有执行 UPDATE/DELETE/TRUNCATE；本轮数据库操作全部只读。

结论：Neon 已恢复且 schema 正常，但“数据库恢复”不等于“任务队列健康”。88 条历史 QUEUED 与两条长时间 STITCHING 必须作为 Phase 5/6 的明确遗留项处理。

## 3. 中国部署产出分诊

### 已保留并转正

- Provider 抽象：AI、Storage、Video、ContentReview 接口仍在主干。
- `/api/health`、统一 env 解析/校验、Dockerfile、docker-compose、UsageLog 与任务审计字段均保留。
- 当前区域枚举改为 `na | future`；不再按 `REGION=cn` 自动切换 provider。
- Video provider 的真实实现改名为 `BytePlusVideoProvider`，业务层仍只依赖 `VideoProvider`。

### 已冻结归档

- `.env.china.example`
- `CHINA_DEPLOYMENT.md`
- `CHINA_COMPLIANCE_READINESS.md`
- Volcengine ContentReview placeholder

归档位置：`deploy/china-future/`。README 与文件头均标记“非当前路线图，仅作未来参考；未来出海预留，当前不维护”。审核 placeholder 改为 `.ts.txt`，确保不参与 TypeScript 编译。

### Seedance 路由校正

- 旧默认与本机配置：`ark.cn-beijing.volces.com`，不符合北美部署语境。
- 新默认与环境配置：`https://ark.ap-southeast.bytepluses.com/api/v3`。
- 真实调用双锁：必须显式 `VIDEO_ENGINE_MOCK=false`，并提供 `BYTEPLUS_ARK_API_KEY`；未设置开关时默认 mock。
- base URL 仅允许 BytePlus 国际 host + `/api/v3`，中国区、HTTP、代理域名、query/hash 均在网络调用前 fail closed。
- 旧火山密钥不再被 Seedance 路径读取；此前对国际 models endpoint 的非计费认证探测返回 401，证明当前没有有效 BytePlus 国际密钥。
- 当前 `.env.local` 与 `.env.production.local` 均 `VIDEO_ENGINE_MOCK=true`；本轮没有提交真实视频任务。

### 尚未满足的 grep 验收项

主干仍有显式 legacy Volcengine AI/TOS/TTS/OmniHuman 实现与历史中国文档。TOS provider 目前还是北京历史资产迁移的源读取能力，不能在迁移前删除；其他实现是否归档会影响旧 demo 脚本，超出 Phase 0 可安全自动决定的范围。

GATE 0 需人工拍板：

1. TOS provider 是否保留到迁移验收完成后再归档（建议：是）。
2. Volcengine LLM/TTS/OmniHuman 与剩余 `docs/CHINA_*` 是否整体移入 `deploy/china-future/`（建议：先确认旧 demo 是否仍需运行）。
3. `future` provider 枚举是否继续允许显式 legacy 迁移工具使用，还是彻底从编译主干移除。

因此，本轮不能把“主干无中国特定代码残留”误报为完成；它是 GATE 0 的显式决策项。

## 4. 截图证据

- `docs/evidence/phase-0/persona-1440.jpg`
- `docs/evidence/phase-0/persona-390.jpg`
- `docs/evidence/phase-0/showcase-1440.jpg`
- `docs/evidence/phase-0/showcase-390.jpg`

Showcase 本轮只读截图，没有修改其路由、样式、组件或依赖。

## 5. 本轮范围自查

- 已执行：Phase 0 审计、路由校正、归档、环境 fail-closed、证据与迁移规划。
- 未执行：北京 TOS 数据复制、真实 BytePlus 生成、Buddy API adapter、统一 B/C 页面、任何数据库写操作。
- BytePlus 账号注册、配额申请、企业价格确认由人工侧处理，不在 agent 范围。
- Buddy API 子循环已登记；按用户给定顺序，Phase 1 之后才启动 SL-A，且在 SL-A Gate 前不写依赖未知契约的真实 adapter。

## 6. 自测结果

| 检查 | 结果 |
|---|---|
| `npm test` | 602 tests：601 pass、0 fail、1 skip。唯一 skip 是需写数据库的 metrics integration；按数据库安全宪法，本轮没有在主 Neon 上解锁写入型测试。 |
| `npm run typecheck` | 通过。 |
| `npm run lint` | 通过（0 error，8 个既有 warning）。生成的冻结 `showcase-static/**` 与归档目录不参与 lint；未修改 Showcase 产物。 |
| `npm run build` | 通过；Next.js 生产构建完成 45/45 静态页数据生成。 |
| `prisma validate` | 通过。 |
| `prisma migrate status` | 通过；10 migrations，schema up to date。 |
| BytePlus guard 聚焦测试 | 国际端点 allowlist、缺密钥 fail-closed、错误端点零网络调用、T2V/I2V/reference/audio payload 全部通过。 |
| UI 截图 | persona 入口与 Showcase 各有 1440/390 两档证据；persona 的布局缺陷已如实记为 Phase 1 承接项。 |

构建仍提示 Next.js `middleware` convention 已弃用；这是 Phase 6 前需处理的非阻断 warning，不在 Phase 0 自动扩展范围。
