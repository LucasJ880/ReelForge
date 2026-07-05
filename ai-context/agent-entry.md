# Agent Entry — ai-context

> 自动生成于 2026-07-05T03:54:05.594Z。AI agent 在做任何代码任务前，必须先读这份文档。
> 不要先扫整个 repo，不要先读大文件，不要重复读取 `public/generated` 或构建产物。

## 项目快照

- 包名：`aivora` (v0.2.0)
- 顶层目录：.cursor, .github, docs, prisma, public, scripts, showcase-static, src, tests
- 主要技术栈：Next.js (16.2.2), React (19.2.4), Prisma ORM (^6.19.3), Vercel Blob (^2.3.3), NextAuth.js (^4.24.13), OpenAI SDK (^6.33.0), Tailwind CSS (^4), Framer Motion (^12.38.0), Zod schemas (^3.25.76), bcryptjs (^3.0.3), Apify TikTok scraper (^2.23.0)
- 已索引源文件：573
- 路由：37 个 page，55 个 API endpoint

## ai-context 文件清单

| 文件 | 用途 | 何时读 |
|------|------|--------|
| `ai-context/repo-map.json` | 顶层结构 / 技术栈 / 区域统计 | 任务开始前必读 |
| `ai-context/file-summary-map.json` | 每个源文件的 type / area / 导出 / notes | 找定位 / 找对应文件 |
| `ai-context/route-map.json` | Next.js 路由 + API endpoint | 改路由 / 加 API / 调试 404 |
| `ai-context/dependency-map.json` | 文件之间的 import 关系 | 想知道"动这个文件会影响谁" |
| `ai-context/area-map.json` | 按功能域归类的文件清单 | 大功能改造前先扫 |
| `ai-context/agent-entry.md` | 你正在读的这份 | 永远第一个读 |

## 常见任务的入口

- **video generation 调试** → 先看 `area-map.json` 中 `video-generation` 与 `ai-providers`，再 `grep` 具体 service 名。
- **demo 页面 / real-footage-ads** → 先看 `area-map.json` 中 `demo` 与 `real-footage-ads`。
- **FFmpeg / 拼接 / 音频** → 先看 `area-map.json` 中 `ffmpeg` 与 `media-processing`。
- **数据库 schema 改动** → `prisma/schema.prisma`（改前先读 `docs/` 中相关 spec）。
- **路由 / API endpoint 检查** → 直接查 `route-map.json`，不要扫 src/app。
- **不知道改什么** → `npm run context:find -- "关键词1 关键词2"`，会基于路径/notes/exports 给你 top 10 文件。

## Agent Token Budget Rules

> 这套规则是硬性要求。Cursor / Claude / Opus 在本项目里都按这套走。

1. **永远先读 `ai-context/agent-entry.md`**（也就是这份文档）。
2. **改代码前先跑 / 看 `context-router`**：`npm run context:find -- "你的任务关键词"`。
3. **优先读精确的文件 + 行号区间**，不要整文件吞。
4. **永远不读以下路径**：
   - `node_modules/`、`.next/`、`.git/`、`.vercel/`
   - `public/generated/`（视频/图片成品，纯二进制 + 大）
   - `tmp/`、`logs/`、`coverage/`、`dist/`、`build/`
   - 任何 `.mp4 / .mov / .webm / .jpg / .png / .gif / .pdf / .zip` 等媒体文件
   - 任何 `.env*`（除了 `.env.example`，但**绝对不要把 example 的 key 放进 prompt**）
   - `package-lock.json`（特大且对任务无价值）
5. **不重读未变更的大文件**：如果你这一轮已经读过 `prisma/schema.prisma` 或某个长 service，跨调用前提（除非用户说改）不要再 fetch 一次。
6. **依赖关系先用 `dependency-map.json`**，不要用 `grep` 暴搜整个 repo。
7. **只有当窄上下文不足以解决问题时**，才升级到全文件读取，并尽量在一次读完。
8. 任何对 `scripts/` 与 `ai-context/` 之外文件的修改，按"改业务代码"对待——需要明确的任务说明。
9. 该 codemap 是静态生成的快照。如果 repo 结构有大幅变动（新增大目录 / 重构模块）请重新 `npm run codemap:build`。

## 紧急刹车

- 如果你发现自己即将读 `public/generated/`、`tmp/`、`.next/` 任何东西——**停下**，回到 `area-map.json` 重新定位。
- 如果你发现自己反复 `grep` 整个 repo——**停下**，跑 `npm run context:find` 替代。
- 如果你需要跨多个文件理解一个流程——先读 `dependency-map.json`，再按图谱顺序最小化读取。
