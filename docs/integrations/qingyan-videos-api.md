# 青砚对接：Aivora 成片接口

> 面向青砚（AI 工作助理）`aivora-sync` 定时任务。对应 PRD v3.3 §9 / 里程碑 M0。
> 状态：**我方已实现并验证**，等青砚侧接。

## 分工

| 谁 | 负责 |
|---|---|
| **青砚** | Postiz 发布、矩阵账号、排期、人工审核、渠道指标灌数 |
| **Aivora** | 内容生产、创意配方、产品锚定与 logo 保真 |

方向是**青砚定时拉，Aivora 不推**。视频文件不经过青砚存储，只登记元数据 + URL。
预期量级约 200 条/天。

## 接口

```
GET {AIVORA_API_URL}/api/videos?status=completed&limit=100
Authorization: Bearer {CRON_SECRET}
```

`CRON_SECRET` 与我方 `/api/cron/*`、`/api/internal/*` 用的是同一个机器凭据，找我方要。

| 参数 | 说明 |
|---|---|
| `status` | 目前只支持 `completed`。中间态对发布没有意义，不暴露 |
| `limit` | 默认 100，上限 200 |
| `since` | ISO 时间戳。只返回该时刻之后完成的成片，用于增量拉取 |

鉴权是 fail-closed 的：凭据缺失或错误一律 401，服务端未配置密钥时返回 503，
**不存在任何降级为公开访问的路径**。

## 响应

```json
{
  "videos": [
    {
      "id": "batch-cmrut3qfc000zlibxbvmts3o8",
      "video_url": "https://....vercel-storage.com/renders/final-videos/....mp4",
      "title": "SunnyShutter 遮光帘 · 夜间隐私暖光 #2",
      "cover_url": null,
      "duration": 15,
      "topic": "SunnyShutter 遮光帘",
      "language": null,
      "completed_at": "2026-07-21T16:03:00.440Z",

      "recipe_id": "tpl:sunnyshutter-commerce-cta-night-privacy@2",
      "hook_type": null,
      "template_id": "sunnyshutter-commerce-cta-night-privacy@2",
      "aspect_ratio": "9:16",
      "brand_placement": null
    }
  ],
  "meta": {
    "count": 1,
    "skipped_unbranded": 90,
    "next_since": "2026-07-21T16:03:00.440Z"
  }
}
```

命名统一 snake_case —— 你们 `mapAivoraItem` 的占位里读的就是 `cover_url`，保持一致。

### `id` 可以直接当幂等键

跨轮次稳定，绝不复用给另一条成片，正好对上 `VideoAsset.@@unique([source, externalId])`。
前缀区分来源：`brief-` 是单条创作，`batch-` 是批量生产。

### `video_url` 一定是已品牌封装的成片

我方只暴露带 logo 与尾卡的成片。未封装的裸片**不会**出现在这个接口里——
挂在客户账号上的东西不能没有品牌封装。

因此 `meta.skipped_unbranded` 很重要：它是「已完成但尚未封装」的条数。
**拉到 0 条时先看这个值**——大于 0 说明是我方封装管线掉队，不是没有产出。

## 创意配方字段（PRD §9.4，本次对接的重点）

这几个字段是我方独有的，请落进 `VideoAsset.metadataJson`。

| 字段 | 含义 |
|---|---|
| `recipe_id` | 创意配方身份，**赛马的分组键**。如 `tpl:<模板 slug>@<版本>` |
| `template_id` | 风格模板 + 版本 |
| `hook_type` | 钩子类型：`POV` / `Curiosity` / `Stat` / `Reveal` / `Pain` / `Demo` |
| `aspect_ratio` | 画幅 |
| `brand_placement` | 植入档位：`natural` / `planar_track` / `corner_badge` |

**全部可空，`null` 表示「未知」，不是「没有配方」。** 2026-07-31 之前生成的历史成片一律为 null，
做配方维度统计时必须**排除**它们，而不是归到某个默认桶里。

为什么要带这几个字段：你们的 `PublishJob` 上已有 `hookText`/`titleText`/`ctaText`，
但那是变体引擎产出的**文案**。「帖子 ↔ 创意配方」这一维两边都没有，而它正是
配方维度赛马的地基。没有它，赛马只能回答「这条表现如何」，回答不了「哪种结构在赢」。

`hook_type` 目前在批量线路为 null（模板线路没有钩子标注），单条创作线路的配方
正在改成生成时的显式选择，届时会填上。字段先留好，不用等。

## 你们侧要改的

按占位注释，只有两处：

1. `fetchAivoraVideos` 里的 endpoint 换成上面的地址
2. `mapAivoraItem` 的字段映射按上表接上，配方字段进 `metadataJson`

`VideoAsset.source` 的 `aivora` 枚举、`externalId` 幂等键、`/api/cron/aivora-sync`
定时任务你们都已经有了，不需要动。

## 反向接口：把渠道指标回灌给我们

```
POST {AIVORA_API_URL}/api/performance
Authorization: Bearer {CRON_SECRET}

{
  "samples": [
    {
      "subjectType": "post" | "video",
      "subjectId": "batch-cmr...",        // 可带 batch-/brief- 前缀，我方会归一化
      "platform": "instagram",
      "externalPostId": "...",            // 可空
      "windowHours": 48,                  // 必填，不设默认值
      "observedAt": "2026-08-01T00:00:00Z",
      "impressions": 1200, "views": null,
      "likes": 60, "comments": 8, "shares": 0, "saves": 5,
      "clicks": null, "conversions": null
    }
  ]
}
→ { "accepted": 1, "unmatched": 0, "withoutRecipe": 0 }
```

方向与 `/videos` 相反：指标在你们手里（你们持有平台 OAuth），我们拉不到，所以由你们推。
一次最多 500 条。

**三件需要注意的：**

1. **`recipeId` 不要传，传了也会被忽略。** 配方是我方生成时确定的事实，
   我们从自己的 subject 上读。允许外部覆盖等于给赛马开一个能被写脏的口子。
2. **`windowHours` 必填。** 同一条内容在不同窗口各存一行、互不覆盖 ——
   12h 下结论和 48h 下结论是两回事。同窗口重复回灌会覆盖数值（指标会被平台修正）。
3. **回执里的 `unmatched` 要看。** 持续大于 0 说明两边 id 对不齐，
   要查而不是忽略；`withoutRecipe` 大于 0 只是说明那些是历史内容，数据会留着但不进配方统计。

分母（`impressions` / `views`）两个都可以为空 —— 各平台口径不同，**我们不做换算**，缺就是缺。

## 我方已验证

- 无凭据 / 错误凭据 → 401；正确凭据 → 200 并返回真实成片
- 中间件按精确路径放行，`/api/videos/*` 子路由不会被顺带放开
- takedown 的成片与样片账号内容一律不出现在结果里
- 契约有回归测试守着（`tests/videos-api-contract.test.ts`）

**尚未验证**：端到端真机发布（依赖你们的 Phase C 生产迁移与真实社媒发布）。
在那之前双方都不对外承诺发布能力。
