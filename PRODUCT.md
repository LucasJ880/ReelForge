# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

小商家（电商 / 本地实体店）的老板或唯一运营者。典型画像：SunnyShutter（窗帘/遮阳帘店）
的店主，没有专职内容团队，白天看店、晚上在笔记本上补内容。他们的工作是：把产品图或
商品链接变成能投放的短视频广告，批量出片、挑出能赢的素材、持续补量。

## Product Purpose

Aivora 是小商家的内容获客与增长操作系统：从产品资产（图/链接/品牌规范）出发，
AI 批量生成短视频广告与产品图，管理素材库与投放赢家，替代整支内容团队。
成功 = 客户每周稳定拿到可投放的成片，且能从数据里认出该加投的赢家。

## Positioning

不是「一键生成一条视频」的玩具，而是围绕批量（batch）、赛马（racing/择优）、
成品库（library）、品牌一致性（brands）组织的持续生产线。邻品（MoneyPrinterTurbo 等）
只有单条生成，没有批量运营闭环。

## Operating Context

- 客户自助面 `/app`：plan（内容计划）→ create（生成向导）→ batches（批次监控）→
  library（成品库）→ wins（赢家）→ brands / templates。
- 旧代运营中台 `(internal)` 19 页，PRD §10 A 级下线中，只减不加。
- 商单面 `(business)`、个人面 `(personal)`、公开落地页 `(public)`、登录 `(auth)`。
- 真实供应商链路：Shuyu / Seedance / OpenAI / Vercel Blob / Neon。生成任务长时运行、
  可失败、必须可取消。

## Capabilities and Constraints

- Next.js 16 App Router + Tailwind v4；视觉唯一来源 `src/styles/tokens.css`，
  组件与页面不得声明颜色、圆角或阴影字面量。
- 每一轮任务必须可取消；失败不能只给「重试」。demo 账号不跑付费生成。
- `'use client'` 文件不得引用服务端 service 模块级值（client-bundle-safety 回归测试）。
- 中英双语（i18n），中文为主。数字信息密集（积分、批次进度、时长、比分）。
- 真实客户资产走 Vercel Blob，禁止 `/brand/*` 静态 URL。

## Brand Commitments

- 名称 Aivora；唯一强调色 `#ff4d00`（品牌橙），克制使用。
- 深色为主的专业工作台气质。
- 2026-08-02 用户决策（约束性）：全站视觉世界替换为**毛玻璃（glassmorphism）**，
  追求高级感；**放弃**旧剪辑台方向的胶片/场记板装置（时间线轨道、齿孔封边、
  场记板镜号），改用纯玻璃语言。旧 PRD §11 硬规矩（圆角 0、无阴影）同步作废，
  文档随本轮更新。

## Evidence on Hand

- 真实客户 SunnyShutter 的成片样片已在成品库开放（LIBRARY_SHOWCASE）。
- PRD v3.3：`docs/roadmap/2026-07-29-ecommerce-workflow-prd.md`。
- 旧设计稿（已被本轮取代）：`designs/aivora-os/Aivora OS v2.html`。

## Product Principles

1. 生产线优先：界面服务「批量出片—监控—择优—复用」的循环，不做单次炫技。
2. 状态诚实：长任务的进行/失败/取消/恢复必须一眼可读，数字一律等宽。
3. 品牌克制：橙色只给品牌标记、当前项、需要行动的数字。
4. 双语等价：中英文案同权重排版，不为英文优化而牺牲中文可读性。
5. 可逆与可取消：任何界面动作都有退路，破坏性操作有确认。

## Accessibility & Inclusion

深色界面需维持 WCAG AA 文本对比；`#ff4d00` 上不用白字（3.32:1），用深色前景。
`prefers-reduced-motion` 全站生效（现有实现已覆盖，重构不得回退）。
