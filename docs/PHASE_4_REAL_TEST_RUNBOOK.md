# Phase 4 — Real Provider E2E Runbook

> 目标：在烧真钱之前，按这份 runbook 一步一步来，避免静默扣费 / dead-link / 卡在 stitch。

---

## 0. 烧钱预算速查

| 场景 | 段数 | OpenAI | BytePlus Seedance | Blob | Total |
|---|---|---|---|---|---|
| **A · Personal 15s 文生视频** | 1 | ~$0.10 (gpt-5.5 director+script+videoPrompt) | **待确认** | $0 (1 段不走 stitch) | **待确认** |
| **B · Personal 30s 文生视频** | 2 | ~$0.15 | **待确认** | ~$0.001 (1 GH Action stitch upload) | **待确认** |
| **C · Business 30s + auto end card** | 2 AI + 1 end card | ~$0.20 | **待确认** | 可能 ~$0.05 (logo gen 走 OpenAI Image，缺 logo 时) | **待确认** |

> BytePlus 企业账号尚未完成注册，模型可用性、配额与单价均标记为「待确认」。账号与配额申请由人工侧处理；确认后再回填单价，并按「单价 × 条数 × 预期重试率」计算批准点预算。

---

## 1. 跑真测前的强制预检（必做）

```bash
npm run mode:check
```

会输出当前 4 个 provider 的状态 + 估算成本。**确认 mock 状态符合预期** 再进下一步。

期望输出（dev 安全模式）：

```
✅ LLM           = MOCK (LLM_FORCE_MOCK=true)
✅ Seedance      = MOCK (VIDEO_ENGINE_MOCK=true)
✅ OpenAI Image  = MOCK (IMAGE_ENGINE_MOCK=true)
…
```

期望输出（准备烧真钱）：

```
🔥 LLM           = REAL (gpt-5.5 / 4.1 / 4o)
🔥 Seedance      = REAL (dreamina-seedance-2-0-260128)
🔥 OpenAI Image  = REAL (gpt-image-2)
…
```

**如果你以为是 mock 但显示 REAL → 立刻停下，检查 `.env.local` / 部署环境变量。**

---

## 2. 场景 A — Personal · 15s · 9:16 · 文生视频（最低成本起点）

### 2.1 准备

```bash
# .env.local 至少包含
DATABASE_URL=postgresql://...                    # 真实 Neon
OPENAI_API_KEY=sk-...                            # 真实 OpenAI
BYTEPLUS_ARK_API_KEY=...                         # BytePlus 国际区真实 Seedance
ARK_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3
BLOB_READ_WRITE_TOKEN=vercel_blob_...            # 真实 Blob
AUTH_SECRET=...                                  # NextAuth
NEXT_PUBLIC_APP_URL=http://localhost:3000

# 安全：先全 mock 跑一遍 UI
LLM_FORCE_MOCK=true
VIDEO_ENGINE_MOCK=true
IMAGE_ENGINE_MOCK=true
```

```bash
npm run mode:check          # 应全部显示 MOCK
npm run dev
```

### 2.2 Mock 全链路 walk-through（不烧钱）

1. 浏览器打开 `http://localhost:3000`
2. seed admin 登录（`SEED_ADMIN_EMAIL` 在 .env.local 里）→ 跳 `/internal/orders`
3. 临时切换 persona：直接在 URL 里访问 `/personal`（OPERATOR/SUPER_ADMIN bypass，Phase 5 之前任何人都能进）
4. `/personal/create-video` → 输入 "a cat exploring a sunny apartment"
5. 选 15s / 9:16 / no end card → **Preview plan** → 验证 plan 卡片显示 "AI scenes 1, Length 15s, Format 9:16 vertical"
6. **Generate video** → 自动跳 `/personal/videos?highlight=<id>`
7. 等几秒（mock latency 1500ms） → 列表项状态 `准备中 → 生成中 → 视频已完成`
8. **「查看视频」CTA** 应可点开播放（mock 视频是本地 file:// 静态画面）
9. 验证 `/personal/videos` 也展示「再做一支」+「下载视频」CTA

### 2.3 切换 real（成本待确认，须另行人工批准）

```bash
# .env.local
LLM_FORCE_MOCK=false
VIDEO_ENGINE_MOCK=false
IMAGE_ENGINE_MOCK=false
```

```bash
npm run mode:check          # 应显示 🔥 REAL
# 二次确认后重启 dev
npm run dev
```

重复 2.2 第 1-9 步：

- 第 5 步 Preview plan 现在会真烧 LLM（~$0.10）
- 第 6 步 Generate 真提交 BytePlus Seedance（单价待确认；未获人工成本批准不得执行）
- 等 30-90s（不是几秒），列表状态会停在「生成中」一段时间
- **本地 dev（2026-05 起）**：`/personal/videos` 会对进行中的任务每 15s 自动 POST
  `/api/briefs/:id/render-status` 并刷新页面，一般**不必**再手动 curl cron。
- 若列表长时间卡在「生成中」，可手动触发 cron 双保险：
  ```bash
  curl -X POST http://localhost:3000/api/cron/poll-videos \
       -H "Authorization: Bearer $CRON_SECRET"
  ```
- 网络需可访问 BytePlus 国际 Ark 与 OpenAI；不得回退到中国区端点。

**验收**：列表显示「视频已完成」+ 真实 Seedance 视频可下载。

### 2.4 失败演练

故意让 prompt 触发 Seedance 安全审核（如包含真实人名 / 商标 / 政治敏感词），验证：
- 失败状态显示「生成失败，请重试」chip
- 「重新生成」CTA 跳回 `/personal/create-video`
- 「换个描述再试一次，效果通常会更好。」guidance 出现

