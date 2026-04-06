# ReelForge — 当前项目状态总结

> 更新时间: 2026-03-13 (Session 2 结束)
> 用途: 在新上下文中继续开发时，将本文档作为项目背景输入

---

## 1. 项目目标

ReelForge 是一套 **面向商业客户的 AI 短视频内容服务工作流系统**。

**核心链路**: 客户需求 -> Brief -> 数据研究 -> 内容策略 -> 脚本生成 -> 视频生成 -> AI 质检 -> 人工审核 -> 交付 -> 数据回流

**商业定位**: 先做服务交付（为客户生产短视频），再做账号矩阵（规模化运营）。第一阶段不是 SaaS，而是 AI 驱动的内容服务能力。

**协同模式**: 未来采用"北美前台(客户沟通/审核/交付) + 中国后台(Pipeline 引擎/Agent 执行/视频生成)"。

**默认平台**: TikTok 短视频，后续扩展 YouTube Shorts、Instagram Reels。

---

## 2. 已完成模块

### Phase 1 — 项目骨架 (已完成)
- 完整目录结构（80+ 文件）
- 所有 JSON Schema 定义（6 个）
- 所有数据模型（SQLAlchemy + Pydantic）
- FastAPI 应用框架 + 5 组 CRUD API 路由
- 8 个 Agent 实现（含 mock fallback）
- 7 条 Pipeline 实现
- 规则引擎（QA + Strategy）
- 配置管理（pydantic-settings）
- 项目文档（8 篇）
- 测试框架 + 基础用例

### Phase 2 — Mock 可运行闭环 (已完成)
- 修复所有 Pipeline-Agent 接口匹配问题
- 新增 `schemas/models.py` Pydantic 运行时校验层
- 新增 `pipelines/strategy_generation.py`
- 端到端 6 步 demo 跑通（Brief -> QA，< 1 秒）
- `scripts/run_demo.py` 演示入口

### Phase 3 — 半真实 LLM 闭环 (已完成)
- `schemas/models.py` 增加 `_TrackedModel` 基类（schema_version, agent_version, prompt_version, created_at, updated_at）
- StrategyAgent (v0.2.0) + ScriptAgent (v0.3.1) 改造为 LLM/mock 双模式
- 外置 Prompt 模板（`prompts/strategy/`, `prompts/script/`）
- `prompts/loader.py` 模板加载器（支持 `{{变量}}` 渲染）
- `services/llm/client.py` 重写（内置重试、token 统计、JSON 解析容错）
- `run_demo.py` 支持环境变量自动检测 mock/real 切换
- LiteLLM + python-dotenv 依赖已安装

### Session 2 新增改动 (2026-03-13)
- **ScriptAgent v0.3.1 稳定化**:
  - 新增 `_normalize_script_output()` 统一清洗/补齐所有输出字段
  - 输出新增标准字段: `platform`, `language`, `schema_version`, `generation_mode`
  - `prompt_version` 始终记录（无论 LLM 还是 mock）
  - `topic_priority` 加入 prompt 模板变量
- **Strategy -> Script 契约优化**:
  - Pipeline 传递完整 `topic_item` dict（含 topic/format/angle/duration/priority）而非字符串
  - ScriptAgent 读取 topic_item 中的 angle/format/priority/duration
  - Pipeline validate_script 新增 title + visual_directions 校验
  - Script status 改为 `validated`（无问题）/ `needs_review`（有问题）
- **LLM 失败自动降级**: StrategyAgent + ScriptAgent 的 `execute()` 中 catch LLM 异常，自动 fallback 到 mock，metadata 标记 `llm_fallback`
- **QA 阈值统一**: `qa_review.py` 不再定义独立阈值，改为 `from agents.qa_agent import AUTO_PASS_THRESHOLD`（80）
- **Schema 字段修复**: `QAIssue` 增加 `message` 字段兼容 Agent 输出；`QAReport` 主键改为 `qa_report_id` + 增加 `script_id`/`job_id`；`ScriptStatus` 增加 `VALIDATED`/`NEEDS_REVIEW`

---

## 3. 当前目录结构

