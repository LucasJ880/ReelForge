# Aivora · 中国大陆登录与支付本土化规划

> 本文档不实现任何新登录或支付方式，只规划路径和优先级。
> Phase 1（本次迁移）继续使用现有邮箱密码登录；支付完全关闭。

## 1. 当前登录方式

**已实现**：邮箱 + 密码（`src/lib/auth.ts` + NextAuth Credentials Provider）。

- 流程：注册 → 邮箱密码 → bcryptjs 哈希 → DB 校验
- 没有第三方 OAuth（无 Google / GitHub）
- 没有手机号 / 短信验证码
- 没有微信 / 企业微信

## 2. 哪些登录方式**不适合**中国大陆用户

| 方式 | 问题 |
|---|---|
| Google OAuth | 大陆不可访问 |
| GitHub OAuth | 大陆访问不稳定 |
| Magic Link 邮箱 | 国内邮件送达率低（QQ / 163 / 企业邮 反垃圾严） |
| 仅邮箱密码 | C 端用户体验差；B 端勉强可用 |
| Twitter / Facebook | 大陆封禁 |

## 3. 推荐登录路径

### Phase 1（本阶段 · 现状）— 邮箱密码

- 目标用户：内部团队 + 已签约客户 + 投资人 demo
- 实现：✅ 已就位
- 操作流程：
  - 管理员从 `/internal/settings` 创建账号
  - 把账号密码私下发给客户
  - 客户登录 `/login`
- 风险：客户可能不熟悉「邮箱+密码」流程，需要客服带训

### Phase 2（公开测试 · 3-6 个月内）— 手机号 + 短信验证码

- 目标用户：开放注册 / 自助试用
- 推荐 SMS 服务商：
  - 火山引擎 SMS（与其他基础设施同账号；推荐）
  - 阿里云 SMS（成本最低，~3 分/条）
  - 腾讯云 SMS
- 技术方案：
  - NextAuth Credentials provider 加一个 phone+code 流程
  - 后端实现 `/api/auth/sms/send` + `/api/auth/sms/verify`
  - 复用现有 `AdminUser` 表，加 `phoneNumber` 字段 + `phoneVerified` 时间戳
  - 限流：60s/手机号、20 次/小时/IP（防刷）
- 合规：注册时同时要求**实名认证**（PII 收集）— 见 `CHINA_COMPLIANCE_READINESS.md`
- 开关：env `SMS_LOGIN_ENABLED=true` + `SMS_PROVIDER=volcengine|aliyun` + 凭证

### Phase 3（成熟期 · 6-12 个月）— 微信 / 企业微信 / SSO

- **微信登录**（C 端）
  - 微信开放平台「网站应用」资质需要公司认证 + 300 RMB
  - OAuth 2.0 流程：扫码 → code → access_token → openid
  - 风险：审核严格（需要应用截图、隐私政策、ICP 备案号）
- **企业微信 / 飞书 / 钉钉 SSO**（B 端）
  - 大客户更喜欢 SSO
  - 实现：OIDC 协议（NextAuth 已支持 OIDC provider）
- **企业 SAML 2.0**（大企业）
  - 仅在客户明确要求时做
  - 可考虑用 `next-auth` `@auth/saml-jackson` 适配

---

## 4. 当前支付方式

**已实现**：Stripe 订阅（`src/lib/services/stripe-billing-service.ts` + `/api/webhooks/stripe`）。

- 已有 `subscriptionTier` (free/pro)、`stripeCustomerId`、`stripeSubscriptionId`（`AdminUser` 表）
- 已有 billing 页面（`(business)/business/billing` + `(personal)/personal/billing`）
- Stripe 在中国大陆不能直接收单（公司主体必须海外）

## 5. 哪些支付方式**不适合**中国大陆用户

| 方式 | 问题 |
|---|---|
| Stripe | 大陆收款需要海外公司主体；境内用户 Visa/Master 数字不全 |
| PayPal | 同上，且大陆个人 PayPal 体验差 |
| 信用卡国际通道 | 大陆 70% 用户没有外币卡 |

## 6. Phase 1（本阶段）— 不做支付

