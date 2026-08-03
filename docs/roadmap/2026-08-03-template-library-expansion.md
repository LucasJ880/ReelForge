# 模板库扩容:8 → 35(2026-08-03)

## 背景与决策

同行(Shuyu 生态内的竞对)预配置模板已达 30+,我们的客户入口只有 8 个通用电商配方,
在「模板体量」这个可感知维度上明显落后。本轮把模板库扩到 **35 个**(8 现有 + 27 新增),
覆盖 17 个分类(全部复用 `platform-copy` 已有分类标签,不新增 i18n 键)。

**不自创模板类型。** 全部新模板类型复刻自公开的开源同行资源(见下),再翻译进我们的
确定性锁定配方语言(INV-B1:promptSkeleton 纯填空、真实性锁、三拍结构、<5000 字符)。

2026-07 的「客户入口统一为八个通用配方」决策中,「不建平行客户模板库、客户差异走
lock profile」这半条继续有效;「只有八个」这半条由本决策取代。

## 开源来源(全部 GitHub 公开仓库,2026-08-03 抓取)

| 仓库 | 取了什么 |
|---|---|
| [TheMattBerman/scrollclaw](https://github.com/TheMattBerman/scrollclaw) | `format-library.md` 六大已验证 UGC 格式(Talking Head Review / Hook Face + Demo / Visual Transformation quick B/A / Podcast Clip 等)含逐秒镜头表 |
| [charlesdove977/UGC-Factory](https://github.com/charlesdove977/UGC-Factory) | 12 种电商 2 秒钩子、10 个品类打法(服饰/美妆/数码/食品/珠宝/家居/健身/玩具/车品/宠物)、15 个风格 skill、快切广告 Pattern 1-5 |
| [cliprise/awesome-ai-ugc-video-prompts](https://github.com/cliprise/awesome-ai-ugc-video-prompts) | 六种 UGC 视频类型(创始人/演示/问题-解决/教育/测评/App demo)+ 18 个行业模板 + 「假 UI 文字禁令」等安全边界 |
| [Anil-matcha/Open-AI-UGC](https://github.com/Anil-matcha/Open-AI-UGC) | 开源版 Arcads 的产品形态参照(9:16、参考图内联、脚本驱动) |
| [liu-kaining/Awesome-Veo3-Prompts](https://github.com/liu-kaining/Awesome-Veo3-Prompts) | 31 条结构化视频提示词的 JSON 化组织方式参照 |

> 我们只复刻**模板类型与镜头结构**,提示词文本全部按本仓库的锁定语言重写,
> 不搬运原文;来源仓库为 MIT/文档型仓库,类型层面的借鉴无许可问题。

## 被否掉/改造的同行套路(真实性锁不放行)

| 同行套路 | 处置 |
|---|---|
| Wall of Text(密集文字墙) | 砍。画面内文字必须后期加,模型不许画字(PRODUCTION LOCK) |
| Ingredient Explosion(成分爆炸悬浮) | 改造为「开箱全家福」平铺清单(悬浮物 = 负面词) |
| Scarcity/Urgency(限时限量) | 砍。CLAIM LOCK 禁止虚构稀缺性 |
| Split-Screen 对比 | 改造为「同机位前后对照」matched cut(假分屏与假竞品都不许) |
| 20-30s 多段格式(Hybrid Transformation 等) | 压缩进 15s 三拍结构或砍(批量线路 segmentCount:1) |
| Before/After 皮肤转变(美妆) | 改造为「上妆质地演示」,只拍质地与涂抹,不许诺效果 |

## 新增 27 模板 × 来源映射

| slug | 中文名 | 分类 | motion | 人物 | 来源 |
|---|---|---|---|---|---|
| commerce-talking-head-review | 口播真人实测 | UGC | presenter_point | 受控 | scrollclaw 格式#1 |
| commerce-podcast-authority | 播客对谈背书 | UGC | presenter_point | 受控 | scrollclaw 格式#6 |
| commerce-founder-story | 创始人自述 | UGC | presenter_point | 受控 | cliprise 创始人型 + UGC-Factory brand-story |
| commerce-street-interview | 街头随机安利 | UGC | presenter_point | 受控 | Arcads 类 MOTS(cliprise 工作流) |
| commerce-hook-face-demo | 情绪钩子快切 | 爆款广告 | reveal_transition | 受控 | scrollclaw 格式#2 |
| commerce-triple-proof | 一点三证 | 爆款广告 | static_product | 无 | UGC-Factory Pattern 1 + 清单体 |
| commerce-creator-reaction | 真实反应种草 | 爆款广告 | reveal_transition | 受控 | UGC-Factory Hook 12 + Pattern 5 |
| commerce-before-after-match | 同机位前后对照 | 对比转化 | reveal_transition | 无 | scrollclaw quick B/A + Hook 3 |
| commerce-360-hero-orbit | 环绕产品秀 | 电商展示 | static_product | 无 | UGC-Factory 09-product-360 |
| commerce-variant-lineup | 多色阵列 | 电商展示 | static_product | 无 | UGC-Factory Hook 6 + Pattern 3 |
| commerce-whats-in-box | 开箱全家福 | 电商展示 | static_product | 无 | UGC-Factory 平铺技法(成分爆炸安全化) |
| commerce-in-hand-scale | 掌上真实比例 | 电商展示 | reveal_transition | 受控 | UGC-Factory Hook 9 + 数码打法 |
| commerce-macro-texture-asmr | 材质微距巡礼 | 质感特写 | static_product | 无 | UGC-Factory Hook 2 |
| commerce-dark-luxury-light | 暗调奢品光影 | 奢品 | static_product | 无 | UGC-Factory Hook 1 + 珠宝打法 |
| commerce-seamless-loop | 无缝循环钩子 | 社媒循环 | static_product | 无 | UGC-Factory 11-social-hook 循环技法 |
| commerce-morning-routine | 晨间仪式感 | 生活方式 | reveal_transition | 受控 | UGC-Factory Hook 10 |
| commerce-pov-immersive | 第一视角上手 | 生活方式 | reveal_transition | 受控 | scrollclaw POV + cliprise 演示型 |
| commerce-dual-context | 一物双景 | 生活方式 | reveal_transition | 无 | UGC-Factory 品类打法多场景 |
| commerce-pet-companion | 萌宠陪伴时刻 | 生活方式 | reveal_transition | 受控 | UGC-Factory 打法#10 宠物 |
| commerce-home-space-styling | 家居空间焕新 | 家居空间 | reveal_transition | 无 | UGC-Factory 打法#6 家居 + 15-real-estate |
| commerce-fashion-lookbook | 穿搭动线 | 服饰穿搭 | reveal_transition | 受控 | UGC-Factory 13-fashion-lookbook + 打法#1 |
| commerce-beauty-texture | 上妆质地演示 | 美妆护理 | reveal_transition | 受控 | UGC-Factory 打法#2(宣称安全化) |
| commerce-food-sizzle | 食欲声色 | 食品饮料 | reveal_transition | 无 | UGC-Factory 打法#4 食饮 |
| commerce-tech-feature-focus | 数码功能聚焦 | 科技数码 | static_product | 无 | UGC-Factory 打法#3 + cliprise 假 UI 禁令 |
| commerce-outdoor-rugged | 户外实战场景 | 工具户外 | reveal_transition | 受控 | UGC-Factory 打法#7 户外化 |
| commerce-travel-pack-flow | 旅行收纳动线 | 旅行收纳 | reveal_transition | 受控 | UGC-Factory 打法#9 系收纳动线 |
| commerce-gift-unwrap | 礼盒仪式感 | 包装展示 | reveal_transition | 受控 | UGC-Factory Hook 5 + 珠宝礼赠场景 |

新 slug 全部带 `commerce-` 前缀且与历史归档 slug(before-after-reversal 等 10 个)零冲突,
幂等 seed 直接建 v1 不会撞版本。

> **执行结果与偏差(2026-08-03)**:真机验收进行到 18/27 出片、9 条过检时,
> Shuyu 与 volcengine 双线中断(前者视频运行时不可用,后者账户欠费 403)。
> 按偏差决策全目录上 main、样片白名单只放过检 17 条,余下 18 条按 runbook 续跑。
> 详见 [验收记录](../acceptance/2026-08-03-template-expansion-acceptance.md)。

## 验收与上线闸门(好用才留)

1. 逐模板真机出样片:走**客户真实线路**(持久化批量管线 + Shuyu `studio-video`
   900pt/条),每模板 1 条 15s;复用 `real-video-acceptance-batch20.ts` 的
   幂等续跑套路。
2. QA:contact sheet 逐秒检查幻觉/文字烧入/主体漂移;不合格 → 修 beats 重跑,
   两轮仍不合格 → 从 catalog 砍掉,不上线。
3. 通过的模板才落样片资产 `public/template-previews/<slug>.jpg + .mp4`,
   并加入 `VERIFIED_TEMPLATE_VIDEO_SLUGS` 白名单——**没有真样片的模板不进 main**。
4. `seed-style-templates-target.ts` 幂等 seed 生产库;typecheck/lint/test 全绿后推 main。