---

## 3. 场景 B — Personal · 30s · 文生视频（验证多段 + GH Action stitch）

只在场景 A real 跑通后再做。

### 3.1 关键差异

- 30s = 2 段（每段 15s），需要 ffmpeg 拼接
- **本地 dev**：`STITCH_RUNTIME` 默认 = local（本机有 ffmpeg 时直接拼），输出到 Vercel Blob
- **生产**：`STITCH_RUNTIME=external`（默认），等 GH Action 每 5 分钟 cron 一次拉任务拼接

### 3.2 本地 dev 步骤

```bash
# 确认本机有 ffmpeg
which ffmpeg && ffmpeg -version | head -1

# .env.local 同 2.3 加上
ENABLE_VIDEO_STITCHING=true   # 不要设 false（false = 复用第一段当成片）
# STITCH_RUNTIME=local（默认）
```

进 `/personal/create-video` → 30s → Generate → `/personal/videos`：
- 状态序列：`准备中 → 生成中（已完成 0/2 → 1/2 → 2/2）→ 马上就好 → 视频已完成`
- 「视频已完成」时 finalVideoUrl 应该是 `https://*.public.blob.vercel-storage.com/final-videos/<id>/<ts>.mp4`

### 3.3 生产 staging（GH Action）步骤

依赖：

- 生产 Vercel 已部署最新 main（`origin/main`）
- 仓库 Settings → Secrets and variables → Actions 里已配 `APP_URL` / `CRON_SECRET` / `BLOB_READ_WRITE_TOKEN`
- `.github/workflows/stitch-videos.yml` 和 `poll-videos.yml` 都启用且最近 5 分钟有 success run

操作：

1. 在生产 URL 上跑场景 B
2. 状态停在「马上就好」时去 GitHub → Actions → `stitch-videos` workflow，**手动 Workflow Dispatch** 触发一次（不想等 5 分钟 cron）
3. workflow 完成后 ~10s 内刷新 `/personal/videos` 应看到「视频已完成」+ Blob URL

### 3.4 失败演练

人为让一段失败（如把 BYTEPLUS_ARK_API_KEY 临时换成无效值）：
- 期望 brief 状态 → 「生成失败，请重试」
- DB 里 `videoJob.status = FAILED`，`finalVideo.stitchAttempts` 不变（因为没进 stitch）

---

## 4. 场景 C — Business · 30s · auto end card（验证 brand_end_card 渲染）

### 4.1 关键差异

- B-side 经过 `UnifiedCreativeInput` 的 `userType="business"` 分支
- `selectedBrandEndingMode = "auto_end_card"`（默认），导致 plan 增加 `brand_end_card` 段（3s）
- `assemblyPlan` 总段数 = 2 AI + 1 end card = 3 段
- 缺 logo 时 `renderBrandEndCard` 会调 OpenAI Image gen 出一个 placeholder logo（~$0.05）

### 4.2 步骤

1. 切到 BUSINESS persona（`/persona` 选 Business 卡，POST `/api/persona`）
2. `/business/create-ad-video`
3. 填 prompt + brand name "AcmeHydrate" + website "https://example.com" + cta "Tap to shop"
4. 不上传 logo
5. 30s / 9:16 / Ending=Auto end card → Preview → Generate
6. 跳 `/business/products?highlight=<id>` → 走完同 3.2 / 3.3 流程

**验收**：成片末尾 3s 是 brand end card（白底 + 品牌名 + slogan + CTA），不会出现 OpenAI 生成的真实 logo（除非带了 logo asset）。

---

## 5. 跑完后的清理

- DB 里 `[smoke]` / mock 测试单可以保留作为参考；想清理：
  ```sql
  DELETE FROM "DeliveryOrder" WHERE title LIKE '[smoke]%' OR title LIKE 'Untitled%';
  ```
  Prisma 级联会自动清下游 round / brief / videoJob / finalVideo。
- Blob 里上传的 mp4 不会自动清，定期手动到 Vercel Dashboard 删
- VideoJob `RUNNING` 卡死的（可能 dev 跑一半切了 mock 模式）：
  ```sql
  UPDATE "VideoJob" SET status = 'CANCELLED' WHERE status IN ('RUNNING', 'QUEUED') AND "createdAt" < NOW() - INTERVAL '1 hour';
  ```

---

## 6. 哪些情况下应该立刻 abort

- `npm run mode:check` 显示意料外的 REAL → 立刻 Ctrl+C，修 .env，重测
- 单次 dispatch 跑出 > 5 段 video job（应该最多 4 段 60s） → 检查 `directorPlan` / `segmentPlan` 是否被 LLM 误算
- DB 里 `VideoJob.retryCount > 5` → quota 还没上线，可能在循环烧钱，手动 SQL `UPDATE ... CANCELLED`
- Blob 用量异常增长 → 检查是否有循环 stitch（`finalVideo.stitchAttempts` 增长）

---

## 7. 真实测试日志模板

每跑完一档，在本文件末尾追加一条：

```
### Run YYYY-MM-DD scenario A by <你>
- env: dev local / staging vercel
- duration / segments / aspect: 15s / 1 / 9:16
- elapsed: 提交 → 完成 = ?
- final URL: https://...vercel-storage.com/...mp4
- cost actual: $? (Seedance) + $? (OpenAI)
- issues: ...
- next action: ...
```

---

## 8. 跑通三档后

- 在 `docs/ROADMAP_STATUS.md` 把 Phase 4 的 4c 三个 checkbox 都打勾
- commit message: `chore(phase-4): real test scenario A/B/C all green`
- 然后 Phase 5 启动
