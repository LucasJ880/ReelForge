# Aivora Roadmap Status — 进度看板

> 这份文件是**单一事实来源（SSOT）**：任何时候想知道"我们走到哪了 / 下一步该干什么"，
> 直接读这一份，不要再去翻 chat 历史或 commit log。
> 任何 phase 推进时（开始 / 完成 / 阻塞）必须同步更新本文件，并在同一个 commit 里。

---

## 一句话现状

**正在做：** Phase 5c（B 端 mock 全链路）+ Phase 6e / 7a 预备 — **C 端 mock 浏览器 E2E 已跑通**；真钱 E2E 暂缓。
**最后一次代码同步：** 见底部「Recent commits & status」
**下一动作：** 见「Next session resume hook」

---

## 路线图总览

```
Phase 1   ✅ Foundation：unified video generation pipeline + multi-segment + stitch
Phase 2   ✅ B2B demo flow infrastructure（mock-clip / brand-end-card / assembly）
Phase 2.5 ✅ B2B demo flow hardening（status mapping / dead-link guard / failed CTA）
Phase 3   ✅ C-side personal MVP hardening（personal-status / dead-link guard / friendly copy）
Phase 4   🟡 Real provider readiness + first real C-side E2E
   4a     ✅ Mock E2E 已被 325+ 项单测覆盖；`npm run e2e:phase4:mock` 守门 personal 文案/策略
   4b     ✅ Dev `VIDEO_ENGINE_MOCK` 显式安全检查 + predev 警告
   4c     🟡 本地 dev 自动 reconcile 轮询 ✅；**浏览器 mock 全链路 §1 已跑通**（2026-05-20）；真实场景 A/B/C 暂缓（按 mock 开发）
Phase 5   🟡 Persona-aware auth + 公开个人注册（PERSONAL only） + B-side full E2E
   5a     ✅ requirePersonalUser / requireBusinessUser / requireOperator 接 userType
          + 新增 requireUserOfPersona / requirePersonaPage / requireUserOfTypeForGeneration
          + dispatch 加 persona 与 request.userType 一致性校验（防越权）
   5b     ✅ POST /api/auth/register（仅 PERSONAL，role default=OPERATOR + ut=PERSONAL）
          + /register 页面 + /login 加「创建个人账号」入口
          + 17 新单测（persona 访问矩阵 + register schema 契约）
   5c     🟡 B-side mock 全链路 §3（persona JWT 刷新 + products 列表轮询已补）
Phase 6   ✅ Upload assets UI + 双端详情页 + 段感知重试
   6a     ✅ PERSONAL /personal/videos/[id] 详情页
   6b     ✅ render-retry / render-status 端点改用 brief 归属校验
          + 新 lib/services/brief-access.ts 的纯决策矩阵 + IO wrapper
   6c     ✅ AttachmentUploader 已 inline 显示分类 + 角色下拉 + 警告
   6d     ✅ BUSINESS /business/products/[id] 详情页（与 6a 同构）
          + products list 过滤掉 PERSONAL persona 视频，避免跨 persona 泄漏
   6e     ⏳ create-video「基于上一次 brief 的快速重试」（可选；当前重试入口已够用）

Phase 6.5 ✅ 双端 user flow 收敛（onboarding + audit + walkthrough）
   - 持久化 PERSONAL 自助注册的 onboarding 入口（/persona 卡片走 /register；/login 链接 /register；BUSINESS 卡片明示 invite-only）
   - 修了 business/page.tsx 的历史 react/no-unescaped-entities 错误 —— **lint 现在 0 error**
   - docs/MANUAL_WALKTHROUGH.md：5 分钟双端自检清单（含跨 persona 防护、故障路径、ownership）
Phase 7a  ⏳ Quota / rate-limit / Seedance & Blob & OpenAI 按 user 记账
Phase 7b  ⏳ Stripe / 微信支付 / 套餐 / billing 页
Phase 8   ⏳ 公开 demo / landing / sales packaging
Phase 8.5 ⏳ 法律 / 内容安全 / 监控告警 / 域名 + 备案
Phase 9   ⏳ Templates / 视频编辑 / 协作（上线后迭代）
```

图例：✅ 已完成 · 🟡 进行中 · 🔜 即将开始 · ⏳ 待启动

