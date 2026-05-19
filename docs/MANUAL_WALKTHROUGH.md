# Aivora — 双端 user flow 自检清单（5 分钟跑完）

> 任何一次大改之后，按这份清单跑一遍。两边都过 = 上线就绪。
> 全部都是 mock 模式，不烧任何真钱（前提：已设 `LLM_FORCE_MOCK / VIDEO_ENGINE_MOCK / IMAGE_ENGINE_MOCK = true`）。

---

## 0. 准备（30s）

```bash
# 1. 锁回 mock（如果还没锁）
grep -q '^VIDEO_ENGINE_MOCK=' .env.local || cat <<EOF >> .env.local

# Phase 4 dev safety：不烧真钱
LLM_FORCE_MOCK=true
VIDEO_ENGINE_MOCK=true
IMAGE_ENGINE_MOCK=true
EOF

# 2. 验证模式
npm run mode:check   # 期望 4/5 MOCK（Blob 仍是 REAL，只在 stitch 时上传）

# 3. 重启 dev（让 predev 钩子打印新模式）
npm run dev:mock
# 等价于：LLM_FORCE_MOCK=true VIDEO_ENGINE_MOCK=true IMAGE_ENGINE_MOCK=true npm run dev
```

---

## 1. C 端（PERSONAL）— 公开注册到出片（90s）

| 步骤 | 操作 | 期望 |
|---|---|---|
| 1.1 | 浏览器开 `http://localhost:3000` | 跳到 `/persona`（未登录） |
| 1.2 | 看「Personal」卡片 | 按钮文案是「Get started」+ 小字"Free to start" |
| 1.3 | 点「Get started」 | 跳 `/register` |
| 1.4 | 填邮箱 / 8+ 位密码 / 昵称 → 创建账号 | 自动登录 → 跳 `/personal` |
| 1.5 | 在 `/personal` 看到欢迎卡片 | 「Make a video」+「My videos」两个入口 |
| 1.6 | 点「Make a video」 | 跳 `/personal/create-video` |
| 1.7 | 描述："a cat exploring a sunny apartment in vertical 9:16" | 输入框响应正常 |
| 1.8 | 选 15s / 9:16 / no end card → Preview plan | 看到 plan 卡：1 scene / 15s / 9:16 vertical / 友好文案 |
| 1.9 | Generate video | 跳 `/personal/videos?highlight=...` |
| 1.10 | 列表项状态 chip | 几秒内 `准备中 → 生成中 → 视频已完成` |
| 1.11 | 点视频标题 | 跳 `/personal/videos/[id]` 详情页 |
| 1.12 | 详情页 | 看到分镜进度 1/1 + 成片视频 + 「下载视频」/「再做一支」 |
| 1.13 | 点「刷新进度」按钮 | 状态 spinner 2s 后页面 refresh |

**通过标准**：1.1 到 1.13 全部 OK，无 404，无英文 enum，无内部术语（mock / provider / seedance / blob / ffmpeg）出现在 UI。

---

## 2. C 端故障路径 — 失败重试（30s）

| 步骤 | 操作 | 期望 |
|---|---|---|
| 2.1 | `/personal/create-video` | 描述："blank" 或者 prompt 故意空白 |
| 2.2 | Preview plan | quality reviewer 显示 blocker，按钮禁用 |
| 2.3 | （或者 mock 模拟失败）填 prompt → Generate | 列表显示「生成失败，请重试」 |
| 2.4 | 列表项点「重试失败片段」 | 跳详情页 |
| 2.5 | 详情页点「重试失败片段」按钮 | 状态变更，几秒后再次「生成中」→「视频已完成」 |

**通过标准**：UI 不卡，文案中文友好，无后端 raw error 串到客户。

---

## 3. B 端（BUSINESS）— 商家创建广告（90s）

> BUSINESS 是 invite-only。先用 admin 在 DB 里造一个测试 BUSINESS 账号。

```bash
# 一次性：用 prisma studio 或 psql 创建一个 BUSINESS 测试账号
# 或者更简单：拿一个现有 OPERATOR 账号登录，去 /persona 选 BUSINESS 卡片，
# 它会 POST /api/persona 把 userType 改成 BUSINESS。
```

