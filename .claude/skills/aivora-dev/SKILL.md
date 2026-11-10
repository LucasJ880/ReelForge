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
- 新界面走「Aivora Exchange 深海交易所」方向：冷蓝近黑 + 只来自数据的信号色、`QuoteHeader` / `StatusTick` /
  `FillBar`（`src/components/exchange/`）、圆角 3/6/10、数字 tabular-nums、不做毛玻璃。规矩见根目录 `DESIGN.md`。

## 三、交付门：先验证，再说完成

按改动面挑，**贴命令输出**，不要用「应该没问题」代替证据：

| 改了什么 | 至少要跑 |
|---|---|
| 任何 TS | `npm run typecheck` + `npm run lint` |
| service / 契约 | `npm test`（或指定相关 `tests/*.test.ts`） |
| 前端交互 | 相关 test + preview 里实际点一遍（read_console_messages 查报错） |
| 端到端 | `npm run acceptance:mock`（typecheck + phase4 + i18n + walkthrough） |
| 视觉 | `npm run test:visual`；基线变了才 `test:visual:update` |

`npm test` = `node --import tsx --test tests/*.test.ts`，约 360 个测试文件、一分钟内跑完，跑单个用
`node --import tsx --test tests/<file>.test.ts`。**要 Node 22+**（`pretest` 会核对）：Node 20 下有 5 条假失败，
本机默认是 20 时用 `PATH=/opt/homebrew/bin:$PATH npm test`。加 `--test-reporter=tap` 便于 grep `^not ok`。

## 四、已知陷阱

| 现象 | 真因 | 处理 |
|---|---|---|
| 整页 500、bundle 里出现 OpenAI | client 组件取了服务端 service 的值 | 值挪到 server component 或 API 传下去 |
| 线上图片 404 | `public/brand/` 被 gitignore | 资产走 blob，禁用 `/brand/*` 静态 URL |
| 批次永久卡 QUEUED | 供应商 502「积分已退回」被误判为不可重试 | 已修，勿回退；查 shuyu 路由的退款判定 |
| 供应商能力漂移 | Shuyu 套餐 ID 轮换 / 参数下线，health 查不出来 | 真机跑一次小样，别信 health |
| 刷新后任务状态丢失 | 前端未挂 rehydrate | 走已有的恢复入口，单帧失败不判全死 |
| 生产上传全挂 | 内容审核开着但 OpenAI key 无 moderation 权限 | 生产已关审核；恢复前先确认 key 权限 |
| 生产上传「上传失败 (413)」，本地正常 | 文件穿过 Vercel 函数，请求体超 4.5MB 被平台直接拦（`FUNCTION_PAYLOAD_TOO_LARGE`，handler 没被调用）；本地 dev 无此上限 | 前端一律 `uploadBlobWithProgress` 直传 Blob（ticket → PUT → complete）；`upload-direct-to-storage` 守门测试拦回退 |
| 原生 `<select>` 展开白底看不到字 | 选项面板由浏览器画，select 透明 + 字色继承浅色 | globals.css 已给 `option` 钉 `--popover` 底色；截图拍不到这个面板，别指望视觉基线 |
| 每次发版所有人被登出 | 设计如此：会话绑定发布版本（`src/lib/session-policy.ts`，另有 12h 闲置 / 7 天绝对上限） | 要停掉按发版登出，让 next.config 的 `AIVORA_SESSION_RELEASE` 取固定值，别删闸 |
| PR 显示 MERGED，代码却不在 main | 叠着开的 PR（base 是另一个 PR 的分支）：前一个先合并后，后一个被合进了已经用完的分支（11-09 的 #34） | 每个 PR 都直接对 `main` 开；有依赖就等前一个合并再开，或推到同一个 PR。合并后用 `git merge-base --is-ancestor <提交> origin/main` 核对 |
| `db:migrate:deploy` 说「没有待执行的迁移」，但 PR 明明带了迁移 | 迁移文件在 PR 的分支上，本地是 `main` | 切到 PR 分支再跑；**先迁移、后合并**。`/api/health` 的 `schema` 字段与发布后冒烟会拦住「代码比库新」 |
| Vercel 上加了环境变量却不生效 | 环境变量只在部署那一刻读入 | 加完要重新部署；用「变量创建时间 vs 最新生产部署时间」判断是否已生效 |
| 新加的模型调用上线后更慢 / 只成功一部分 | 没经真机验证就缺省打开（11-09 的合并看图调用：线上首跑只用上三样里的一样、59 秒） | 新的模型调用一律缺省关 + 环境变量开；先用 `npm run eval:shot-cards` 这类只调模型的量测看合格率与耗时，再用真机小实验看成片 |
| 连续快速合并后冒出一条红色 prod-smoke | 部署成功事件乱序，较新版本的冒烟被较旧版本的取消 | 11-10 已修（`judgeSupersession`：被顶替时改测线上这一版）；看到红灯先读日志里它等的是哪个版本 |
| 测试「在 main 上本来就红」 | 多半是本机 Node 版本低于 22 造成的假失败 | 换 Node 22+ 重跑再下结论，别把假失败记成基线 |
| 商家说「功能没生效」（例：勾了片尾落款重拼后没看到） | 先别怀疑合成逻辑：11-10 那次重拼 22 秒就成功了，是详情页重拼后不刷新、一直放旧成片 | 先查库里这条记录的状态与快照，再从产物里抽帧看；确认是页面问题再改页面 |
| 走查时页面「一直停在正在加载…」 | 有 `loading.tsx` 的页面，读取工具（页面文本 / `main.innerText`）会读到残留的加载占位，页面其实已经渲染好 | 以截图为准；本地 dev 首次打开一页要等 15–20 秒才完成加载脚本 |
| 本地手敲 ffmpeg 烧不了字幕 | 本机 homebrew 的 ffmpeg 没带 libass；合成管线用的是 `node_modules/ffmpeg-static` | 验证合成效果要调管线函数（`composeTimeline`）拿现成成片重新合成，不出新片、不碰库 |
| 合并后线上版本没变 / 中间那次提交查不到生产部署 | 连续合并时 Vercel 只构建最新的提交，中间的被跳过 | 正常；看 `/api/health` 的 `release` 是否等于最新合并提交，别盯着中间那次 |
| 改了客户页面后 `personal-customer-strings` 测试红 | 客户页面的字面量（包括 `data-testid`）不许出现 stitch 等内部词 | 换个说法（如 `reassembling-notice`） |
| 改了合成 / 品牌组件后一批旧测试红 | 有些旧测试断言的是代码原文：`postProduction,` 在 stitch-composer 里恰好出现 3 次、deliveryOrder 的 select 原样、品牌组件禁用 `bg-white`（用 `bg-(--brand-tile)`） | 先读失败断言再决定改代码还是改断言；别为了过测试绕开它守的东西 |
| 带迁移的 PR 合并后功能报错 | 表 / 列还没建就部署了 | 新功能优先用**独立新表、不加外键**（表没建时只有这个功能不可用，如 `VideoFeedback`）；给既有表加列的 PR 必须先迁移再合并 |

## 五、任务纪律

- **每一轮任务都必须可取消**：取消要清幂等键、保留素材。只给「重试」不算做完。
- **demo 账号不跑付费生成。**
- 清理旧代码顺序 **A 下线入口 → B 冻结代码 → C 删代码**，不跳级；删除 PR 单独提，
  不与功能改动混在一起。
- 多步任务先写计划再动手（superpowers 的 `writing-plans` / `executing-plans`），
  独立子任务可并行派发。