```
ReelForge/
├── README.md
├── requirements.txt
├── .env.example
├── .env                             # API Key 配置（需手动填入）
├── .gitignore
│
├── config/
│   ├── __init__.py
│   └── settings.py                 # pydantic-settings, 分模块配置
│
├── app/                             # FastAPI 应用层
│   ├── main.py                     # 入口, lifespan, 路由注册
│   ├── database.py                 # SQLAlchemy 2.0 async
│   ├── api/
│   │   ├── deps.py                 # 依赖注入
│   │   └── routes/
│   │       ├── briefs.py           # Brief CRUD
│   │       ├── projects.py         # Project CRUD
│   │       ├── scripts.py          # Script CRUD + 审核
│   │       ├── videos.py           # VideoJob 管理
│   │       └── reviews.py          # QA 审核
│   └── models/
│       ├── base.py                 # TimestampMixin + 枚举
│       ├── project.py
│       ├── brief.py
│       ├── script.py
│       ├── video_job.py
│       ├── qa_report.py
│       └── delivery.py
│
├── agents/                          # Agent 业务逻辑
│   ├── base.py                     # BaseAgent + AgentResult
│   ├── intake_agent.py             # v0.1.0 — mock + LLM placeholder
│   ├── research_agent.py           # v0.1.0 — mock data
│   ├── strategy_agent.py           # v0.2.0 — LLM/mock 双模式 + fallback + 外置 prompt
│   ├── script_agent.py             # v0.3.1 — LLM/mock 双模式 + normalize + 外置 prompt
│   ├── video_production_agent.py   # v0.1.0 — mock video generator
│   ├── qa_agent.py                 # v0.1.0 — 规则 + mock LLM fallback
│   ├── delivery_agent.py           # v0.1.0 — mock
│   └── learning_agent.py           # v0.1.0 — mock
│
├── services/                        # 外部服务封装
│   ├── llm/
│   │   ├── client.py               # LLMClient (LiteLLM, 3次重试, token 统计, JSON 容错)
│   │   └── providers.py            # Provider 注册表 + 成本估算
│   ├── video/
│   │   └── generator.py            # 抽象层 + MockVideoGenerator
│   └── storage/
│       └── file_store.py           # 本地文件存储
│
├── pipelines/                       # 流水线编排
│   ├── base.py                     # BasePipeline + Step + Result + 重试
│   ├── project_intake.py           # validate -> brief -> review
│   ├── research_analysis.py        # validate_brief -> run_research
│   ├── strategy_generation.py      # validate -> generate_strategy
│   ├── script_generation.py        # select_topic(完整item) -> generate -> validate(title+vd)
│   ├── video_generation.py         # validate_script -> generate_video
│   ├── qa_review.py                # run_qa_review -> route_review (阈值从 qa_agent 引入)
│   ├── delivery.py                 # prepare -> record -> deliver
│   └── feedback_loop.py            # collect -> analyze -> insights
│
├── schemas/                         # 数据契约
│   ├── models.py                   # Pydantic 运行时校验 (v1.0.0)
│   ├── brief.schema.json
│   ├── strategy.schema.json
│   ├── script.schema.json
│   ├── video_job.schema.json
│   ├── qa_report.schema.json
│   └── delivery_record.schema.json
│
├── prompts/                         # Prompt 模板
│   ├── loader.py                   # 模板加载器 ({{变量}} 渲染)
│   ├── strategy/
│   │   ├── system.txt              # Strategy Agent system prompt
│   │   └── user.txt                # Strategy Agent user prompt
│   ├── script/
│   │   ├── system.txt              # Script Agent system prompt
│   │   └── user.txt                # Script Agent user prompt (含 format/angle/priority)
│   ├── intake/
│   │   └── brief_generation.md     # 参考文档 (未接入)
│   └── qa/
│       └── video_review.md         # 参考文档 (未接入)
│
├── rules/                           # 规则引擎
│   ├── qa_rules.py                 # 时长/大小/语速检查
│   └── strategy_rules.py           # 平台最佳实践
│
├── docs/                            # 项目文档
│   ├── overview.md
│   ├── architecture.md
│   ├── workflow.md
│   ├── agent-spec.md
│   ├── schemas.md
│   ├── prompt-guidelines.md
│   ├── ops.md
│   ├── costing.md
│   ├── current-status.md           # 本文档
│   └── next-step.md                # 下一阶段任务清单
│
├── tests/
│   ├── test_agents/
│   │   ├── test_intake.py
│   │   └── test_qa.py
│   ├── test_pipelines/
│   │   └── test_project_intake.py
│   └── test_services/
│       ├── test_llm_providers.py
│       └── test_video_generator.py
│
├── scripts/
│   ├── run_demo.py                 # 端到端演示入口 (mock/real 自动切换)
│   ├── run_pipeline.py             # 单 pipeline 运行器
│   └── init_db.py                  # 数据库初始化
│
└── storage/                         # 运行时文件 (.gitignore)
    └── demo_output/                # demo 运行输出 JSON
```

