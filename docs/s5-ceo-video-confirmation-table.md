# S5 · CEO 视频候选确认表

状态：**BRANCH_REHEARSAL_PASS — #13 / #14 已迁移重拼，等待生产 CAS 与 CEO 播放验收**  
生成时间：2026-07-13（完整机器可读报告位于 gitignored `.aivora-private/ceo-storage-migration-candidates.json`）

## 结论

只读联表识别发现：

- 15 组记录满足真实 Seedance provider、所有源段 `SUCCEEDED`、至少一个北京 TOS 源段；
- 1 组由 `productInput.source=investor_demo` 明确排除；
- 14 组历史记录只有 `source=unified_input` 或无 source。历史前端和若干脚本都会写该值，因此不能证明来自前端；
- 候选涉及两个匿名创建者指纹；
- 符合自主认定所需的 `requestOrigin=web_app` 记录为 0。

因此只读扫描阶段命中修订规则“候选 > 2 或创建者不一致”，`autoSelectionAllowed=false`。2026-07-13 人工已明确确认第 13、14 组为 CEO 目标视频，候选歧义解除。

锁定 ID：

- `cmrii4yyv0014l204jaxluepv`
- `cmrij6psx0010jl04gj04xoeg`

## 确认表

| # | FinalVideo | 状态 | 段数 | 创建者指纹 | 标题摘要 |
|---:|---|---|---:|---|---|
| 1 | `cmp1vkjg0000cliowaggmu9ik` | READY | 2 | `45aa621a89f3` | Cozy Home Living · REAL 2026-05-12 |
| 2 | `cmp1wsdf9000clic6dc8vfugx` | READY | 2 | `45aa621a89f3` | Sunny Shutter – Family Comfort 30s · REAL 2026-05-12 |
| 3 | `cmr796e380008lixxbjgr1lsi` | READY | 1 | `2bd3b50694ab` | 便携榨汁杯 15 秒 UGC |
| 4 | `cmr800o470008liyrddvtbl77` | READY | 1 | `2bd3b50694ab` | Blackout roller blinds 15s UGC |
| 5 | `cmr81oxvy0008lil7df8l7kpv` | READY | 1 | `2bd3b50694ab` | Fragrance-free body lotion 15s |
| 6 | `cmr81pp6m000jlil7qxxxm7rv` | READY | 1 | `2bd3b50694ab` | 磨砂绿保温杯 15 秒 |
| 7 | `cmr8217su001blil7mbjg294o` | READY | 2 | `2bd3b50694ab` | 治愈系猫咪店探店 30 秒 |
| 8 | `cmr82s20s001slil78kw0h101` | READY | 2 | `2bd3b50694ab` | Fragrance-free body lotion 30s |
| 9 | `cmr83jwrk0027lil7uqoyds4c` | READY | 2 | `2bd3b50694ab` | Meow Club 真实店铺探店 30 秒 |
| 10 | `cmr85dm2e000ylivpbj414c8w` | READY | 1 | `2bd3b50694ab` | Meow Club 多猫精品视频 15 秒 |
| 11 | `cmr85ouhw001blivpo6zsme56` | READY | 1 | `2bd3b50694ab` | Meow Club 多猫精品视频第 1 支 |
| 12 | `cmr85owzq001mlivp9dm7kbjq` | READY | 1 | `2bd3b50694ab` | Meow Club 多猫精品视频第 2 支 |
| 13 | `cmrii4yyv0014l204jaxluepv` | FAILED | 1 | `2bd3b50694ab` | Sunny Shutter 实用窗帘带货 |
| 14 | `cmrij6psx0010jl04gj04xoeg` | FAILED | 1 | `2bd3b50694ab` | Sunny Shutter 世界杯热点 15 秒 |

`FAILED` 是 FinalVideo 拼接终态；两组源 `VideoJob` 均为真实 provider 且 `SUCCEEDED`，因此仍符合“迁移源段后在北美重拼”的候选标准。

## 人工所需回复

已完成：迁移源段 → SHA-256 校验 → IAD1 Blob → Neon 分支库重拼/CAS 演练 → `ffprobe` → 演练分支成品库。详细证据见 `docs/evidence/phase-0/s5-ceo-migration-rehearsal.md`。

剩余：生产库重复同一 CAS → CEO 前端逐条播放后置验收。在后置验收完成前不得标记 featured/showcase。
