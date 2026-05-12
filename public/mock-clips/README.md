# Mock Clips（Phase 2 / B2B 占位 MP4）

`mock-clip-generator` 在以下场景使用本目录的静态占位：

- 当 `VIDEO_ENGINE_MOCK=true` 但本机 **没有 ffmpeg** 时回落到这里
- 不要把这些当成产品资产；它们仅用于让本地多段拼接流程能跑通

文件命名约定（小写 + `x`）：

- `9x16.mp4` — 720×1280 / 2s
- `16x9.mp4` — 1280×720 / 2s
- `1x1.mp4`  — 720×720 / 2s

如果你升级了 ffmpeg / drawtext 已可用，可以重新生成更带文本标签的版本：

```bash
npm run mock-clips:rebuild   # 见 scripts/build-mock-clip-fallbacks.ts（待补）
```

绝不依赖 `sample-videos.com` / Big Buck Bunny / 任何远程 sample URL。
