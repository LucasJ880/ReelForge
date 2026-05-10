# AI Video Demo Page & Demo Video Plan

> 主 Demo Page（`/demo/real-footage-ads`）与配套 demo 视频的实施计划。
> 本轮 **不** 真实生成 mp4，也不调用任何视频 provider，仅落地页面 + 文档计划。

## 1. Demo Page Structure

主对外 demo 路径：`/demo/real-footage-ads`

页面是一个一页式、可滚动、可点击的“客户模拟产品体验页”，对应内部 `/wizard`
1→6 的概念，但不调用 `/api/wizard/*`。

| Section                            | 锚点               | 数据来源 (sample) |
|------------------------------------|---------------------|-----------|
| 1. Hero                            | (top)               | `storyboardShots[0]` 用作 phone mockup 占位 |
| 2. Customer input panel            | `#input`            | `demoProject` |
| 3. Creative evidence cards         | `#evidence-cards`   | `creativeEvidenceCards` |
| 4. Reference video previews        | `#references`       | `referencePreviews` |
| 5. AI script                       | `#script`           | `generatedScript` |
| 6. Storyboard / shooting guide     | `#storyboard`       | `storyboardShots` (6 张) |
| 7. Asset QA mock                   | `#asset-qa`         | `assetQAResults` |
| 8. Final output                    | `#final-output`     | `finalOutputs` |
| 9. Pet grooming extension          | `#pet-grooming`     | `petGroomingSample` |
| 10. Book demo / waitlist           | `#book-demo`        | `RealFootageWaitlistForm` |
| 11. Compliance / scope             | `#compliance`       | `COMPLIANCE_NOTES` |

所有 sample data 都集中在 `src/lib/demo/ai-video-workflow-demo-data.ts`，
组件位于 `src/components/demo/*.tsx`。

页面交互：
- 默认选中 `real-estate-price-contrast-tour` 方向；
- 点击其它 creative card 仅切换 selected 标签 / hero 文案，不触发后端；
- Input panel 的 chips 同样只切换 active 状态。

CTA：
- 登录用户：`Try the workflow` → `/wizard/new`
- 未登录：`Book demo` 锚点 → 现有 `RealFootageWaitlistForm`
- 第二 CTA：`See the generation flow` → `#workflow`，`Jump to final video` → `#final-output`

---

## 2. Product Workflow Walkthrough Video（60-90 秒）

> 用途：在 hero / sales call 里播放，让客户在 90 秒内看完工作流闭环。

### 整体节奏

| 时间    | 段落           | 内容 |
|---------|----------------|------|
| 0-6s    | 痛点 hook      | “你拍了一堆素材，但发出去的视频还是模板感。” |
| 6-15s   | 输入需求       | 客户在 input panel 选行业 / 目标 / 平台 / 视频长度 |
| 15-26s  | 创意证据卡     | 三张方向卡浮现，默认 highlight `Price-contrast listing tour` |
| 26-36s  | 参考视频信号   | 参考视频结构 + 表现指标 + 合规说明（不展示原视频） |
| 36-50s  | AI 脚本 + 分镜 | 脚本卡 + 6 张 storyboard 卡 zoom，强调“拿手机就能拍” |
| 50-65s  | 素材质检       | 客户上传 → QA 表格出现 → Kitchen pan 标 retake |
| 65-78s  | 自动出片       | 30s 主版本预览 + 15s 广告版 + 多平台 caption |
| 78-90s  | CTA            | “上传你的目标和素材，我们帮你跑这套流程。” |

### 录制要点

- 用屏幕录制 + 局部缩放，不要整页截屏
- caption / 音频建议中文为主，英文做 supers
- 每张分镜/QA/Final video 卡都允许是 mockup（沿用 page sample）
- 视频不要承诺“实时生成”，应明确这是“产品工作流概览”

---

## 3. Real Estate Final Sample 视频脚本（25-30 秒）

> 用途：作为 hero phone mockup 真实播放的 30s 主版本，替换当前 sample placeholder。

| 时间    | Shot                  | Visual                                  | Voice / Caption |
|---------|-----------------------|-----------------------------------------|-----------------|
| 0-4s    | Shot 01 · Agent intro | 经纪人门口半身 talking head             | “North York 这个预算还有选择？” |
| 4-8s    | Shot 02 · Exterior    | 楼盘外观 establishing                   | “今天我带你实地看一套” |
| 8-13s   | Shot 03 · Living room | 客厅 push-in，自然光                    | “进门看采光和户型” |
| 13-17s  | Shot 04 · Kitchen pan | 厨房慢速横移                            | “厨房 = 日常生活密度” |
| 17-23s  | Shot 05 · Bedroom + community | 主卧静态 + 窗外社区 B-roll       | “主卧 + 社区是真正的‘住起来’” |
| 23-30s  | Shot 06 · Agent CTA   | 经纪人静态 talking head 收尾            | “DM me for the full list.” |

合规：
- 必须附 Fair Housing / disclosure
- 不要承诺投资回报
- AI avatar / voice clone 须经经纪人书面同意

---

## 4. Pet Grooming Sample 视频脚本（15-25 秒）

> 用途：宠物美容行业扩展样片；当前已有 `DEMO_SEED_VIDEO_URL` 作为占位。

