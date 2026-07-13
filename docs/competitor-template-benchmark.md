# 风格模板库盘点与同行基准（阶段一）

> 盘点日期：2026-07-13  
> 范围：只读核实模型、版本机制、seed、同行 `ALL_TEMPLATES` 与覆盖差距。  
> 同行来源：`docs/reference/competitor-video-generator.html` 第 3660–3888 行。  
> 注意：本文只提取玩法、镜头意图与负面词模式，不把同行 prompt 当作后续模板文案。

## 1. 结论摘要

- 批量管线的 `StyleTemplate` 数据模型、`slug + version` 唯一约束、DRAFT/ACTIVE 状态、10 条 v1 seed 和服务层 ACTIVE 不可变检查均已落地。
- 当前批量生产可用的 source seed 为 **10 条、9 个分类**；全部含 `{IMAGE_REFS}`、英文镜头语言、布光、节奏和非空负面词。
- 同行 `ALL_TEMPLATES` 共 **38 条、7 个分类**：电商产品 12、一致性锁 5、UGC 达人 3、商业脚本 2、社区脚本 1、世界杯 2026 11、案例拆解 4。
- 如果按批量生产真正可调用的 DB seed 统计，我们只对同行 38 条中的 **4 条形成直接覆盖**，另有 12 条可视为部分覆盖，22 条缺失。
- 仓库还有一套未接入批量 DB 的旧前端模板库：17 条 `STYLE_TEMPLATES` + 5 个 `CONSISTENCY_LOCKS`。它覆盖了更多电商品类，但不能当作批量流水线已覆盖。
- 要达到“总量 ≥ 40”，以当前 10 条批量 seed 为基线，至少需要新增 **30 条 DRAFT**。若同时补齐同行全部玩法并形成我方品类差异化，建议规划 32–36 条。

## 2. 模型、版本与 seed 核实

### 2.1 数据模型

`StyleTemplate` 已包含：

- `id`：数据库生成的 CUID。
- `slug + version`：稳定逻辑标识与版本号，数据库唯一约束。
- `name / nameZh / category / coverImage`。
- `promptSkeleton / negativePrompt`。
- `lockedParams / imagesPerVideo`。
- `status`：`DRAFT | ACTIVE`。
- `activatedAt / createdAt / updatedAt`。
- `BatchJob.templateId` 外键和独立 `templateVersion`，旧批次可继续指向原版本。
- `VideoJob.templateSnapshot`、`promptText`、`negativePrompt`、`seed`，用于生成时审计。

证据：

- `prisma/schema.prisma`：`StyleTemplateStatus`、`StyleTemplate`、`BatchJob`、`VideoJob`。
- `prisma/migrations/20260713_batch_style_templates/migration.sql`：表、枚举、唯一索引及状态分类索引。

### 2.2 不可变与版本机制

已落地：

1. `updateStyleTemplateDraft` 遇到 ACTIVE 时抛出 `ACTIVE_TEMPLATE_IMMUTABLE`，不会执行 update。
2. `createStyleTemplateVersion` 从旧版本复制内容，按同一 slug 的最高版本创建 `version + 1`，新行固定为 DRAFT。
3. `seedBatchStyleTemplates` 使用 `createMany + skipDuplicates`，不会覆盖已存在的 ACTIVE 行。
4. `tests/batch-style-templates.test.ts` 覆盖 ACTIVE 修改拒绝及新版本 DRAFT。

边界与风险：

- 不可变目前是**服务层约束**，数据库没有 trigger 阻止绕过服务直接更新 ACTIVE 行。
- `activateStyleTemplate` 本身不重新执行 `validateValues`；通过正规 `createStyleTemplateVersion` 产生的草稿已校验，但直接写数据库的非法 DRAFT 仍可能被激活。
- `prisma/seed.ts` 与 `seedBatchStyleTemplates` 都会把初始 10 条写成 ACTIVE。符合第二轮初始 seed 规格，但阶段三新增内容必须使用另一条 DRAFT seed 路径，不能复用当前 ACTIVE seed 行为。
- seed 是“只补缺、不更新”。因此 source 常量与已部署数据库可能存在漂移；本次 Neon 配额不可用，未能读取线上实际行进行二次核对。

### 2.3 校验规则

服务层当前校验：