---

## 每个 Phase 的目标 + 验收 + 退出条件

### Phase 4 — Real provider readiness + first real C-side E2E

**目标**：在真实烧 Seedance / OpenAI 额度之前，把 dev 环境调教到「不会静默扣费」+ 写好可复用的 real-test 跑法。

**已完成**
- 真实 mock 全链路覆盖度 = 325 项单测 + audit 测试（覆盖 status / customer-safe strings / plan / supervisor）
- `npm run mode:check` 显式打印当前 LLM / 视频 / 拼接 / Image 4 个 provider 的 mock-or-real 状态 + 预估每段成本
- `predev` 钩子：`npm run dev` 之前自动打印安全提示，提醒 dev 是否在烧真钱
- `docs/PHASE_4_REAL_TEST_RUNBOOK.md` 三档场景（A=15s personal / B=30s personal / C=30s business with end card），每档明确成本 + 风险 + 验证点

**退出条件（4c 由用户执行）**
- [ ] 场景 A 跑通（15s personal，~$0.6），UI 拿到可播放 finalVideoUrl（**国内：Seedance 关 VPN；OpenAI 开 VPN**）
- [ ] 场景 B 跑通（30s personal，~$1.2），GH Action stitch + Blob 上传链路验证
- [ ] 场景 C 跑通（30s business with auto end card，~$1.3）
- [x] 本地 dev 无需手动 `curl cron`：列表/详情页自动 POST `render-status` 调和 Provider
- [ ] 任何一档失败时 `/personal/videos` 或 `/business/products` 看到友好的「重新生成」CTA

---

### Phase 5 — Persona-aware auth + 公开 PERSONAL 注册

**目标**：把"PERSONAL 用户"从 stub 升级成真实可注册账号，为 Phase 7 的 quota / billing 打底。

**计划**
- 5a：`requirePersonalUser` / `requireBusinessUser` 真正读 `session.user.userType`，OPERATOR/SUPER_ADMIN 仍 bypass
- 5b：新增 `POST /api/auth/register`（仅创建 `userType=PERSONAL` 的账号，role=OPERATOR 复用现有 enum）+ `/register` 页面 + `/login` 添加 "Don't have an account?" 链接
- 5c：B-side 真实 E2E（同 4c 但 persona=BUSINESS）

**退出条件**
- [ ] 一个未登录访客能在 `/register` 自助创建 PERSONAL 账号 → 自动跳 `/personal`
- [ ] BUSINESS 仍是 invite-only（admin 在 `/settings` 创建并指定 userType=BUSINESS）
- [ ] PERSONAL 用户访问 `/business/*` 被拒；BUSINESS 用户访问 `/personal/*` 被拒
- [ ] OPERATOR/SUPER_ADMIN 访问任何路径仍 OK（运维需要）
- [ ] 测试覆盖 4 类用户 × 3 类路径的访问矩阵

---

### Phase 6 — Upload + edit/regenerate UI

**目标**：把已有但没有 UI 的能力（按段重试 / regenerate / 素材管理）暴露出来。

**已就绪的后端**：`retryFailedVideoJob`、`retryFailedSegmentsForBrief`、`/api/upload/blob`、`AttachmentUploader`

**计划**
- `personal/videos/[id]` 详情页：每段 thumbnail + 失败重试按钮 + edit prompt
- `business/products/[id]` 同上 + brand kit edit
- 上传素材后 inline 显示分类（AssetClassifier 已实现）

---

### Phase 7a — Quota / 用量记账

**目标**：上线公开注册之前必须有的"防护栏"——单用户不能无限烧 Seedance。

**计划**
- Prisma schema：`UsageQuota` + `UsageLog`（按 user × resource × period）
- Middleware：`/api/video-generation/dispatch` 进入前查 quota，超额返 429 + 友好文案
- 资源粒度：Seedance 段数 / OpenAI tokens / Blob bytes / 视频条数 / 月
- 默认套餐：free / starter / pro

---

### Phase 7b — 支付

依赖 Phase 7a 完成。可能用 Stripe Checkout（海外）+ 微信/支付宝（国内）。

---

### Phase 8 — 公开 demo + landing + sales

依赖 Phase 5+6+7 全部完成。

---

