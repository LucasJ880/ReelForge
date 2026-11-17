# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

小商家（电商 / 本地实体店）的老板或唯一运营者。典型画像：SunnyShutter（窗帘/遮阳帘店）
的店主，没有专职内容团队，白天看店、晚上在笔记本上补内容。他们的工作是：把产品图
变成能投放的短视频广告，批量出片、持续补量。

## Product Purpose

Aivora 是小商家的内容获客与增长操作系统：从产品资产（商品图 / 品牌规范）出发，
AI 批量生成短视频广告，管理成品库与询盘，替代整支内容团队。
成功 = 客户每周稳定拿到可投放的成片。

## Positioning

不是「一键生成一条视频」的玩具，而是围绕批量（batch）、成品库（library）、
品牌一致性（brands）组织的持续生产线。邻品（MoneyPrinterTurbo 等）
只有单条生成，没有批量运营闭环。

## Operating Context

- 客户自助面 `/app`：create（创作）→ batches（批次监控）→ library（成品库）→
  products / brands / templates / leads（询盘）。plan（本周内容）、wins（战绩）、racing（投放赛马）、
  create/images（产品图工作台）四页 2026-11-16 已删除（代码与接口都不在了，表还在）。
- 旧代运营中台 `(internal)` 已全部删除；商单面 `(business)`、个人面 `(personal)` 早已不在。
- 其余面：公开首页与法务页 `(public)`、登录注册 `(auth)`、行情大屏 `/wall`、询盘页 `/l/[slug]`。
- 真实供应商链路：Shuyu（出图、出片，Seedance）/ OpenAI（出方案）/ Vercel Blob / Neon。
  Runway、实拍图库与配音、链接抓取、抠图、成片画面质检、Stripe、国内版部署 2026-11-16 已删除。
  生成任务长时运行、可失败、必须可取消。

## Capabilities and Constraints

- Next.js 16 App Router + Tailwind v4；视觉唯一来源 `src/styles/tokens.css`，
  组件与页面不得声明颜色、圆角或阴影字面量。
- 每一轮任务必须可取消；失败不能只给「重试」。demo 账号不跑付费生成。
- `'use client'` 文件不得引用服务端 service 模块级值（client-bundle-safety 回归测试）。
- 中英双语（i18n），中文为主。数字信息密集（积分、批次进度、时长、比分）。
- 真实客户资产走 Vercel Blob，禁止 `/brand/*` 静态 URL。

## Brand Commitments

- 名称 Aivora；品牌标记是一枚「上涨 tick」▲ 刻成的字母 A（信号青 `#22e0ff`）。
- 深色为主的交易大厅气质：冷蓝近黑的场 + 只来自数据与媒体的颜色（信号青 / 成交绿 / 赢家金 / 失败玫红 / AI 鸢尾紫）。
- 2026-10-24 用户决策（约束性，取代 2026-08-02 的毛玻璃决策）：旧版「黑 + 品牌橙 + 毛玻璃」
  风格整体退役，不留任何痕迹；新视觉是「增长交易所 + 行情大屏」（Aivora Exchange），
  追求科技感与高级感，大胆换色。旧数据保留，旧风格不保留。

## Evidence on Hand

- 真实客户 SunnyShutter 的成片样片已在成品库开放（LIBRARY_SHOWCASE）。
- PRD v3.3：`docs/roadmap/2026-07-29-ecommerce-workflow-prd.md`。

## Product Principles

1. 生产线优先：界面服务「批量出片—监控—复用」的循环，不做单次炫技。
2. 状态诚实：长任务的进行/失败/取消/恢复必须一眼可读，数字一律等宽。
3. 颜色只来自数据：信号青给实时与当前项，赢家金给赢家与需要行动的数字，玫红只给失败。
4. 双语等价：中英文案同权重排版，不为英文优化而牺牲中文可读性。
5. 可逆与可取消：任何界面动作都有退路，破坏性操作有确认。

## Accessibility & Inclusion

深色界面需维持 WCAG AA 文本对比；信号青等亮色上一律用深色前景 `--primary-foreground`。
`prefers-reduced-motion` 全站生效（现有实现已覆盖，重构不得回退）。
