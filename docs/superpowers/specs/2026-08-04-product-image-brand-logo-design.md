# 产品图工作台 · 印上品牌 Logo（路径 B：产品照没印 logo，AI 印上去）

日期：2026-08-04 · 状态：CEO 已拍板（Plan B），一个工作段
关联：PRD §5 B1/B2/B3（品牌植入分档）；本设计是 B2「自然植入」在**产品照本身没有 logo**
场景下的入口。与 PRD §5 的路径 A/B（保护已印 logo 不被重画）互补，不冲突。

## 1. 问题

商家的产品实物没有印 logo（或实拍图上看不到 logo），带货视频里产品与品牌就是脱节的。
底层能力其实已经齐备：

- 生成线路 Shuyu「Image 2」= gpt-image-2，`input_images` 最多收 5 张 HTTPS 参考图
  （`src/lib/providers/shuyu.ts` `createShuyuImageTask`），当前只传了 1 张源图。
- 品牌包 `WorkspaceBrandPackage.logoAsset` 已存官方 logo（MediaAsset，Blob URL）。

唯一缺口是工作台没有「印上品牌 Logo」的入口——**纯接线**。

## 2. 方案取舍

| 方案 | 说明 | 判断 |
|---|---|---|
| **B-1（选定）** 品牌包 logo 作第二参考图，随产品图任务一次合成 | `input_images: [产品图, logo]` + 印制指令 | 一次生成、零新管线，走现有 durable 任务/取消/重试/计费 |
| B-2 后处理贴图（RGBA 叠加 + 光影匹配） | 类似 PRD 路径 B 贴回 | 需要新的合成/光影管线，超出「小接线」承诺 |
| B-3 OpenAI 直连 `composeReferenceImage` 新开管线 | images.edit 多参考 | 绕开现有产品图任务持久化/取消/积分体系，重复造轮子 |

选 B-1：改动最小、复用全部既有约束（可取消、幂等、快照重放、审计计费）。
Logo 保真校验 Gate（PRD B5/M5）不在本段范围——先人工看，Gate 落地后自动复检。

## 3. 契约与数据

### 3.1 API（POST /api/product-images）

请求体新增可选字段：

```ts
brandPackageId?: string   // 品牌包 id；表示「把该品牌包的 logo 印到产品上」
```

规则（服务端强制）：

- `brandPackageId` 需通过 `findWorkspaceBrandPackageForUser`（涵盖 workspace 自有与
  global 只读包）；找不到 → 404 `RESOURCE_NOT_FOUND`。
- 印 logo 必须有产品源图：无 `sourceAssetId` 时 → 400 `BRAND_LOGO_REQUIRES_SOURCE`
  （文案：「印品牌 Logo 需要先上传产品图。」）。GENERATE 模式不做印制（YAGNI）。
- 响应/详情 job 视图新增 `brandLogo: { packageId, url } | null`。

### 3.2 Prisma（纯加法，nullable）

`ProductImageJob` 新增三列快照（与 `sourceImageUrl` 同语义：**不可变的已计费请求输入**，
资产日后被删也要能按原样重放确认重试）：

```prisma
brandPackageId   String?   // 来源品牌包（溯源）
brandLogoAssetId String?   // 提交时的 logo MediaAsset id（溯源，不建 FK，快照语义）
brandLogoUrl     String?   // 提交给供应商的 logo URL（重放用）
```

迁移 `20260804*_product_image_brand_logo`：三条 `ADD COLUMN IF NOT EXISTS`，不动任何行。

### 3.3 Service（product-image-service）

- `ProductImageRequest` 增 `brandLogo?: { packageId, assetId, url }`。
- `createProductImageJob` 持久化三列快照。
- `submitProductImageProviderTask`（含确认重试重放路径）：
  `inputImages = [sourceImageUrl, brandLogoUrl].filter(Boolean)`——顺序即 prompt 里的
  「参考图 1 / 参考图 2」。重放一律从 job 列快照取，不看关联资产现值。
- `buildProductImagePrompt` 增 `hasBrandLogo`，在 `hasReference && hasBrandLogo` 时追加
  印制指令块（见 §4）。`PRODUCT_IMAGE_PROMPT_VERSION` 升为 `product-image-shuyu-v3`。

### 3.4 UI（ProductImageStudio）

- 页面（server component）用 `listWorkspaceBrandPackagesForUser` 预载品牌包精简列表
  `{ id, name, brandName, logoUrl }`，作 prop 传入（不新开读接口）。
- 上传区下方新增「印上品牌 Logo」开关行：
  - 开启后显示 logo 缩略图 + 品牌名；多个品牌包时给下拉（默认选 `isDefault` 的
    workspace 包，其次第一个 workspace 包，最后 global 包）。
  - 未上传产品图时开关禁用，提示「需要先上传产品图」。
  - 一个品牌包都没有 → 显示去 `/app/brands` 上传 logo 的链接。
- 提交体带 `brandPackageId`；文案 zh/en 都进 `platform-copy.ts`。

## 4. 印制 Prompt 块（追加在 reference 块之后）

要点（英文提示词，与现有风格一致）：

1. 声明参考图角色：图 1 = 产品照（产品身份唯一事实来源），图 2 = 官方品牌 logo 资产。
2. 印制要求:把图 2 的 logo 以「出厂印制」效果印到产品最自然的品牌位（包装正面 /
   标签区 / 织物边缘等，按产品类型自选）。
3. 保真硬约束：字形、拼写、配色、比例与图 2 完全一致；禁止重设计/重排/翻译/风格化。
4. 物理贴合：logo 跟随表面透视、曲率、材质纹理与场景光照；不是贴纸悬浮感。
5. 原有「不得添加 invented logos」约束在带 logo 时改述为「除所给品牌 logo 外
   不得添加任何其它标识/文字」。

## 5. 测试与验收

- `tests/shuyu-product-image-service.test.ts`：
  - 带 brandLogo 创建 → `submitTask` 收到 `[source, logo]` 两张、顺序正确；
  - job 三列快照落库；确认重试重放同一 logo URL；
  - prompt 含印制块（且无 logo 时不含）。
- `tests/product-image-ui-contract.test.ts`：路由三例——happy path / 无源图 400 /
  包不存在 404；job 视图含 `brandLogo`。
- 交付门：`npm run typecheck` + `npm run lint` + 相关 test 全绿，贴输出。
- **真机验收（CEO 标准）**：SunnyShutter 窗帘实拍图 + SunnyShutter 品牌包 logo →
  印 logo 产品图 → 进单条视频全流程 → 一条完整带货视频。判据：全部语音字幕齐且对齐、
  产品上有 logo 且不脱节；尾卡本轮不管。

## 6. 不做（本段）

- Logo 保真自动校验 Gate（PRD B5，M5 落地后接上）。
- GENERATE（无源图）模式印 logo。
- 平面跟踪视频内贴合（B2 第二档）。
- 位置/大小手动控制——先信模型的「自然品牌位」，不够再加。
