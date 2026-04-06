# ReelForge — 项目规则 (Project Rules)

> 版本: 1.0.0 | 最后更新: 2026-03-14
> 适用阶段: MVP → 服务交付验证

---

## 0. 项目定位

ReelForge 是一个 **AI 短视频服务 Agent 系统**。

- 不是通用 SaaS
- 不是自媒体账号矩阵工具
- 不是先做 UI 产品
- 第一阶段目标：**支持商业客户的 AI 短视频服务交付**

---

## 1. 服务优先原则

所有开发优先服务于「AI 视频服务交付」。

- 功能排期标准：能否直接提升一次服务交付的质量或效率
- 不优先做 SaaS 化功能（多租户、套餐、自助注册）
- 不提前为大规模账号矩阵做复杂设计
- 不做与服务交付无关的辅助功能

**判断口诀：这个功能在下一个客户项目里用得到吗？用不到就不做。**

---

## 2. MVP 优先原则

当前阶段的目标不是做大而全，而是先跑通最小可运行闭环。

- 先保证主链路 `Brief → Research → Strategy → Script → Video → QA` 可运行
- 再增强单点能力（如 QA 精细化、Prompt 质量提升）
- 不做过度工程化：不上 K8s、不建微服务、不做消息队列，除非有明确交付瓶颈
- 不为假设场景引入基础设施（如「以后可能需要」的功能一律后置）

**判断口诀：删掉它主链路还能跑吗？不能就保留，能就不急做。**

---

## 3. TikTok 优先原则

当前默认平台是 TikTok。

- Prompt、Strategy、Script、QA 都优先围绕 TikTok 短视频特性优化
- 平台约束（时长、竖屏、Hashtag 限制）以 TikTok 为默认值
- 其他平台（YouTube Shorts、Instagram Reels）保留 schema 兼容，但不作为优化目标
- 如果 TikTok 和其他平台的最佳实践冲突，按 TikTok 来

---

## 4. 人工审核保留原则

当前阶段所有内容生成结果必须支持人工审核。

- Pipeline 中必须保留 QA → human_review 环节
- `auto_pass` 仅用于减少人工负担，不代表跳过审核
- 不得实现默认全自动发布
- 不得删除 `human_review` 在 QA 报告和路由中的位置
- 即使 QA 分数 ≥ 阈值，人工仍可覆盖决策

---

## 5. 结构化输出原则

所有核心 Agent 输出必须优先结构化。

- 优先使用 Pydantic model 做运行时校验
- Agent 返回值必须是 `dict`，符合对应 JSON Schema
- Prompt 必须要求 LLM 输出 JSON（使用 `response_format: json_object`）
- 不允许关键步骤依赖不可控自由文本作为唯一输出
- 如果 LLM 返回的 JSON 缺少字段，由 Agent 的 `_normalize` 层补齐，不抛异常

---

## 6. Agent 单一职责原则

每个 Agent 只负责单一清晰职责。

| Agent | 职责 | 不应包含 |
|-------|------|----------|
| IntakeAgent | Brief 生成 | 不做策略 |
| ResearchAgent | 行业/平台研究 | 不做选题 |
| StrategyAgent | 内容策略 + 选题 | 不做脚本 |
| ScriptAgent | 脚本生成 | 不做视频 |
| VideoProductionAgent | 视频生成调度 | 不做质检 |
| QAAgent | 质检评分 | 不做交付 |
| DeliveryAgent | 交付打包 | 不做质检 |

如果一个 Agent 开始处理两种职责，应该拆分而不是合并。

---

## 7. Pipeline 稳定性原则

主链路 `Brief → Research → Strategy → Script → Video → QA` 是系统命脉。

- 任何修改必须保证主链路仍可跑通
- 新功能不能破坏已有 Pipeline step
- 修改 Agent 的输入/输出结构后，必须同步检查：
  - 对应的 Pydantic model
  - Pipeline 中的数据传递
  - run_demo.py 的调用
  - 上下游 Agent 的契约
- 每次重要修改后运行一次 `python scripts/run_demo.py` 验证

---

## 8. Prompt 管理原则

Prompt 是 Agent 的核心资产，必须规范管理。

- 所有 Prompt 外置到 `prompts/{agent_name}/` 目录
- 每个 Agent 有独立的 `system.txt` 和 `user.txt`
- 使用 `{{variable}}` 占位符，通过 `prompts/loader.py` 渲染
- Agent 代码中记录 `PROMPT_VERSION`，每次修改 prompt 时更新
- Prompt 优化应小步迭代：改一处 → 跑 demo → 看 QA 分数 → 再改下一处
- 不要在一次 commit 中同时重构 prompt 和 agent 逻辑

