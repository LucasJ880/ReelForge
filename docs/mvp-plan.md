# ReelForge — MVP 实施计划

> 版本: 2.0 | 更新时间: 2026-04-06

---

## 1. 实施策略

- 分 Sprint 推进，每个 Sprint 2-3 天
- 每个 Sprint 交付一个可验证的闭环
- 外部 API 先用 Mock 实现，再逐步替换为真实调用
- TikTok API 审批并行进行，不阻塞开发

## 2. Sprint 规划

### Sprint 0: 项目初始化（1 天）


| 任务                            | 说明                        |
| ----------------------------- | ------------------------- |
| 初始化 Next.js + TypeScript 项目   | App Router, src/ 目录       |
| 安装配置 Tailwind CSS + shadcn/ui | 中文友好的 UI 基础               |
| 配置 Prisma + Neon Postgres     | Schema 定义 + 首次 migration  |
| 基础布局组件                        | 侧边栏 + Header + 页面容器       |
| 环境变量配置                        | .env.local + .env.example |
| 沉淀文档                          | 所有规划文档提交到 docs/           |


**交付物**: 项目可启动，能看到基础布局页面，数据库已连接。

### Sprint 1: 内容生成闭环（2-3 天）


| 任务               | 说明                         |
| ---------------- | -------------------------- |
| Project CRUD API | 创建、列表、详情、删除                |
| OpenAI Provider  | 封装 API 调用 + JSON mode 输出   |
| ContentService   | 生成/重新生成逻辑                  |
| 内容生成 Prompt      | 中文脚本、caption、hashtags、角度建议 |
| 创建项目页面           | 关键词输入表单                    |
| 项目列表页面           | 卡片列表 + 状态筛选                |
| 项目详情页（内容阶段）      | 内容展示 + 编辑 + 重新生成           |


**交付物**: 用户输入关键词 → 看到 AI 生成的完整内容方案 → 可编辑。

**里程碑 M1**: 内容生成可用。

### Sprint 2: 视频生成闭环（2-3 天）


| 任务           | 说明                                     |
| ------------ | -------------------------------------- |
| 即梦 Provider  | 封装火山方舟 Seedance API（先 Mock，有 Key 后接真实） |
| VideoService | 提交任务 + 轮询状态 + 结果获取                     |
| 视频生成 API     | 触发生成 + 状态查询                            |
| 前端轮询逻辑       | 5-10s 间隔轮询，展示进度                        |
| 视频预览组件       | 播放器 + 状态展示                             |
| 项目详情页（视频阶段）  | 生成中 → 完成 → 预览                          |


**交付物**: 用户确认内容 → 视频生成 → 可预览。

**里程碑 M2**: 视频生成可用。

### Sprint 3: TikTok 发布闭环（2-3 天）


| 任务              | 说明                                      |
| --------------- | --------------------------------------- |
| TikTok Provider | OAuth + Content Posting API（需要已审批的 App） |
| TikTok OAuth 流程 | auth → callback → 存储 token              |
| PublishService  | 发布逻辑 + token 刷新                         |
| 发布 API          | 触发发布 + 状态展示                             |
| 设置页面            | TikTok 账号绑定/解绑                          |
| 发布确认对话框         | 二次确认 + 发布进度                             |


**前置**: TikTok Developer App 审批通过。如未通过，此 Sprint 用 Mock 跑通流程。

**交付物**: 用户预览视频 → 确认发布 → 发布到 TikTok。

**里程碑 M3**: 发布流程可用。

### Sprint 4: 数据分析闭环（1-2 天）


| 任务               | 说明                        |
| ---------------- | ------------------------- |
| Vercel Cron 配置   | vercel.json + CRON_SECRET |
| AnalyticsService | 拉取数据 + 生成报告               |
| 分析 Prompt        | 表现总结 + 方向建议 + 优化建议        |
| 数据指标展示           | 播放/点赞/评论/分享 卡片            |
| AI 分析报告展示        | 报告卡片组件                    |
| 仪表板首页            | 概览统计 + 最近项目               |


**交付物**: 视频发布后 → 自动拉数 → AI 分析报告。