| 时间    | Beat              | Visual                              | Caption |
|---------|-------------------|-------------------------------------|---------|
| 0-3s    | Before            | 宠物洗护前真实毛发特写              | “今天的小客人是不是有点凌乱？” |
| 3-12s   | Grooming process  | 洗澡 / 吹毛 / 修剪三段快剪          | “店家手法专业、流程稳定。” |
| 12-17s  | After reveal      | 洗护后反差对比                      | “前后对比就是最好的广告。” |
| 17-20s  | Booking CTA       | 门店外观 + 联系方式                 | “周末约我们，给毛孩子一次清爽。” |

合规：
- 宠物店本人门店素材，避免使用第三方账号视频
- 联系方式 / 地址必须为真实门店或获得授权的合作门店

---

## 5. 建议镜头清单（全行业通用模板）

地产：
1. Agent intro talking head（半身、自然光、声音清晰）
2. Building exterior establishing（竖屏、稳定、光线明亮）
3. Living room push-in（慢速、采光强）
4. Kitchen pan（慢速横移、台面整洁）
5. Bedroom + community B-roll
6. Agent CTA close-out

宠物美容：
1. Before（洗护前真实毛发特写）
2. Process（洗澡 / 吹毛 / 修剪 3 段快剪）
3. After reveal（前后对比）
4. Storefront + booking CTA

通用拍摄要点：
- 全程竖屏 9:16
- 镜头匀速、不要扫得太快
- 自然光优先；逆光必备反光板
- 收尾 5 秒一定预留给 CTA

---

## 6. 需要准备的真实素材

为了把 demo page 的 sample placeholder 替换成真实输出，需要：

1. **Real estate 30s 主版本 mp4**
   - 上面 6 个 shot 的真实素材或合规授权素材
   - 经纪人书面同意（含 AI avatar 备份方案）
   - Fair Housing disclaimer 字幕版

2. **Real estate 15s 广告版 mp4**
   - 由 30s 主版本删减出（保留 Shot 01/03/04/06）
   - 字幕加大、CTA 提前

3. **Cover image · 9:16**
   - 来自 Shot 02 第 1.2 秒静帧
   - 需要文案叠层（hook 句）

4. **Pet grooming 真实 before/after 样片**
   - 已有 `DEMO_SEED_VIDEO_URL` 作为占位
   - 后续可替换为更新版本

5. **Product walkthrough 60s**
   - 已有 `public/generated/aivora-real-footage-ads-walkthrough-60s-16x9.mp4`
   - 仅作 hero 旁可选 walkthrough 链接，不进 phone mockup

---

## 7. 未来如何接 Phase 2 /wizard 实际输出

替换路径（按优先级）：

1. **Final output mp4 替换**
   - 把 `finalOutputs[*].videoUrl` 从 `null` 改成 wizard 真实输出的 `WizardRenderJob.assets.url`
   - 在 `/demo/real-footage-ads` 添加 server-side fetch（基于 admin 的 demo project）
   - Phone mockup 已支持 `videoUrl=null` 自动降级，无需修改组件

2. **Creative cards / Reference previews**
   - 切到 `creative-evidence-card-service.ts` 真实 PUBLISHED 卡片
   - 保持卡片字段对齐 `parseCreativeEvidenceCardCore`
   - 仍需要 `Sample data` badge，直到我们有真实 client demo

3. **AI script / storyboard**
   - 接 `wizard-script-service` / `wizard-storyboard-service` 的样例输出
   - 不接客户真实 brief，避免暴露隐私

4. **Asset QA mock → real**
   - 接 `asset-qa-service` 的 mock evaluation（或对一组样例素材做 read-only 评估）

5. **CTA 路由**
   - 已经做了登录态分流（`getServerSession`）
   - 后续可加 `?industry=real_estate` query 让 `/wizard/new` 预填行业

---

## 8. 合规边界（重要）

页面与文档严格遵守：

- **Reference videos**：仅引用结构与表现信号，禁止下载、自托管、去水印、复制原字幕配音
- **第三方素材**：所有 demo 数据中的 `referenceUrl` 都是占位（null）或合规外链
- **AI avatar / voice clone**：需要经纪人 / 出镜人显式书面同意
- **客户素材**：客户必须确认拥有素材授权或合法使用权
- **Real estate 行业**：必须遵守 Fair Housing 与本地房产 disclosure 规则
- **样本声明**：所有数字 / 脚本 / 分镜上方都有 `Sample data` badge

下列措辞**禁止**出现在 demo 数据 / UI / 文档：
- “remove watermark”
- “clone exact video”
- “copy script”
- “scrape and download”
- “rehost third-party video”

---

## 9. 维护责任

- 添加新行业 sample 时，必须新增对应 `creativeEvidenceCard` + `referencePreview` +
  `storyboardShots` + `finalOutputs`，并更新此文档
- 替换真实 mp4 时，确认所有 `videoUrl` 与 `posterUrl` 已校验授权
- 任何对 `creativeEvidenceCards` / `storyboardShots` / `finalOutputs` 长度的更改
  都必须更新 `tests/ai-video-workflow-demo-data.test.ts` 期望
