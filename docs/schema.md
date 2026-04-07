# ReelForge — 数据模型设计

> 版本: 2.0 | 更新时间: 2026-04-06
> ORM: Prisma | 数据库: Neon Postgres

---

## 1. 实体关系图

```
TikTokAccount (全局，1个)

Project ────1:1──── ContentPlan
   │
   ├───1:1──── VideoJob
   │
   ├───1:1──── Publication ────1:N──── AnalyticsSnapshot
   │
   └───1:1──── AnalysisReport
```

## 2. Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// 枚举
// ============================================================

enum ProjectStatus {
  DRAFT                 // 草稿，等待生成内容
  CONTENT_GENERATED     // 内容已生成，等待用户确认
  VIDEO_GENERATING      // 视频生成中
  VIDEO_FAILED          // 视频生成失败
  VIDEO_READY           // 视频已就绪，等待用户确认发布
  PUBLISHING            // 发布中
  PUBLISH_FAILED        // 发布失败
  PUBLISHED             // 已发布，等待数据
  ANALYTICS_PENDING     // 等待数据拉取
  ANALYTICS_FETCHED     // 数据已拉取
  ANALYZED              // 分析已完成
}

enum VideoJobStatus {
  PENDING               // 等待提交
  PROCESSING            // 生成中
  COMPLETED             // 生成完成
  FAILED                // 生成失败
}

enum PublishStatus {
  PENDING               // 等待发布
  PUBLISHED             // 已发布
  FAILED                // 发布失败
}

// ============================================================
// 核心实体
// ============================================================

/// 视频项目 — 核心实体，贯穿整个工作流
model Project {
  id            String         @id @default(cuid())
  keyword       String         // 用户输入的中文关键词/方向
  status        ProjectStatus  @default(DRAFT)
  errorMessage  String?        // 最近一次错误信息
  retryCount    Int            @default(0)
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  contentPlan    ContentPlan?
  videoJob       VideoJob?
  publication    Publication?
  analysisReport AnalysisReport?
}

/// 内容方案 — AI 生成的脚本、提示词、标题等
model ContentPlan {
  id             String   @id @default(cuid())
  projectId      String   @unique
  script         String   // 中文脚本
  videoPrompt    String   // 视频生成提示词（英文或中文，取决于即梦要求）
  caption        String   // TikTok caption
  hashtags       String[] // hashtag 列表
  contentAngles  Json     // 内容角度建议 [{ angle: string, reason: string }]
  modelUsed      String   // 例如 "gpt-4o-mini"
  tokenUsage     Json?    // { promptTokens, completionTokens, totalTokens }
  createdAt      DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

/// 视频生成任务
model VideoJob {
  id             String         @id @default(cuid())
  projectId      String         @unique
  provider       String         @default("jimeng") // 视频生成商标识
  providerJobId  String?        // 即梦 API 返回的任务 ID
  status         VideoJobStatus @default(PENDING)
  videoUrl       String?        // 生成的视频 URL
  thumbnailUrl   String?        // 缩略图 URL
  errorMessage   String?
  retryCount     Int            @default(0)
  createdAt      DateTime       @default(now())
  completedAt    DateTime?

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

/// 发布记录
model Publication {
  id                    String        @id @default(cuid())
  projectId             String        @unique
  platform              String        @default("tiktok")
  platformVideoId       String?       // TikTok 视频 ID
  publishStatus         PublishStatus @default(PENDING)
  publishedAt           DateTime?
  errorMessage          String?
  analyticsScheduledAt  DateTime?     // 计划拉数时间（发布后 +12h）

  project    Project              @relation(fields: [projectId], references: [id], onDelete: Cascade)
  snapshots  AnalyticsSnapshot[]
}

/// 数据快照 — 可多次拉取，追踪变化
model AnalyticsSnapshot {
  id             String   @id @default(cuid())
  publicationId  String
  views          Int      @default(0)
  likes          Int      @default(0)
  comments       Int      @default(0)
  shares         Int      @default(0)
  fetchedAt      DateTime @default(now())

  publication Publication @relation(fields: [publicationId], references: [id], onDelete: Cascade)
}

/// 分析报告 — AI 生成的表现分析
model AnalysisReport {
  id                  String   @id @default(cuid())
  projectId           String   @unique
  performanceSummary  String   // 表现总结
  directionAdvice     String   // 方向建议（是否值得继续）
  optimizationTips    String[] // 优化建议列表
  modelUsed           String
  createdAt           DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

/// TikTok 账号 — MVP 阶段全局唯一
model TikTokAccount {
  id              String   @id @default(cuid())
  openId          String   @unique // TikTok Open ID
  accessToken     String   // 访问令牌（加密存储建议）
  refreshToken    String   // 刷新令牌
  tokenExpiresAt  DateTime // Token 过期时间
  displayName     String?
  avatarUrl       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

## 3. 设计说明

### 3.1 关系设计
- Project 与 ContentPlan/VideoJob/Publication/AnalysisReport 为 1:1 关系
- Publication 与 AnalyticsSnapshot 为 1:N 关系（支持多次拉取数据）
- 所有子表通过 `onDelete: Cascade` 级联删除

### 3.2 状态管理
- Project.status 作为工作流的唯一状态源
- VideoJob.status 和 Publication.publishStatus 记录子步骤的细粒度状态
- 每次状态变更自动更新 `updatedAt`（Prisma @updatedAt）

### 3.3 扩展预留
- `VideoJob.provider` 字段为未来多视频生成商预留
- `Publication.platform` 字段为未来多平台发布预留
- TikTokAccount 表独立于 Project，未来可支持多账号

### 3.4 索引建议（后续优化）
- `Project.status` — 按状态查询列表
- `Project.createdAt` — 按时间排序
- `Publication.publishStatus` + `Publication.analyticsScheduledAt` — Cron 查询待拉数的发布记录

## 4. 状态流转规则

### Project 状态流转
```
DRAFT → CONTENT_GENERATED         (内容生成成功)
DRAFT → DRAFT + errorMessage      (内容生成失败，可重试)
CONTENT_GENERATED → VIDEO_GENERATING    (用户确认，触发视频生成)
CONTENT_GENERATED → DRAFT               (用户要求重新生成内容)
VIDEO_GENERATING → VIDEO_READY          (视频生成成功)
VIDEO_GENERATING → VIDEO_FAILED         (视频生成失败)
VIDEO_FAILED → VIDEO_GENERATING         (重试)
VIDEO_READY → PUBLISHING               (用户确认发布)
PUBLISHING → PUBLISHED                 (发布成功)
PUBLISHING → PUBLISH_FAILED            (发布失败)
PUBLISH_FAILED → PUBLISHING            (重试)
PUBLISHED → ANALYTICS_PENDING          (自动，设置12h后拉数)
ANALYTICS_PENDING → ANALYTICS_FETCHED  (Cron 拉数成功)
ANALYTICS_FETCHED → ANALYZED           (AI 分析完成)
```

### 不可逆规则
- `PUBLISHED` 之后不可回退到视频生成或内容生成阶段
- 已删除的项目不可恢复（级联删除所有关联数据）
