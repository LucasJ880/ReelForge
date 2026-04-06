# ReelForge — 系统架构

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        API Layer (FastAPI)                    │
│  /briefs  /projects  /scripts  /videos  /reviews             │
├─────────────────────────────────────────────────────────────┤
│                     Pipeline Orchestrator                     │
│  project_intake → research → script → video → qa → delivery  │
├─────────────────────────────────────────────────────────────┤
│                        Agent Layer                            │
│  Intake | Research | Strategy | Script | Video | QA | ...     │
├──────────────┬──────────────┬───────────────────────────────┤
│  LLM Service │ Video Service│  Storage Service               │
│  (LiteLLM)   │ (Mock/API)   │  (Local/S3)                   │
├──────────────┴──────────────┴───────────────────────────────┤
│              Rules Engine (QA / Strategy)                     │
├─────────────────────────────────────────────────────────────┤
│           Data Layer (SQLAlchemy + SQLite/PostgreSQL)         │
└─────────────────────────────────────────────────────────────┘
```

## 分层说明

### 1. API Layer
- FastAPI 异步 Web 框架
- RESTful 接口，Pydantic 请求/响应验证
- 自动生成 OpenAPI 文档
- 职责：接收外部请求，返回结构化响应

### 2. Pipeline Layer
- 编排 Agent 的执行顺序
- 管理步骤间的数据传递
- 处理失败重试和状态追踪
- 7 条核心流水线覆盖完整业务流程

### 3. Agent Layer
- 每个 Agent 职责单一
- 统一的 BaseAgent 接口：`run(input) -> AgentResult`
- 支持 LLM 调用和纯规则处理
- 内置日志和错误处理

### 4. Service Layer
- **LLM Service**: 基于 LiteLLM 统一封装，支持 OpenAI/Gemini/DeepSeek
- **Video Service**: 抽象接口，MVP 阶段用 Mock，后续接入 Seedance/Runway 等
- **Storage Service**: 本地文件系统 → S3/MinIO

### 5. Rules Engine
- 不依赖 LLM 的确定性规则检查
- 平台规范约束（时长、尺寸、文件大小）
- 内容质量规则（语速、结构完整性）
- 策略规则（平台最佳实践、标签策略）

### 6. Data Layer
- SQLAlchemy 2.0 异步 ORM
- MVP: SQLite → 生产: PostgreSQL
- 所有实体统一 UUID 主键 + 时间戳

## 技术栈

| 组件 | MVP 选型 | 生产选型 |
|------|---------|---------|
| Web 框架 | FastAPI | FastAPI |
| ORM | SQLAlchemy 2.0 (async) | SQLAlchemy 2.0 |
| 数据库 | SQLite | PostgreSQL |
| 队列 | 同步调用 | Celery + Redis |
| 缓存 | 无 | Redis |
| AI 接入 | LiteLLM | LiteLLM |
| 对象存储 | 本地文件系统 | MinIO / S3 |
| 日志 | structlog | structlog + ELK |
| 配置 | pydantic-settings + .env | pydantic-settings + Vault |
| 文档校验 | Pydantic + JSON Schema | Pydantic + JSON Schema |

## 部署架构（未来）

```
北美前台                          中国后台
┌──────────┐                    ┌──────────────┐
│ 客户界面  │ ──── API ────────→ │ Pipeline 引擎 │
│ 人工审核  │ ←── Webhook ───── │ Agent 执行    │
│ 交付管理  │                    │ 视频生成      │
└──────────┘                    └──────────────┘
```
