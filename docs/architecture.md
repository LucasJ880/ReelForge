# ReelForge — 系统架构设计

> 版本: 2.0 | 更新时间: 2026-04-06
> 技术栈: Next.js + TypeScript + Prisma + Neon Postgres + Vercel

---

## 1. 整体架构

```
┌───────────────────────────────────────────────────────────────┐
│                    前端层 (Next.js App Router + RSC)            │
│  Tailwind CSS + shadcn/ui | 中文 UI                            │
├───────────────────────────────────────────────────────────────┤
│                    API 路由层 (Route Handlers)                  │
│  /api/projects  /api/generate  /api/video  /api/publish        │
│  /api/tiktok/auth  /api/cron/fetch-analytics                   │
├───────────────────────────────────────────────────────────────┤
│                    Service 层 (业务逻辑)                        │
│  ContentService | VideoService | PublishService | AnalyticsService │
├──────────────┬──────────────┬────────────────────────────────┤
│  Provider 层  │              │                                │
│  OpenAI      │  即梦/Seedance│  TikTok API                    │
│  (文本生成)   │  (视频生成)   │  (发布+数据)                    │
├──────────────┴──────────────┴────────────────────────────────┤
│                    数据层 (Prisma + Neon Postgres)              │
├───────────────────────────────────────────────────────────────┤
│                    基础设施 (Vercel + Vercel Cron)              │
└───────────────────────────────────────────────────────────────┘
```

## 2. 分层职责

| 层 | 职责 | 原则 |
|---|------|------|
| **前端层** | UI 渲染、用户交互、状态展示 | Server Components 优先，Client Components 仅在需要交互时 |
| **API 路由层** | 请求校验、调用 Service、返回响应 | 薄路由，不包含业务逻辑 |
| **Service 层** | 核心业务逻辑、状态流转、错误处理 | 纯函数优先，可测试，不直接调外部 API |
| **Provider 层** | 封装外部 API 调用细节 | 面向接口编程，可替换实现 |
| **数据层** | 数据持久化、查询 | 统一通过 Prisma，由 Service 层调用 |

## 3. 核心数据流

```
[用户输入关键词]
    ↓
ContentService.generate() ──→ OpenAI API
    ↓ 返回: script, videoPrompt, caption, hashtags, angles
[用户审核/编辑，保存到数据库]
    ↓
VideoService.submit() ──→ 即梦 API（异步任务）
    ↓
[前端轮询] ──→ VideoService.checkStatus() ──→ 即梦 API
    ↓ 视频完成，返回 videoUrl
[用户预览确认]
    ↓
PublishService.publish() ──→ TikTok Content Posting API
    ↓ 返回 tiktokVideoId
[等待 12 小时]
    ↓
[Cron] AnalyticsService.fetchMetrics() ──→ TikTok API
    ↓
AnalyticsService.generateReport() ──→ OpenAI API
    ↓ 返回: 表现分析 + 方向建议
```

## 4. 工作流状态机

```
DRAFT ──→ CONTENT_GENERATED ──→ VIDEO_GENERATING ──→ VIDEO_READY
               ↑ (重新生成)          ↑ (重试)            ↓ (用户确认)
          CONTENT_FAILED        VIDEO_FAILED        PUBLISHING ──→ PUBLISHED
                                                      ↑ (重试)        ↓
                                                 PUBLISH_FAILED  ANALYTICS_PENDING
                                                                      ↓
                                                              ANALYTICS_FETCHED ──→ ANALYZED
```

状态规则：
- 每次状态变更记录 `updatedAt`
- 失败状态保留 `errorMessage` 和 `retryCount`
- 任何失败状态可重试，回到前一个正常状态
- `PUBLISHED` 之后不可回退到视频生成阶段

## 5. Provider 接口抽象

```typescript
// 文本生成 Provider
interface TextProvider {
  generateContent(input: ContentInput): Promise<ContentPlan>
  generateAnalysis(input: AnalysisInput): Promise<AnalysisReport>
}

// 视频生成 Provider
interface VideoProvider {
  submitGeneration(prompt: string, options?: VideoOptions): Promise<{ jobId: string }>
  getJobStatus(jobId: string): Promise<VideoJobStatus>
  getJobResult(jobId: string): Promise<{ videoUrl: string; thumbnailUrl?: string }>
}

// 发布 Provider
interface PublishProvider {
  publishVideo(params: PublishParams): Promise<{ platformVideoId: string }>
  getPublishStatus(publishId: string): Promise<PublishStatusResult>
}

// 数据获取 Provider
interface AnalyticsProvider {
  fetchMetrics(platformVideoId: string): Promise<VideoMetrics>
}
```

MVP 阶段每个接口只有一个实现，但接口定义为未来扩展（多平台、多视频生成商）预留空间。

