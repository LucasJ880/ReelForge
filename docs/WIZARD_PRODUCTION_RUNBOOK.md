# Aivora Wizard · Production Runbook

> 适用范围：`/wizard` 客户向导（Phase 1–3 已完成、Phase 4 已 hardening）。
> 与 admin pipeline（`/orders` / `/qa` / `/publish` / cron）共用同一个 Next.js app + Postgres + Vercel Blob 基础设施，但所有依赖都设计了 fallback，wizard 端在缺失外部服务时不会卡死。

---

## 1. 功能概览

`/wizard` 是给本地商家客户用的 6 步半自动短视频生产流程：

| Step | 路径 | 输入 | 产出 | 关键 service |
|---|---|---|---|---|
| 1 · 项目初始化 | `/wizard/new` | `ClientBrief`（行业 / 目标 / 平台 / 三项 consents） | DeliveryOrder + clientBrief JSON | `client-project-service.initClientProject` |
| 2 · 选择卡片 | `/wizard/[id]/step-2-card` | 行业推荐 + 全部 PUBLISHED 卡 | `selectedCardSlug` 写入 brief | `creative-evidence-service` |
| 3 · 生成脚本 | `/wizard/[id]/step-3-script` | brief + selectedCard | `Script` + 完整 `ScriptOutput` 写入 `Script.metadata`（Phase 3A） | `wizard-script-service` |
| 4 · 生成分镜 | `/wizard/[id]/step-4-storyboard` | 当前 Script | `StoryboardOutput` + `ShootingGuide` → 写入 `ScenePlan[]` | `wizard-storyboard-service` |
| 5 · 上传素材 | `/wizard/[id]/step-5-upload` | 直接上传 / 公网 URL | `RawAsset` + Asset QA | `wizard-asset-service` + `/api/upload/blob` |
| 6 · 渲染预览 | `/wizard/[id]/step-6-render` | timeline = ScenePlan + matched RawAsset | `WizardRenderJob`（REAL / DRAFT / MOCK） | `wizard-render-service` + `wizard-ffmpeg-adapter` |

观测面板：`/admin/ai-usage`（Phase 3B），SUPER_ADMIN / OPERATOR 可见。

---

## 2. 环境变量

> ⚠️ **重要**：项目实际使用 `AUTH_SECRET`（不是 `NEXTAUTH_SECRET`）。

### 2.1 必填（缺失会导致登录 / 中间件 401）

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | Neon Postgres 连接（含 `?sslmode=require`） |
| `AUTH_SECRET` | NextAuth JWT 签名密钥（`openssl rand -hex 32`） |
| `NEXTAUTH_URL` | NextAuth 回调 URL（生产域名） |

### 2.2 推荐（缺失则该 step 走兜底）

| 变量 | 缺失时的行为 |
|---|---|
| `OPENAI_API_KEY` | Step 3/4 自动 mock，写 `AIUsageLog.status=MOCK`；wizard 不卡。banner 显示蓝色 info：「OPENAI_API_KEY 未配置，已回退到 mock 脚本」 |
| `OPENAI_MODEL` | 默认 `gpt-4o-mini` |
| `BLOB_READ_WRITE_TOKEN` | Step 5 直传 tab 自动 disable，UI 提示「请改用公网 URL」；Step 6 渲染输出落在 `file://`（仅本地可看） |
| `ENABLE_WIZARD_FFMPEG_RENDER` | `true` 才尝试 REAL 渲染；否则永远 DRAFT。**第一次部署建议保持 `false`** |

### 2.3 可选（与 wizard 无关，但部署时可能要看）

| 变量 | 服务 |
|---|---|
| `CRON_SECRET` | admin cron `/api/cron/poll-videos` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | 首次创建 SUPER_ADMIN |
| `APIFY_TOKEN`、`ARK_*`、`HEYGEN_*`、`DIGITAL_HUMAN_PROVIDER`、`REMOVE_BG_API_KEY`、`TIKTOK_*` | admin / demo pipeline，不影响 wizard |
| `ENABLE_FFMPEG_RENDER` | admin pipeline 的 ffmpeg 开关（与 `ENABLE_WIZARD_FFMPEG_RENDER` 各自独立） |

### 2.4 缺失 env 的用户体验汇总

| 缺失 | wizard 用户看到 |
|---|---|
| `OPENAI_API_KEY` | Step 3/4 顶部蓝色 info banner，显示「mock 脚本/分镜，仍可继续」 |
| `BLOB_READ_WRITE_TOKEN` | Step 5「直接上传」tab 灰显 + 提示，自动切到「公网 URL」tab |
| `ENABLE_WIZARD_FFMPEG_RENDER` 未设 / `false` | Step 6 输出 `Draft Preview`（含 manifest + 第一段素材作为预览）；不报错 |
| 服务器无 `ffmpeg` binary 但 `ENABLE_WIZARD_FFMPEG_RENDER=true` | service 自动检测后降为 DRAFT，写 `errorMessage` + `fallbackReason` |

---

## 3. Migration 步骤

当前 migration 历史：