---

## 4. 已完成的 Pipeline

| Pipeline | 文件 | 步骤 | Agent | 状态 |
|----------|------|------|-------|------|
| **project_intake** | `project_intake.py` | validate_input -> generate_brief -> review_brief | IntakeAgent | mock 可运行 |
| **research_analysis** | `research_analysis.py` | validate_brief -> run_research | ResearchAgent | mock 可运行 |
| **strategy_generation** | `strategy_generation.py` | validate_inputs -> generate_strategy | StrategyAgent v0.2.0 | mock + LLM 就绪 + fallback |
| **script_generation** | `script_generation.py` | select_topic(完整item) -> generate_script -> validate_script(title+vd) | ScriptAgent v0.3.1 | mock + LLM 就绪 + fallback + normalize |
| **video_generation** | `video_generation.py` | validate_script -> generate_video | VideoProductionAgent | mock 可运行 |
| **qa_review** | `qa_review.py` | run_qa_review -> route_review | QAAgent (AUTO_PASS=80) | 规则质检可运行 |
| **delivery** | `delivery.py` | prepare_assets -> create_record -> deliver | DeliveryAgent | 存在但未接入 demo |
| **feedback_loop** | `feedback_loop.py` | collect -> analyze -> insights | LearningAgent | 存在但未接入 demo |

**已跑通的主链路**: project_intake -> research_analysis -> strategy_generation -> script_generation -> video_generation -> qa_review

---

## 5. 已定义的 Schema

### JSON Schema 文件 (schemas/*.schema.json)

| Schema | 用途 | 产出者 | 消费者 |
|--------|------|--------|--------|
| `brief.schema.json` | 客户项目 Brief | IntakeAgent | Research/Strategy/Script |
| `strategy.schema.json` | 内容策略 | StrategyAgent | ScriptAgent |
| `script.schema.json` | 视频脚本 | ScriptAgent | VideoProductionAgent, QAAgent |
| `video_job.schema.json` | 视频生成任务 | VideoProductionAgent | QAAgent |
| `qa_report.schema.json` | 质检报告 | QAAgent | DeliveryAgent, 人工审核 |
| `delivery_record.schema.json` | 交付记录 | DeliveryAgent | LearningAgent |

### Pydantic 运行时模型 (schemas/models.py)

所有模型继承 `_TrackedModel`，统一带有:
- `schema_version` (当前 "1.0.0")
- `created_at` / `updated_at` (自动填充 UTC ISO)
- `agent_version` (产出该数据的 Agent 版本)
- `prompt_version` (使用的 Prompt 版本)
- `status`

模型清单: `Brief`, `ResearchReport`, `Strategy`, `Script`, `VideoJob`, `QAReport`, `DeliveryRecord`

子模型: `TargetAudience`, `TopicSuggestion`, `VisualDirection`, `QAIssue`, `HumanReview`, `CostSummary`

枚举: `ScriptStatus` 包含 `draft`, `review`, `validated`, `needs_review`, `approved`, `rejected`

---

## 6. 已完成的 Agent

