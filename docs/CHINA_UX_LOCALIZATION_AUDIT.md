# Aivora · 中国大陆 UX 与本土化审计

> 本文档审计当前 UI/copy 在中国大陆 demo 场景下的可用性。
> 本阶段不做完整 i18n 改造，只做最小化建议 + 必修清单。

## 0. 现状速读

- ✅ i18n 框架已就位（`src/i18n/`），中英双字典完整
- ✅ 默认语言 `zh-CN`（`NEXT_PUBLIC_DEFAULT_LOCALE=zh-CN`）
- ✅ 大部分核心流程（上传素材、生成视频、查看状态、下载视频）已中文化
- ⚠️ 仍有少量"OpenAI / Stripe / render / Vercel"字样裸露在 UI / 错误信息
- ⚠️ Billing 页面在中国大陆模式下应隐藏入口（避免暴露 Stripe / USD）

## 1. 关键流程中文化完成度

| 流程 | zh-CN 覆盖 | 残留英文/海外术语 |
|---|---|---|
| 登录 / 注册 | ✅ 完整 | 无 |
| 上传素材 | ✅ 完整 | 错误信息含"BLOB_READ_WRITE_TOKEN"（开发者错误，普通用户看到也无伤） |
| 创意输入（unified-input） | ✅ 完整 | 无 |
| 生成视频（点击生成、查看状态） | ✅ 大体完整 | 个别地方写"render"应改为"生成/渲染" |
| 视频预览 / 下载 | ✅ 完整 | 无 |
| 任务失败提示 | ⚠️ 部分 | `Seedance` / `OpenAI` 字样可能透出 |
| Billing / 订阅 | ❌ 仍英文海外术语 | "Pro plan"、"$X / month"、"Stripe" |
| 内部后台 | ⚠️ 中英混杂 | 内部页面优先级低，dev 友好即可 |
| Demo 页面 | ✅ 完整 | 无 |
| 个人 / 商业 sidebar | ✅ 完整 | 无 |

## 2. 海外术语 vs 中文替换建议

| 当前术语 | 推荐替换 | 说明 |
|---|---|---|
| render | 渲染 / 生成 | "Render" 在中国 SaaS 里 99% 用户不懂；"生成"更直观 |
| credits | 额度 / 配额 | 借 SaaS 习惯，"额度"在中国语境最自然 |
| workspace | 工作区 / 项目 | 业务上下文里可直接说"项目" |
| pro plan | 专业版 | |
| upgrade | 升级到专业版 | |
| usage | 用量 | |
| quota | 配额 | |
| brief | 任务 / 创意 | brief 是广告术语，C 端不熟；B 端可保留 |
| storyboard | 分镜 | "分镜"是国产剧/广告制作通用词 |
| segment | 片段 / 镜头 | |
| pipeline | 流水线 / 流程 | |

## 3. 用户可见的海外品牌词

需要在大陆模式下隐藏 / 替换：

| 位置 | 当前 | Phase 1 建议 |
|---|---|---|
| `zh-CN.ts:213` "已生成新脚本（来自 OpenAI）" | 提及 OpenAI | 改为"已生成新脚本"（不显示 provider） |
| `zh-CN.ts:232` "已生成 {count} 个镜头（来自 OpenAI）" | 提及 OpenAI | 改为"已生成 {count} 个镜头"或"由 AI 生成" |
| `src/lib/services/stripe-billing-service.ts:23` 错误"Stripe 未配置" | 用户可能看到 | 改为"在线开通暂未启用，请联系商务" |
| `src/app/api/upload/blob/route.ts:25` 错误"BLOB_READ_WRITE_TOKEN 未配置" | 用户可能看到 | 改为"素材上传暂不可用，请联系运营" |
| billing 页面 plan 名 / 价格 | "Pro / $X" | 大陆模式下整页隐藏入口 |

## 4. 时区 / 日期 / 货币

| 项 | 当前 | 中国大陆建议 |
|---|---|---|
| 时区 | 浏览器本地 | 服务端日志强制 Asia/Shanghai；UI `Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai" })` |
| 日期格式 | ISO 8601 / 浏览器默认 | `2026/05/28 18:30`（YYYY/MM/DD HH:mm）或"2 小时前" |
| 货币 | USD（仅 billing） | demo 阶段不展示价格；商业化展示 ¥（CNY） |
| 数字格式 | 1,000.50 | 中文环境本地化（千分位仍可用 `toLocaleString("zh-CN")`）|

实现建议：
- 全局加一个 `src/lib/utils/format.ts` 封装时间/数字/货币
- 现有 `Date.toLocaleString()` 调用排查替换

## 5. 是否需要中英文切换

- **建议保留**。现有 `LanguageSwitcher` 组件可用，sidebar 底部已经有。
- B 端客户可能有外籍员工 / 跨境业务；保留英文切换是低成本福利。
- 中国大陆 demo 默认 zh-CN，但不要禁用 en-US。

## 6. Phase 1 中文化最小改造清单（推荐尽快做）

按优先级排序：

### P0（demo 前必修）
- [ ] 删除 `zh-CN.ts:213, 232` 中"（来自 OpenAI）" 字样
- [ ] 大陆模式下隐藏 Billing 入口（sidebar item + 路由级 redirect 或 banner）
- [ ] `stripe-billing-service.ts` 错误信息改成中性「在线开通暂未启用」
- [ ] `upload/blob/route.ts` 错误信息脱敏（不要让用户看到环境变量名）

### P1（公开测试前修）
- [ ] 所有 `render` 字样替换为"生成"或"渲染"
- [ ] AI 生成内容上加水印 / 角标（合规要求 + UX 透明）
- [ ] Footer 加 ICP 备案号占位 + 隐私政策 / 用户协议链接
- [ ] 全站日期格式统一 Asia/Shanghai

### P2（商业化前可选）
- [ ] 配置 zh-CN 优先级（移到字典首位）
- [ ] 内部页面 i18n 覆盖完整
- [ ] 用户输入框默认中文输入法兼容（IME composition events 处理）

## 7. 不建议改动

- 路由命名（`/business/products`、`/personal/videos`、`/internal/qa`）— 程序员友好即可，用户看不到
- DB 字段名 / API 路径 — 改动成本高、收益低
- 代码注释 / 错误日志 — 已经混杂中英文，保持现状

## 8. 不影响 demo 但要记录

- `compliance-note.tsx` 已存在但仅 demo 页面使用 — 公开测试时需要扩展到全局
- `business-order-title-service.ts` 可能针对海外行业生成标题；中国大陆 demo 时检查行业列表（`industry-defaults.ts`）是否合适
- `industry-defaults.ts` 列表来自海外视角；中国大陆典型 demo 客户行业（家居、教育、餐饮、母婴）可能需要补充本地化预设
