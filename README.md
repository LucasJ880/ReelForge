# Aivora

AI 驱动的中文短视频自动化平台。输入关键词 → AI 生成文案 → 选 Pro / Free 通道出视频 → 下载 mp4 到本地，手动发布到 TikTok / 抖音 / 视频号。

## 核心理念

- **只管生成，不管发布**。用户自行下载 mp4 到任一平台发布，平台不绑定任何社媒账户。
- **双通道策略**：
  - **Pro 通道**（即梦 Seedance）：质量最高，适合正式出片，需要 `ARK_API_KEY`。
  - **Free 通道**（Pexels + Edge TTS + ffmpeg.wasm）：完全免费、浏览器本地合成，适合大规模试水。
- **用户友好**：一键生成、音色可选（9 国 22 个音色）、可上传自带素材、项目一键批量删除。

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | Next.js 16 App Router, React 19, TypeScript, Tailwind v4, shadcn/ui |
| 后端 | Next.js API Routes, Prisma ORM, Neon Postgres |
| 认证 | NextAuth.js v4（邮箱密码 + JWT） |
| AI 文案 | OpenAI (gpt-4o-mini) |
| AI 视频（Pro） | 即梦 Seedance（火山方舟 Ark） |
| 免费视频（Free） | Pexels + msedge-tts + @ffmpeg/ffmpeg（wasm） |
| 存储 | Vercel Blob |
| 部署 | Vercel |

## 数据模型

```
Project (关键词 + 状态)
├── ContentPlan  (AI 生成的脚本/标题/Hashtag/视频提示词)
└── VideoJob
    ├── channel: "pro" | "free"
    ├── manifest: Free 通道素材清单（Pexels URL + TTS mp3 + SRT）
    └── variants / selectedVariant: 多变体候选

Batch → Project[]
User
```

### 项目状态流（简化版）

```
DRAFT → CONTENT_GENERATED → VIDEO_GENERATING → VIDEO_READY → DONE
                                      ↓
                                VIDEO_FAILED
```

## 两条通道对比

| 维度 | Pro 通道 | Free 通道 |
|---|---|---|
| 视觉素材 | 即梦 Seedance AI 生成 | Pexels 免费竖屏视频 / 用户自传 |
| 配音 | AI 视频自带或无 | Microsoft Edge TTS（22 音色） |
| 合成位置 | 服务端（Seedance 返回 mp4） | 浏览器（ffmpeg.wasm） |
| 成本 | 付费（方舟 Token） | 完全免费 |
| 速度 | ~1-2 分钟 | 视浏览器性能（通常 30-60 秒） |
| 质量上限 | 高（SOTA） | 中（看你的脚本 + 素材） |

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

# Free 通道
PEXELS_API_KEY=                      # 免费申请 https://www.pexels.com/api/
                                      # 不填则走内置 mock 竖屏素材

# 测试开关：强制所有视频走 mock（不消耗 Ark Token）
VIDEO_ENGINE_MOCK=false
```

### 部署

```bash
git push origin main    # Vercel 自动部署
```

Vercel 环境变量在 Dashboard → Settings → Environment Variables 配置。

首次部署或 Preview 测试时，建议：

1. 设置 `VIDEO_ENGINE_MOCK=true` 快速验证整条链路不烧 Token。
2. 跑通 Free 通道 → 验证浏览器 ffmpeg.wasm 合成 → 确认视频下载可用。
3. 关掉 `VIDEO_ENGINE_MOCK`，再放一个真实 Pro 任务验证即梦链路。
4. 确认作品库批量删除 + 过期清理工作正常。

## 主要 API

| 路由 | 说明 |
|---|---|
| `POST /api/projects` | 创建项目 |
| `POST /api/projects/[id]/generate` | 生成文案 |
| `POST /api/projects/[id]/auto-generate` | 一键：文案 + 视频（Pro 通道） |
| `POST /api/projects/[id]/free-prepare` | Free 通道准备 manifest |
| `POST /api/projects/[id]/free-finalize` | 浏览器合成完毕回传 mp4 URL |
| `POST /api/projects/[id]/user-assets` | 上传自带视频素材 |
| `POST /api/projects/bulk-delete` | 批量/过期项目删除（含 Blob 清理） |

## 文档

- [docs/FREE_CHANNEL.md](./docs/FREE_CHANNEL.md) — Free 通道架构与调试
- [docs/PRE_RELEASE_CHECKLIST.md](./docs/PRE_RELEASE_CHECKLIST.md) — 发布前核对清单

## License

Private project.