---

## 9. 真实 LLM 接入原则

LLM 接入按阶段推进，不一次性全部接入。

**当前阶段（已完成）：**
- StrategyAgent：real LLM ✅
- ScriptAgent：real LLM ✅

**下一阶段（按需）：**
- QAAgent：先规则增强 ✅，LLM 二审已预留 hook（默认关闭）
- VideoProductionAgent：继续 mock，等 QA 稳定后再接真实 provider

**稳定性原则：**
- 每个 Agent 必须支持 mock / llm 双模式
- 真实 LLM 调用必须有 fallback 回 mock
- 若 LLM 输出不稳定，优先修 prompt 和 normalize，不优先重构架构
- LLM 调用必须有 retry（当前 3 次）和超时保护

---

## 10. QA 优先增强原则

QA 是人工审核前的最后一道防线。

- 在 Strategy 和 Script 可运行后，优先增强 QA
- QA 增强路径：字段完整性 → 规则评分（7 维度）→ LLM 二审 → 人工审核
- 当前 QA 评分维度（v0.4.0）：
  1. hook_quality — 开头吸引力
  2. topic_alignment — 主题对齐度
  3. angle_alignment — 策略 angle 遵从度
  4. format_alignment — 格式特征匹配度
  5. cta_quality — CTA 质量
  6. duration_fitness — 时长适配度
  7. brief_alignment — Brief 需求匹配度
  8. technical — 技术指标
- QA 的目标是为人工审核提供有效筛选，不是替代人工

---

## 11. 当前阶段明确不做的事项

以下功能在 MVP 阶段明确不优先开发：

| 不做 | 原因 |
|------|------|
| UI 大界面 | 先跑通 API + Pipeline |
| 自动发布 | 人工审核保留 |
| 多平台联动 | TikTok 优先 |
| CRM | 不是 SaaS |
| 复杂 BI 报表 | 先做交付 |
| 完整账号矩阵系统 | 先做服务 |
| 高复杂权限系统 | 单团队操作 |
| 过早的 SaaS 封装 | 先验证服务模式 |

---

## 12. 代码修改约束

- 优先做最小必要修改
- 不要为了一个局部问题重写整个模块
- 不要随意改动已经跑通的主链路
- 如果修改 Agent 输入输出，必须同步检查 schema、pipeline、demo
- 新增功能走新文件 / 新方法，不侵入已稳定逻辑
- 改 prompt 时不同时改 agent 逻辑，反之亦然

---

## 13. 每次改动后的评估标准

每次重要改动后，必须回答以下问题：

```
□ 主链路还能否跑通？（python scripts/run_demo.py）
□ schema 是否仍通过？（validate_schema 无 WARN）
□ Strategy → Script 契约是否仍生效？（topic/angle/format/priority/duration 传递正确）
□ 是否更接近可交付内容？
□ 是否减少人工审核成本？
□ 是否仍符合「先服务，再做账号矩阵」路线？
□ 是否引入了「暂不做」列表中的功能？
```

---

## 14. 技术栈约束

| 层 | 技术 | 备注 |
|----|------|------|
| 语言 | Python 3.12+ | 全项目 |
| Web 框架 | FastAPI | API 层 |
| LLM 调用 | LiteLLM | 多 provider 统一接口 |
| 数据校验 | Pydantic v2 | Agent 输入输出校验 |
| 结构化日志 | structlog | 全链路 |
| 配置 | python-dotenv + pydantic-settings | 环境变量 |
| 默认模型 | gpt-4o-mini | 成本与质量平衡 |

---

## 15. 目录结构约束

```
agents/          — Agent 实现（每个 Agent 一个文件）
pipelines/       — Pipeline 编排（每条链路一个文件）
prompts/         — Prompt 模板（按 Agent 分子目录）
schemas/         — JSON Schema + Pydantic models
scripts/         — 脚本入口（run_demo.py, run_pipeline.py）
services/        — 外部服务封装（llm/, video/, storage/）
rules/           — 规则引擎
config/          — 配置
app/             — FastAPI 应用
docs/            — 文档
storage/         — 运行时输出
tests/           — 测试
```

不随意新增顶层目录。新模块优先放入已有目录。
