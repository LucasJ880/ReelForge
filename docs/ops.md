# ReelForge — 运维指南

## 本地开发环境搭建

### 前置要求

- Python 3.11+
- pip / virtualenv

### 步骤

```bash
# 1. 克隆项目
cd "Ai 视频流"

# 2. 创建虚拟环境
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
# source .venv/bin/activate

# 3. 安装依赖
pip install -r requirements.txt

# 4. 配置环境变量
copy .env.example .env
# 编辑 .env 填入 API Key

# 5. 初始化数据库
python scripts/init_db.py

# 6. 启动开发服务器
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 验证

- 健康检查: `http://localhost:8000/health`
- API 文档: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## 目录结构说明

```
项目根目录/
├── app/          → FastAPI 应用（API 路由、数据模型）
├── agents/       → Agent 业务逻辑
├── services/     → 外部服务封装（LLM、视频、存储）
├── pipelines/    → 流水线编排
├── schemas/      → JSON Schema 定义
├── prompts/      → Prompt 模板
├── rules/        → 规则引擎
├── docs/         → 项目文档
├── tests/        → 测试
├── scripts/      → 工具脚本
└── storage/      → 本地文件存储（.gitignore）
```

## 常用命令

```bash
# 启动开发服务器
uvicorn app.main:app --reload

# 运行测试
pytest tests/ -v

# 运行单个 pipeline
python scripts/run_pipeline.py project_intake --input '{"raw_requirements": "...", "client_name": "test"}'

# 初始化/重建数据库
python scripts/init_db.py
```

## 日志

使用 structlog 结构化日志，输出格式：

```
2024-01-15 10:30:00 [info] agent.start  agent=intake_agent input_keys=['raw_requirements', 'client_name']
2024-01-15 10:30:01 [info] llm.request  model=gpt-4o prompt_len=1500
2024-01-15 10:30:03 [info] llm.response model=gpt-4o tokens=500
2024-01-15 10:30:03 [info] agent.complete agent=intake_agent success=True
```

日志级别通过 `.env` 中的 `LOG_LEVEL` 控制。

## 生产部署（未来）

### Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 环境隔离

```
development  → SQLite, 本地存储, Mock 视频服务
staging      → PostgreSQL, MinIO, Mock 视频服务
production   → PostgreSQL, S3, 真实视频服务 + Redis + Celery
```

## 监控（未来）

- API 响应时间和错误率
- LLM 调用量和成本
- 视频生成成功率
- Pipeline 执行时间和失败率
- 队列积压情况
