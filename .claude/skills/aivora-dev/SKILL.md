---
name: aivora-dev
description: Aivora/ReelForge 仓库的开发导航与交付规程。在本仓库做任何代码改动前使用——定位文件（先走 codemap 而不是全 repo 扫）、加 API 路由 / service / Prisma 迁移的既定套路、该跑哪些测试、以及会打穿生产的已知陷阱。用户说"改 X 功能""加个接口""这个 bug 在哪""跑一下验收"时都适用。
---

# Aivora 开发规程

目的：**少烧 token、少踩坑、交付有证据**。硬性铁律见根目录 `CLAUDE.md` §4，本文件是操作细节。

## 一、定位文件：三级升级，不许跳过第 1 级

```bash
npm run context:find -- "关键词1 关键词2"   # 0.3s，输出 top 10 + 建议阅读顺序
```

1. **`context:find`** —— 永远第一步。关键词用领域词（`storyboard resume`、`credit refund`、
   `videos contract recipe`），不要用文件名猜。
2. **`ai-context/` 索引**（`npm run codemap:build` 重建）：
   - `area-map.json` —— 按功能域列文件。域名：`video-generation` / `media-processing` /
     `ffmpeg` / `ai-providers` / `blob-storage` / `publishing` / `payments` / `auth` /
     `admin` / `demo` / `real-footage-ads` / `wizard` / `i18n` / `metrics` / `upload`。
   - `dependency-map.json` —— 「动这个文件会牵连谁」。改 service 前必查。
   - `route-map.json` —— 路由与 API endpoint 清单，别去扫 `src/app`。
   - `file-summary-map.json` —— 单文件的 exports / notes。
3. **grep / 全文件读** —— 只有前两级都定位不到才升级。

读大文件用行号区间。**永不读** `public/generated`、`tmp`、`.next`、`test-results`、
`playwright-report`、`node_modules`。

索引过期（distance 大或找不到新文件）就先 `npm run codemap:build`，380ms。

## 二、分层与落点

```
route (src/app/api/**)      鉴权 + zod 校验 + 调 service，不写业务逻辑、不直接 Prisma
service (src/lib/services)  业务逻辑与事务；40+ 个，改前查 dependency-map
provider (src/lib/providers) 外部 API 封装（openai / seedance / shuyu / apify / remove-bg …）
contract (src/lib/contracts) 对外契约与 zod schema —— 跨系统的字段定义放这里
```

客户面在 `src/app/(platform)`。`src/app/(internal)` 是旧代运营中台，PRD §10 正在 A 级下线，
**只减不加**。

### 加一个对外 API

1. 契约先写 `src/lib/contracts/<name>.ts`（zod schema + 类型），这样测试和调用方共用一份。
2. 机器鉴权用 `src/lib/machine-auth.ts` 的 `machineAuthFailure(req)` —— fail-closed，
   必须在解析入参、碰任何 service/DB **之前** return 它。
3. 路由放 `src/app/api/<name>/route.ts`，只做「鉴权 → 校验 → service → 序列化」。
4. 配一个 `tests/<name>-contract.test.ts`，参考 `tests/batch-api-contract.test.ts`。

### 改数据库

```bash
npm run db:migrate          # ⚠️ dotenv -e .env.local = 直连生产库
```

- **只加列 / 加表，不 DROP。** 新列一律 nullable 或带默认值，否则线上写入会炸。
- DDL 需要 `neondb_owner` 角色；**失败的迁移会卡住之后所有部署**，跑之前想清楚。
- 业务数据只归档不物理删除。

### 改前端

- `'use client'` 文件**不得引用服务端 service 的模块级值**——会把 OpenAI SDK 打进客户端
  bundle，整页 500。有 `client-bundle-safety` 回归测试守着，别绕过它。
- 新界面走「剪辑台」方向：圆角 0、无阴影、数字 tabular-nums、accent `#ff4d00` 只用三处、
  只做深色。规矩见 PRD §11。

## 三、交付门：先验证，再说完成

按改动面挑，**贴命令输出**，不要用「应该没问题」代替证据：

| 改了什么 | 至少要跑 |
|---|---|
| 任何 TS | `npm run typecheck` + `npm run lint` |
| service / 契约 | `npm test`（或指定相关 `tests/*.test.ts`） |
| 前端交互 | 相关 test + preview 里实际点一遍（read_console_messages 查报错） |
| 端到端 | `npm run acceptance:mock`（typecheck + phase4 + i18n + walkthrough） |
| 视觉 | `npm run test:visual`；基线变了才 `test:visual:update` |

`npm test` = `node --import tsx --test tests/**/*.test.ts`，211 个测试文件，跑单个用
`node --import tsx --test tests/<file>.test.ts`。

## 四、已知陷阱

| 现象 | 真因 | 处理 |
|---|---|---|
| 整页 500、bundle 里出现 OpenAI | client 组件取了服务端 service 的值 | 值挪到 server component 或 API 传下去 |
| 线上图片 404 | `public/brand/` 被 gitignore | 资产走 blob，禁用 `/brand/*` 静态 URL |
| 批次永久卡 QUEUED | 供应商 502「积分已退回」被误判为不可重试 | 已修，勿回退；查 shuyu 路由的退款判定 |
| 供应商能力漂移 | Shuyu 套餐 ID 轮换 / 参数下线，health 查不出来 | 真机跑一次小样，别信 health |
| 刷新后任务状态丢失 | 前端未挂 rehydrate | 走已有的恢复入口，单帧失败不判全死 |
| 生产上传全挂 | 内容审核开着但 OpenAI key 无 moderation 权限 | 生产已关审核；恢复前先确认 key 权限 |

## 五、任务纪律

- **每一轮任务都必须可取消**：取消要清幂等键、保留素材。只给「重试」不算做完。
- **demo 账号不跑付费生成。**
- 清理旧代码顺序 **A 下线入口 → B 冻结代码 → C 删代码**，不跳级；删除 PR 单独提，
  不与功能改动混在一起。
- 多步任务先写计划再动手（superpowers 的 `writing-plans` / `executing-plans`），
  独立子任务可并行派发。
