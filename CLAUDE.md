# Aivora — AI agent 工作须知

小商家的内容获客与增长操作系统（Next.js 16 App Router + Prisma/Neon + Vercel Blob）。
当前实施依据：[PRD v3.3](docs/roadmap/2026-07-29-ecommerce-workflow-prd.md)，从 **M0** 起做。

> ⚠️ `.cursor/rules/reelforge-project-context.mdc` 描述的是已废弃的「代运营中台 / 只有 AdminUser」
> 模型，与当前 PRD 冲突，**不要拿它当事实来源**。

## 1. 找代码：先查索引，别扫 repo

493 个 src 文件、81 个 API route、80+ npm scripts。全 repo grep 是本项目最大的 token 漏斗。

```bash
npm run context:find -- "关键词1 关键词2"   # 0.3s，给 top 10 文件 + 阅读顺序
```

索引在 `ai-context/`（`npm run codemap:build` 重建，改动大之后跑一次）。
定位不到再升级到 grep。大文件用行号区间读，别整文件吞。
细节协议见 skill `aivora-dev` 与 [docs/AI_CONTEXT_WORKFLOW.md](docs/AI_CONTEXT_WORKFLOW.md)。

## 2. 目录约定

| 位置 | 内容 |
|---|---|
| `src/app/(platform)/` | 客户自助面 —— 新定位的主战场 |
| `src/app/(internal)/` | 旧代运营中台，19 页，**A 级下线中**，别加新功能 |
| `src/app/(business)/ (personal)/ (public)/ (auth)/` | 商单面 / 个人面 / 落地页 / 登录 |
| `src/app/api/` | 路由只做鉴权 + 参数校验，业务委托 `src/lib/services/` |
| `src/lib/services/` | 业务层（40+ service），Provider 层封装外部 API |
| `src/lib/contracts/` | 对外契约（`customer-api` / `batch-api` / …），M0 的 `/api/videos` 在这层定 |

## 3. 常用命令

```bash
npm run dev            # 真机模式（predev 会跑 mode:check）
npm run typecheck      # tsc --noEmit —— 提交前必过
npm run lint
npm test               # node --test tests/**/*.test.ts
npm run db:migrate     # dotenv -e .env.local（⚠️ 直连生产库，见 §4）
npm run context:find -- "..."
```

## 4. 铁律（违反会打穿生产，不是风格问题）

1. **`.env.local` 直连生产库。** 任何 `db:*` 命令都是对生产执行。
   - **迁移只能用 `npm run db:migrate:deploy`**，它已切到 `NEON_PRODUCTION_OWNER_DATABASE_URL`
     （直连 + owner 角色）。用默认 `DATABASE_URL` 会报 `42501 must be owner of table`，
     且失败记录会卡住后续所有部署 —— 恢复要先 `prisma migrate resolve --rolled-back`。
   - 走 pooler 跑迁移还会**把 advisory lock 泄漏在 pgbouncer 的复用连接上**，
     之后每次迁移都 `P1002` 超时。真遇到了用 `npm run db:migrate:deploy:unlock`
     绕过（仅当迁移本身幂等时），不要去 kill 生产连接。
2. **数据库只加列 / 加表，不 DROP。** 业务数据只归档不物理删除（PRD §10.4 D 级）。
3. **只走真实供应商。** 不做 mock 模拟测试来充当验收；`dev:mock` 只用于纯前端联调。
4. **demo 账号不跑付费生成。**
5. **`'use client'` 文件不得引用服务端 service 的模块级值**（曾导致整页 500，
   有 `client-bundle-safety` 回归测试守着）。
6. **`public/brand/` 被 gitignore。** 真实客户资产走 blob，禁止用 `/brand/*` 静态 URL。
7. **每一轮任务都必须可取消**，取消要清幂等键、保留素材。失败不能只给「重试」。
8. **旧代码清理顺序 A→B→C 不跳级**，删除 PR 单独提，不与功能改动混。

## 5. 交付门

改完代码，**先自己验证再报完成**：`npm run typecheck` + `npm run lint` + 相关 test 全绿，
把命令输出贴出来。失败就说失败，不要用「应该没问题」代替证据。

## 6. 新界面：剪辑台方向（已定稿）

时间线轨道 / 齿孔封边 / 场记板镜号三个装置必须复用，不要各自发明。
**圆角 0、无阴影、数字一律等宽 tabular-nums、accent `#ff4d00` 只用三处、只做深色。**
完整 token 与硬性规矩见 PRD §11，设计稿 `designs/aivora-os/Aivora OS v2.html`。