| Agent | 文件 | 版本 | 模式 | LLM Fallback | 规则 | Prompt 外置 | Normalize |
|-------|------|------|------|-------------|------|------------|-----------|
| **IntakeAgent** | `intake_agent.py` | 0.1.0 | mock + LLM placeholder | - | 有 | 未外置 | 无 |
| **ResearchAgent** | `research_agent.py` | 0.1.0 | mock + LLM fallback | 有 | 无 | 未外置 | 无 |
| **StrategyAgent** | `strategy_agent.py` | 0.2.0 | **LLM/mock 双模式** | **有** | 有 | **已外置** | 无 |
| **ScriptAgent** | `script_agent.py` | **0.3.1** | **LLM/mock 双模式** | **有** | 有 | **已外置** | **有** |
| **VideoProductionAgent** | `video_production_agent.py` | 0.1.0 | mock only | - | 无 | N/A | 无 |
| **QAAgent** | `qa_agent.py` | 0.1.0 | 规则 + mock LLM fallback | 有 | **有** | 未外置 | 无 |
| **DeliveryAgent** | `delivery_agent.py` | 0.1.0 | mock only | - | 无 | N/A | 无 |
| **LearningAgent** | `learning_agent.py` | 0.1.0 | mock only | - | 无 | N/A | 无 |

### ScriptAgent v0.3.1 输出字段 (normalize 后)

```
script_id, brief_id, topic, topic_format, topic_angle, topic_priority,
title, hook, body, cta, voiceover_text, subtitle_text, visual_directions, music_style,
duration_seconds, platform, language, schema_version, generation_mode,
agent_version, prompt_version, status
```

### Agent 统一接口

```python
class BaseAgent(ABC):
    name: str
    version: str

    async def run(self, input_data: dict) -> AgentResult:
        # 日志 -> validate_input -> execute -> 日志 -> 返回

class AgentResult:
    success: bool
    data: dict        # {"strategy": {...}} / {"script": {...}}
    error: str | None
    metadata: dict    # {"mode": "llm"/"mock"/"llm_fallback", ...}
    trace_id: str
    timestamp: str
```

### Pipeline 统一接口

```python
class BasePipeline(ABC):
    name: str

    async def run(self, input_data: dict) -> PipelineResult:
        # 顺序执行 steps, 每步可重试, 数据在步骤间透传

class PipelineResult:
    pipeline_name: str
    run_id: str
    status: str  # "completed" | "failed"
    steps: list[PipelineStep]
    final_output: dict
```

---

## 7. 当前 Demo 运行结果

**运行命令**:
```powershell
$env:REELFORGE_MODE = "mock"
C:\Users\Lucas\python312\python.exe scripts/run_demo.py
```

**结果** (2026-03-13, mock 模式, Session 2 最后一次):

| Step | Pipeline | 状态 | Schema 校验 | 备注 |
|------|----------|------|------------|------|
| 1. Intake | project_intake | completed | passed | mock |
| 2. Research | research_analysis | completed | - | mock |
| 3. Strategy | strategy_generation | completed | passed | mock, v0.2.0 |
| 4. Script | script_generation | completed | passed | mock, v0.3.1, status=validated |
| 5. Video | video_generation | completed | - | mock |
| 6. QA | qa_review | completed | passed | 规则, score=78, auto_pass=false |

**Summary**:
- Client: UrbanKicks (fashion, TikTok)
- Script: `generation_mode=mock`, `platform=tiktok`, `language=en`
- QA Score: 78/100, Auto Pass: False (threshold 80)
- Review Route: human_review_required

**Fallback 测试** (fake API key): 通过 — LLM 失败 3 次重试后自动降级 mock，6 步全 [OK]

**模式切换**:
- `REELFORGE_MODE=mock` -> 全 mock
- `OPENAI_API_KEY=sk-xxx` -> Strategy + Script 用 LLM，其余 mock
- `REELFORGE_MODE=real` -> 强制 real
- `REELFORGE_MODEL=gpt-4o-mini` -> 指定模型

---

## 8. 已知问题

### 已修复 (Session 2)
1. ~~QA auto_pass 阈值不一致~~ -> 统一为 80，Pipeline 引用 Agent 常量
2. ~~LLM 失败无降级~~ -> 两个 Agent 均加了 try/except fallback
3. ~~QAIssue/QAReport 字段不匹配~~ -> 修复 message/description 兼容 + qa_report_id 对齐
4. ~~Script Pipeline 只传 topic 字符串~~ -> 改为传完整 topic_item dict
5. ~~ScriptAgent 输出字段不完整~~ -> 新增 _normalize_script_output() 统一补齐

