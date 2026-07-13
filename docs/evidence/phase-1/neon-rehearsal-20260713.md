# Phase 1 · Neon 分支迁移演练证据

日期：2026-07-13（America/Toronto）  
状态：**REHEARSAL PASS + PRODUCTION APPLIED/VERIFIED**

## 隔离范围

- Neon 项目：`weathered-dream-36367410`（AWS `us-east-1`）
- 父分支：`production`
- 演练分支：`phase1-rehearsal-20260713`（`br-long-violet-amfi1fib`）
- 运行角色：`aivora_phase1_rehearsal`
- owner 连接只保存在 gitignored `.env.local` 的 `NEON_REHEARSAL_OWNER_DATABASE_URL`，报告不记录连接串或密码。

## 迁移过程

1. 专用运行角色执行首个枚举迁移时，以 PostgreSQL `42501`（不是枚举 owner）停止。该结果证明运行角色不能越权执行 schema migration；迁移改由分支 owner 执行。
2. owner 执行到 `20260713_phase1_workspace_plans` 时，fail-closed 守门发现 1 个历史冲突：匿名账号指纹 `f079409cb23b`，`role=SUPER_ADMIN`、`userType=BUSINESS`。
3. 既有人工决议要求 `SUPER_ADMIN` 保持系统角色；迁移只把旧 `role=OPERATOR + BUSINESS/PERSONAL` 客户改为 `CUSTOMER`。因此守门条件改为允许 `SUPER_ADMIN`，仍对其他未知角色 fail-closed，并新增源码测试。
4. 将失败记录标记 rolled back 后重新部署，三份迁移全部成功：
   - `20260713_phase1_customer_role`
   - `20260713_phase1_historical_dispatch_quarantine`
   - `20260713_phase1_workspace_plans`
5. `prisma migrate status`：`Database schema is up to date!`

## 数据核验

| 检查 | 结果 |
| --- | ---: |
| AdminUser | 9 |
| Workspace | 9 |
| owner 重复/缺失 | 0 |
| CUSTOMER | 7 |
| 保留 SUPER_ADMIN | 2 |
| plan 映射错误 | 0 |
| 未知客户 persona 角色 | 0 |
| 隔离栏审计列 | 6 / 6 |
| starter 权益 | 30/月，10 并发，digitalHuman=false |
| studio 权益 | 200/月，10 并发，digitalHuman=false |

`scripts/verify-phase1-rehearsal.ts` 使用非 owner 运行角色读取上述结果，全部检查 `passed=true`。

## 应用层核验

- 统一 `/app/create`、`/app/batches`、`/app/racing`、`/app/library`、`/app/templates` 均使用演练分支真实数据成功渲染。
- 浏览器 console error：0。
- 390px 五页 `documentElement.scrollWidth <= viewport content width`；移动媒体网格溢出问题已修复并增加回归测试。
- 1440/390 截图见 `docs/evidence/phase-1/design/`。

## 凭据处置

Neon 子分支继承 owner 密码。首次 CLI 输出使旧 owner 凭据进入任务日志后，已按无停机顺序完成处置：

1. 生产创建独立运行角色 `aivora_app_prod_20260713`；
2. 更新 Vercel `DATABASE_URL`；
3. 仅重新部署线上既有 commit `431704d`，未部署本地脏工作区；
4. `https://reelforge-delta.vercel.app/api/health` 返回 `database=connected`；
5. 生产与演练分支旧 owner 密码均已失效；新 owner 密码分别生成并仅保存于本地 secret 环境。

## 生产执行结果

2026-07-13 获得人工继续总攻授权后，使用本地 secret 中的 production owner 连接执行同三份迁移；`prisma migrate status` 返回 `Database schema is up to date!`。随后用非 owner 运行角色执行只读核验：9 个用户对应 9 个唯一默认 Workspace，7 个 CUSTOMER、2 个保留 SUPER_ADMIN，plan/role 映射错误均为 0，隔离栏 6/6 列存在，starter/studio 权益与演练分支一致，`passed=true`。

生产应用运行时仍使用非 owner 的 `DATABASE_URL`；owner 连接未写入仓库、报告或日志。