**里程碑 M4**: 完整闭环。

### Sprint 5: 打磨与上线（1-2 天）


| 任务         | 说明             |
| ---------- | -------------- |
| 错误处理完善     | 所有 API 错误有友好提示 |
| 空态/加载态完善   | 所有页面的边界状态      |
| 重试逻辑完善     | 所有失败步骤可重试      |
| 端到端手动测试    | 全流程走一遍         |
| 部署到 Vercel | 配置环境变量 + 验证    |
| 上线检查清单     | 逐项确认           |


**交付物**: 可对外使用的 MVP 版本。

**里程碑 M5**: 上线。

## 3. 里程碑时间线


| 里程碑 | 目标                | 预计完成（天）   |
| --- | ----------------- | --------- |
| M0  | 项目脚手架 + 数据库就绪     | Day 1     |
| M1  | 关键词 → 内容方案生成可用    | Day 3-4   |
| M2  | 内容确认 → 视频生成 → 可预览 | Day 6-7   |
| M3  | 视频确认 → TikTok 发布  | Day 9-10  |
| M4  | 自动拉数 + AI 分析报告    | Day 11-12 |
| M5  | 全流程打磨 + 上线        | Day 13-14 |


总计预计 **2 周** 完成 MVP。

## 4. 并行任务（立即开始）

以下任务不依赖开发进度，应立即启动：

- 注册 TikTok Developer 账号，申请 Content Posting API 权限
- 注册/配置火山方舟账号，开通 Seedance 模型
- 注册 Neon 账号，创建 Postgres 数据库
- 配置 Vercel 项目
- 准备 OpenAI API Key

## 5. 风险缓解


| 风险                    | 缓解方案                        |
| --------------------- | --------------------------- |
| TikTok App 审批慢        | Sprint 3 先用 Mock 实现，审批通过后替换 |
| 即梦 API 不可用            | Provider 接口抽象，可快速切换其他视频生成商  |
| Vercel Hobby Cron 频率低 | 加「手动触发分析」按钮作为补充             |
| 即梦视频 URL 过期           | 发布前检查 URL 有效性，过期则重新生成       |


## 6. 代码模块开发顺序

```
1. package.json + 项目配置
2. prisma/schema.prisma + 首次 migration
3. src/lib/db.ts (Prisma Client 单例)
4. src/types/index.ts (共享类型)
5. src/app/layout.tsx + 基础布局组件
6. src/lib/providers/openai.ts
7. src/lib/services/content-service.ts
8. src/app/api/projects/* (CRUD + generate)
9. src/app/projects/* (列表 + 新建 + 详情)
10. src/lib/providers/jimeng.ts
11. src/lib/services/video-service.ts
12. src/app/api/projects/[id]/video/*
13. src/lib/providers/tiktok.ts
14. src/lib/services/publish-service.ts
15. src/app/api/tiktok/*
16. src/lib/services/analytics-service.ts
17. src/app/api/cron/*
18. 仪表板首页
```

## 7. 上线检查清单

- Neon 数据库已创建，连接串已配置到 Vercel
- Prisma schema 已 migrate 到 Neon
- OpenAI API Key 有效且有余额
- 火山方舟 API Key 有效且即梦/Seedance 模型已开通
- TikTok Developer App 已审批通过
- TikTok OAuth 回调 URL 指向生产域名
- 所有环境变量配置到 Vercel (DATABASE_URL, OPENAI_API_KEY, ARK_API_KEY, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, NEXT_PUBLIC_APP_URL, CRON_SECRET)
- vercel.json Cron 已配置
- CRON_SECRET 已设置且端点已校验
- 首次部署 + migration 成功
- 手动端到端测试通过
- Vercel Function 超时设置合理
- .env.example 不包含真实密钥

## 8. 开发环境变量模板

```env
# 数据库
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# 即梦/火山方舟
ARK_API_KEY=
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_VIDEO_MODEL=doubao-seedance-1-5-pro-251215

# TikTok
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=

# 应用
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=your-random-secret-here

# 可选: 简单密码保护
ADMIN_PASSWORD=
```

