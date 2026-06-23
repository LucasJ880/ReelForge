# 投资人 Demo 页（/showcase）国内可访问部署方案

> 背景：`/showcase` 现在部署在 Vercel，**国内访问慢/经常打不开**（Vercel 默认线路在大陆不稳定）。
> CEO 要求：**把这一页单独做成国内能稳定打开的网页**给投资人看。
>
> 本文只针对「单独这一页 demo」的对外可访问问题，给出方案对比与推荐。
> 整套 App 在大陆的完整部署（火山 ECS + RDS + TOS + Ark）见 [docs/CHINA_DEPLOYMENT.md](CHINA_DEPLOYMENT.md)，二者不冲突。

## 1. 现状约束（决定能不能"纯静态"）

`/showcase` 目前有两处服务端依赖，做"单独静态站"前必须先处理：

| 依赖 | 位置 | 影响 | 静态化处理 |
|---|---|---|---|
| 登录态 `getServerSession` | [src/app/(public)/showcase/page.tsx](../src/app/(public)/showcase/page.tsx) | 决定 CTA 文案/跳转 | 给投资人看的版本写死 `isAuthenticated=false` 即可，不需要登录 |
| 体验申请表单 | `POST /api/demo/real-footage-ads/waitlist`（Prisma 写库） | 表单提交需要后端 | 静态站没有后端 → 改投第三方表单（金数据 / 腾讯问卷 / Formspree）或 `mailto:`，或跨域调用线上 API |

**大文件**（影响国内首屏速度，必须配 CDN）：

- 讲解视频 `aivora-pet-content-kit-walkthrough-60s-16x9.mp4` ≈ **35 MB**
- `public/demo/pet/` 图片合计 ≈ **25 MB**（多张 1–2 MB PNG）

建议上线前再压一轮：视频转 H.264 较低码率压到 ~10–15 MB；图片转 WebP，缩略图按显示尺寸出图（封面 600px、头像 128px 足够）。

## 2. 方案对比

| 方案 | 国内速度 | 是否需 ICP 备案 | 上线速度 | 适用 |
|---|---|---|---|---|
| **A. 复用火山全栈部署** | 快 | 需要（大陆节点） | 慢（依赖 RDS/TOS/Ark + 备案） | 长期，且 demo 要带登录/表单/真实生成 |
| **B. 静态导出 + 大陆对象存储 + CDN**（阿里云 OSS / 腾讯 COS / 火山 TOS 静态网站托管） | 最快 | 需要（绑大陆域名时） | 中（卡在备案 7–20 天） | 长期对外、已有/愿走备案域名 |
| **C. 静态导出 + 香港/海外节点**（香港区 OSS/COS，或一台香港轻量服务器 + Nginx） | 较快（比 Vercel 稳） | **免备案** | 最快（1 天内） | 马上要给投资人看、暂无备案 |
| D. Cloudflare Pages / Netlify / Vercel | 不稳定 | 否 | 快 | ❌ 不建议作为给投资人的主链路 |

## 3. 推荐

- **马上要给投资人看、还没备案 → 选 C。** 把 `/showcase` 做成静态站，传到**香港区对象存储 + CDN**（阿里云/腾讯都有香港 region，免 ICP），或一台香港轻量应用服务器跑 Nginx。1 天内可上线，国内访问明显比 Vercel 稳。
- **要长期对外、愿意走备案 → 选 B。** 静态站放**大陆 OSS/COS + CDN**，绑已备案域名，国内体验最佳、成本最低（纯静态 + CDN 流量费）。
- **demo 之后还要带登录/表单/真实生成 → 选 A**，并入 [CHINA_DEPLOYMENT.md](CHINA_DEPLOYMENT.md) 的火山全栈。

> 备案是唯一的"长周期"变量：要绑大陆域名指向大陆节点，**先去申请 ICP 备案**（约 7–20 天），其它都可当天搞定。先用方案 C 的临时链接给投资人，备案下来再切方案 B。

## 4. 静态导出落地步骤（方案 B / C 通用）

1. **抽离静态变体**：当前整个 App 含 API 路由与 NextAuth，**不能整体 `output: 'export'`**。两条路：
   - （推荐）新建一个**最小 Next 子项目**，只搬 `/showcase` 页 + `src/components/demo/pet/*` + `src/lib/demo/pet-content-kit-demo-data.ts` + 暖色主题样式，`isAuthenticated` 写死 false，表单换第三方，然后 `next build && next export` 出纯静态。
   - （兜底）用无头浏览器渲染线上 `/showcase` 后抓取 HTML + 静态资源，做"快照式"静态站（改动小但不易维护）。
2. **资源走 CDN**：视频与图片压缩后上传对象存储，页面里引用 **CDN 绝对 URL**，不要让托管站直接吐 35 MB 视频。
3. **上传 + 开 CDN**：对象存储开启「静态网站托管」，前面挂 CDN（大陆节点选 B、香港节点选 C），开启 gzip/br 压缩与缓存。
4. **域名**：大陆节点必须备案域名；香港/海外节点可直接用 CDN 默认域名先顶着。
5. **表单回收**：第三方表单（金数据/腾讯问卷）后台即可收 leads；如需进我们自己的库，再让表单 webhook 回调线上 API。

## 5. 后续可选优化

- 视频额外出一个 9:16 竖版/更低码率版本，移动端国内加载更快。
- 图片统一转 WebP + 响应式 `srcset`。
- 给静态站加一个简单的访问统计（如自建 + 对象存储日志，或国内可用的统计 SDK）。