### 仍待解决
6. **IntakeAgent prompt 未外置**: 仍使用内联硬编码 prompt, 需要迁移到 `prompts/intake/`
7. **ResearchAgent 数据全 mock**: `_gather_platform_data()` 返回硬编码数据
8. **delivery + feedback_loop pipeline**: 已定义但未接入主链路 demo
9. **FastAPI 路由未测试**: `app/api/routes/` 下的 CRUD 端点未与 Pipeline/Agent 层对接
10. **数据库未启用**: SQLAlchemy 模型已定义，demo 不经过数据库
11. **JSON Schema 文件与 Pydantic 模型未自动同步**: 两套定义独立维护
12. **真实 LLM 模式未验证**: 需要填入真实 OPENAI_API_KEY 运行 real demo

---

## 9. 下一步开发优先级

### P0 — 下次开始时立即做
1. **填入 OPENAI_API_KEY，运行 real demo** — 验证 Strategy + Script 的真实 LLM 输出
2. **根据 LLM 实际输出调优 prompt 模板** — 确保 schema 校验全 pass
3. **StrategyAgent 也加 _normalize 处理** — 与 ScriptAgent 对齐稳定性

### P1 — 质检 + 交付闭环
4. QAAgent 接入 LLM 做内容质量评估（保留规则引擎做技术检测）
5. 接通 delivery pipeline 到 demo 主链路
6. 批量脚本生成: 一个 strategy 生成多个 script（当前只取第一个 topic）

### P2 — API 化 + 真实视频
7. 将 run_demo.py 的逻辑迁移到 FastAPI 端点（POST /projects/run）
8. 接入至少一个真实视频生成 API（Seedance / Runway）
9. 启用 SQLite 数据库 + Alembic 迁移

### P3 — 后续
10. 简单人工审核 API（approve/reject + notes）
11. Redis + Celery 异步任务队列
12. 接入 TikTok Analytics API 做数据回流

---

## 10. 所有重要约束

### 商业约束
- **先服务后矩阵**: 第一阶段做服务交付能力，不做 SaaS
- **TikTok 优先**: 默认平台为 TikTok 短视频
- **北美前台 + 中国后台**: 架构需支持异地协作、人工审核、任务交接
- **成本可追踪**: 每条视频的 LLM 成本 + 视频生成成本 + 返工次数必须可量化

### 技术约束
- **结构化输出优先**: 所有 Agent 间数据传递必须经过 JSON Schema / Pydantic 校验
- **规则优先于 LLM**: 能规则化的先规则化
- **先半自动后全自动**: 保留人工审核节点
- **Agent 职责单一**: 每个 Agent 只做一件事，通过 Pipeline 编排
- **Prompt 外置**: 所有面向 LLM 的 prompt 必须外置为模板文件
- **双模式架构**: 每个 Agent 同时支持 LLM 和 mock + 自动 fallback
- **MVP 心态**: 不过度工程化

### 技术栈
- Python 3.12 (`C:\Users\Lucas\python312\python.exe`) + FastAPI + SQLAlchemy 2.0 (async)
- Pydantic v2 (数据校验) + JSON Schema (契约定义)
- LiteLLM (统一 AI 模型调用) + structlog (结构化日志)
- SQLite (MVP) -> PostgreSQL (生产)
- 本地文件存储 (MVP) -> S3/MinIO (生产)

---

## 快速恢复开发

```powershell
# 进入项目
cd "c:\Users\Lucas\OneDrive\桌面\Ai 视频流"

# Python 路径
$py = "C:\Users\Lucas\python312\python.exe"

# 运行 mock demo
$env:PYTHONIOENCODING = "utf-8"
$env:REELFORGE_MODE = "mock"
& $py scripts/run_demo.py

# 运行 real demo (需要先在 .env 填入 OPENAI_API_KEY)
Remove-Item Env:REELFORGE_MODE -ErrorAction SilentlyContinue
& $py scripts/run_demo.py

# 强制指定模型
$env:REELFORGE_MODEL = "gpt-4o-mini"
& $py scripts/run_demo.py
```
