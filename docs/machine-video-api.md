# 机器视频任务接口

给 Grok Bot 或其他外部自动化使用。只做两件事：保存一条待确认的视频任务，以及按任务号查询进度。创建任务**不会开拍**，也不会扣视频额度。

故事板出图、人工确认、视频派发、轮询、失败重试和品牌封装都沿用创作台现有流程。本接口不提供确认、派发或重试。

## 配置

在运行环境增加下面两个变量，**不要**把 `CRON_SECRET` 填进来。两者相同，或令牌短于 16 位、或账号未填时，接口返回 503，且响应里不出现变量名。

| 变量 | 作用 |
|---|---|
| `MACHINE_VIDEO_API_TOKEN` | 机器凭证。只放在 `Authorization: Bearer` 里 |
| `MACHINE_VIDEO_API_USER_ID` | 这把凭证唯一能操作的账号 id |

请求体里不能指定别的账号。查不到的任务一律 404，包括别人的任务。

改完配置后需要自行执行迁移 `20261108120000_machine_video_task`（本变更不部署、不改生产配置）。视频进度仍然依赖现有的 `/api/cron/poll-videos`。

## 创建任务

`POST /api/machine/video-tasks`

```http
POST /api/machine/video-tasks
Authorization: Bearer <MACHINE_VIDEO_API_TOKEN>
Idempotency-Key: bot-2026-11-08-001
Content-Type: application/json

{
  "prompt": "三十秒内讲清这款窗帘怎么一键遮光，开头先给刺眼阳光。",
  "voiceoverScript": "早上阳光太刺眼。按一下，窗帘自己合上。",
  "durationSec": 15,
  "aspectRatio": "9:16",
  "assetIds": []
}
```

`durationSec` 只接受 `15`、`30`、`60`。`aspectRatio` 默认 `9:16`。`assetIds` 必须是该账号自己的图片。

成功时 `201`，同一键重放时 `200`，`replayed: true`，`taskId` 不变。

```json
{
  "ok": true,
  "taskId": "cm...",
  "briefId": null,
  "status": "awaiting_confirmation",
  "stage": "needs_storyboard",
  "started": false,
  "deliverableUrl": null,
  "failure": null,
  "confirmationPath": "/app/create?machineTask=cm...",
  "replayed": false
}
```

`started: false` 表示还没有视频任务。`briefId` 要等用户在创作台确认故事板并点击生成之后才会出现。

把 `confirmationPath` 拼到站点域名上交给用户。页面会带上文案。用户需要：

1. 生成故事板（这一步才会调用出图供应商，沿用现有故事板逻辑）。
2. 在故事板面板确认。未确认不会派发视频。
3. 点击生成视频。这一步才是开拍，并走现有额度、幂等和供应商派发。

查询接口不会替用户做这三步。

## 查询

`GET /api/machine/video-tasks/{taskId}`

同一套 Bearer。只读数据库，不向供应商对账，所以进度最多滞后一个现有轮询周期。

`status` 只有这些值：

| status | 含义 |
|---|---|
| `awaiting_confirmation` | 还没开拍。`stage` 会区分还没故事板、故事板生成中、等确认、故事板失败、故事板已确认但还没点生成 |
| `queued` / `running` | 视频已派发，在排队或生成 |
| `failed` | 视频失败，或供应商是否接单无法确认 |
| `processing_output` | 片段可能已经生成，但还没到可交付成片。未拼接完、未做品牌封装，都不给 URL |
| `deliverable` | 可以交付。`deliverableUrl` 只在这时出现，并且是品牌封装后的地址 |
| `cancelled` | 故事板或视频已取消，或成片已下架 |

故事板图片生成成功不是成品。响应里没有供应商任务号、原始报错或密钥。

`failure.retryable: false` 且 `failure.code` 为 `SUBMISSION_ACK_UNKNOWN` 时，表示供应商可能已经接单。不要用同一个或新的请求盲重试，否则可能重复扣费。这种状态要人工核对。

## 幂等

`Idempotency-Key` 必填，1–200 字符，按绑定账号隔离。

- 同一账号、同一键、同一文案和参数：返回原来的 `taskId`，不会再建一条。
- 同一键但文案、时长、画幅、口播或素材不同：`409 IDEMPOTENCY_CONFLICT`。
- 并发提交由数据库唯一约束收口，后到的请求回读胜出的那一条。

创建本身不扣款。重复创建不会重复出图或出视频。用户后来在创作台的派发仍使用原来的派发幂等，`ACK_UNKNOWN` 的保护也不变。

## 错误码

失败体为 `{ ok: false, code, error, retryable, action }`。

| HTTP | code | 何时 |
|---|---|---|
| 401 | `AUTH_REQUIRED` | 没带凭证或凭证不对。`CRON_SECRET` 也不能用 |
| 503 | `SERVICE_UNAVAILABLE` | 机器凭证未配置，或和 `CRON_SECRET` 配成了同一个值 |
| 400 | `VALIDATION_FAILED` | 文案或参数不合法 |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | 缺少提交标识 |
| 403 | `FORBIDDEN` | 绑定账号不存在、已停用，或是演示账号 |
| 404 | `RESOURCE_NOT_FOUND` | 任务或素材不存在，或属于别的账号 |
| 409 | `IDEMPOTENCY_CONFLICT` | 提交标识已被另一份参数占用 |
| 500 | `INTERNAL_ERROR` | 未预期的失败。响应不包含内部原因 |

## Grok Bot 接入还缺什么

- 部署这份代码，并在目标库执行上述迁移。本仓库的这次改动没有做这两步。
- 配置 `MACHINE_VIDEO_API_TOKEN` 和 `MACHINE_VIDEO_API_USER_ID`。Bot 要保存站点根地址才能拼 `confirmationPath`。
- Bot 没有确认和开拍能力。用户必须登录创作台完成故事板确认和生成。
- 没有回调。Bot 自己轮询查询接口。
- `deliverableUrl` 还依赖现有品牌封装。封装没完成时状态停在 `processing_output`。
- 开拍当刻如果额度不足，创作台会按原逻辑拒绝。创建任务时看不出来。
- 不包含抖音发布、审核状态或作品指标。
