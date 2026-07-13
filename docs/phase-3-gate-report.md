# Phase 3 · 赛马 MVP GATE 3 验收报告

日期：2026-07-13（America/Toronto）

状态：**GATE 3 已通过（CEO 决议，2026-07-13）**

## 范围与显式假设

`ASSUMPTION: Phase 3 所称 Placement 是一次视频在外部平台的投放记录。现有 PublishRecord 已完整承载 platform、externalPostId、publishUrl、publishedAt 与 MetricsSnapshot 关系，因此本阶段将它作为产品层 Placement 复用，不新增重复表。`

该选择不改变既有内部发布流程；统一 `/app` 只暴露 owner-scoped 的产品 DTO 与新接口。

## 已完成闭环

- 统一 `/app/racing` 从占位页升级为真实赛马工作台。
- Round 卡片展示变体、Placement、12/24/48h 指标窗口、排名、分数与证据完整度。
- 客户可为自己的变体手动录入平台贴文 ID、链接和指标。
- 置信度由变体数、窗口完整度、48h 成熟度确定；小样本不会标为高置信度，并明确披露局限。
- 排名后生成 DistillationFeature 与下一轮建议。
- 下一轮必须引用本轮蒸馏结果，默认建立 3 个优化位 + 2 个探索位。
- 新建客户项目默认 `maxRounds=3`；首轮仍只在用户真实请求时创建。
- 客户 ownership 通过 `DeliveryOrder.createdById` fail-closed；内部 OPERATOR/SUPER_ADMIN 保留显式全局读取能力。
- mock 强制模式下的蒸馏不会误发真实 OpenAI 请求。

## 自动验证证据

| 验证 | 结果 | 证据 |
|---|---:|---|
| 全量 Node 测试 | 629 passed / 1 skipped / 0 failed | `npm test`，54.8s |
| TypeScript | 通过 | `npm run typecheck` |
| Production build | 通过 | `npm run build`；包含 3 个 `/api/racing` 路由与 `/app/racing` |
| ESLint | 0 errors；7 个既有 warnings | `npm run lint` |
| Neon 演练分支真实 DB 闭环 | 1 passed / 0 failed | ownership 拒绝 → Placement/MetricSnapshot → ScoreReport/Distillation → Round 2 |
| 桌面/移动路由走查 | 3 passed / 0 failed | Playwright setup + 1440 + 390，50.3s |

截图：

- `docs/evidence/phase-3/racing-desktop-1440.png`
- `docs/evidence/phase-3/racing-mobile-390.png`

## CEO 走查脚本

1. 登录统一工作区，进入“投放与赛马”。
2. 展开一个 Round，确认变体、Placement 与窗口信息能读懂。
3. 选择一个变体，录入测试贴文 ID 与一组 12h 指标。
4. 再补 24h/48h，观察证据完整度变化。
5. 点击“生成排名与建议”，确认小样本限制与建议文案可理解。
6. 点击“建立下一轮”，确认新轮次为 3 优化 + 2 探索，且引用本轮蒸馏。
7. 用另一个客户账号确认不能读取或写入该轮次。

## 非本 Gate 结论

- 本报告不证明与同行的 P1/P2 视觉质量对齐；仍需人工提供同行平台导出的盲评对照视频。
- mock 能证明模板参数、稳定性约束、调度与数据闭环，不能证明真实视频幻觉率。
- Buddy 真实调用仍被 F4 封锁：`confirmed_unit_price` 与账户积分充值均需人工确认后才能解锁。
- 尚未部署，也未对外宣称上线。

## GATE 3 人工决议

- [x] CEO 批准赛马闭环与置信度表达（2026-07-13）
- [ ] CEO 要求修改（请列具体步骤/文案/指标）
