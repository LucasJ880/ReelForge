# 发布前核对清单

按照 commit 1 → commit 7 的顺序做完后，在合到 production 前逐条核对：

## 1. 本地烟雾测试（mock）

```bash
# 在 .env.local 里打开 mock
VIDEO_ENGINE_MOCK=true

npm run dev
```

- [ ] 登陆 admin 账号，进 `/projects/new` 能创建项目。
- [ ] 点"一键生成 · Pro" → 状态进入 VIDEO_GENERATING → ~15s 后自动变 VIDEO_READY（mock 返回占位 mp4）。
- [ ] 点"免费生成 · Free"：
  - [ ] DRAFT 下能看到音色下拉（22 条，按语言分组）与语速滑杆。
  - [ ] 可上传一段自己的 mp4 到素材池，网格显示、可删除。
  - [ ] 点击后页面自动进入"浏览器合成中"，进度条推进到 100%。
  - [ ] 出现可播放视频与"下载 mp4"按钮。
- [ ] `/projects` 列表：
  - [ ] 多选 + 批量删除正常，Blob 被清理（观察 Vercel Blob console）。
  - [ ] "清理过期项目"弹窗显示预估数量，确认后批量删。
  - [ ] 下载按钮在卡片 + 列表视图都能触发文件下载。
- [ ] `/dashboard` 只显示新统计（项目数 / 已出片 / 已完成），无 Publication / Analytics 相关字样。
- [ ] `/settings` 无 TikTok 绑定入口，有 Blob 状态说明。
- [ ] Landing / Login / Register / Privacy / Terms 全部是新配色（深灰 + 青绿 accent），无 purple/pink 残留。

## 2. TypeScript + Build

```bash
npx tsc --noEmit
npx next build
```

- [ ] 两个命令都以退出码 0 结束。
- [ ] Build 输出里包含以下路由：
  - `/api/projects/[id]/auto-generate`
  - `/api/projects/[id]/free-prepare`
  - `/api/projects/[id]/free-finalize`
  - `/api/projects/[id]/user-assets`
  - `/api/projects/bulk-delete`
  - `/api/upload/video-token`

## 3. Vercel Preview 测试（真实环境）

推到 main 后 Vercel 会自动出 Preview URL。

- [ ] Preview 上 `VIDEO_ENGINE_MOCK=true`，跑一次 Free + Pro 流程。
- [ ] 浏览器端 ffmpeg 下载 `@ffmpeg/core@0.12.10/ffmpeg-core.wasm`（~25MB）不会卡（首次 Cold Load）。
- [ ] 合成完的 mp4 能通过 `/api/upload/video-token` 直传到 Blob，URL 可公开访问。
- [ ] `/api/projects/:id/free-finalize` 成功写回 videoUrl，页面刷新后仍能看到视频。
- [ ] 用非 admin 账号访问 `/projects/new` 等页面会 403 / 隐藏创作入口。

## 4. 切到 Pro 真实模式

在 Vercel Dashboard 把 `VIDEO_ENGINE_MOCK` 去掉或设为 `false`：

- [ ] 新建一个 15s 的 Pro 项目，确认调 Seedance 返回真实 mp4。
- [ ] Blob 永久化（`persistRemoteVideo`）成功，链接不过期。
- [ ] 过期素材迁移按钮 `/repersist` 对老项目可用。

## 5. 数据库健康检查

```bash
npx prisma db push --skip-generate
```

- [ ] 无 migration warning；所有 legacy 字段已经干净（TikTok/Publication/TrendReference 表消失）。
- [ ] Neon 控制台查看：
  - Project 行无 status 为 PUBLISHING/PUBLISHED/ANALYTICS_* 的记录。
  - VideoJob.channel 默认值 "pro"，Free 项目已正确写入 "free" + manifest。

## 6. 回滚预案

- 保留上一次 production 的 Vercel deploy URL，随时 Promote 回去。
- Neon 提供 7 天 PITR（Point-in-time Recovery），schema 变更可在 DB 端回滚。
- Blob 删除是软删除？请查阅 Vercel 文档确认，或先用 Preview 验证 del 行为。

## 7. 发布

- Vercel `Promote to Production` 按钮一键上线。
- 在 Settings 页更新版本号或 copy（可选）。