- `promptSkeleton` 必须含 `{IMAGE_REFS}`。
- `negativePrompt` 非空。
- `duration ∈ {5, 10, 15}`。
- `aspectRatio ∈ {9:16, 16:9, 1:1}`。
- `resolution ∈ {720p, 1080p}`。
- `cameraStyle` 长度 3–200。
- `imagesPerVideo.min/max ∈ [1, 9]` 且 `min <= max`。

## 3. 当前批量 StyleTemplate 全量清单

下列“ID”采用 source seed 的稳定 `slug`。数据库物理 `id` 在插入时生成；当前数据库因配额不可用，无法列出具体 CUID。

### 3.1 `slow-360-orbit`

- 分类 / 名称：电商展示 / Slow 360 Product Orbit / 360 慢旋转展示
- `imagesPerVideo`：2–3
- `lockedParams`：10s、9:16、1080p、`motorized slow orbit`
- `promptSkeleton`：Use the supplied product reference images exactly as the visual source of truth. Keep product geometry, color, material, logos and proportions consistent across every frame. Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. Create a seamless slow 360-degree clockwise orbit around the hero product on a minimal pedestal. Start at a three-quarter front angle, ease around the side and finish on the opposite three-quarter angle. Large softbox key light at 45 degrees, clean rim light tracing the silhouette, soft neutral fill, smooth controlled highlights. Calm premium pacing with one continuous stabilized move and a gentle final hold.
- 负面词：product morphing, changing proportions, duplicate product, warped sole, sole deformation, bent heel, label blur, unreadable logo, flicker, camera shake, abrupt cuts, text overlay

### 3.2 `macro-material-study`

- 分类 / 名称：质感特写 / Macro Material Study / 微距质感特写
- `imagesPerVideo`：2–4
- `lockedParams`：10s、9:16、1080p、`macro slider and rack focus`
- `promptSkeleton`：Use the supplied product reference images exactly as the visual source of truth. Keep product geometry, color, material, logos and proportions consistent across every frame. Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. Film an extreme macro material study: glide across surface texture, rack focus onto one craftsmanship detail, then pull back just enough to reveal the product identity. Narrow diffused strip light skims the surface, dark negative fill creates depth, tiny specular accents reveal material quality. Slow tactile rhythm, two deliberate focus transitions, no rushed motion.
- 负面词：soft focus, waxy material, fake texture, excessive bloom, warped stitching, sole deformation, label blur, melted edges, macro noise, focus pumping, text overlay

### 3.3 `street-style-placement`

- 分类 / 名称：生活方式 / Street Style Placement / 街拍场景植入
- `imagesPerVideo`：2–3
- `lockedParams`：15s、9:16、1080p、`handheld gimbal street tracking`
- `promptSkeleton`：Use the supplied product reference images exactly as the visual source of truth. Keep product geometry, color, material, logos and proportions consistent across every frame. Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. Place the product naturally in an energetic urban street-style scene. Track beside the subject at walking speed, cut to a low-angle product hero insert, then whip-pan back to the lifestyle wide shot. Late-afternoon directional sunlight, realistic bounce from storefronts, crisp edge light, natural street shadows. Confident medium-fast pacing with match-on-action cuts.
- 负面词：floating product, incorrect scale, warped limbs, extra fingers, duplicate people, sole deformation, label blur, oversaturated skin, unstable background, random signage, text overlay

### 3.4 `ugc-handheld-review`

- 分类 / 名称：UGC / UGC Handheld Review / UGC 手持口播风
- `imagesPerVideo`：2–3
- `lockedParams`：15s、9:16、1080p、`authentic handheld creator camera`
- `promptSkeleton`：Use the supplied product reference images exactly as the visual source of truth. Keep product geometry, color, material, logos and proportions consistent across every frame. Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. Create an authentic creator-style handheld product review without generated dialogue: selfie-height establishing shot, hand brings the product close to camera, quick cut to a practical use demonstration, then an enthusiastic reaction hold. Soft window key light, warm household practicals, natural exposure roll-off. Conversational rhythm with subtle handheld micro-movement and clean jump cuts.
- 负面词：lip-sync speech, generated captions, extra fingers, fused fingers, deformed hands, floating product, beauty filter, label blur, logo mutation, aggressive camera shake, text overlay

### 3.5 `rhythmic-unboxing`

