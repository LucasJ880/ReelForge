# ReelForge — TikTok AI 短视频自动化平台

> AI 驱动的 TikTok 短视频内容生成、发布和数据分析平台

## 功能闭环

1. 输入中文关键词或产品方向
2. AI 自动生成：中文脚本 + 视频提示词 + TikTok caption + hashtags + 内容角度建议
3. 调用即梦（Seedance）生成 AI 视频
4. 用户在平台内预览和确认视频
5. 一键发布到 TikTok
6. 发布 12 小时后自动拉取 TikTok 数据
7. AI 输出分析结果和优化建议

## 技术栈

| 组件 | 选型 |
|------|------|
| 前端 | Next.js + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| 数据库 | Neon Postgres |
| ORM | Prisma |
| 部署 | Vercel |
| 定时任务 | Vercel Cron |
| 文本生成 | OpenAI |
| 视频生成 | 即梦 / Seedance (火山方舟) |
| 发布 | TikTok Content Posting API |

## 开发

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入各项配置

# 数据库迁移
npm run db:push

# 启动开发服务器
npm run dev
```

## 项目文档

- [产品需求文档](docs/prd.md)
- [系统架构](docs/architecture.md)
- [数据模型](docs/schema.md)
- [API 设计](docs/api-design.md)
- [MVP 计划](docs/mvp-plan.md)
- [重构计划](docs/refactor-plan.md)
- [待确认项](docs/open-questions.md)
