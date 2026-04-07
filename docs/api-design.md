# ReelForge — API 与模块设计

> 版本: 2.0 | 更新时间: 2026-04-06
> 框架: Next.js Route Handlers

---

## 1. API 路由总览


| 方法     | 路径                                | 说明                 |
| ------ | --------------------------------- | ------------------ |
| POST   | `/api/projects`                   | 创建项目               |
| GET    | `/api/projects`                   | 项目列表（支持状态筛选、分页）    |
| GET    | `/api/projects/[id]`              | 项目详情（含所有关联数据）      |
| PATCH  | `/api/projects/[id]`              | 更新项目（编辑内容方案）       |
| DELETE | `/api/projects/[id]`              | 删除项目               |
| POST   | `/api/projects/[id]/generate`     | 生成/重新生成内容方案        |
| POST   | `/api/projects/[id]/video`        | 触发视频生成             |
| GET    | `/api/projects/[id]/video/status` | 查询视频生成状态（轮询用）      |
| POST   | `/api/projects/[id]/publish`      | 发布到 TikTok         |
| POST   | `/api/projects/[id]/analyze`      | 手动触发分析             |
| GET    | `/api/tiktok/auth`                | 发起 TikTok OAuth 授权 |
| GET    | `/api/tiktok/callback`            | TikTok OAuth 回调    |
| GET    | `/api/tiktok/account`             | 获取已绑定的 TikTok 账号信息 |
| DELETE | `/api/tiktok/account`             | 解绑 TikTok 账号       |
| POST   | `/api/cron/fetch-analytics`       | Cron: 拉取待分析数据      |


## 2. API 详细设计

### 2.1 POST /api/projects

创建新项目。

```
请求:
{
  "keyword": "宠物用品推荐"
}

响应 201:
{
  "id": "clx...",
  "keyword": "宠物用品推荐",
  "status": "DRAFT",
  "createdAt": "2026-04-06T12:00:00Z"
}
```

### 2.2 GET /api/projects

获取项目列表。