- 分类 / 名称：开箱 / Rhythmic Unboxing / 开箱节奏剪辑
- `imagesPerVideo`：3–4
- `lockedParams`：10s、9:16、1080p、`locked top-down with macro inserts`
- `promptSkeleton`：Use the supplied product reference images exactly as the visual source of truth. Keep product geometry, color, material, logos and proportions consistent across every frame. Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. Stage a locked-camera top-down rhythmic unboxing: sealed package enters frame, hands open it in two precise actions, product reveal lands on the beat, macro camera inserts follow, ending with the complete set arranged neatly. Broad overhead soft light, controlled side fill, clean white balance and defined contact shadows. Fast satisfying pacing with five beat-matched cuts and a one-second hero hold.
- 负面词：extra fingers, fused hands, impossible box folds, teleporting objects, duplicate accessories, label blur, warped packaging, missing product parts, motion smear, text overlay

### 3.6 `white-studio-standard`

- 分类 / 名称：电商展示 / White Studio Standard / 白棚电商标准
- `imagesPerVideo`：2–4
- `lockedParams`：10s、1:1、1080p、`precision studio slider`
- `promptSkeleton`：Use the supplied product reference images exactly as the visual source of truth. Keep product geometry, color, material, logos and proportions consistent across every frame. Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. Produce a clean white cyclorama ecommerce video: centered front hero shot, smooth 30-degree lateral slider move, top-detail insert, then return to a symmetrical packshot. High-key three-point soft lighting, pure white sweep with a subtle grounded contact shadow, accurate color and neutral reflections. Even catalog pacing with precise one-second holds on every key view.
- 负面词：clipped whites, grey dirty background, floating object, incorrect color, warped silhouette, sole deformation, label blur, unreadable logo, harsh shadow, camera shake, text overlay

### 3.7 `dark-luxury-lighting`

- 分类 / 名称：奢品 / Dark Luxury Lighting / 暗调奢品布光
- `imagesPerVideo`：2–3
- `lockedParams`：10s、9:16、1080p、`slow low-angle luxury dolly`
- `promptSkeleton`：Use the supplied product reference images exactly as the visual source of truth. Keep product geometry, color, material, logos and proportions consistent across every frame. Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. Craft a dark luxury reveal: begin in near silhouette, send a narrow light sweep across the signature detail, execute a slow low-angle push-in, and finish on a polished hero frame. Black velvet environment, hard controlled rim lights, narrow snooted key, subtle warm reflection beneath the product. Restrained cinematic pacing with long anticipation and a decisive final reveal.
- 负面词：crushed product detail, noisy blacks, cheap plastic look, excessive smoke, blown highlights, warped metal, label blur, logo mutation, flicker, fast cuts, text overlay

### 3.8 `lifestyle-use-demo`

- 分类 / 名称：使用演示 / Lifestyle Use Demo / 生活场景使用演示
- `imagesPerVideo`：2–4
- `lockedParams`：15s、9:16、1080p、`eye-level gimbal demonstration`
- `promptSkeleton`：Use the supplied product reference images exactly as the visual source of truth. Keep product geometry, color, material, logos and proportions consistent across every frame. Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. Demonstrate the product solving one everyday task in a believable home: establish the problem, follow the hand reaching for the product, track the complete use action, then show the relaxed result. Soft directional daylight through a window, warm practical background lights, realistic skin and material response. Clear problem-action-result pacing with continuity-matched cuts.
- 负面词：extra fingers, fused fingers, impossible interaction, product changing size, duplicate product, label blur, liquid leaks, discontinuous action, cluttered frame, text overlay

### 3.9 `fast-commerce-beats`

- 分类 / 名称：爆款广告 / Fast Commerce Beats / 快节奏带货卡点
- `imagesPerVideo`：3–4
- `lockedParams`：10s、9:16、1080p、`snap zoom and motion-match cuts`
- `promptSkeleton`：Use the supplied product reference images exactly as the visual source of truth. Keep product geometry, color, material, logos and proportions consistent across every frame. Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. Build a high-retention commerce montage: snap zoom to hero product, three rapid feature close-ups from distinct angles, hand-in-use proof shot, then a clean final packshot. Bright punchy softbox lighting, colored edge accents, high local contrast without clipping. Very fast beat-driven pacing, cuts every 0.8-1.2 seconds, motion-match transitions, readable final hold.
- 负面词：random text, generated price tags, product morphing, duplicate product, extra fingers, sole deformation, label blur, unreadable logo, chaotic framing, strobe flicker, excessive motion blur

