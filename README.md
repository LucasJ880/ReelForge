# Aivora

AI 驱动的中文短视频自动化平台。输入关键词 → AI 生成脚本 / 标题 / Hashtag → 即梦 Seedance 产出 mp4 → 浏览器端 Brand Lock 叠加 Logo → 下载到本地，手动发布到 TikTok / 抖音 / 视频号。

## 核心理念

- **只管生成，不管发布**。用户自行下载 mp4 到任一平台发布，平台不绑定任何社媒账户。
- **单通道极简**：MVP 阶段只保留 Pro（即梦 Seedance）路径，避免 Pexels/TTS 免费通道的稳定性陷阱。
- **Brand Lock 品牌保真**：AI 模型无法稳定出 Logo —— 用 ffmpeg.wasm 最后一步硬叠加兜底，品牌 100% 清晰。
- **订阅驱动**：
  - **免费用户**：只能浏览公开画廊、下载公开作品。
  - **Pro 用户**：解锁 AI 生成、批量任务、Brand Lock、私有化作品等全部能力。
  - **ADMIN**：权限等同 Pro，且可在后台手动为用户开通 / 撤销订阅。

## 技术栈

| 层级           | 技术                                                       |
| -------------- | ---------------------------------------------------------- |
| 前端           | Next.js 16 App Router, React 19, TypeScript, Tailwind v4   |
| 后端           | Next.js API Routes, Prisma ORM, Neon Postgres              |
| 认证           | NextAuth.js v4（邮箱密码 + JWT）                           |
| AI 文案        | OpenAI (gpt-4o-mini)                                       |
| AI 视频        | 即梦 Seedance（火山方舟 Ark）                              |
| Brand Lock     | ffmpeg.wasm（浏览器侧硬叠加 Logo / Slogan / 片头片尾）     |
| 存储           | Vercel Blob                                                |
| 部署           | Vercel                                                     |

## 数据模型

```
User
└── planTier: FREE | PRO  +  planExpiresAt / planSource（审计字段）

Project (关键词 + 状态 + isPublic)
├── ContentPlan  (AI 生成的脚本 / 标题 / Hashtag / 视频提示词)
└── VideoJob     (Pro 通道提交 Seedance 任务，返回 mp4)

Batch → Project[]
```

### 项目状态流

```
DRAFT → CONTENT_GENERATED → VIDEO_GENERATING → VIDEO_READY → DONE
                                     ↓
                              VIDEO_FAILED
```

## 订阅模型（MVP）

| 能力                         | Free | Pro | Admin |
| ---------------------------- | :--: | :-: | :---: |
| 浏览公开画廊 / 下载公开作品  |  ✓   |  ✓  |   ✓   |
| 注册账号 / 个人设置          |  ✓   |  ✓  |   ✓   |
| AI 一键生成视频              |  —   |  ✓  |   ✓   |
| 批量并行生成                 |  —   |  ✓  |   ✓   |
| Brand Lock 品牌叠加          |  —   |  ✓  |   ✓   |
| 切换作品是否进入公开画廊     |  —   |  —  |   ✓   |
| 为其他用户开通 / 撤销 Pro    |  —   |  —  |   ✓   |

### 如何升级 Pro

MVP 阶段订阅为**人工开通**：

1. 用户访问 `/settings/billing` → 点击"联系管理员开通"发送 `mailto:` 邮件；
2. 管理员进入 `/admin/users` 后台，搜索用户 → 点击「开通 Pro」→ 输入天数（默认 30）；
3. 用户刷新页面即可看到生效（Session 下次 `update()` 自动刷新 `planTier`）。

V2 接入支付（详见下方 Roadmap）后，用户可以直接 `/pricing` → Checkout → 自动开通。

## 快速开始

```bash
npm install
cp .env.example .env.local   # 按下面填写
npx prisma db push
npm run dev
```

### 环境变量

```bash
# 必填
DATABASE_URL=postgresql://...        # Neon Postgres
OPENAI_API_KEY=sk-...
AUTH_SECRET=<openssl rand -hex 32>
NEXT_PUBLIC_APP_URL=http://localhost:3000
BLOB_READ_WRITE_TOKEN=...            # Vercel Blob 读写 token

# Pro 通道（可留空走 mock）
ARK_API_KEY=
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_VIDEO_MODEL=doubao-seedance-1-5-pro-250115

# V2：支付（暂不启用）
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
# CREEM_WEBHOOK_SECRET=
```

### 部署

```bash
git push origin main    # Vercel 自动部署
```

Vercel 环境变量在 Dashboard → Settings → Environment Variables 配置。

## 权限守卫一览

| 守卫            | 作用                                                       | 失败码  |
| --------------- | ---------------------------------------------------------- | ------- |
| `requireAuth`   | 已登录即可                                                 | 401     |
| `requirePro`    | ADMIN 直接放行；普通用户必须 `planTier=PRO` 且未过期       | 402     |
| `requireAdmin`  | 必须 `role=ADMIN`                                          | 403     |

前端对应 hook：`useIsAdmin()` / `useIsPro()` / `useSubscription()`。

## 主要 API

| 路由                                         | 守卫           | 说明                           |
| -------------------------------------------- | -------------- | ------------------------------ |
| `POST /api/projects`                         | `requirePro`   | 创建项目                       |
| `POST /api/projects/[id]/generate`           | `requirePro`   | 生成文案                       |
| `POST /api/projects/[id]/auto-generate`      | `requirePro`   | 一键：文案 + Seedance 视频     |
| `POST /api/projects/[id]/brand-lock`         | `requirePro`   | 回写 Brand Lock 结果           |
| `POST /api/projects/bulk-delete`             | `requirePro`   | 批量 / 过期项目删除            |
| `PATCH /api/projects/[id]` (`isPublic`)      | `requireAdmin` | 调整作品公开 / 私有            |
| `GET  /api/admin/users`                      | `requireAdmin` | 列出所有用户                   |
| `POST /api/admin/users/[id]/grant-pro`       | `requireAdmin` | 手动开通 / 续期 Pro（天数可选）|
| `POST /api/admin/users/[id]/revoke-pro`      | `requireAdmin` | 立即撤销 Pro                   |
| `POST /api/webhooks/stripe`                  | public         | V2 占位：未配置时返回 503      |
| `POST /api/webhooks/creem`                   | public         | V2 占位：未配置时返回 503      |

## 公开路由（无需登录）

- `/` 落地页
- `/gallery` 公开画廊 + `/gallery/[id]` 作品详情
- `/pricing` 订阅方案
- `/login` / `/register`

## Roadmap (V2)

- 接入 Stripe（海外）/ Creem（国内支付宝 / 微信）webhook，让 `/api/webhooks/*` 真正把事件翻译成 `grantPro` / `revokePro`。
- `/pricing` 直接挂 Checkout 链接，取消 mailto 人工流程。
- 团队席位（Team Plan）与共享作品库。

## License

Private project.
