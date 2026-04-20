# ReelForge

**外贸电商视频闭环交付系统** · 面向内部运营团队，第一阶段聚焦毛毯 / blanket 类目。

核心闭环：
`产品输入 → 市场分析 → 卖点提炼 → 多版本视频 → 发布 → 数据回流 → 赛马打分 → 特征蒸馏 → 下一轮`

---

## 技术栈

- Next.js 16 App Router + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Prisma + Neon Postgres
- NextAuth v4 Credentials（仅 Admin 登录）
- OpenAI（LLM 管线）+ 即梦/Seedance（T2V/I2V via 火山方舟 Ark）
- Vercel Blob + Vercel Cron

## 快速开始

```bash
# 1. 装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 填入 DATABASE_URL / OPENAI_API_KEY / AUTH_SECRET / BLOB_READ_WRITE_TOKEN
# （可选）ARK_API_KEY（不填走 mock）

# 3. 建库 + 种子管理员
npm run db:push
SEED_ADMIN_EMAIL=admin@reelforge.local SEED_ADMIN_PASSWORD=your-strong-pass npm run db:seed

# 4. 启动
npm run dev
```

打开 http://localhost:3000 → 自动跳 `/login` → 用 seed 账号登录 → 进入 `/orders`。

## 目录结构

```
src/
├── app/
│   ├── (app)/           # 登录后运营页面
│   │   ├── orders/      # 交付单
│   │   ├── rounds/      # 赛马轮次
│   │   ├── qa/          # QA 审核
│   │   ├── publish/     # 发布队列
│   │   ├── metrics/     # 数据回流
│   │   ├── distillation/# 创意蒸馏
│   │   └── settings/    # 管理员设置
│   ├── (auth)/login/
│   └── api/
├── lib/
│   ├── services/        # 15 个业务 service
│   ├── providers/       # 外部 API 封装
│   └── validators/      # zod schemas
├── components/
│   ├── ui/              # shadcn
│   ├── layout/          # sidebar
│   └── features/        # 业务组件
└── types/
prisma/
├── schema.prisma        # 15 个实体 + 3 个状态机
└── seed.ts
```

## 角色

- `SUPER_ADMIN` — 全权限 + 管理员账号管理
- `OPERATOR` — 创建交付单、执行流程、发布
- `REVIEWER` — QA 审核

## 发布链路（MVP 半自动）

1. 系统生成 5 条视频（3 优化 + 2 探索）
2. AI + 人工 QA 双打分
3. 运营在 `/publish` 下载成片
4. 人工上传到 TikTok 后在 UI 回填 post_id
5. 12h / 24h / 48h 后运营上传 CSV 数据
6. 系统自动打分、选 top3、蒸馏特征
7. 进入下一轮

## 文档

- [TESTING.md](./docs/TESTING.md) — 端到端冒烟脚本、真实 UAT、PRD §3 对齐矩阵
- [DEPLOYMENT.md](./docs/DEPLOYMENT.md) — Vercel 部署、环境变量、Cron、冒烟

## V2 路线图

- 接 TikTok Content Posting API 做全自动发布
- 接 TikTok Shop API 拿商业分（CTR / ROAS）
- 扩展到更多类目

## License

Internal use only.