### 3.10 `before-after-reversal`

- 分类 / 名称：对比转化 / Before After Reversal / 对比前后反转
- `imagesPerVideo`：2–3
- `lockedParams`：15s、9:16、1080p、`locked tripod match-cut comparison`
- `promptSkeleton`：Use the supplied product reference images exactly as the visual source of truth. Keep product geometry, color, material, logos and proportions consistent across every frame. Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. Create a locked-camera before/after reversal: show the unsolved situation for two seconds, introduce the product with a centered match cut, demonstrate one decisive action, then reveal the improved result from the exact same camera position. Before uses flat cool light; after shifts to soft warm key and brighter fill while preserving spatial continuity. Tension-release rhythm with a sharp midpoint transformation.
- 负面词：camera position drift, inconsistent room geometry, fake split screen, product shape change, duplicate objects, extra fingers, label blur, overdone glow, random text, text overlay

## 4. 仓库内的第二套旧前端模板库

`/personal/templates` 当前导入 `src/lib/video-generation/style-templates.ts`，不是 DB `StyleTemplate` API。

- 静态模板 17 条：4 条爆款广告、8 条电商产品、2 条 UGC、1 条探店、2 条宠物。
- 独立一致性锁 5 条：产品锁形、手部完整性、口播对嘴、主体居中、光线连续。
- 这套库包含香水、腕表、护肤、饮料、3C、食品等批量 DB seed 未细分的品类。
- 这套库不能通过 `templateId + version` 追溯，也不是批量向导 `/api/batch-style-templates` 的数据源。

风险：若只查看模板页，会误以为批量生产已覆盖 17 条；真实批量向导只会返回 DB 中 ACTIVE 的 10 条 seed。

## 5. 同行 ALL_TEMPLATES 完整基准

### 5.1 电商产品（12）

| ID | 名称 | Prompt 意图 | 负面词模式 |
|---|---|---|---|
| A1 | 香水微距水珠 | 黑色反光台、湿身瓶体、水滴、奢华美妆微距 | logo distortion, label blur |
| A2 | 腕表精密特写 | 表冠旋转、金属高光、黑色背景、85mm 观感 | wrong brand text, warped dial |
| A3 | 球鞋 360 旋转 | 居中慢旋、侧逆光、干净落地阴影 | sole deformation, lace chaos |
| A4 | 护肤质地微距 | 半透明精华、玻璃器皿、白棚高级感 | dirty background, over-saturated |
| A5 | 厨电演示 | 暖调厨房、手部交互、流畅功能演示 | button artifacts, hand deformation |
| A6 | 3C 功能聚焦 | 屏幕、机身、装机 UI、包装盒、功能节奏 | screen glitches, logo warp |
| A7 | 包袋街拍 | 模特城市跟走、自然阳光、社媒节奏 | bag shape warping, strap clipping |
| A8 | 食品包装食欲感 | 深色桌面、蒸汽碎屑、暖高光食欲镜头 | fake text artifacts, crushed package |
| A9 | 珠宝闪光 | 钻戒微距、可控闪光、柔焦花艺、杂志风 | gem distortion, overbloom |
| A10 | 前后对比叙事 | 美容仪首尾变化、并排对比逻辑 | unclear transition, skin artifacts |
| A11 | 家居全屋扫视 | 现代客厅慢扫、陈列架、家居编辑感 | geometry warping, ghosting |
| A12 | 饮料冷凝爆点 | 冷凝瓶体、高速水滴、强冲击广告 | liquid physics errors, label blur |

### 5.2 一致性锁（5）

| ID | 名称 | Prompt 意图 | 负面词模式 |
|---|---|---|---|
| B1 | 产品锁形 | 跨特写固定产品几何、比例、材质 | logo warp, shape morphing |
| B2 | 手部完整性锁 | 鱼眼伸手动作中固定五指解剖 | extra fingers, fused fingers |
| B6 | 口播对嘴锁 | 固定说话人身份、自然口型和直视镜头 | lip mismatch, identity flicker |
| B9 | 主体居中锁 | 主体居中，背景用匹配剪辑变化 | object teleporting, scale jumps |
| B10 | Logo 几何锁 | 透视和特写变化中固定字标与装饰比例 | text distortion, stroke wobble |

### 5.3 UGC 达人（3）

