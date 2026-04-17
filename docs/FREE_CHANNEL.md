# Free 通道架构

Free 通道是 Aivora 的"零成本视频合成管线"，灵感来自 [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)。
它完全不调用付费 AI 视频 API，只借助免费素材 + 免费 TTS + 浏览器端 ffmpeg.wasm。

## 流程总览

```
┌─────────────────────────────────────┐
│  /api/projects/:id/free-prepare     │
│  （服务端）                         │
├─────────────────────────────────────┤
│  1. 若无 contentPlan 先调 OpenAI    │
│  2. 切句                             │
│  3. 并行对每句：                     │
│       a. Edge TTS → mp3 → Blob       │
│       b. Pexels 搜关键词（或用       │
│          用户上传的 userVideoAssets  │
│          循环替代）                  │
│  4. 生成 SRT                         │
│  5. 写入 VideoJob.manifest           │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  FreeChannelPanel 组件              │
│  （浏览器）                         │
├─────────────────────────────────────┤
│  useEffect 自动触发                  │
│  free-channel-composer.ts:          │
│    - 加载 @ffmpeg/core@0.12.10       │
│    - 对每个 clip：                    │
│        ffmpeg -stream_loop -1        │
│          -i <pexels.mp4>             │
│          -i <tts.mp3>                │
│          -t <durationMs/1000>        │
│          -vf scale=1080:1920,crop    │
│          -c:v libx264 -c:a aac       │
│          clip<i>.mp4                 │
│    - concat list.txt                 │
│    - -c copy → output.mp4            │
│  得到 Blob (mp4)                     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  @vercel/blob/client.upload()       │
│  → POST /api/upload/video-token     │
│  拿到临时 token，浏览器直传到 Blob   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  /api/projects/:id/free-finalize    │
│  更新 VideoJob.videoUrl、状态置     │
│  VIDEO_READY                        │
└─────────────────────────────────────┘
```

## 为什么合成放在浏览器？

1. **Vercel Serverless 有 60s / 1GB 内存上限**，ffmpeg 跑多分镜拼接大概率超时或 OOM。
2. **CPU 成本转嫁给用户**，平台成本为零。
3. **可在任一设备上跑**，不需要维护后台渲染 worker。

## 关键模块

| 文件 | 作用 |
|---|---|
| `src/lib/voices.ts` | 音色目录（纯数据，客户端/服务端共享） |
| `src/lib/providers/edge-tts.ts` | 服务端：调用 msedge-tts 合成 mp3 |
| `src/lib/providers/pexels.ts` | 服务端：Pexels 搜索 + mock 样片 |
| `src/lib/utils/srt.ts` | 切句 + SRT 构造 |
| `src/lib/services/free-channel-service.ts` | 编排 TTS + Pexels → manifest |
| `src/lib/free-channel-composer.ts` | 浏览器端：ffmpeg.wasm 拼接逻辑 |
| `src/components/project/free-channel-panel.tsx` | 驱动客户端合成 + 上传 |
| `src/components/project/free-channel-options.tsx` | 音色 + 语速选择 UI |
| `src/components/project/user-assets-manager.tsx` | 用户自带素材池管理 |

## Mock 模式

设置 `VIDEO_ENGINE_MOCK=true`：

- `edge-tts.synthesizeSpeech` 返回 ~300ms 静音 mp3
- `pexels.searchPexelsVideos` 走内置的 3 条 Pexels 公开样片

这样能在没有 `PEXELS_API_KEY` 且不想真的 WS 连 Edge Speech 的前提下跑通完整流程，非常适合 Vercel Preview 环境的烟雾测试。

## 已知边界

- 目前**不烧字幕**到视频里（字幕栅格化需要字体文件，会让 wasm 包变大）。SRT 文本保留在 manifest 里，后续可做外挂字幕或客户端 Canvas 叠加。
- 字幕语种与音色挂钩：`voiceId` 前缀决定估算时长的方式（CJK vs 拉丁）。
- 所有 clip 被统一到 1080x1920 / 30fps / H.264 / AAC 才能走 `-c copy` 极速拼接；换规格需要走 reencode 降级分支。
- 浏览器刷新/关闭页面会中断合成。
