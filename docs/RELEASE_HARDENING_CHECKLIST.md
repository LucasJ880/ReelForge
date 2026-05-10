# Release Hardening Checklist · Aivora Wizard

> 每次部署前从上到下打勾。所有项必须通过才能发 `vercel --prod`。
> 详细原理见 [`WIZARD_PRODUCTION_RUNBOOK.md`](WIZARD_PRODUCTION_RUNBOOK.md)。

---

## 0. 准备

- [ ] 当前在干净的 `main` 分支
- [ ] 已 pull 最新 `git pull --rebase origin main`

## 1. 静态检查

```bash
npm run typecheck      # 期望：0 errors
npm run lint           # 期望：0 errors（warning 可接受）
npm test               # 期望：86 pass / 1 skipped（B3 后总数）
```

- [ ] `typecheck` 0 errors
- [ ] `lint` 0 errors
- [ ] `test` 全绿

## 2. Prisma

```bash
npx prisma validate
npx prisma generate
npx dotenv -e .env.local -- npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma
# 期望：No difference detected
```

- [ ] `prisma validate` 通过
- [ ] `prisma generate` 通过
- [ ] dev DB schema 与 `schema.prisma` 一致（diff 输出 No difference）

## 3. Seed 数据

```bash
# 检查创意卡数量
npx dotenv -e .env.local -- npx tsx -e "import('./src/lib/db.js').then(m => m.db.creativeEvidenceCard.count({ where: { status: 'PUBLISHED' } }).then(c => { console.log('PUBLISHED cards:', c); process.exit(0) }))"
# 期望：18
```

如果不是 18：

```bash
npm run db:seed:creative-cards
```

- [ ] PUBLISHED CreativeEvidenceCard ≥ 18

## 4. 部署 smoke（不依赖外部 service）

```bash
npm run smoke:wizard -- --cleanup
```

- [ ] 输出末尾：`✅ Wizard release smoke: PASS`
- [ ] cleanup 成功（控制台 `Cleanup done.`）

## 5. 手动 wizard 走一遍（dev 或 staging）

用 OPERATOR / SUPER_ADMIN 账号登录：

- [ ] `/wizard` 首页能打开
- [ ] `/wizard/new` 能创建项目（三项 consents 全勾）
- [ ] `step-2-card` 看到 ≥ 18 张卡，能选中
- [ ] `step-3-script` 能生成脚本（无 OPENAI_API_KEY 时看到蓝色 mock banner）
- [ ] `step-4-storyboard` 能生成 storyboard + shooting guide
- [ ] `step-5-upload` 能用直接上传 **或** 公网 URL 注册素材，QA 状态显示
- [ ] `step-6-render` 能生成 WizardRenderJob（DRAFT_READY / MOCK 都算）
- [ ] step indicator 高亮当前 step，已完成 step 可点回去

## 6. 观测面板

- [ ] `/admin/ai-usage` 能打开（不能 500）
- [ ] 看到刚才 wizard 跑出的 calls（feature: client_script / storyboard）
- [ ] KPI 数字与 recent 50 表合理一致

## 7. 兜底验证

- [ ] **Blob fallback**：临时把 `BLOB_READ_WRITE_TOKEN` 留空启动 → step-5 「直接上传」disabled，公网 URL 仍能用（恢复 token 后再起）
- [ ] **Render fallback**：把 `ENABLE_WIZARD_FFMPEG_RENDER=false` → step-6 一直 DRAFT
- [ ] **AI fallback**：临时把 `OPENAI_API_KEY` 留空 → step-3/4 蓝色 mock banner（恢复后再起）

## 8. 权限

- [ ] 退出后访问 `/wizard/new` → 跳 `/login`
- [ ] 用 REVIEWER 账号登录 → 访问 `/wizard` 被重定向到 `/orders`
- [ ] `/api/wizard/projects`（POST）未登录 → 401

## 9. Build

```bash
npm run build
```

- [ ] `next build` 通过（如失败：判断是 wizard 引入还是预存 / 环境变量问题，记录到 release notes）

## 10. Production migration（仅 staging → production 之前）

```bash
vercel env pull .env.production.local
npx dotenv -e .env.production.local -- npx prisma migrate deploy
# 期望输出：Applied migrations + No pending migrations to apply.
```

- [ ] production DB migration 通过（无 pending）
- [ ] production seed 创意卡（如这是新环境第一次）

```bash
npx dotenv -e .env.production.local -- tsx scripts/seed-creative-evidence-cards.ts
```

## 11. Deploy

```bash
vercel --prod
```

- [ ] 部署成功
- [ ] 生产域名 `/login` 能加载
- [ ] 用真实 OPERATOR 账号登录后能走完 wizard 1→6（按第 5 节复跑一次）
- [ ] `/admin/ai-usage` 在 production 也能打开

## 12. 部署后

- [ ] 在 Vercel logs 监控 30 分钟，无 500 错误（特别盯 `/api/wizard/**`）
- [ ] 通知团队 release 完成 + 已知 limitation（见 RUNBOOK §11）

---

## 紧急 rollback

```bash
vercel rollback <prev-deployment-url>
```

如果是 schema 问题，按 [`WIZARD_PRODUCTION_RUNBOOK.md` §12](WIZARD_PRODUCTION_RUNBOOK.md#12-rollback) 执行。