| ID | 名称 | Prompt 意图 | 负面词模式 |
|---|---|---|---|
| C1 | 口播种草 | 卧室工作室口播、自然眼神、轻手势、环形灯眼神光 | lip mismatch, extra fingers |
| C2 | 开箱特写 | 双手开小盒、包装触感、零售环境、社媒快节奏 | box deformation, hand artifacts |
| C4 | 镜面自拍穿搭 | 时尚单品镜面自拍、潮流转场、画外音同步 | mirror geometry errors, identity drift |

### 5.4 商业脚本（2）

| ID | 名称 | Prompt 意图 | 负面词模式 |
|---|---|---|---|
| D1 | 磁吸蝴蝶结商业广告 | 15 秒完整节拍：四色钩子、磁吸特写、场景快切、组合收尾 | 未独立定义 |
| D2 | 奢华手袋商业视频 | 多图分别锁定手袋侧面、表面材质和完整细节 | 未独立定义 |

### 5.5 社区脚本（1）

| ID | 名称 | Prompt 意图 | 负面词模式 |
|---|---|---|---|
| E1 | 口播种草（中文社区） | 15 秒 UGC：痛点开场、产品特写、使用演示、CTA | 未独立定义 |

### 5.6 世界杯 2026（11）

| ID | 名称 | Prompt 意图 | 负面词模式 |
|---|---|---|---|
| WC1a | 转播观众席首帧 | 超写实夜场观众席首帧，人设、服装、零食饮料、锁脸 | prompt 仅含锁脸条件，无独立 neg |
| WC1b | 走上球场踢球 | 观众被捕捉、下场进球、全场沸腾、遮镜收尾 | 未独立定义 |
| WC1c | 接球员发饰带货变体 | 进球时接住并佩戴参考发饰，产品全程锁定 | logo warp, shape morphing, wrong product color, identity drift |
| WC2a | 超维度 AI 足球大片 | 单球连续性、双人对抗、盘带、滑铲、闪电凌空抽射 | 角色特写、闪粉、静态姿势、无球、extra limbs |
| WC2b | 各国应援大乱斗 | 两国球迷鼓阵/齐唱对决、裁判定格、合欢收尾 | real logos, federation emblems, violence, identity drift, extra limbs |
| WC3a | 各国美女球迷通用模板 | 多国家变量 fan-cam，发现镜头后挥巾/飞吻 | identity drift, extra fingers, logo artifacts, oversexualized framing, text watermark |
| WC3b | 巴西球迷发饰植入 | 巴西 fan-cam，参考发箍在人群运动中保持稳定 | identity drift, product morphing, oversexualized framing, real badges, logo warp |
| WC4a | 转播进球 + 看台狂喜 | 挑射破门与看台人物狂喜的双镜头转播叙事 | real club logos, real player names, CCTV5 watermark, identity drift |
| WC5a | 球迷周边带货通用 | 35 秒 7 场景：摊位、试戴、入场、庆祝、产品收尾 | real logos, federation emblems, logo warp, shape morphing |
| WC5b | 巴西发饰带货版 | 绿黄发饰试戴、入场、庆祝、品牌字样和几何锁定 | real logos, federation emblems, logo warp, shape morphing, extra fingers |
| WCG | Gemini 爆款逆向复刻法 | 逐帧分析系统提示与“拆解—精简—替换主体”方法 | 方法论条目，无独立 neg |

### 5.7 案例拆解（4）

| ID | 名称 | Prompt 意图 | 负面词模式 |
|---|---|---|---|
| CASE01 | AI 世界杯直播·全片 13 镜 | 32 秒 13 镜转播叙事：观众反转球员、进球、贴镜、喜剧、夺冠、教程钩子 | 分镜内规避真实标识；无统一 neg |
| CASE02 | 英雄镜头·贴镜比心 | 主角冲向场边镜头、贴镜比心、自动对焦呼吸 | identity drift, extra fingers, lens artifacts, blurry face, real team logos |
| CASE03 | 进球→贴镜连续镜头 | 门后进球镜头紧接主角冲向镜头比心 | real team logos, real player names, identity drift, extra fingers, logo warp |
| CASE_VAR | 爆款骨架·7 变量替换表 | 固定 13 镜骨架，只替换世界观、数据、身份反转、英雄镜头、喜剧、高峰道具、CTA | 方法论条目，无独立 neg |

## 6. 逐条覆盖差距矩阵

状态定义：