## 6. 文件结构

```
src/
├── app/
│   ├── layout.tsx                     # 根布局
│   ├── page.tsx                       # 首页/仪表板
│   ├── projects/
│   │   ├── page.tsx                   # 项目列表
│   │   ├── new/page.tsx               # 新建项目
│   │   └── [id]/
│   │       ├── page.tsx               # 项目详情（核心页面）
│   │       └── analytics/page.tsx     # 数据分析详情
│   ├── settings/
│   │   └── page.tsx                   # 设置（TikTok 账号绑定）
│   └── api/
│       ├── projects/
│       │   ├── route.ts               # GET 列表 / POST 创建
│       │   └── [id]/
│       │       ├── route.ts           # GET 详情 / PATCH 更新 / DELETE 删除
│       │       ├── generate/route.ts  # POST 生成内容
│       │       ├── video/route.ts     # POST 触发视频生成
│       │       ├── publish/route.ts   # POST 发布到 TikTok
│       │       └── analyze/route.ts   # POST 触发分析
│       ├── video/
│       │   └── status/[jobId]/route.ts  # GET 视频生成状态
│       ├── tiktok/
│       │   ├── auth/route.ts          # GET TikTok OAuth 跳转
│       │   └── callback/route.ts      # GET OAuth 回调
│       └── cron/
│           └── fetch-analytics/route.ts # POST Cron 拉取数据
├── lib/
│   ├── db.ts                          # Prisma Client 单例
│   ├── providers/
│   │   ├── openai.ts                  # OpenAI 封装
│   │   ├── jimeng.ts                  # 即梦/Seedance 封装
│   │   └── tiktok.ts                  # TikTok API 封装
│   ├── services/
│   │   ├── content-service.ts         # 内容生成
│   │   ├── video-service.ts           # 视频生成
│   │   ├── publish-service.ts         # 发布
│   │   └── analytics-service.ts       # 数据分析
│   ├── prompts/
│   │   ├── content-generation.ts      # 内容生成 Prompt
│   │   └── analysis.ts               # 分析 Prompt
│   └── utils/
│       ├── errors.ts                  # 统一错误类型
│       └── retry.ts                   # 重试工具函数
├── components/
│   ├── ui/                            # shadcn/ui 组件
│   ├── layout/
│   │   ├── app-sidebar.tsx
│   │   ├── app-header.tsx
│   │   └── page-container.tsx
│   ├── project/
│   │   ├── create-project-form.tsx
│   │   ├── project-card.tsx
│   │   ├── project-list.tsx
│   │   ├── status-stepper.tsx
│   │   ├── status-badge.tsx
│   │   ├── content-plan-card.tsx
│   │   ├── video-player.tsx
│   │   ├── publish-confirm.tsx
│   │   └── retry-button.tsx
│   ├── analytics/
│   │   ├── metrics-grid.tsx
│   │   ├── analysis-report.tsx
│   │   └── direction-badge.tsx
│   └── settings/
│       └── tiktok-account-card.tsx
├── types/
│   └── index.ts                       # 共享类型
├── prisma/
│   └── schema.prisma                  # 数据库 Schema
└── public/
```

## 7. 关键技术决策

| 决策 | 选择 | 备选 | 理由 |
|------|------|------|------|
| 视频生成状态 | 前端 5-10s 轮询 | WebSocket / SSE | MVP 简单可靠 |
| 定时任务 | Vercel Cron | 外部 Cron 服务 | 零额外成本 |
| 视频文件 | 只存 URL | 上传到 S3 | MVP 不需要自己存文件 |
| 平台认证 | 环境变量密码 | NextAuth | 个人使用不需要用户系统 |
| TikTok Token | Postgres 存储 | Redis | 已有数据库，不引入额外组件 |
| 前端状态 | 数据库 + SWR/fetch | Zustand/Redux | 服务端数据为主，不需要复杂状态管理 |
| Runtime | Node.js | Edge | Prisma 在 Edge 需要额外适配，MVP 用 Node.js 更稳 |

## 8. 外部依赖

| 依赖 | 服务 | 用途 | API 文档 |
|------|------|------|---------|
| OpenAI | gpt-4o-mini | 内容生成 + 数据分析 | https://platform.openai.com/docs |
| 火山方舟 Ark | Seedance/即梦 | AI 视频生成 | https://www.volcengine.com/docs/82379 |
| TikTok | Content Posting API | 视频发布 | https://developers.tiktok.com/doc/content-posting-api-get-started |
| TikTok | Video Query API | 数据获取 | https://developers.tiktok.com/doc/research-api-specs-query-videos |
| Neon | Serverless Postgres | 数据存储 | https://neon.tech/docs |
| Vercel | Hosting + Cron | 部署和定时任务 | https://vercel.com/docs |