- `PAYMENT_ENABLED=false` 默认值（`src/lib/config/env.ts`）
- Billing 页面行为：
  - 当前 `stripe-billing-service.ts` 在 `STRIPE_SECRET_KEY` 缺失时返回 `{ error: "Stripe 未配置..." }`
  - Phase 1 应该在 UI 层进一步隐藏入口（避免 demo 时被客户看到 "Stripe" 字样）
  - **待办**（建议尽快）：billing 页面顶部根据 `chinaComplianceMode` 显示「企业客户请联系商务开通额度」
- 替代方案：管理员手动开通 → 内部 `/internal/settings/admins` 给客户账号设置 `subscriptionTier=pro`

## 7. Phase 2（试点期 · 商业化前）— 企业对公 + 人工开票

- 目标客户：B 端，按月签约
- 流程：
  - 商务签合同 → 客户对公转账（按月 / 按年）→ 内部财务对账 → 管理员手动开通账号
  - 月度对账：导出 `UsageLog` + `VideoJob` 报表
- 系统支持：
  - 内部后台加「客户企业」表（关联 AdminUser → CustomerOrg）
  - 配额管理：当前 `UserUsagePeriod` 已就位，给"对公开通"账号设置高配额
- 不接入第三方支付通道，不开放自助续费

## 8. Phase 3（成熟期 · 12 个月+）— 微信支付 / 支付宝 / 发票系统

### 8.1 个人 C 端（如果开放）
- 微信支付（H5 / Native / JSAPI）
  - 申请：微信支付商户号（需要营业执照 + 对公账户 + 一定开户费）
  - 周期：1-2 周
- 支付宝（PC 网站支付 / 手机网站支付）
  - 申请：支付宝商户中心
- 集成：
  - 推荐 [pingpp](https://www.pingxx.com/) / [Yeepay](https://www.yeepay.com/) 这类聚合支付（一次接入支持多渠道）
  - 不自己写微信/支付宝签名（容易出 bug 且要维护证书）
- 状态自动回写：用 webhook → 替换现有 stripe webhook 逻辑

### 8.2 企业版
- 充值 / 额度 / 账单 中心：
  - 充值：对公转账或微信/支付宝充值企业账户
  - 额度：按月扣减 + 余额提醒
  - 账单：每月自动出账单 PDF，财务确认后开发票
- 发票系统：
  - 推荐对接「金蝶 / 用友 / 诺诺网 / 百望」开票服务
  - 增值税专票（专票）：需要客户公司纳税人识别号 + 开户行 + 地址电话
  - 普票（电子发票）：发邮箱即可

---

## 9. 数据库变更预览

Phase 2+ 可能需要的 Prisma schema 变更（仅参考，本阶段不改）：

```prisma
model AdminUser {
  phoneNumber   String?   @unique
  phoneVerified DateTime?

  // 微信
  wechatOpenId  String?   @unique
  wechatUnionId String?

  // 企业关联
  customerOrgId String?
}

model CustomerOrg {
  id              String   @id @default(cuid())
  name            String
  industry        String?
  taxId           String?
  contactEmail    String
  contractStartAt DateTime
  contractEndAt   DateTime?
  monthlyQuota    Int      @default(0)
}
```

---

## 10. 本阶段开关一览

| Env | 默认值 | 说明 |
|---|---|---|
| `SMS_LOGIN_ENABLED` | false | Phase 2 改 true |
| `SMS_PROVIDER` | 空 | Phase 2 填 volcengine/aliyun |
| `PAYMENT_ENABLED` | false（cn）/ true（global） | 中国 demo 强制 false；商业化打开 |
| `STRIPE_SECRET_KEY` | 空（cn） | 海外环境保留；国内绝不配置 |
| `WECHAT_PAY_MCH_ID` | （Phase 3）| 未来微信支付 |
| `ALIPAY_APP_ID` | （Phase 3）| 未来支付宝 |

---

## 11. 风险与提示

- **不要**在 Phase 1 / 2 让海外 Stripe key 进入中国部署。否则即便没有 UI 入口，密钥泄露也可能引发合规问题。
- **不要**在没有商户资质前接入微信支付/支付宝（资金风险 + 平台封禁）。
- **不要**用第三方"代收代付"绕过商户资质（违反《非银行支付机构管理条例》）。
- **不要**在 Phase 1 自行实现 SMS（成本高 + 风控差），用云厂商 SMS。