```
prisma/migrations/
├── 20260510_phase1_phase2_wizard_baseline/      ← 新建 wizard 表的累积 baseline
└── 20260510154031_phase3a_script_metadata/       ← Script.metadata Json?
```

### 3.1 Dev

```bash
# .env.local 已配置 DATABASE_URL（dev neon branch 或本地 postgres）
npx dotenv -e .env.local -- npx prisma migrate dev
npx prisma generate
```

### 3.2 Staging（如果有独立 neon branch）

```bash
DATABASE_URL=<staging-url> npx prisma migrate deploy
DATABASE_URL=<staging-url> npx prisma generate
```

### 3.3 Production

```bash
# 先 pull 生产 env
vercel env pull .env.production.local

# 应用所有未应用的 migrations（不会跑 dev/baseline）
npx dotenv -e .env.production.local -- npx prisma migrate deploy

# 部署
vercel --prod
```

> **不要在 production 用 `prisma db push`**：那会绕过 migration 历史，未来无法 rollback。
> Vercel build script 已在 `package.json.build` 里跑 `prisma generate`，不需要在 build hook 里跑 `migrate`。

### 3.4 检查 schema vs DB 是否一致

```bash
npx dotenv -e .env.local -- npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma
# 期望输出：No difference detected
```

---

## 4. Seed 步骤

### 4.1 SUPER_ADMIN（首次部署 1 次）

```bash
SEED_ADMIN_EMAIL=ops@your.com \
SEED_ADMIN_PASSWORD=ChangeMe-1234 \
  npx dotenv -e .env.production.local -- tsx prisma/seed.ts
# 已存在则跳过，幂等
```

### 4.2 Creative Evidence Cards（每个新环境 1 次）

```bash
npx dotenv -e .env.production.local -- tsx scripts/seed-creative-evidence-cards.ts
# 18 张 PUBLISHED 卡，upsert by slug，可重复执行
# 不跑：/wizard/[id]/step-2-card 会显示 empty state（不会崩溃，只是 wizard 第二步选不到卡）
```

---

## 5. Feature Flags

| Flag | 默认 | 含义 | 推荐策略 |
|---|---|---|---|
| `ENABLE_WIZARD_FFMPEG_RENDER` | `false` | Step 6 是否尝试真 FFmpeg 渲染 | 首次上线保持 `false`；服务器准备好 ffmpeg + Blob 后再开 `true` |
| `ENABLE_FFMPEG_RENDER` | `false` | admin pipeline 的 ffmpeg 开关（独立） | 与 wizard 无关 |
| `VIDEO_ENGINE_MOCK` | `false` | seedance mock 强制 | admin only |
| `DIGITAL_HUMAN_PROVIDER` | `mock` | demo page 用，wizard 不读 | demo only |

---

## 6. Upload Behavior（Step 5）

```
用户进入 Step 5
   ├─ BLOB_READ_WRITE_TOKEN 已配置  ─→  默认显示「直接上传」tab，可选 ScenePlan 绑定
   │                                      上传成功 → /api/upload/blob → /api/wizard/projects/[orderId]/assets
   │                                      失败 → 自动切到「公网 URL」tab + 错误提示
   │
   └─ BLOB_READ_WRITE_TOKEN 缺失     ─→  「直接上传」tab disabled + tooltip
                                          默认显示「公网 URL」tab，提示「Direct upload comes next」
```

支持文件类型：`video/mp4` / `video/quicktime` / `image/jpeg` / `image/png` / `image/webp`，单文件上限按 `/api/upload/blob` route 内部限制（当前为常量，不在 wizard 层放大）。

---

## 7. Render Behavior（Step 6）

| Mode | 触发条件 | 输出 |
|---|---|---|
| **REAL** | `ENABLE_WIZARD_FFMPEG_RENDER=true` + 服务器有 `ffmpeg` + 至少 1 个 usable clip | 真 mp4（Blob URL 或本地 `file://`） + manifest |
| **DRAFT** | 上面任一不满足，但有素材 | 第一段可用素材作为 preview + manifest |
| **MOCK** | 完全没素材 | 仅 manifest（含 timeline 占位） |
| **失败兜底** | REAL 跑了一半抛错 | 自动降级 DRAFT_READY，写 `errorMessage` + `fallbackReason` |

UI banner 说明（Phase 3B 已统一）：
- REAL → 绿色 success：「Real Render：已用真 FFmpeg 渲染」
- DRAFT → 蓝色 info：「Draft Preview：尚未启用真 FFmpeg 渲染」
- MOCK → 蓝色 info：「Mock Preview：尚未上传任何可用素材」

文案常量集中在 [`src/lib/services/wizard-fallback-messages.ts`](../src/lib/services/wizard-fallback-messages.ts)。

---

## 8. AI Fallback Behavior

| 场景 | Step 3 / 4 | AIUsageLog 写入 |
|---|---|---|
| `OPENAI_API_KEY` 已配置且响应正常 | 真 LLM 输出 | `status=SUCCESS` + tokens + cost |
| `OPENAI_API_KEY` 未配置 | mock 脚本 / 分镜 | `status=MOCK` |
| `OPENAI_API_KEY` 已配置但调用失败 / Zod 校验失败 | 自动 mock | 一行 `status=FAILED`（错误） + 一行 `status=MOCK`（兜底） |

