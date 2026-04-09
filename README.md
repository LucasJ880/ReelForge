# ReelForge

AI 驱动的 TikTok 短视频自动化平台。输入关键词，自动生成内容方案、AI 视频、发布到 TikTok，并用 AI 分析表现数据。

## 核心流程

```
关键词 → AI 内容生成 → AI 视频生成 → 用户审核 → TikTok 发布 → 数据拉取 → AI 分析报告
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Framer Motion |
| 后端 | Next.js API Routes, Prisma ORM |
| 数据库 | Neon Postgres |
| 认证 | NextAuth.js v4 (Credentials + JWT) |
| AI 文本 | OpenAI (gpt-4o-mini) |
| AI 视频 | 即梦/Seedance (火山方舟 Ark API) |
| 社媒 | TikTok Content Posting API + Video Query API |
| 部署 | Vercel + Vercel Cron |

## 项目结构

```
src/
├── app/
│   ├── (app)/              # 认证后页面
│   │   ├── page.tsx        # Dashboard
│   │   ├── projects/       # 作品库（搜索/分类/多视图）
│   │   ├── batches/        # 批量任务
│   │   └── settings/       # 设置（TikTok 绑定）
│   ├── (auth)/             # 登录/注册
│   ├── (public)/           # Landing Page
│   └── api/                # API 路由
│       ├── projects/       # 项目 CRUD + 生成/发布/分析
│       ├── batches/        # 批量任务
│       ├── auth/           # NextAuth + TikTok OAuth
│       └── cron/           # 定时数据拉取 + 自动分析
├── components/
│   ├── layout/             # Sidebar, Header
│   ├── project/            # StatusBadge, StatusStepper
│   └── ui/                 # shadcn/ui 组件, Logo
├── lib/
│   ├── providers/          # 外部 API 封装
│   │   ├── openai.ts       # 内容生成 + 数据分析
│   │   ├── jimeng.ts       # 即梦视频生成
│   │   ├── tiktok.ts       # TikTok 发布 + 数据拉取
│   │   └── tiktok-auth.ts  # TikTok OAuth
│   └── services/           # 业务逻辑
│       ├── content-service.ts   # 内容方案生成
│       ├── video-service.ts     # 视频生成管理
│       ├── publish-service.ts   # TikTok 发布
│       ├── analytics-service.ts # 数据拉取
│       ├── analysis-service.ts  # AI 分析报告
│       └── batch-service.ts     # 批量执行
└── types/                  # TypeScript 类型定义
```

## 数据模型

```
Project (关键词 + 状态)
├── ContentPlan     (AI 生成的脚本/标题/标签/视频提示词)
├── VideoJob        (视频生成任务状态/URL)
├── Publication     (TikTok 发布记录)
│   └── AnalyticsSnapshot[] (播放/点赞/评论/分享)
└── AnalysisReport  (AI 分析: 评分/建议/优化方向)

Batch (批量任务)
└── Project[]

User (认证用户)
TikTokAccount (OAuth 令牌)
```

### 项目状态流

```
DRAFT → CONTENT_GENERATED → VIDEO_GENERATING → VIDEO_READY
                                 ↓
                           VIDEO_FAILED
         ↓
PUBLISHING → PUBLISHED → ANALYTICS_FETCHED → ANALYZED
    ↓
PUBLISH_FAILED
```

## 功能清单

- **AI 内容生成**: 输入关键词，GPT-4o-mini 自动生成脚本、视频提示词、TikTok 标题、Hashtags、内容角度、分类
- **AI 视频生成**: 即梦/Seedance API 生成 AI 短视频，支持状态轮询和失败重试
- **TikTok 发布**: FILE_UPLOAD 方式上传视频到 TikTok，支持 Sandbox 和正式模式
- **数据分析**: 拉取 TikTok 播放/点赞/评论/分享数据，GPT-4o-mini 生成分析报告（评分 + 建议）
- **批量生成**: 多关键词批量执行，支持并发控制和部分重试
- **作品库管理**: 搜索、分类筛选、网格/列表视图切换、分页、排序
- **自动分类**: 内容生成时 AI 自动分配分类（美食/旅行/时尚/科技等）
- **定时任务**: Vercel Cron 每日自动拉取 TikTok 数据并触发 AI 分析
- **用户认证**: NextAuth.js 邮箱密码登录，JWT 策略，路由保护
- **TikTok OAuth**: TikTok Login Kit 授权绑定，令牌自动刷新
- **Landing Page**: Framer Motion 动画，品牌展示页
- **深色主题**: 全局深色 UI，glassmorphism 风格

## 快速开始

### 环境变量

复制 `.env.example` 到 `.env.local`，填入以下配置：

```bash
DATABASE_URL=           # Neon Postgres 连接串
OPENAI_API_KEY=         # OpenAI API Key
OPENAI_MODEL=gpt-4o-mini
ARK_API_KEY=            # 火山方舟 API Key（即梦视频）
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_VIDEO_MODEL=doubao-seedance-1-5-pro-250115
TIKTOK_CLIENT_KEY=      # TikTok Developer Client Key
TIKTOK_CLIENT_SECRET=   # TikTok Developer Client Secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
AUTH_SECRET=            # NextAuth JWT 密钥
CRON_SECRET=            # Cron 任务认证密钥
```

### 安装运行

```bash
npm install
npx prisma db push
npm run dev
```

访问 http://localhost:3000

### 部署

```bash
npx vercel deploy --prod
```

Vercel 环境变量需要在 Dashboard 中配置。`vercel.json` 已包含 Cron 配置（每日 12:00 UTC 执行数据拉取 + AI 分析）。

## AI Agency 团队

本项目集成了 [Agency AI Team](https://github.com/msitarzewski/agency-agents)，34 个专业 AI Agent 分布在 4 个 Division 中，通过 `.cursor/rules/` 提供智能辅助：

| Division | Agents | 核心能力 |
|----------|--------|----------|
| Engineering (13) | Frontend Developer, Backend Architect, Software Architect, Code Reviewer, Database Optimizer, AI Engineer, Security Engineer, DevOps, SRE, Git Master, Tech Writer, Senior Dev, Rapid Prototyper | 代码实现、架构设计、代码质量 |
| Design (8) | UI Designer, UX Architect, UX Researcher, Brand Guardian, Visual Storyteller, Image Prompt Engineer, Whimsy Injector, Inclusive Visuals | UI/UX 设计、品牌一致性 |
| Testing (8) | Evidence Collector, Reality Checker, API Tester, Performance Benchmarker, Test Results Analyzer, Accessibility Auditor, Workflow Optimizer, Tool Evaluator | 质量保证、Bug 修复 |
| Product (5) | Product Manager, Sprint Prioritizer, Trend Researcher, Feedback Synthesizer, Behavioral Nudge Engine | 产品规划、用户洞察 |

### 使用方式

```
"启动整个 Agency 团队来实现 [功能]"
"让 Engineering + Testing 一起优化 [页面]"
"用 @evidence-collector 检查并修复 [bug]"
"用 @code-reviewer 审查最近的改动"
```

## License

Private project.
