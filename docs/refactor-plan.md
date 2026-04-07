# ReelForge — 重构实施计划

> 版本: 1.0 | 更新时间: 2026-04-06
> 状态: 执行中

---

## 1. 代码库审计结论

### 1.1 现状

当前仓库是一个**纯 Python 项目**（FastAPI + SQLAlchemy + LiteLLM），共 87 个文件。
**没有任何 TypeScript / Next.js 代码。** 无 package.json、tsconfig.json、next.config。

### 1.2 与新方案的核心差异


| 维度  | 现有代码                | 新方案                            |
| --- | ------------------- | ------------------------------ |
| 语言  | Python              | TypeScript                     |
| 框架  | FastAPI             | Next.js App Router             |
| ORM | SQLAlchemy + SQLite | Prisma + Neon Postgres         |
| 前端  | 无                   | Next.js + Tailwind + shadcn/ui |
| 部署  | 未定                  | Vercel                         |
| 业务  | B2B 多 Agent 服务      | 个人 TikTok 自动化工具                |


### 1.3 审计结论

Python 代码与 Next.js/TypeScript 新方案完全不兼容。这不是增量重构，而是完全重建。
策略：将所有旧代码归档到 `_legacy/`，在根目录初始化全新 Next.js 项目。

---

## 2. 旧代码处理

### 2.1 归档到 `_legacy/`（保留参考价值）


| 目录/文件                         | 参考价值                       |
| ----------------------------- | -------------------------- |
| `services/video/generator.py` | Seedance/Ark HTTP API 调用模式 |
| `prompts/strategy/*.txt`      | Prompt 模板文本（需改写为中文）        |
| `prompts/script/*.txt`        | Prompt 模板文本（需改写为中文）        |
| `agents/qa_agent.py`          | QA 评分维度参考                  |
| 其余所有 Python 文件                | 业务逻辑参考                     |


### 2.2 保留在项目根目录


| 文件                 | 理由       |
| ------------------ | -------- |
| `docs/*.md`（6个新文档） | 新方案规划文档  |
| `.git/`            | Git 版本历史 |


### 2.3 需要全新创建


| 文件/目录                  | 说明                      |
| ---------------------- | ----------------------- |
| `package.json`         | Next.js + TypeScript 依赖 |
| `tsconfig.json`        | TypeScript 配置           |
| `next.config.ts`       | Next.js 配置              |
| `tailwind.config.ts`   | Tailwind 配置             |
| `prisma/schema.prisma` | 数据库 Schema              |
| `src/` 全部              | 应用代码                    |
| `.gitignore`           | 替换为 Next.js 版           |
| `.env.example`         | 新版，无密钥                  |
| `README.md`            | 新版                      |
| `vercel.json`          | Cron 配置                 |


---

## 3. 实施阶段

### Stage 1：项目骨架与目录重构（当前）

**目标**：清理旧代码，初始化 Next.js 项目，建立基础目录和布局。

**操作**：

1. 将所有旧 Python 文件移入 `_legacy/`
2. 替换 `.gitignore` 为 Next.js 版
3. 初始化 Next.js + TypeScript + Tailwind + shadcn/ui
4. 配置 Prisma + Neon Postgres 连接
5. 创建基础布局（侧边栏 + Header）
6. 新建 `.env.example`（干净版）

**完成标准**：

- `npm run dev` 可启动
- 能看到中文基础布局页面
- Prisma 可连接数据库

### Stage 2：数据库与 Prisma Schema

**目标**：实现数据模型，完成首次 migration。

**操作**：

1. 编写完整 `prisma/schema.prisma`（基于 docs/schema.md）
2. 配置 Neon 连接串
3. 执行 `prisma migrate dev`
4. 创建 `src/lib/db.ts` Prisma Client 单例
5. 创建 `src/types/index.ts` 共享类型

**完成标准**：

- 7 张表成功创建
- Prisma Client 可正常查询

### Stage 3：核心后端流程

**目标**：实现 Project CRUD + 内容生成 + 视频生成的 API 和 Service 层。

**操作**：

1. `src/lib/providers/openai.ts` — OpenAI 封装
2. `src/lib/services/content-service.ts` — 内容生成
3. `src/lib/providers/jimeng.ts` — 即梦/Seedance 封装
4. `src/lib/services/video-service.ts` — 视频生成
5. `src/app/api/projects/` — CRUD + generate + video 路由
6. `src/lib/utils/errors.ts` — 统一错误处理

**完成标准**：

- 通过 API 可创建项目、生成内容、触发视频生成
- OpenAI 和即梦 Provider 可调通

### Stage 4：前端页面与中文平台

**目标**：实现用户可用的中文界面。

**操作**：

1. 创建项目页面（关键词输入表单）
2. 项目列表页（卡片 + 状态筛选）
3. 项目详情页（内容展示/编辑 + 视频预览 + 发布 + 分析）
4. 设置页（TikTok 账号绑定）
5. 仪表板首页

**完成标准**：

- 用户可通过界面完成关键词 → 内容 → 视频的流程
- 所有页面中文

### Stage 5：TikTok + 即梦 + OpenAI 串联

**目标**：打通外部 API 集成。

**操作**：

1. TikTok OAuth 流程
2. TikTok Content Posting API 发布
3. TikTok Analytics API 数据获取
4. 错误处理、重试、日志
5. 状态同步

**完成标准**：

- 视频可发布到 TikTok
- 发布后可拉取数据

### Stage 6：Cron / 数据拉取 / AI 分析

**目标**：实现自动化数据回收和分析。

**操作**：

1. `vercel.json` Cron 配置
2. Cron 端点实现（幂等）
3. AnalyticsService 数据拉取
4. AI 分析报告生成
5. 分析结果展示页面

**完成标准**：

- 12 小时后自动拉取数据
- AI 分析报告可查看

### Stage 7：QA 清理与收口

**目标**：清理、测试、准备上线。

**操作**：

1. 清理 `_legacy/` 中确认不再需要的文件
2. 检查死代码
3. 检查状态一致性
4. 补全空态/错误态
5. 部署检查清单确认
6. README 更新

**完成标准**：

- 端到端手动测试通过
- Vercel 部署成功
- 无明显 bug

---

## 4. 风险提示


| 风险                        | 应对                             |
| ------------------------- | ------------------------------ |
| TikTok API 审批可能需要数周       | Stage 5 用 Mock 先行，审批后替换        |
| 即梦 API 可能有网络限制            | 参考旧 `generator.py` 中的 Ark 调用逻辑 |
| Neon 免费版冷启动慢              | MVP 可接受，后续升级 Pro               |
| `.env.example` 中的 API Key | 已标记为紧急安全事项                     |