| 步骤 | 操作 | 期望 |
|---|---|---|
| 3.1 | 用 BUSINESS 账号登录 | 跳 `/business` |
| 3.2 | 看到 Business 主页 | 「New ad video」+「Your products」两个入口 |
| 3.3 | 点「New ad video」 | 跳 `/business/create-ad-video` |
| 3.4 | 描述："hydration sports drink, energetic vertical ad" + brand name "AcmeHydrate" + cta "Tap to shop" | 输入响应正常 |
| 3.5 | 选 30s / 9:16 / Auto end card → Preview | plan 卡片显示 2 AI scenes + 1 brand end card |
| 3.6 | Generate | 跳 `/business/products?highlight=...` |
| 3.7 | 列表项状态 chip | 状态序列 `准备中 → 生成中（已完成 0→1→2 个画面）→ 视频已完成` |
| 3.8 | 点产品标题 | 跳 `/business/products/[id]` 详情页 |
| 3.9 | 详情页 | 看到 3 个分镜（2 AI + 1 end card 占位）+ 成片视频 + 下载 |
| 3.10 | 点「刷新进度」按钮 | 同 1.13 |

**通过标准**：BUSINESS 的 UI 路径与 PERSONAL 同构但文案更专业（brand / 商家 / 最终视频）。

---

## 4. 跨 persona 防护（30s）

| 步骤 | 操作 | 期望 |
|---|---|---|
| 4.1 | 用 PERSONAL 账号登录 | 跳 `/personal` |
| 4.2 | 浏览器地址栏改成 `/business` | 不被踢回 `/login`，而是 redirect 回 `/personal` |
| 4.3 | 浏览器地址栏改成 `/internal/orders` | redirect 回 `/personal`（无 admin 权限） |
| 4.4 | 反过来：用 BUSINESS 账号访问 `/personal` | redirect 回 `/business` |
| 4.5 | 用 OPERATOR 账号访问任意三处 | 都能进（内部 staff bypass） |

**通过标准**：4.1–4.5 全部按预期 redirect，没有 401 / 403 白屏。

---

## 4b. 配额（Phase 7a，可选 30s）

| 步骤 | 操作 | 期望 |
|---|---|---|
| 4b.1 | 登录 PERSONAL → `/personal/billing` | 看到本月四项用量进度条 |
| 4b.2 | 本地设 `QUOTA_ENFORCE=true` 重启 dev，连续 dispatch 直到超额 | API 返回 429 + 中文友好文案；UI 显示限额提示 |
| 4b.3 | 内部 OPERATOR 账号 | `/api/me/usage` 显示 `exempt: true`，不限额 |

生产环境默认强制配额；dev mock 默认**不**扣配额（`walkthrough:mock` 不受影响）。

---

## 4c. 语言切换（20s）

| 步骤 | 操作 | 期望 |
|---|---|---|
| 4c.1 | 登录 B 或 C 端，侧栏底部点语言（简体中文 / English） | 导航、首页卡片、创建页、Billing 用量文案**整页切换** |
| 4c.2 | 刷新页面 | 语言偏好保持（localStorage + cookie） |
| 4c.3 | 切到 English 走一遍 C 端创建页 | 表单标签为英文；个人端错误提示为英文 |

**通过标准**：无「侧栏英文 + 正文中文」明显混搭（统一输入区与 Billing 已 i18n 化）。

---

## 5. 自动化补充（30s）

```bash
# 无浏览器：C 15s + B 30s 服务层全链路（推荐每次改 video/stitch 后跑）
npm run walkthrough:mock
npm run acceptance:mock   # typecheck + 客户文案审计 + i18n + C/B mock 管线

# 这些每次大改后都该跑
npm run typecheck   # 0 错误
npm run lint        # 0 错误（仅 6 个无关 warnings 是历史遗留）
npm test            # 350+ ✅
npm run e2e:phase4:mock
npm run mode:check  # 确认 mock 状态没漂
npm run roadmap     # 看进度 hook
```

---

## 6. 通过后

打 commit：

```
chore(walkthrough): manual flow run YYYY-MM-DD by <你> — both personas green
```

或者直接在 `docs/ROADMAP_STATUS.md` 的「Recent commits」表里加一行。

---

## 7. 何时该跑这份清单

- 每次合 PR 前
- 每次改 `src/app/(personal)/` 或 `src/app/(business)/` 之后
- 每次改 `src/lib/api-auth.ts` 或 `src/lib/services/brief-access.ts` 之后
- 每次改 `unified-creative-input.tsx` 或 `plan-preview-card.tsx` 之后
- 任何"动了 user flow"的改动