### Phase 8.5 — 法务 / 安全 / 监控

并行可做：ToS / Privacy / Cookie banner / Sentry / NSFW 检测 / 域名 ICP 备案。

---

## Recent commits & status

| 日期 | Commit | Phase | 备注 |
|---|---|---|---|
| 2026-05-12 | `4ef8993 chore(b2b): add demo:mock-business-flow probe script` | Phase 2.5 prep | |
| 2026-05-12 | `4da7201 chore(b2b): harden demo flow polish` | Phase 2.5 ✅ | |
| 2026-05-13 | `3ea1fcd chore(personal): harden c-side mvp flow` | Phase 3 ✅ | C 端 status / dead-link / lint / 19 新单测 |
| 2026-05-13 | `ada0a4a feat(phase-4): real-mode safety + roadmap tracker` | Phase 4 ✅ | mode:check / roadmap / runbook |
| 2026-05-13 | `0579ed4 feat(phase-5): persona-aware auth + public PERSONAL signup` | Phase 5a+5b ✅ | 公开注册 / 17 新单测 |
| 2026-05-13 | `(prev) feat(phase-6): personal detail + brief ownership` | Phase 6a+6b+6c ✅ | personal 详情页 + 段感知重试 + brief 归属 / 13 新单测 |
| 2026-05-13 | _next: feat(phase-6.5)_ | Phase 6d + 6.5 ✅ | business 详情页 + persona onboarding + 0-error lint + walkthrough doc / 8 新单测 |

---

## Next session resume hook

> 你重启 session / 找新一个 agent 接手时，让它先做这两件事，就能立刻知道在哪里：
>
> 1. `cat docs/ROADMAP_STATUS.md` — 读这一份
> 2. `npm run roadmap` — 终端一行打印「上一个 commit / 当前 Phase / 下一动作」
>
> 然后按「Phase X — 计划」执行。所有计划都已经拆好，无需再设计。

**当前推荐的下一动作**（日常一律 mock，见 `docs/MANUAL_WALKTHROUGH.md` §0）：

1. `LLM_FORCE_MOCK=true VIDEO_ENGINE_MOCK=true IMAGE_ENGINE_MOCK=true npm run dev`
2. `npm run e2e:phase4:mock` — 守门单测。
3. Mock 全链路：`docs/MANUAL_WALKTHROUGH.md` §1 ✅ · §3 B 端 🟡（dispatch 已通，等列表轮询成片）· §4 跨 persona。
4. 真钱场景 A/B/C：**暂缓**（`docs/PHASE_4_REAL_TEST_RUNBOOK.md`）。
2. **直接打开 `docs/MANUAL_WALKTHROUGH.md` 跑 5 分钟双端自检**。这份文档把以前散落
   在脑子里的所有 user-flow 检查一次性钉死，包括：
   - C 端公开注册 → 详情页（90s）
   - C 端故障路径 + 重试（30s）
   - B 端商家创建 → 详情页（90s）
   - 跨 persona 防护（PERSONAL/BUSINESS/OPERATOR 三向 redirect 都要对）
3. 双端跑通后选下一程：
   - **想上线**：开 Phase 7a（quota / rate-limit），是公开 demo 之前的最关键护栏
   - **想做真测**：按 `docs/PHASE_4_REAL_TEST_RUNBOOK.md` 场景 A（≈ $0.6）跑第一发真生成
   - **想优化体验**：开 Phase 6e（基于上一次 brief 的快速重试）或 Phase 8 landing 美化
4. 创建 BUSINESS 测试账号的最快办法：用任意已有 OPERATOR 账号登录 → 访问 `/persona`
   → 点 BUSINESS 卡 → 它会 POST `/api/persona` 把 userType 改成 BUSINESS。然后这个
   账号就能走 `/business/create-ad-video` 全流程。

---

## 维护规则

- 每完成一个 Phase（或一个 4a / 5a 这样的子阶段），**同一个 commit 里**更新本文件
- 任何 blocker / 决策 / 取消的功能，写进对应 Phase 的「备注」一行
- 不要堆积 TODO 在源码里；规划性的 TODO 全部进本文件
- commit message 用 `feat(phase-X): ...` / `feat(phase-Xa): ...` 前缀，方便 `git log --grep='phase-'` 查史
