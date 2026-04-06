# ReelForge — AI 视频服务 Agent 系统

> 面向商业客户的 AI 短视频内容服务工作流系统

## 项目简介

ReelForge 是一套 **AI 驱动的短视频内容服务系统**，通过多 Agent 协作完成从客户需求采集到视频交付的完整链路。系统采用"先做服务，再做账号矩阵"的商业策略，第一阶段支撑 AI 短视频内容服务交付能力。

**项目代号候选**：
1. **ReelForge** — Reel(短视频) + Forge(锻造) → 打造精品短视频
2. **VidCraft** — Video + Craft(工艺) → 内容匠心
3. **FlowClip** — Flow(工作流) + Clip(剪辑) → 自动化流程

当前默认使用 **ReelForge**。

## 项目目标

- 为商业客户提供高效的 AI 短视频内容生产服务
- 构建标准化、可追踪、可优化的视频生产工作流
- 支持"北美前台 + 中国后台"的协同交付模式
- 每条视频的成本、质量、返工次数均可量化

## 当前范围 (MVP 1.0)

### 包含的 5 个核心模块

| 模块 | 说明 | Agent |
|------|------|-------|
| 客户 Brief | 需求采集与标准化 | Intake Agent |
| 数据分析 / 策略 | 趋势研究与策略输出 | Research Agent + Strategy Agent |
| 脚本生成 | 短视频脚本、口播、字幕 | Script Agent |
| 视频生成调度 | AI 视频生成任务管理 | Video Production Agent |
| AI 质检 | 自动评分与问题检测 | QA Agent |

### 暂不包含

- 自动发布到平台 / 多平台联动
- CRM / 自动报价
- 复杂权限系统 / 深度 BI 报表
- 账号矩阵管理

## 系统流程

```
客户建档 → Brief 生成 → 数据采集 → 策略分析 → 脚本生成
    → 视频生成 → AI 质检 → 人工审核 → 交付 → 数据回流
```

## 项目结构

```
├── app/                    # FastAPI 应用
│   ├── main.py            # 应用入口
│   ├── database.py        # 数据库配置
│   ├── api/routes/        # API 路由 (briefs/projects/scripts/videos/reviews)
│   └── models/            # SQLAlchemy 数据模型
├── agents/                 # Agent 业务逻辑
│   ├── base.py            # Agent 基类
│   ├── intake_agent.py    # 需求采集 Agent
│   ├── research_agent.py  # 研究分析 Agent
│   ├── strategy_agent.py  # 策略生成 Agent
│   ├── script_agent.py    # 脚本生成 Agent
│   ├── video_production_agent.py  # 视频调度 Agent
│   ├── qa_agent.py        # 质检 Agent
│   ├── delivery_agent.py  # 交付 Agent
│   └── learning_agent.py  # 学习优化 Agent
├── services/               # 外部服务封装
│   ├── llm/               # LLM 统一调用层 (LiteLLM)
│   ├── video/             # 视频生成服务 (Mock → Seedance/Runway)
│   └── storage/           # 文件存储 (本地 → S3/MinIO)
├── pipelines/              # 流水线编排
│   ├── base.py            # Pipeline 基类
│   ├── project_intake.py  # 项目录入
│   ├── research_analysis.py
│   ├── script_generation.py
│   ├── video_generation.py
│   ├── qa_review.py
│   ├── delivery.py
│   └── feedback_loop.py
├── schemas/                # JSON Schema 定义
│   ├── brief.schema.json
│   ├── strategy.schema.json
│   ├── script.schema.json
│   ├── video_job.schema.json
│   ├── qa_report.schema.json
│   └── delivery_record.schema.json
├── prompts/                # Prompt 模板
│   ├── intake/
│   ├── strategy/
│   ├── script/
│   └── qa/
├── rules/                  # 规则引擎 (不依赖 LLM)
│   ├── qa_rules.py        # 质检规则
│   └── strategy_rules.py  # 策略规则
├── docs/                   # 项目文档
├── tests/                  # 测试
├── scripts/                # 工具脚本
├── config/                 # 配置管理
├── requirements.txt
├── .env.example
└── .gitignore
```

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 语言 | Python 3.11+ | |
| Web 框架 | FastAPI | 异步、自动文档 |
| ORM | SQLAlchemy 2.0 | 异步支持 |
| 数据库 | SQLite (MVP) → PostgreSQL | |
| AI 接入 | LiteLLM | 统一封装 OpenAI/Gemini/DeepSeek |
| 数据校验 | Pydantic v2 + JSON Schema | |
| 日志 | structlog | 结构化日志 |
| 配置 | pydantic-settings | .env 驱动 |
| 测试 | pytest + pytest-asyncio | |
| 队列 | Celery + Redis (生产阶段) | |

## 快速开始

```bash
# 1. 创建虚拟环境
python -m venv .venv
.venv\Scripts\activate  # Windows

# 2. 安装依赖
pip install -r requirements.txt

# 3. 配置环境变量
copy .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY

# 4. 初始化数据库
python scripts/init_db.py

# 5. 启动服务
uvicorn app.main:app --reload

# 6. 查看 API 文档
# http://localhost:8000/docs
```

## 运行测试

```bash
pytest tests/ -v
```

## 运行 Pipeline

```bash
python scripts/run_pipeline.py project_intake --input '{"raw_requirements": "Need 5 TikTok videos for sneaker launch", "client_name": "NikeTest", "platform": "tiktok"}'
```

## 开发原则

1. **结构化输入输出** — 所有关键模块用 JSON Schema 约束
2. **规则优先** — 能规则化的先规则化，不过度依赖 LLM
3. **先半自动，后全自动** — 人工审核环节保留
4. **Agent 职责单一** — 每个 Agent 只做一件事
5. **成本可追踪** — 每条视频的 LLM/生成/返工成本透明
6. **先服务，后矩阵** — 先验证服务交付能力

## MVP 开发计划

### 第 1 周：基础设施 + Brief 模块
- [x] 项目骨架搭建
- [ ] 数据库模型完善
- [ ] Intake Agent + Brief API 完整实现
- [ ] LLM 调用层对接 OpenAI
- [ ] 基础测试跑通

### 第 2 周：策略 + 脚本模块
- [ ] Research Agent 实现（先用 mock 数据）
- [ ] Strategy Agent + 规则引擎
- [ ] Script Agent + 脚本生成 pipeline
- [ ] 人工审核脚本的 API 流程

### 第 3 周：视频生成 + 质检 + 交付
- [ ] Video Production Agent（Mock 模式）
- [ ] QA Agent + 规则质检 + LLM 质检
- [ ] Delivery Agent + 交付记录
- [ ] 端到端 pipeline 联调
- [ ] 成本追踪验证

## 下一步计划

- 接入真实视频生成 API（Seedance / Runway）
- 添加 Redis + Celery 异步任务队列
- 切换 PostgreSQL 数据库
- 构建简单的管理后台（人工审核界面）
- 接入平台数据 API（TikTok Analytics）
- 支持多语言脚本生成

## 协同模式

```
北美前台                          中国后台
├── 客户沟通                      ├── Pipeline 引擎
├── Brief 确认                    ├── Agent 执行
├── 人工审核                      ├── 视频生成
├── 交付管理                      ├── 质检
└── 客户反馈                      └── 数据分析
```

## License

Private — All Rights Reserved