- **有**：批量 DB seed 中有可直接对应的玩法。
- **部分**：有通用模板或约束，但缺少同行条目的品类专用镜头/负面词/完整节拍。
- **无**：批量 DB seed 中没有可合理映射的玩法。
- “旧前端”只表示静态展示库有类似内容，不代表批量可用。

| 同行 ID / 玩法 | 批量 DB seed | 旧前端静态库 | 差距结论 |
|---|---|---|---|
| A1 香水微距水珠 | 部分：macro + dark luxury | 有：`tpl_perfume_macro` | 缺香水瓶体/标签/液滴专用批量模板 |
| A2 腕表精密特写 | 部分：macro + dark luxury | 有：`tpl_watch_closeup` | 缺表盘、指针、刻度和金属反射专用约束 |
| A3 球鞋 360 | 有：`slow-360-orbit` | 有：`tpl_sneaker_360` | 已覆盖，后续可强化鞋带/鞋底锁 |
| A4 护肤质地微距 | 部分：macro | 有：`tpl_skincare_texture` | 缺瓶体标签和精华液物理专用模板 |
| A5 厨电演示 | 部分：lifestyle demo | 无 | 缺按钮/UI、蒸汽、手部安全和厨房动作模板 |
| A6 3C 功能聚焦 | 无 | 有：`tpl_3c_focus` | 缺屏幕伪影、UI 稳定、端口结构专用模板 |
| A7 包袋街拍 | 有：`street-style-placement` | 部分：通用街拍 | 已覆盖玩法，缺肩带穿模专用负面词 |
| A8 食品包装食欲感 | 无 | 有：`tpl_food_appetite` | 缺包装文字、食物物理和蒸汽专用模板 |
| A9 珠宝闪光 | 部分：macro + dark luxury | 无 | 缺宝石切面、镶爪、反光过曝专用模板 |
| A10 前后对比 | 有：`before-after-reversal` | 有：`tpl_before_after` | 已覆盖 |
| A11 家居全屋扫视 | 无 | 部分：空间焕新爆款 | 缺空间几何、家具稳定和房间运镜模板 |
| A12 饮料冷凝 | 无 | 有：`tpl_drink_condensation` | 缺液体物理、瓶标、冷凝水珠专用模板 |
| B1 产品锁形 | 部分：所有 seed 共用强参考声明 | 有：`lock_product_shape` | 缺可单独选择、可审计的 DB 锁模板/字段 |
| B2 手部完整性 | 部分：UGC/开箱负面词 | 有：`lock_hands` | 缺批量 DB 可组合锁 |
| B6 口播对嘴 | 无；当前 UGC 明确禁生成对白 | 有：`lock_lipsync` | 完整缺口 |
| B9 主体居中 | 部分：白棚/轨道模板隐含 | 有：`lock_centered` | 缺显式可组合锁 |
| B10 Logo 几何锁 | 部分：通用 logo consistency | 部分：产品锁形 | 缺文字笔画/透视专用锁 |
| C1 口播种草 | 部分：无对白 UGC review | 有：`tpl_ugc_talking` | 缺真实口播/对嘴版本 |
| C2 开箱特写 | 有：`rhythmic-unboxing` | 有：`tpl_unboxing` | 已覆盖 |
| C4 镜面自拍穿搭 | 无 | 无 | 完整缺口 |
| D1 15 秒完整商业广告 | 部分：`fast-commerce-beats` | 部分：4 条爆款结构 | 缺明确时间轴、卖点与 CTA 结构 |
| D2 多图手袋商业视频 | 无 | 无 | 完整缺口 |
| E1 中文社区口播脚本 | 无 | 部分：UGC 口播 | 缺痛点—演示—CTA 的完整模板 |
| WC1a 观众席首帧 | 无 | 无 | 缺热点首帧/视频两阶段模板 |
| WC1b 球迷下场进球 | 无 | 无 | 缺热点转播叙事 |
| WC1c 发饰带货变体 | 无 | 无 | 缺热点 + 商品植入 |
| WC2a 单球连续动作 | 无 | 无 | 缺运动连续性模板 |
| WC2b 球迷应援对决 | 无 | 无 | 缺群像喜剧节奏模板 |
| WC3a 多国 fan-cam | 无 | 无 | 缺国家变量与人设稳定模板 |
| WC3b 巴西发饰植入 | 无 | 无 | 缺热点品类植入模板 |
| WC4a 进球 + 看台反应 | 无 | 无 | 缺双线转播叙事 |
| WC5a 球迷周边带货 | 无 | 无 | 缺 35 秒长脚本；当前模型参数只支持最长 15 秒 |
| WC5b 巴西发饰带货 | 无 | 无 | 同上 |
| WCG 逆向复刻方法 | 无 | 无 | 更适合作为模板创作工具，不应直接作为生成模板 |
| CASE01 13 镜完整案例 | 无 | 无 | 当前 15 秒 lockedParams 无法直接承载 32 秒案例 |
| CASE02 贴镜比心英雄镜头 | 无 | 无 | 可抽象为“贴镜互动英雄镜头”原创模板 |
| CASE03 进球→贴镜连续镜头 | 无 | 无 | 可抽象为“事件高潮→镜头互动”结构 |
| CASE_VAR 7 变量骨架 | 无 | 无 | 更适合作为模板作者规范，不应直接入库 |

