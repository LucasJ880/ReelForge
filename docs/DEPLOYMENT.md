# ReelForge 部署指南（Vercel + Neon Postgres）

## 1. 所需外部服务

| 服务 | 用途 | 必需 |
|---|---|---|
| Vercel | Next.js 托管 + Cron + Blob 存储 | ✅ |
| Neon Postgres | 数据库 | ✅ |
| OpenAI API | LLM（调研/卖点/Angle/脚本/QA/蒸馏） | MVP 可用 mock，生产必需 |
| Volcengine Ark (Seedance) | 文本/图生视频 | MVP 可用 mock，生产必需 |
| remove.bg | V2 图片抠图（MVP 可关闭） | 可选 |

## 2. 环境变量清单

参考 `.env.example`。最少需要：

```
# === 必填 ===
DATABASE_URL=postgresql://...neon.tech/...?sslmode=require
AUTH_SECRET=$(openssl rand -hex 32)
NEXTAUTH_URL=https://reelforge.your.domain
NEXT_PUBLIC_APP_URL=https://reelforge.your.domain
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
CRON_SECRET=$(openssl rand -hex 16)

# 首次 seed SUPER_ADMIN（仅首次 db:seed 生效）
SEED_ADMIN_EMAIL=ops@yourdomain.com
SEED_ADMIN_PASSWORD=ChangeMe-1234

# LLM（不填则走 mock）
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Seedance（不填或 VIDEO_ENGINE_MOCK=true 则走 mock）
ARK_API_KEY=...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_VIDEO_MODEL=doubao-seedance-2-0-260128
ARK_VIDEO_I2V_MODEL=           # 留空则复用 ARK_VIDEO_MODEL
VIDEO_ENGINE_MOCK=false

# === 强烈推荐（让市场调研变"真实"） ===
APIFY_TOKEN=apify_api_...      # 不填则 discovery 仅走 LLM 常识模式

# === 可选 ===
REMOVE_BG_API_KEY=             # V2 抠图，MVP 不用
TIKTOK_CLIENT_KEY=             # V2 全自动发布预留
TIKTOK_CLIENT_SECRET=
```

## 3. 部署流水

```bash
# 1) Vercel 项目关联
vercel link

# 2) 设置环境变量（推荐 vercel.com 界面批量导入）
vercel env add DATABASE_URL production
# ... 其余同步

# 3) 首次推 schema & seed 超级管理员
vercel env pull .env.production.local
npx dotenv -e .env.production.local -- npx prisma db push
npx dotenv -e .env.production.local -- tsx prisma/seed.ts

# 4) 部署
vercel --prod
```

**Cron 独立需求**：Vercel Hobby 最多 2 个 Cron/天，Pro 起 60 秒粒度；我们需要 2 分钟粒度，Pro 或 Team 即可。

## 4. Vercel Cron

`vercel.json` 已配置：

```json
{
  "crons": [
    { "path": "/api/cron/poll-videos", "schedule": "*/2 * * * *" }
  ]
}
```

Cron 调用会带 `Authorization: Bearer <CRON_SECRET>`（Vercel 自动注入），需与环境变量一致。

## 5. 部署后冒烟（5 分钟）

1. 访问 `/login`，用 seed 账号登录 → 应自动跳转 `/orders`
2. 新建一个测试交付单（任何 SKU）
3. 点击「执行调研 + 卖点」→ 若 `OPENAI_API_KEY` 未配置，应看到 mock 提示但仍写入数据库
4. 开启第一轮 → 生成 angle（5 条）
5. 任意 brief → 生成脚本 / 分镜 / 触发渲染
6. 等 2–4 分钟（Cron 周期），或手动访问 `/api/cron/poll-videos`（带 Auth）
7. 进入 `/qa`，AI 初审应已出现打分
8. 通过 → `/publish` 出现待发布记录
9. 模拟回填 post_id → 确认上线 → `/metrics` 上传一条 CSV
10. 回 Round 详情 → 打分 + 排名 → 蒸馏

如果 1–10 都能顺畅跑完，部署即完成。

## 6. 监控 & 告警（建议）

- Vercel Observability / Logs 上监控：
  - `/api/cron/poll-videos` 的 200/500 比例
  - `/api/briefs/[id]/render` 错误
  - `/api/rounds/[id]/distill` 错误
- Neon：监控 `VideoJob` 表中长时间 `RUNNING` 未结束的任务
- 单独报警：`DeliveryOrder.status = FAILED` / `VideoBriefStatus = RENDER_FAILED`

## 7. 回滚

- Vercel：`vercel rollback <deployment-url>`
- Prisma：schema 修改走正式 migration（`db:migrate`），避免 `db:push`；回滚通过反向 migration

## 8. 访问控制

系统仅供内部账号使用。不开放注册。
- 新增用户：`/settings`（仅 SUPER_ADMIN 可见）
- 删除用户：`/settings` 中点击垃圾桶
- 角色：
  - SUPER_ADMIN：全权 + 账号管理
  - OPERATOR：交付单 / 轮次 / 渲染 / 发布 / 数据
  - REVIEWER：QA 队列
