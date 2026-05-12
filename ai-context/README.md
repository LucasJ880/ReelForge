# ai-context — Aivora 项目 codemap

这是一份**自动生成的项目地图**，专门给 AI agent（Cursor / Claude / Opus 等）使用。
它的唯一目标：在 AI 写代码 / 审代码前，先读这份地图、再决定读哪些精确文件，从而**显著降低 token 消耗**。

> ⚠ 这套机制**不修改任何业务代码**，不改 Prisma schema，不改 demo 页面，不动 Vercel/Blob/Neon 配置。它只产出元数据。

---

## 一、这个 codemap 是干什么的？

它把整个 repo 静态扫描一次，提炼出一些 AI 友好的**摘要 JSON**：

| 文件 | 内容 | 适合回答的问题 |
|------|------|----------------|
| `agent-entry.md` | AI 阅读的入口指南 + token 预算规则 | 第一份永远要读的文档 |
| `repo-map.json` | 顶层目录、技术栈、文件类型/区域统计 | 项目整体长什么样？ |
| `file-summary-map.json` | 每个源文件的 type / area / 导入导出 / notes | 我要的逻辑可能在哪个文件？ |
| `route-map.json` | Next.js 路由 + API endpoint + HTTP 方法 | `/api/xxx` 在哪里实现？ |
| `dependency-map.json` | 文件之间的 import 关系（local / external） | 改这个文件会牵连谁？ |
| `area-map.json` | 按功能域归类的文件清单 | demo / video-generation / ffmpeg 都涉及哪些文件？ |

所有内容都**完全静态**——没有 LLM、没有外部网络、不读 secrets。

---

## 二、怎么生成？

```bash
npm run codemap:build
```

执行 `scripts/build-codemap.ts`，毫秒级完成。产物写在 `ai-context/`，不会触碰其他任何目录。

---

## 三、怎么用来减少 token？

### 方式 1：Cursor / Claude / Opus 自动读取

在 prompt 里加一行：

> 「在做任何代码任务前，先读 `ai-context/agent-entry.md`，然后按里面规则定位文件。」

`agent-entry.md` 会自动告诉 agent：先用 area-map 找区域，再用 dependency-map 找上下文，再读精确文件。

### 方式 2：开发者 / agent 主动用 context-router

```bash
npm run context:find -- "你的任务关键词"
```

例如：

```bash
npm run context:find -- "real footage ad demo video generation"
npm run context:find -- "ffmpeg stitching audio loudness"
npm run context:find -- "Prisma demo leads"
npm run context:find -- "Vercel Blob generated video URL"
npm run context:find -- "Sunny Shutter commercial prompt"
```

输出包含：

- 命中的 area
- 相关路由（如果有）
- top 10 相关文件 + score + 为什么相关 + 警告
- 建议阅读顺序（先 schema/provider/service，再 api/page/component）

可选参数：

| flag | 含义 |
|------|------|
| `--top=20` | 改变返回条数（默认 10） |
| `--area=demo` | 只在某个 area 里搜（参考 area-map.json） |
| `--json` | 以 JSON 输出（给程序解析） |

---

## 四、Cursor / Claude / Opus 使用规则（**Agent Token Budget Rules**）

> 这套规则是**硬性要求**。AI agent 在本项目里都要遵守。

1. **永远先读 `ai-context/agent-entry.md`**，再做任何事。
2. **改代码前先跑 / 看 `context-router`**：`npm run context:find -- "你的任务关键词"`。
3. **优先读精确文件 + 行号区间**，不要一股脑整文件 fetch。
4. **永远不读以下路径**：
   - `node_modules/`、`.next/`、`.git/`、`.vercel/`、`.turbo/`
   - `public/generated/`（视频/图片成品，纯二进制 + 大）
   - `tmp/`、`logs/`、`coverage/`、`dist/`、`build/`
   - 任何 `.mp4 / .mov / .webm / .jpg / .png / .gif / .pdf / .zip / .woff*` 等媒体/字体文件
   - 任何 `.env*`（**绝对不要**把任何 env 内容放进 prompt）
   - `package-lock.json`（特大且对任务无价值）
   - `*.tsbuildinfo`
5. **不重读未变更的大文件**：如果你这一轮已经读过 `prisma/schema.prisma` 或某个长 service，跨调用别再 fetch 一次。
6. **依赖关系先用 `dependency-map.json`**，不要一上来就 grep 整个 repo。
7. **只有当窄上下文不够时**，才升级到全文件读取，并尽量在一次读完。
8. 任何对 `scripts/` 与 `ai-context/` 之外文件的修改，按"改业务代码"对待——需要明确的任务说明。

### 哪些文件**永远不要**放进 prompt

- `.env`、`.env.local`、`.env.production.local` —— 含数据库连接字符串、API key、blob token
- `public/generated/*` —— 二进制视频 / 图片 / 海报
- `tmp/*` —— ffmpeg 中间产物、QA 截图、本地 build log
- `node_modules/*` —— 没有任何理由要读
- `.next/*`、`.vercel/*` —— 构建/部署产物
- `package-lock.json` —— 几百 KB 的锁文件，没有任务级价值
- `*.tsbuildinfo` —— TS 增量构建缓存

---

## 五、什么时候需要重建 codemap？

下面任一情况发生时，跑 `npm run codemap:build`：

- 新增/删除大量文件（路由、组件、service）
- 重构了某个目录的结构
- 改了 `package.json` 的 dependencies（影响 stack hints）
- 把某个 area 的文件挪到了别处
- 长时间没生成（codemap 顶部的 `generatedAt` 超过 2 周）

> 重建非常便宜（几十毫秒），可以放心反复跑。

---

## 六、安全保证

`scripts/build-codemap.ts` 在**任何情况下**都：

- ❌ 不读 `.env*`（除了 `.env.example`，且把内容置空再处理）
- ❌ 不读任何二进制 / 媒体 / 字体文件
- ❌ 不读 `public/generated/`、`tmp/`、`node_modules/`、`.next/`
- ❌ 不发起任何外部请求
- ❌ 不调用 LLM
- ❌ 不写任何 secret 内容到输出
- ✅ 输出文件只放在 `ai-context/`

如果需要进一步收紧策略，看 `scripts/build-codemap.ts` 里的 `EXCLUDED_DIRS`、`EXCLUDED_SUBPATHS`、`MEDIA_EXTENSIONS`、`isSecretFile`。

---

## 七、Phase 2 后续建议（不在本轮做）

- 给每个文件**抽出 5-15 行的"signature 摘要"**（不是全文），让 agent 不用读源码也知道函数签名
- 对**真的有必要看源码**的文件，按 `range-map.json` 的方式提供"按 symbol 的行号区间"
- 在 CI 里跑 `npm run codemap:build` 校验，结果发到 PR 评论
- 加一个 `npm run context:diff -- <commit-range>` 子命令，把变更影响面预算化
- 探索 LLM 辅助 summary：用一次小模型 pass 给每个文件生成 1-2 句中文 notes，缓存到 `ai-context/llm-notes.json`
- 把 codemap 嵌进 Cursor `.cursorrules` / `.cursor/rules/` 让规则永久生效