## 7. 分类级覆盖汇总

| 分类 | 同行数量 | 批量直接覆盖 | 部分覆盖 | 缺失 | 主要缺口 |
|---|---:|---:|---:|---:|---|
| 电商产品 | 12 | 3 | 5 | 4 | 3C、食品、家居、饮料及品类专用负面词 |
| 一致性锁 | 5 | 0 | 4 | 1 | DB 侧没有可组合锁模型；口播对嘴完全缺失 |
| UGC 达人 | 3 | 1 | 1 | 1 | 对嘴口播、镜面自拍 |
| 商业脚本 | 2 | 0 | 1 | 1 | 时间轴脚本、多图局部参考 |
| 社区脚本 | 1 | 0 | 1 | 0 | 完整痛点—演示—CTA 节拍 |
| 世界杯 2026 | 11 | 0 | 0 | 11 | 时效性热点体系完全缺失 |
| 案例拆解 | 4 | 0 | 0 | 4 | 可复用英雄镜头/事件反转骨架尚未产品化 |
| **合计** | **38** | **4** | **12** | **22** | 批量生产覆盖明显不足 |

说明：逐条矩阵中按严格“独立模板”口径统计；通用 consistency 声明不算独立一致性锁直接覆盖。

## 8. 我方已有、同行基准未明确提供的能力

- 白棚电商标准化 packshot。
- 通用暗调奢品渐进式灯扫揭示。
- 通用生活场景 problem → action → result。
- 可审计的 `slug + version + templateSnapshot + assignedAssets + seed`。
- 确定性 `{IMAGE_REFS}` 填空，无 LLM 进入批量关键路径。
- 每模板独立 `lockedParams` 与 `imagesPerVideo`，可与分配器协同。
- ACTIVE 版本不可通过正规服务原地修改。

## 9. 阶段三扩充建议（待人工确认，不执行）

建议把新增 DRAFT 分为六组：

1. **电商专用品类 12 条**：鞋服、香水/护肤瓶体、腕表/珠宝、3C、食品、饮料、家居、厨电、包袋。
2. **一致性强化 5 条**：产品几何、Logo/文字、手部、人物身份/对嘴、主体/光线连续。
3. **UGC 5 条**：手持口播、第一视角开箱、对比测评、镜面自拍、桌面测评。
4. **带货节奏 5 条**：成果前置、痛点—方案—CTA、卡点快剪、三卖点证明、完整 15 秒商业脚本。
5. **场景植入 4 条**：街拍、家庭、办公室、门店/探店。
6. **热点与独有结构 4–6 条**：世界杯 fan-cam、事件高潮→产品英雄镜头、球迷周边带货、群像应援；全部需要时效字段和下线提醒机制。

执行前需要确认：

- 是否允许为 `StyleTemplate` 增加 `description / applicableCategories / expiresAt` 等展示和时效字段；当前模型没有这些字段。
- 一致性锁是继续做成独立模板，还是扩展 DB 模型支持“模板 + 可组合 locks”。后者会触及批量请求/快照结构，不属于“纯内容”。
- 当前合法时长只有 5/10/15 秒。同行 32/35 秒案例不能直接入库，需先决定是抽象为 15 秒版本，还是另行扩展参数范围。
- 是否把 `/personal/templates` 的旧静态库迁移为 DB StyleTemplate 的展示层，避免两套模板继续漂移。