```
查询参数:
  ?status=PUBLISHED        (可选，按状态筛选)
  ?page=1&pageSize=20      (可选，分页)

响应 200:
{
  "projects": [...],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

### 2.3 GET /api/projects/[id]

获取项目详情，包含所有关联数据。

```
响应 200:
{
  "id": "clx...",
  "keyword": "宠物用品推荐",
  "status": "VIDEO_READY",
  "contentPlan": {
    "script": "...",
    "videoPrompt": "...",
    "caption": "...",
    "hashtags": ["#宠物", "#推荐"],
    "contentAngles": [...]
  },
  "videoJob": {
    "status": "COMPLETED",
    "videoUrl": "https://...",
    "thumbnailUrl": "https://..."
  },
  "publication": null,
  "analysisReport": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### 2.4 POST /api/projects/[id]/generate

调用 OpenAI 生成内容方案。可重复调用（重新生成）。

```
前置条件: status 为 DRAFT 或 CONTENT_GENERATED
副作用: 创建/更新 ContentPlan，status → CONTENT_GENERATED

响应 200:
{
  "contentPlan": {
    "script": "大家好，今天给大家推荐几款超实用的宠物用品...",
    "videoPrompt": "A cute golden retriever using various pet products...",
    "caption": "你家毛孩子值得更好的！这几款宠物好物真的绝了",
    "hashtags": ["#宠物好物", "#养宠必备", "#宠物推荐"],
    "contentAngles": [
      { "angle": "性价比推荐", "reason": "目标用户关注实用性和价格" },
      { "angle": "萌宠开箱", "reason": "TikTok 上宠物开箱类内容热度高" }
    ]
  }
}

错误 400: { "error": "项目状态不允许此操作" }
错误 500: { "error": "内容生成失败", "detail": "OpenAI API 超时" }
```

### 2.5 POST /api/projects/[id]/video

触发视频生成。

```
前置条件: status 为 CONTENT_GENERATED 或 VIDEO_FAILED
副作用: 创建 VideoJob, status → VIDEO_GENERATING

响应 200:
{
  "videoJob": {
    "id": "clx...",
    "status": "PENDING",
    "provider": "jimeng"
  }
}
```

### 2.6 GET /api/projects/[id]/video/status

查询视频生成状态（前端轮询用）。

```
响应 200:
{
  "status": "PROCESSING",        // PENDING | PROCESSING | COMPLETED | FAILED
  "videoUrl": null,
  "progress": 60,                // 进度百分比（如果 API 支持）
  "estimatedSeconds": 120        // 预计剩余时间（如果 API 支持）
}
```

### 2.7 POST /api/projects/[id]/publish

发布视频到 TikTok。

```
前置条件: status 为 VIDEO_READY 或 PUBLISH_FAILED
前置条件: TikTokAccount 已绑定且 Token 有效
副作用: 创建 Publication, status → PUBLISHING → PUBLISHED

响应 200:
{
  "publication": {
    "platformVideoId": "7123456789...",
    "publishedAt": "2026-04-06T14:00:00Z",
    "analyticsScheduledAt": "2026-04-07T02:00:00Z"
  }
}

错误 400: { "error": "请先绑定 TikTok 账号" }
```

### 2.8 POST /api/cron/fetch-analytics

Vercel Cron 调用，拉取所有待分析的视频数据。

```
请求头: Authorization: Bearer {CRON_SECRET}

逻辑:
1. 查询所有 Publication 中 publishStatus=PUBLISHED 且 analyticsScheduledAt <= now()
   且对应 Project.status 为 PUBLISHED 或 ANALYTICS_PENDING
2. 对每条记录调用 TikTok API 获取数据
3. 创建 AnalyticsSnapshot
4. 调用 OpenAI 生成分析报告
5. 更新 Project.status → ANALYZED

响应 200:
{
  "processed": 3,
  "failed": 0,
  "details": [...]
}
```

## 3. Service 层设计

### 3.1 ContentService

```
ContentService
  ├── generate(projectId: string): Promise<ContentPlan>
  │   流程: 获取 project → 构造 prompt → 调用 TextProvider.generateContent()
  │         → 解析响应 → 创建/更新 ContentPlan → 更新 Project.status
  │
  └── update(projectId: string, data: Partial<ContentPlan>): Promise<ContentPlan>
      流程: 获取 contentPlan → 更新字段 → 返回
```

### 3.2 VideoService

```
VideoService
  ├── submit(projectId: string): Promise<VideoJob>
  │   流程: 获取 contentPlan.videoPrompt → 调用 VideoProvider.submitGeneration()
  │         → 创建 VideoJob(status=PENDING) → 更新 Project.status
  │
  ├── checkStatus(projectId: string): Promise<VideoJobStatusResult>
  │   流程: 获取 VideoJob → 调用 VideoProvider.getJobStatus()
  │         → 如果完成: 更新 videoUrl + status → 更新 Project.status
  │         → 如果失败: 更新 errorMessage → 更新 Project.status
  │
  └── retry(projectId: string): Promise<VideoJob>
      流程: 重置 VideoJob.retryCount++ → 重新调用 submit 逻辑
```

### 3.3 PublishService

```
PublishService
  ├── publish(projectId: string): Promise<Publication>
  │   流程: 检查 TikTokAccount → 检查 token 有效 → 获取 videoUrl + caption + hashtags
  │         → 调用 PublishProvider.publishVideo() → 创建 Publication
  │         → 设置 analyticsScheduledAt = now + 12h → 更新 Project.status
  │
  └── refreshToken(): Promise<void>
      流程: 获取 TikTokAccount → 如果即将过期 → 调用 TikTok refresh API → 更新数据库
```

### 3.4 AnalyticsService

```
AnalyticsService
  ├── fetchPendingAnalytics(): Promise<void>   (Cron 调用)
  │   流程: 查询所有待拉数的 Publication → 逐条 fetchMetrics → 逐条 generateReport
  │
  ├── fetchMetrics(publicationId: string): Promise<AnalyticsSnapshot>
  │   流程: 获取 platformVideoId → 调用 AnalyticsProvider.fetchMetrics()
  │         → 创建 AnalyticsSnapshot → 更新 Project.status
  │
  └── generateReport(projectId: string): Promise<AnalysisReport>
      流程: 获取最新 AnalyticsSnapshot + ContentPlan → 构造分析 prompt
            → 调用 TextProvider.generateAnalysis() → 创建 AnalysisReport
            → 更新 Project.status → ANALYZED
```

## 4. Provider 层设计

### 4.1 OpenAI Provider (`lib/providers/openai.ts`)

封装 OpenAI API 调用：

- `generateContent(input)`: 内容生成（JSON mode，结构化输出）
- `generateAnalysis(input)`: 分析报告生成
- 内置重试（3次）、超时（30s）、token 统计
- Prompt 模板从 `lib/prompts/` 加载

### 4.2 即梦 Provider (`lib/providers/jimeng.ts`)

封装火山方舟 Ark Seedance API：

- `submitGeneration(prompt, options)`: 提交视频生成任务
- `getJobStatus(jobId)`: 查询任务状态
- `getJobResult(jobId)`: 获取生成结果
- 处理异步任务模式（提交→轮询→完成）

### 4.3 TikTok Provider (`lib/providers/tiktok.ts`)

封装 TikTok 平台 API：

- `getAuthUrl()`: 生成 OAuth 授权 URL
- `exchangeToken(code)`: 用 auth code 换取 access_token
- `refreshToken(refreshToken)`: 刷新 token
- `publishVideo(params)`: 发布视频（Content Posting API）
- `fetchMetrics(videoId)`: 获取视频数据

## 5. Cron 任务设计

### 5.1 fetch-analytics（每小时执行）

```
触发: Vercel Cron, "0 */1 * * *"
认证: CRON_SECRET header 校验

流程:
1. 查询 Publication WHERE
   publishStatus = 'PUBLISHED'
   AND analyticsScheduledAt <= NOW()
   AND project.status IN ('PUBLISHED', 'ANALYTICS_PENDING')
2. 对每条记录:
   a. 调用 TikTok API 拉数据 → 写入 AnalyticsSnapshot
   b. 更新 project.status = ANALYTICS_FETCHED
   c. 调用 OpenAI 生成分析 → 写入 AnalysisReport
   d. 更新 project.status = ANALYZED
3. 记录处理结果（成功/失败数量）

幂等保证:
- AnalyticsSnapshot 以 fetchedAt 区分，重复执行不会覆盖
- 已经 ANALYZED 的项目不会重复处理
```

## 6. 错误处理策略


| 场景              | 处理                                                                  |
| --------------- | ------------------------------------------------------------------- |
| OpenAI 调用失败     | 重试 3 次 → 返回错误，Project.status 不变                                     |
| 即梦 API 提交失败     | 返回错误，VideoJob.status = FAILED                                       |
| 即梦 视频生成失败       | VideoJob.status = FAILED, retryCount++                              |
| TikTok 发布失败     | Publication.publishStatus = FAILED, Project.status = PUBLISH_FAILED |
| TikTok Token 过期 | 自动尝试 refresh → 如果 refresh 也失败，提示用户重新授权                              |
| Cron 拉数失败       | 单条失败不影响其他，下次 Cron 自动重试                                              |
| 数据库写入失败         | API 返回 500，不改变外部状态                                                  |


