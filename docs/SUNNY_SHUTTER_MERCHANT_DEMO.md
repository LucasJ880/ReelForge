# Sunny Shutter 商家演示（Mock）

虚构电商 **Sunny Shutter** 用 Aivora 批量制作窗帘 TikTok 广告，录入流量后获得「该押哪条产品线」的智能建议。

## 一键种子数据

```bash
npm run sunny:merchant-journey
```

## 历史订单标题中文化（可选）

若产品库仍显示英文 prompt 标题（如 `hydration sports drink...`）：

```bash
npm run backfill:business-titles -- --dry-run
npm run backfill:business-titles
# 仅某账号：npm run backfill:business-titles -- --email=mock-full-20260520@aivora.test
```

会创建商家账号、生成 2 条 30s 竖屏窗帘广告（mock 引擎）、写入模拟 TikTok 播放量/完播率，并在终端打印 **智能建议** 与浏览器路径。

| 字段 | 值 |
|------|-----|
| 邮箱 | `sunny-shutter@aivora.test` |
| 密码 | `testpass123` |

## 浏览器验收

```bash
npm run dev:mock
```

用上述账号登录 B 端，侧栏语言选 **中文**，按顺序浏览：

1. **产品库** — 两条窗帘广告，状态「已完成」
2. **集成** — 可查看/补录 TikTok 数据
3. **表现数据** — 播放量、完播率对比（遮光帘完播更高）
4. **智能建议** — 应出现「复制高完播开场」类建议，指向创意工作室做变体
5. **创意工作室** — 「基于最新成片做变体」、`?from=` 预填

## 与投资人 Demo 的区别

- `npm run demo:sunny-investor:v21`：真实 Seedance / 出图管线，面向 `/personal/videos` 展示片。
- `npm run sunny:merchant-journey`：**B 端商家面板**全流程 mock，突出产品库 → 流量 → AI 建议闭环。