观测：`/admin/ai-usage`（SUPER_ADMIN / OPERATOR 可见）显示 7/30/90 天 success/mock/failed 计数 + 费用估算 + 最近 50 条调用。

---

## 9. Auth / Roles

| Role | wizard 页面 | wizard API | admin 入口 |
|---|---|---|---|
| `SUPER_ADMIN` | ✅ | ✅ | ✅ 全部（含 `/admin/ai-usage`、`/settings` 用户管理） |
| `OPERATOR` | ✅ | ✅ | ✅ 大部分（含 `/admin/ai-usage`） |
| `REVIEWER` | ❌ 重定向 `/orders` | ❌ 401 | 仅 `/qa` |

强制点：
- `requireWizardPage()`（server component）：`/wizard/**` 所有页面
- `requireOperator()`（API route）：`/api/wizard/**` 所有路由
- `middleware.ts`：所有非 public path 强制登录（`/demo` 是 public）

---

## 10. Demo Checklist（给 CEO / 客户演示前）

1. 用 OPERATOR / SUPER_ADMIN 账号登录
2. 访问 `/wizard` → 看到「新建项目」按钮
3. `/wizard/new` 填一个真实业务名（例如 `Sample Realtor`）+ 三项 consents 全勾 → 创建
4. 自动跳 `/wizard/[id]/step-2-card` → 至少看到 18 张卡
5. 选 1 张卡 → step-3-script 自动跳转 → 点「生成脚本」 → 出现完整 hook/cta/voiceover
   - 如果 `OPENAI_API_KEY` 缺失：banner 显示蓝色 info，但脚本仍然出现
6. step-4-storyboard → 「生成分镜」→ 出现 N 个 shots + shooting guide
7. step-5-upload → 上传一个 mp4 或粘公网 URL → 看到 QA 状态
8. step-6-render → 「生成草稿」→ 看到 `Draft Preview` 横幅 + manifest 链接
9. 进 `/admin/ai-usage` → 看刚才的调用记录是否落库

---

## 11. Troubleshooting

| 现象 | 排查 |
|---|---|
| **Step 2 看不到任何卡** | 跑 `npm run db:seed:creative-cards` 或 production 等价命令；DB 检查 `SELECT COUNT(*) FROM "CreativeEvidenceCard" WHERE status='PUBLISHED'` 应 ≥ 1 |
| **Step 5 直接上传 disabled** | `vercel env ls` 检查 `BLOB_READ_WRITE_TOKEN`；如不要上传，直接用「公网 URL」tab |
| **Step 6 一直是 DRAFT，想要 REAL** | 确认 `ENABLE_WIZARD_FFMPEG_RENDER=true` + 服务器有 `ffmpeg` + Step 5 至少 1 个素材绑定到了 storyboard shot |
| **服务器没有 ffmpeg 但 flag 已开** | wizard 仍可用（自动降 DRAFT，会写 `errorMessage`），但日志会出现 `ffmpeg -version` 失败 |
| **AI banner 一直显示 mock 但 key 已配置** | `/admin/ai-usage` 看是否有 `status=FAILED` 记录；常见是 OpenAI rate limit / 5xx |
| **Migration 报错 `relation already exists`** | 检查是否之前用过 `db push`；解决方法：`prisma migrate resolve --applied <migration-name>` 把对应 baseline mark 为 applied |
| **登录后立刻被踢回 `/login`** | 检查 `AUTH_SECRET` + `NEXTAUTH_URL` 是否设置；`AUTH_SECRET` 不是 `NEXTAUTH_SECRET` |

---

## 12. Rollback

```bash
# Vercel deployment 回滚（最快）
vercel rollback <previous-deployment-url>

# Prisma migration 回滚（仅在新 migration 出问题时）
# 1. 写一个反向 migration（如 ALTER TABLE Script DROP COLUMN metadata;）
#    放在 prisma/migrations/<timestamp>_revert_<name>/migration.sql
# 2. 部署：npx prisma migrate deploy
# 注意：metadata 是 nullable JSON，Phase 3A 之前的代码可以直接读旧行（已验证），
#      因此回滚到 Phase 2 不需要删列，只需 revert app code。
```

`WizardRenderJob` 表是 Phase 2 新建，不影响 admin pipeline；如需短期 disable wizard 可：
1. 在 `middleware.ts` 加 `if (pathname.startsWith("/wizard")) return NextResponse.redirect("/orders")`
2. 或者把 sidebar 入口隐藏（`src/components/layout/app-sidebar.tsx`）

---

## 13. Release Smoke

部署后第一时间在 dev / staging neon 上跑：

```bash
npm run smoke:wizard            # 不污染（自带 [Smoke] 前缀的 DeliveryOrder）
npm run smoke:wizard -- --cleanup     # 跑完自动删除测试 order（推荐）
```

期望输出末尾：

```
✅ Wizard release smoke: PASS
```

详见 [`docs/RELEASE_HARDENING_CHECKLIST.md`](RELEASE_HARDENING_CHECKLIST.md)。
