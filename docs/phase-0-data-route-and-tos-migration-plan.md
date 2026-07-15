# Phase 0 · 数据路由结论与北京 TOS 迁移方案

状态：**GATE 0 已通过；CEO 两条已完成 IAD1 + Neon 分支 CAS 演练，生产 CAS 与全量迁移待 Gate**。源对象仍禁止删除。

GATE 0 后只读扫描已于 `2026-07-13T14:40:12.720Z` 完成，manifest 位于 git 忽略的 `.aivora-private/storage-migration-manifest.json`：总引用 2,030，北京 TOS 67（46 个 canonical URL 去重对象），Vercel Blob 234。人工已提供控制台证据，确认目标 store `aivora-blob` 为 `IAD1`（北美）且为 Public access；证据见 `docs/evidence/phase-0/vercel-blob-iad1-public.png`。region Gate 已解除；CEO 已确认 #13/#14，并完成优先演练。

非 CEO 数据库对象的 HEAD-only 预检已完成：34 个去重对象全部带不可枚举目标 key，但 34/34 返回 HTTP 403。没有下载 body、没有上传 Blob、没有写 Neon。该结果说明公开旧 URL 不可直接迁移；后续执行需要受控 TOS 源凭证或临时签名只读 URL。

## 1. 当前与目标路由

| 环节 | 当前结论 | Phase 0 目标 |
|---|---|---|
| 数据库 | Neon Postgres，`us-east-1` pooler | 保持北美，不迁移。 |
| 视频生成 | 历史任务使用北京火山方舟；代码/环境已改为 BytePlus 国际 ModelArk `ap-southeast` | 当前 mock。企业账号/配额/价格由人工完成后，真实调用仍需成本 Gate。 |
| 新上传与成片存储 | 主干默认 `vercel_blob`，历史 URL 混有北京 TOS；`aivora-blob` 已取证为 IAD1/Public | 迁移目标固定为现有 `aivora-blob`，使用不可枚举随机 key。 |
| 历史北京 TOS | 36 个 VideoJob URL、10 个 VideoBrief URL、7 个 FinalVideo URL 命中 `tos-cn-beijing`；RawAsset.url 直接命中为 0 | 建 manifest、复制、校验、切换引用；源对象先保留。 |

上述计数只覆盖结构化 URL 字段的直接命中，不覆盖 JSON、数组、脚本产物或已过期签名 URL。迁移前必须用全字段 scanner 生成最终 manifest，不能把当前计数当成总量。

### 2026-07-14 后续人工裁决（仅覆盖视频生成路由）

本节是对上表“视频生成”一行的 **superseding decision**，不删除也不改写原始北美迁移决议：

- 为 CEO 内部视频生成临时允许使用 Volcengine `cn-beijing` legacy profile。该例外只覆盖视频生成请求与返回成片所必需的数据处理，不扩展到 LLM、TTS、OmniHuman、内容审核、数据库或对象存储。
- Neon Postgres 与 Vercel Blob 继续位于北美；素材和成片的系统记录、长期保存与交付仍以北美数据库/对象存储为准。该临时路由不授权把主数据库或对象存储迁回中国大陆。
- BytePlus 国际路径完整保留为目标路径与回退候选；Buddy provider 及其既有价格、积分、契约 Gate 保持不变。不得因启用 legacy profile 删除或绕过 `VideoProvider` 抽象。
- 该裁决构成跨境处理例外，不等同于法律批准或永久架构变更。隐私披露、第三方处理方清单、数据类别/保存时间与退出条件须在对外客户使用前完成律师复核。
- `ASSUMPTION: 人工尚未给出该临时例外的明确截止日期。` 在给出日期前，应将其作为需复审的临时风险，而不是新的默认长期路线；生产实际启用仍需独立配置、健康检查与计费安全证据。

## 2. 显式假设与待确认

### 2026-07-13 Final Sprint 修订

CEO 候选不再依赖本文旧的硬编码候选 ID。`scripts/identify-ceo-storage-migration-candidates.ts`
按真实 provider、源段全成功、北京 TOS 路由和可证明的前端请求来源四项做只读识别。
历史 `productInput.source=unified_input` 同时被前端和若干脚本使用，不能证明创建来源；
只有新增的 `productInput.requestOrigin=web_app` 可作为明确前端证据。来源不明确的历史记录进入确认表，
不得由 agent 自行挑选。下面原候选表保留为历史记录，不再提供执行授权。

- 已确认：Vercel Blob store `aivora-blob` 为 IAD1（北美）且 Public access，采用“不可猜测 URL + 公开读取”的当前访问模型。受控访问升级列入 backlog，不在本迁移中改造。
- 已确认：CEO 目标为 `cmrii4yyv0014l204jaxluepv` 与 `cmrij6psx0010jl04gj04xoeg`。
- BytePlus 企业账号注册、配额申请与单价确认由人工侧处理，不属于 agent 任务。

CEO 优先候选（仅内部 ID，不记录临时签名 URL）：

| 优先级 | FinalVideo | VideoBrief | 源段 VideoJob | 当前状态 |
|---|---|---|---|---|
| CEO-01 | `cmrij6psx0010jl04gj04xoeg` | `cmrij6pr8000zjl04pbo2urzm` | `cmrij6pty0012jl04n6wi5ul8` | 源段 SUCCEEDED，FinalVideo STITCHING |
| CEO-02 | `cmrii4yyv0014l204jaxluepv` | `cmrii4yxl0013l2043tz1473b` | `cmrii4yzr0016l204c4rcwpw6` | 源段 SUCCEEDED，FinalVideo STITCHING |

