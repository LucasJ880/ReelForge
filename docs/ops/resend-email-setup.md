# 开通邮件提醒（Resend）

Aivora 的两类提醒邮件已经写好，只差一个发信账号：

- **试点申请提醒**：落地页有人提交试点申请 → 发给创始人（默认 `lucas@sunnyshutter.ca`）。
- **新询盘提醒**：商家询盘页有人留资 → 发给该工作区的 owner（owner 被停用时只发给创始人）。
- **创始人每日汇总**（`/api/cron/founder-digest`，每天 13:00 UTC）：过去 24 小时的试点申请、询盘页新询盘、
  失败的视频与各账号「需要处理」→ 发给创始人；同一个 UTC 日只发一封。

没配之前，这些提醒只写服务器日志（每日汇总的日志版不写联系方式与姓名），数据照常入库，后台都能看到。

另有**密码找回邮件**（`/forgot-password` → 发给账号的注册邮箱，链接 30 分钟内有效、只能用一次）也走同一个发信账号。
链接的站点根地址取 `APP_BASE_URL` / `NEXT_PUBLIC_APP_URL`，都没配时用 Vercel 的生产域名；从不取请求的 Host 头。
没配发信之前，找回页会请用户写信到对外联系邮箱（`src/lib/config/contact.ts`），由人工核对后在后台重置。

## 一、在 Resend 建账号和发信域名（约 15 分钟 + 等 DNS 生效）

1. 打开 <https://resend.com>，用 `lucas@sunnyshutter.ca` 注册（免费档：每天 100 封、每月 3,000 封，够试点期用）。
2. 左侧 **Domains → Add Domain**。建议用子域名，不影响主域收发邮件：
   - 有 Aivora 自己的域名就用它，例如 `notify.<aivora 域名>`；
   - 没有就先用 `notify.sunnyshutter.ca`。
   Region 选 **North America**（us-east-1）。
3. Resend 会列出 3–4 条 DNS 记录（MX、SPF 的 TXT、DKIM 的 `resend._domainkey` TXT，可选 DMARC）。
   到 `sunnyshutter.ca` 的域名服务商（DNS 管理后台）**逐条原样添加**，然后回 Resend 点 **Verify DNS Records**。
   通常几分钟到一小时变成 Verified。
4. 左侧 **API Keys → Create API Key**：Permission 选 **Sending access**，Domain 选刚验证的域名。
   复制以 `re_` 开头的 key（只显示一次）。

## 二、在 Vercel 填三个环境变量（约 3 分钟）

Vercel → 项目 **reelforge** → **Settings → Environment Variables**，环境勾 **Production**：

| 变量 | 填什么 |
|---|---|
| `RESEND_API_KEY` | 上一步复制的 `re_…` |
| `EMAIL_FROM` | `Aivora <notify@notify.sunnyshutter.ca>`（@ 后面必须是第 2 步验证过的域名） |
| `AIVORA_FOUNDER_EMAIL` | 可不填：代码默认就是 `lucas@sunnyshutter.ca` |

保存后在 **Deployments** 里对最新一次部署点 **Redeploy**（环境变量要重新部署才生效）。

## 三、验证

在生产落地页 <https://reelforge-delta.vercel.app/#pilot-apply> 用自己的另一个邮箱提交一次试点申请，
`lucas@sunnyshutter.ca` 应在 1 分钟内收到「试点申请」邮件。收不到的话：先看 Resend 后台 **Emails** 里有没有这封
（有 = 被收件箱拦了，去垃圾箱找；没有 = key 或 `EMAIL_FROM` 填错，检查域名是否 Verified）。

## 说明

- 对外联系邮箱（隐私页、条款页、试点表单与成品库的「联系支持」）已统一为 `lucas@sunnyshutter.ca`，
  源头是 `src/lib/config/contact.ts`；以后要换，改 Vercel 的 `AIVORA_CONTACT_EMAIL` 即可，不用改代码。
- 不要把 `re_…` key 发在聊天或提交进代码仓库。
