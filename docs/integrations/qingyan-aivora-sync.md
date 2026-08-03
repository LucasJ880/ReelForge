# Aivora → 青砚 成片同步接入说明(aivora-sync)

> 面向:青砚工程侧 · 版本 2026-08-04 · 对应 Aivora PRD §9(契约已冻结)
> 有问题直接找 Lucas;本文档不含任何凭据。

## 1. 一句话概述

青砚**定时拉取**、Aivora 不推送。接口只读,返回**已完成品牌封装**的成片元数据 + 视频直链;
视频文件不需要经青砚存储,登记元数据与 URL 即可。预期量级约 **200 条/天**。

## 2. 环境与鉴权

| 项 | 值 |
|---|---|
| Base URL | `https://reelforge-delta.vercel.app` |
| 接口 | `GET /api/videos` |
| 鉴权 | HTTP 头 `Authorization: Bearer <token>` |
| Token | 由 Lucas 通过安全渠道单独提供,**不随本文档传播** |

- Token 请存入你们的密钥管理,不要写进代码仓库或日志。疑似泄露立即联系 Lucas 轮换。
- 鉴权失败返回 `401 {"error":"unauthorized"}`;接口为纯机器鉴权,无会话回退。

## 3. 请求参数(Query)

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `status` | string | 否 | 目前仅支持 `completed`(默认)。中间态不暴露 |
| `limit` | int | 否 | 每页条数,1–200,默认 100 |
| `since` | ISO 8601 时间串 | 否 | **增量游标**:只返回该时刻之后完成的成片 |

## 4. 响应结构

```jsonc
{
  "videos": [
    {
      "id": "cmr…",                  // 幂等键,跨轮次稳定,永不复用 → 存入你们 externalId
      "video_url": "https://….public.blob.vercel-storage.com/….mp4",
      "title": "…",
      "cover_url": "https://…" ,      // 可空
      "duration": 15,                 // 实际秒数;拿不到为 null(不会用目标时长冒充)
      "topic": "…",                   // 可空
      "language": "zh",               // 可空
      "completed_at": "2026-08-03T17:28:00.000Z",

      // —— 创意配方维度(全部可空,见 §5 null 语义)——
      "recipe_id": "…",
      "hook_type": "POV",             // 枚举:POV | Curiosity | Stat | Reveal | Pain | Demo
      "template_id": "…",
      "aspect_ratio": "9:16",
      "brand_placement": "corner_badge" // 枚举:natural | planar_track | corner_badge
    }
  ],
  "meta": {
    "count": 37,                      // 本页条数
    "skipped_unbranded": 2,           // 已完成但尚未品牌封装、暂不可交付的条数(见 §6)
    "next_since": "2026-08-03T17:28:00.000Z"  // 下一轮 since 用这个;无数据时为 null
  }
}
```

## 5. 数据语义(数据分析侧务必注意)

1. **`id` 是幂等键**:与你们 `VideoAsset` 的 `@@unique([source, externalId])` 对齐,
   `source` 固定填 `aivora`。同一 `id` 重复拉到就是同一条成片,直接 upsert。
2. **配方字段的 `null` 表示"未知",不是"没有配方"**:2026-07-31 加列之前的历史成片
   配方字段一律为 null。做配方维度统计(赛马)时必须把 null 排除,**不要**归进默认桶。
3. `duration` 为空同理:是拿不到实际时长,不是 0。
4. 只返回**已品牌封装**(带 logo/尾卡)的可交付成片;裸片不出现在本接口。
5. 客户已要求下架(takedown)与平台演示样片账号的内容**永远不会**出现在响应里。

## 6. 增量拉取协议(推荐实现)

```bash
# 首次全量(或补拉)
curl -H "Authorization: Bearer $AIVORA_TOKEN" \
  "https://reelforge-delta.vercel.app/api/videos?limit=200"

# 之后每轮:用上一轮 meta.next_since 作为 since
curl -H "Authorization: Bearer $AIVORA_TOKEN" \
  "https://reelforge-delta.vercel.app/api/videos?limit=200&since=2026-08-03T17%3A28%3A00.000Z"
```

- 建议轮询间隔 **10–15 分钟**(量级 200 条/天,更密没有意义)。
- `next_since` 为 null(本轮无数据)时,下轮沿用上一次的 since。
- 单轮拉满 `limit` 条时,立即用新的 `next_since` 再拉一轮直到不满页,再回到定时节奏。
- **监控建议**:`skipped_unbranded` 持续偏高 ≠ 没有产出,而是 Aivora 封装管线在掉队,
  可以把它作为一个观测指标报警给我们。

## 7. 视频文件

- `video_url` / `cover_url` 是公开直链(Vercel Blob),下载无需鉴权,可直接入分析管线。
- 链接语义为"不公开列出、持链可读",请只在你们系统内部使用,勿对外二次分发。

## 8. 错误与重试

| 状态码 | 含义 | 处理 |
|---|---|---|
| 400 | query 非法(响应含 `details` 字段级错误) | 修参数,不重试 |
| 401 | token 缺失/错误 | 检查配置,不自动重试 |
| 503 | 服务端配置缺失 | 指数退避重试 + 通知 Lucas |
| 5xx/超时 | 偶发 | 指数退避重试(下一轮 since 不变,幂等安全) |

接口幂等只读,任何重试都不会产生副作用。

## 9. 验收清单(联调当天过一遍)

- [ ] 带 token 首拉返回 200,`videos[].id` 全部成功 upsert
- [ ] 用 `next_since` 增量拉,第二轮不重复入库(幂等验证)
- [ ] 故意错 token 得到 401,监控有告警
- [ ] `hook_type` / `brand_placement` 入库枚举与本文档 §4 一致
- [ ] 配方字段 null 的成片被排除在配方维度报表之外