两组 ID 已由人工确认。IAD1 上传、SHA-256、重拼、ffprobe 与 Neon 分支 CAS 已完成；证据见 `docs/evidence/phase-0/s5-ceo-migration-rehearsal.md`。生产 CAS 与 CEO 播放仍待后置 Gate。

## 3. 必扫字段

- `RawAsset.url` 与 `metadata` 内嵌 URL。
- `FootageShot.thumbnailUrl`。
- `VideoBrief.referenceImageUrls[]`、`finalVideoUrl`、`finalThumbnailUrl`、`directorPlan`、`videoGenerationPlan`。
- `VideoPrompt.referenceImageUrl` 与 params。
- `VideoJob.outputVideoUrl`、`outputThumbUrl`、`assignedAssets`、`templateSnapshot`。
- `FinalVideo.stitchedVideoUrl`、`thumbnailUrl`。
- `BatchJob.imageUrls[]`。
- `AdEditPlan.outputVideoUrl`、`outputThumbnailUrl`、timeline JSON。
- Logo、publish、digital-human、render-job 相关 URL 字段。
- repo 内历史成片 manifest、演示脚本生成的 JSON 与静态素材引用。

## 4. GATE 0 后迁移步骤

1. **冻结窗口与备份**：记录 app version；确认 Neon PITR；导出上述表的只读 URL 快照。禁止删除/覆盖源数据。
2. **生成 manifest**：每个对象记录 source URL、表/字段/row id、owner/workspace、mime、size、源 checksum（缺失则下载后算 SHA-256）、目标 key、priority、状态。
3. **CEO 两条优先演练**：两条候选当前均为 `STITCHING`，不是可直接复制的完整成片。人工确认 ID 后，严格执行：**迁移源段及所需引用素材 → 在已取证的北美对象存储上重跑拼接 → `ffprobe` 校验时长/codec/分辨率/可解码性 → 写入成品库 → 人工逐条播放确认**。源段和重拼成片均使用不可变 key，如 `migrations/beijing-tos/<sha256>/<filename>`；不得把北京 TOS URL 重新写回成品字段。
4. **安全下载**：在受控 worker 中拉取源对象；不把签名 URL 写入日志；设置超时、大小上限与 MIME/magic-byte 校验。若 URL 过期，先从 TOS 源凭证生成短时只读 URL。
5. **上传北美目标**：服务端上传到 IAD1 的 Public `aivora-blob`；目标 key 必须为 `migrations/beijing-tos/<sha256>/<sanitized-filename>`，不得使用业务 ID、原始顺序号或可枚举路径。当前访问模型为随机 URL + 公开读取；记录目标 ETag/checksum 与 region 证据，受控访问升级列入 backlog。
6. **字节与媒体校验**：SHA-256 相同；视频执行 `ffprobe` 验证时长、codec、分辨率、可解码；图片验证尺寸；抽样实际播放。
7. **分支库演练 URL 切换**：在 Neon branch 运行可重入脚本，采用 compare-and-swap（只在字段仍等于 source URL 时更新），写 migration audit log。不得批量裸 UPDATE。
8. **双读观察**：代码优先新 URL，失败时只读回源旧 URL；观察至少 72 小时。CEO 两条由人工在成品库逐一播放确认。
9. **生产切换**：按 10%→50%→100% 分批更新引用；每批有计数、失败列表、回滚 manifest。
10. **回滚**：根据 manifest 反向恢复旧 URL；新对象不删除。只有在完整验收、法务/成本确认和保留期结束后，才单独申请删除北京 TOS 源对象。

迁移目标 Gate 已解除：人工证据确认 Vercel Blob 为 IAD1。CEO 两条优先演练已完成；其他对象仍只执行 manifest 去重、源可达性/元数据检查和目标 key 预计算，等待分批生产授权。

公开暴露约束：迁移成片 URL 只允许出现在经过认证的产品页面/API 响应，或人工明确批准的公开 Showcase 页面源码中；不得进入 sitemap、robots 附加数据、无认证列表 API、静态 JSON 索引或其他可爬取目录。`scripts/audit-public-video-url-exposure.ts` 提供只读静态检查；冻结 Showcase 与其现有公开 demo 素材明确排除，不改动其源码。

`2026-07-13T15:14:06Z` 静态审计结果：sitemap / robots / public JSON/XML/TXT 索引中对象存储 URL 命中为 0；6 个会携带视频 URL 字段的 API route 全部存在认证或 internal secret guard；无认证 route 为 0。详细证据保存在 git 忽略的 `.aivora-private/public-video-url-exposure-audit.json`。

## 5. 成本与安全 Gate

迁移执行前输出：

- 北京 TOS egress：待 manifest 字节数与合同价确认。
- 北美对象存储写入/存储/egress：待目标 provider 与 region 确认。
- worker 计算与 ffprobe：按对象数/总时长估算。
- 预留 10% 重跑流量，但脚本必须按 checksum 幂等，不能产生重复对象。

BytePlus 视频生成价格不参与存储迁移成本；当前统一标注 **“待确认”**。`docs/PHASE_4_REAL_TEST_RUNBOOK.md` 已去除旧火山价格假设，待企业账号注册后回填。

## 6. 验收证据

- manifest 总数、总字节数、按字段/owner/provider 分组。
- CEO 两条成品的 before/after 播放截图与 ffprobe 输出。
- 全量 checksum/媒体校验通过率，失败对象列表为 0 或有人工处置记录。
- Neon branch 演练日志、生产分批日志与回滚演练记录。
- 目标存储 region、生命周期与备份策略截图/配置导出。
- 72 小时双读期间 404/403、播放失败、回源率指标。

没有以上证据，不得关闭迁移任务，也不得删除北京 TOS 源对象。
