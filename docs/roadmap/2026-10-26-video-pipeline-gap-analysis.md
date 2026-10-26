# 2026-10-26 视频生成流差距分析：CEO 的 Blender→SD 提议、同行为什么又顺又好、我们差什么

> 调研方法：三路联网调研（CEO 路线 / 竞品工作流 / 底层模型，各带来源与日期）+ 对本仓库视频链路 7 个子系统的只读精读（231 条能力记录，每条带 `file:line`）+ 对驱动结论的 38 条关键事实做第二轮对抗性核实（官方来源优先）+ Shuyu 实时价目探针（只 GET）。
> 本文只做判断与建议，没有改任何代码。CEO 参考片的逐镜拆解见 §1。

## 0. 一句话结论

**CEO 的「Opus 写 Blender 建模 → 喂给 SD」对我们当前的成片质量问题基本无效**（它解决的是机位和运镜可控，不是商品/人物漂移、logo 保真、口播同步、AI 味），而他发来的参考片恰恰是用「多参考图一致 + 原生口播 + 卡拉 OK 字幕 + 2.5 秒一镜的节奏」做出来的真人 UGC，跟 3D 渲染没有关系。**同行又顺又好不是因为模型更好——大家接的是同一批模型（Seedance 2.x / Kling 3 / Veo 3.1）——而是把「链接起片 → 先锁静帧或一次多镜头 → 只改坏掉的那一镜 → 批量出变体 → 投放回流」做成了默认路径。** 我们的链路离这条路径差四块：① 质检只查「有没有烧字」，不查漂移；② 单供应商 + 720P + 单段 15 秒 + 无原生音频；③ 成片后没有任何局部重做；④ 口播与字幕的时间轴是估的，不是对的。这四块都在核心链路上，建议在接 CEO 下一轮新功能之前先把它们做稳。

## 1. 参考片拆解（CEO 10:42 发的 18 秒西语头盔片）

| 项 | 实测 |
|---|---|
| 规格 | 720×1280 · 30fps · 18.07s · H.264 1.7Mbps + AAC；封装 `Lavf58.20.100`（ffmpeg 合成，不是手机直出） |
| 切点 | 0.3 / 3.9 / 4.7 / 5.4 / 8.2 / 10.1 / 13.1 → **7 段，平均 2.5s/镜** |
| 结构 | 自拍钩子（风吹头发、惊讶）→ 转身走位 → 手摸头盔紫黑涂装（POV）→ 护目镜特写 → 面罩特写 → 戴面罩抱头盔收尾 |
| 口播 | 西语女声原生口播，mean −17.6dB；whisper 转写：「风要毁了我的出行，但拿我没办法。外面大风，我的最爱三件套：哑光紫头盔超轻、防反光护目镜、透气面罩。设计炸裂，一切尽在掌握。问题解决，出发。」→ **痛点钩子 → 三件套 → 逐件卖点 → 解决 + 行动** |
| 字幕 | 黄字白描边、逐词/短语高亮、居中偏下、每条 2–3 词 |
| 一致性 | 头盔紫黑涂装、护目镜彩虹镜片、黑面罩在 7 个镜头（含手部 POV 特写）全部一致；同一人同一服装同一房间 |
| 判断 | AI 生成的真人感 UGC（最可能 Seedance 2.x 或 Kling 3.0 Omni 多参考 + 原生口播，或先出画面再对口型），**不是 3D 渲染**。真正要对口型的只有自拍开场，中段手部特写、戴面罩（挡嘴）都是避险设计；口播是一条连续音轨跨过各切镜。 |

这条片子的「好」，拆开就是五件事：多参考图跨镜头一致、原生口播、逐词高亮字幕、短镜头节奏、痛点→方案的脚本框架。对照 §4，这五件我们分别是：degraded / degraded / missing（只是类型名）/ 模板固定三拍 / 有但三套互不相通。

## 2. 问题一：Opus → Blender → SD，对成片质量有没有提高？

**结论：对真人 UGC 与 logo 保真无效；只对「硬质、形状简单、logo 印在大平面上」的商品做 360 转台 / 推拉摇移 packshot 有有限价值。不建议现在投入；如果 CEO 坚持，用 §2.3 的 2 天 $50 实验止损。**

### 2.1 为什么无效

1. **LLM 建不出商家手里那件实物。** Blender 官方团队（Blender Lab）基于 MCP 做了 Blender 连接器，Anthropic 2026-04-28 宣布接入（blender.org 自己写明它会「无防护地执行 LLM 生成的代码」）[R1-1]；blender-mcp（32k star）里 Claude 确实能用 bpy 写程序化建模、材质、绑定，但「从照片出一个像实物的网格」这一步靠的是 Tripo / Hunyuan3D / Rodin / Meshy 等外部生成器 [R1-2]；3DCodeBench（2026-05-31）指出能运行的建模代码仍常出现断开、悬浮的几何件 [R1-3]。所以 Opus 能可靠产出的是几何原语、场景布局和运镜脚本，不是商家那件窗帘或头盔。
2. **商品照片转 3D 仍不保真。** Meshy 6 / Tripo v3.1 / Rodin Gen-2.5 横评：每次 $0.18–0.25、耗时 99–195 秒，常见部件粘连和破洞，没有测文字和 logo [R1-4]；另一篇明确不建议拿生成式 3D 做需要和实物一致的资产 [R1-5]。窗帘这类软体转出来是刚体网格，还要另做布料模拟。商家通常只有几张正面图，背面只能靠模型猜。
3. **3D 引导控制的是构图，不是商品细节。** NVIDIA 的 3D-guided blueprint 用 Blender 视口 → 深度图 → FLUX.1-Depth 控制摆位和机位，官方明说不需要精细模型和贴图 [R1-7]（该蓝图现标 Deprecated）。深度图是灰度几何信号，贴图和 logo 根本不进控制信号，所以 SD/FLUX 阶段必然自己重绘商品表面——这是推论，不是 NVIDIA 原话。电商贴图实践：生成模型会改商品轮廓、编造材质，ControlNet「仍不是硬保证」，正确做法是先确定性合成，再把掩码以外的像素硬还原成原图 [R1-9]。**我们 0805 自己实锤过**：Seedance 把实拍 logo 重绘成金色手写体乱码，LOGO LOCK 提示词无效，修法就是原生像素英雄镜头 + 确定性贴印（`src/lib/video-generation/logo-imprint-compositor.ts:4-15`）。再过一遍 SD，等于多一次漂移。
4. **「SD」在 2026 年已经不是对的选型。** FLUX.2 主打多参考商品一致（API 上限 8 张，Playground 10 张，dev 6 张）[R1-10]；Nano Banana 2 号称可同时保住 14 个物体的保真 [R1-11]；Seedream 4.5 也支持多参考 [R1-12]；ControlNet 退成 FLUX.2 上的结构控制插件 [R1-13]。
5. **到视频这一步，参考片那类片子已经可以直接出。** 3D 渲染确实能当控制视频（Wan2.1-VACE 官方接深度/姿态/光流/涂鸦，**不含法线**；Blender→ComfyUI→VACE 只有社区模板，且停在 Wan 2.1 VACE 14B——开源权重止于 2.2，画质比 Seedance 2.5 / Wan 3.0 落后一代 [R1-14]），而 Seedance 2.0 已可收 9 图 + 3 视频 + 3 音频作参考并用参考视频带运镜 [R1-17]，Kling 3.0 支持多镜头和含西语的原生音频 [R1-18]——不需要先建模。
6. **代价。** Vercel 没有 GPU，函数包 250MB（我们媒体函数已到 140MB，曾 299MB 部署失败），Blender 和 VACE 只能外挂 GPU 服务（Modal L4 ≈ $0.8/h、H100 ≈ $3.95/h [R1-20]）；单条估算 $2–4.5；要多维护 GPU 容器和 Blender 版本，每个模型还得人工检查。

### 2.2 适用 / 不适用

- 适用：头盔、露营灯、瓶罐等硬质简单形状、logo 在大平面上，做 360 转台、推拉摇移 packshot，或同一机位系列片。
- 不适用：真人 UGC 种草片（CEO 参考片这类）、窗帘等软体、细字标签特写。

### 2.3 如果一定要验证：2 天、< $50 的止损实验

选 3 个商品（硬质头盔类 / 户外灯 / 窗帘），每个用商家 3–5 张手机图，三组对照：A 现有链路；B 照片转 3D → Claude 经 MCP 写相机轨迹 → 渲深度/法线 → Wan VACE 出 720P，logo 仍后期贴；C 不用 3D，走 Seedance 2.x / Kling 3.0 多参考 + 一段手机拍的运镜参考视频。指标：逐帧 OCR 的 logo 命中率、与原图裁片的 DINOv2 相似度、运镜符合度、5 人盲评、单条成本与耗时、失败率。**止损线：B 在硬质商品上没有明显胜过 C 就停。**

## 3. 问题二：市面上为什么又顺又好

### 3.1 八条共性（每条背后都是一个产品决定，不是一个模型）

| # | 共性 | 证据 | 我们 |
|---|---|---|---|
| 1 | **一个链接起片，用户只审和换。** 从链接抽品名、描述、≤8 张图、品牌色和 logo，渲染前每项可换（Higgsfield Click to Ad，2026-10-13）；TopView 拿到 URL 自己规划分镜、自己选模型；Pippit / TikTok Symphony 同样 | [R2-1] | 链接起片只喂**文本**（title/brand/price/description 拼进提示词），抓到的主图 `imageUrl` 哪儿都不用；批量向导没有链接入口（`product-link-service.ts:502-509`） |
| 2 | **商品一致性在生成时锁住，不靠事后修。** Seedance 2.0 单次 9 图 + 3 视频 + 3 音频、多镜头输出；Kling 3.0 用 2–4 张多角度图建「主体」；即梦先出九宫格分镜再喂 Seedance；Arcads 官方做法是先用商品参考图生成「手持静帧」再驱动；HeyGen 建议小件手持商品 | [R2-2] | 图像级锚定只有两处：故事板第 N 帧回灌最近 2 张成帧、派发时实拍在前故事板帧在后 ≤8 张；**人物没有参考图槽位**（AssetRole 无 person）；商品锚点切片不进视频参考图 |
| 3 | **音画一次出。** Seedance / Kling 原生口播 + 音效；HeyGen Video Agent 把 Seedance 镜头和 Avatar 口播自动合成 | [R2-3] | Shuyu 拒收 `generate_audio`，口播靠 prompt「祈祷」，有无音轨不可控（`shuyu.ts:205-216`） |
| 4 | **多模型路由 + 兜底是基础设施。** Runway Model Router（2026-07-21）+ Capacity Fallbacks + Task Cost API；Arcads / TopView 各接 Seedance 2.5、Kling、Wan 3.0、Nano Banana；反例 Sora：App 2026-04-26 关停、API 2026-09-24 停用，只绑它的产品直接断供 | [R2-4] | 注册 4 条线路，**生产只有 Shuyu 可提交**（BytePlus 未配、火山 401/欠费）；批量路径**没有 failover 分支**（`batch-service.ts:606-623`） |
| 5 | **变体是一等公民。** Creatify 一次十几条；CapCut Seedance Mini UGC 一次出多长度/多开头/多 CTA；Mirage 按 hook 重混；Icon 先找投放满 2 周的竞品赢家再克隆 | [R2-5] | 批量只有三维：模板 × 图组轮换 × `{PRODUCT_NAME}`；无钩子/口播/主播/文案变体；视频行 hookType/recipeId 恒 null，进不了赛马 |
| 6 | **局部改，不用整条重来。** Arcads 换主播/换声音/翻译/延长；TopView 分镜留在画布上单镜重做；Runway Aleph 改一帧传播全片 | [R2-6] | 故事板帧可重抽（≤3 次）但不能换提示词/换参考图；**成片后不能点名重做任何一镜**，只能重投失败段或整条重来新订单 |
| 7 | **生成器正在变成媒体买手。** Creatify AI Media Buyer 连 Meta/Google/TikTok，从赢家生成变体直接上线（2026-07-13）；Meta Cannes 2026 的一体空间 | [R2-7] | 发布只有青砚拉取（白名单默认空）；回流只有图文维度 |
| 8 | **Agent + 画布双模式。** Runway Agent 一句话搭 Workflow；Figma Weave 固化流程；美图开拍转「交付成果」 | [R2-8] | 固定五步表单 |

### 3.2 企业级能力清单（标配 vs 差异化）

- **标配**：品牌套件（Runway Brand Kits、CapCut 锁字体颜色）；团队共享积分与项目；API + MCP（Creatify、Arcads、TopView、Omneky）；多语种翻译配音；SOC 2 Type II（Creatify；Synthesia 另有 ISO 42001）。
- **差异化**：投放账户直连 + 数据回流自动上新（Creatify、Icon、Smartly）；投放前预测打分（Pencil、Smartly）；审批与审计链（Pencil 必须有人签字）；品牌私有模型（Adobe Firefly Foundry）；商用安全 + IP 赔付 + Content Credentials（Adobe）；身份已验证的真人脸（HeyGen）；项目预算封顶（Runway）；**SLA 没查到任何一家公开数字**。

### 3.3 用户最常见的吐槽（我们的定价与失败处理要绕开的坑）

积分和扣费（Higgsfield「Unlimited」仍被扣 3000+ 分且限速；Arcads 价格突然翻倍；Creatify 失败照样扣分）；退款和客服不回复（Arcads、MakeUGC）；出片质量（长脚本口型机械、商品跨帧漂移「贴图感」、HeyGen 手持罐子文字扭曲）；只出裸片要另外剪（Arcads、MakeUGC）；真人 UGC 仍赢 ROAS，AI 赢在「每美元能出多少变体」。**真正的自动质检（商品漂移、手部、口型，再自动重试）没查到成熟方案——主流做法是多出几条让人挑。** 这意味着 §5 P0-1 如果做成，是差异化而不是补课。

## 4. 我们的链路：真实状态（不是文档说的状态）

口径：**production** = 客户现在用得到且有验收痕迹；**degraded** = 在跑但靠降级/fail-open；**wired_not_exposed** = 服务端通但没客户入口或被开关关着；**code_only** = 有代码但没接进任何调用链；**missing** = 没有。

### 4.1 「以为有、其实没有」清单（最该先知道的）

| 以为 | 实际 | 证据 |
|---|---|---|
| 成片是 1080P | **720P 拉伸**：Shuyu 请求体没有 `resolution` 字段，单条传的 `"1080p"` 与批量模板 `lockedParams.resolution` 在主线路上无效；尾卡也只渲 720×1280；stitch 用 lanczos 拉到 1080×1920 | `shuyu.ts:1007-1018`、`video-service.ts:665`、`stitch-pipeline.ts:54-58` |
| Shuyu 上限 720P | **Shuyu 今天就在卖 1080P（240 点/秒）和 4K（640 点/秒）**，是我们 `auditShuyuVideoPlan` 只放行 720P/480P | 实时 `/prices` 探针 2026-10-26；`shuyu.ts:317-321` |
| 有逐词高亮 / 卡拉 OK 字幕 | 只是类型名：`word_by_word` 与 `karaoke` 渲染结果与粗体描边完全相同，ASS 里定义了黄色 SecondaryColour 却从不产生 `\k` 标签；UI 已悄悄改名「醒目描边」 | `audio-post-production.ts:255-275`、`audio-caption-controls.tsx:71-80` |
| 字幕跟口播对齐 | **不用任何语音时间戳**：按句/标点切块，按字重在窗口内均分；口播说快说慢字幕都不跟 | `audio-post-production.ts:147-186` |
| 原生口播是 TTS | 口播稿按段切块写进 prompt 的 `Spoken dialogue (...)`，由视频模型「尽力说」；4 个音色 id 只是写进提示词的风格词；OpenAI TTS 只给 b-roll 用（且 `tts-1` 已被 OpenAI 宣布 2027-01-06 关停，见 §5） | `prompt-intelligence.ts:383-387`、`openai-tts.ts:18-31` |
| 故事板走「抽卡择优 + vision 评审」 | **客户路径每帧 1 候选、串行、唯一评审是商家点确认**；vision 评审器零运行时调用方；连 SunnyShutter 两条脚本流水线也只是 `generateFrameDeterministically` 取第一个成功（测试反向断言「free of judge calls」），仍为每帧付 4/3 候选费用其余作废 | `storyboard-gacha.ts:157-194`、`tests/shuyu-image2-routing.test.ts:110-111` |
| 发片前有画面质检 | 只检一件事：**画面烧录文字/错字**。商品相似、人物一致、运动都不拦；黑边/近静止只是影子记录且没有任何 UI 读取。生产 OpenAI 无额度后 vision 失败 fail-open 记 SKIPPED → **帧质检在生产里从未真正拦过片** | `frame-qa.ts:63-70`、`frame-qa-gate.ts:29` |
| 批量故事板有人审 | 批量 `approvalPolicy=AUTO`，帧出齐即 APPROVED，零人工零 AI；**1026 验收 5 条漂移全在批量模板路径** | `batch-service.ts:1618-1631` |
| 多供应商冗余 | 4 条线路里 mock 生产禁用、BytePlus 无 key、火山 401/欠费；**Shuyu 是单点**；批量无 failover 分支；能力状态文案「已自动切换备用线路」与事实不符 | `video-route-registry.ts:10-15`、`registry.ts:208-211` |
| 取消会停供应商扣费 | 取消从不到达供应商：Shuyu 无取消端点，`cancelVideoJob` 零调用方；取消 = DB CAS + 晚到结果丢弃；已提交任务照烧积分 | `shuyu-video-provider.ts:269-277` |
| 一致性圣经 / 视觉分析在起作用 | plan 阶段生成的 CHARACTER/LOCATION/PRODUCT 行在派发改写时**全部丢弃**，只保留 `*LOCK:` 与口播行；无 LLM 时所有商家共用写死的「late-20s 女性 + 公寓卧室」 | `storyboard-beats.ts:46-47,96-101`、`consistency-bible.ts:174-180` |
| 品类锁已通用化 | 5 品类锁表存在，但客户路径无品类字段；客户锁档只有 `sunnyshutter` 命中；`renderSafeCommercePrompt` 零调用方 | `client-lock-profiles.ts:44-60`、`generic-shot-policy.ts:82-129` |
| 链接起片用主图锚定商品 | `imageUrl` 抓到了、注释写「它就是产品锚点首选」，实际哪儿都不用 | `product-link-service.ts:21-22,502-509` |
| 数字人 / 口型同步有通道 | 数字人整链硬封印（`sealed`，任何 env/plan 都不能开）；OmniHuman / 火山 TTS 是抛错桩；仓库无 HeyGen / wav2lip / V2V 代码 | `digital-human.ts:1-13`、`omnihuman.ts:26-36` |
| 视频参考图经过抠图 | `processReferenceImages` 是 TODO 桩原样返回；真正的抠图在产品锚点，但锚点因无 remove.bg key 全部停 `PENDING_CUTOUT`，且锚点切片不进视频链路 | `remove-bg.ts:28-39`、`product-anchor-service.ts:54-62` |
| 故事板吃全部商家图 | 每帧入参截到 5 张且前帧占 2 位：商家传超过 3 张时，第 2 帧起只有前 3 张实拍进 Shuyu（API 允许 9 张） | `storyboard-service.ts:466-469` |

### 4.2 分段状态总览

**生成前（创意 / 脚本 / 参考）**
- production：34 配方三拍（HOOK 0-3 / PROOF 3-13 / CTA HOLD 13-15）；模板版本化；提示词预算与夹紧；口播稿按段注入；派发时按已确认故事板改写；链接起片（文本）。
- degraded：创意 brief / 分镜 / 一致性圣经 / 视觉分析四件全依赖 OpenAI，无额度即静默回启发式（且 `isLLMAvailable` 只看 key 存在不看额度，每次仍发请求再失败）。
- missing：**平台差异化**（TikTok/Reels/抖音只是由画幅推断的一行文字）；脚本结构没有统一契约（批量三拍 / 单条 LLM 4-6 镜 / 故事板 4 拍三套互不相通）；视频 hookType 无数据源。
- code_only：导演方法论（五档重拍分诊、八机制诊断、交付 QC）只是常量表，没接进任何路径；爆款分析（apify）只在 A 级下线的中台。

**生成中（供应商 / 派发）**
- production：Shuyu 语义化套餐审计 + 提交级降级冷却 + single-flight 探针 + 幂等键 + CAS 落库 + 熔断器 + 看门狗先问供应商再判死——**这块是全链路最扎实的部分**，0728/0804 的坑都修在这里。
- 硬上限：单段 5–15s、≤9 张参考图、720P（自限）、无音频字段、无首尾帧（Shuyu 从不发 `frames2video`）、无视频/音频参考。
- missing：批量 failover；Seedance 适配器不发幂等键；单条成本不回写实际套餐；USD 成本从不写入；供应商侧取消。

**生成后（合成 / 口播 / 字幕 / 品牌）**
- production：Vercel 进程内单遍合成（26s 出 15s 片）、ASS 字幕打包字体（1026 验收中文无方框）、语音安全裁尾、BGM 闪避 + loudnorm、自动品牌尾卡、SRT 导出、口播缺失则整条失败不交哑片。
- degraded：字幕时间轴（均分）、1080p（拉伸）、BGM 曲库 1 首、TTS 多语种靠猜。
- missing：逐词高亮、转场（`transitions` 恒 cut 且合成器根本不读）、声音克隆 / 情绪 / 语速、口型同步。

**质检 / 失败处理**
- production：清扫先对账再判死、按条额度返还（D1）、退额后重试先补扣、故事板 ACK_UNKNOWN 自愈、批次熔断、能力状态闸门诚实降级。
- missing：**商品 / 人物 / 运动质检**；**成片级质检**（拼接只 probe 轨道）；视频段级 ACK_UNKNOWN 无自动恢复；非质检失败的重试无上限。

**客户面 / 可编辑性**
- production：五步主流程、故事板单帧重抽 + 取消 + 刷新恢复、成片取消即返还、失败段重投 / 合成重拼、批量四步向导、模板库入口。
- missing：单帧换提示词 / 换参考图；**成片后局部重做（成功镜头点名重做、换口播、换字幕样式、换时长）**；时间线 / 分镜编辑；批量成片后期（**批量成片是裸片**：无字幕无 BGM 无口播）；多平台规格导出。

### 4.3 企业级清单对照（完整性审查员的 14 项裁决）

| 能力 | 我们 | 一句话 |
|---|---|---|
| 商品链接输入 | degraded | 只喂文本，主图不用，批量无入口 |
| 多参考一致性（产品/人物/场景） | degraded | 图像级只两处，人物无槽位，漂移无检测 |
| 原生口播 | degraded | 祈祷式，无音轨整条失败 |
| 口型同步 | missing | 只有一段提示词 |
| 单镜头重做 · 故事板帧 | production | ≤3 次，但不能换提示词/参考图 |
| 单镜头重做 · 成片后 | missing | 只能重投失败段或整条重来 |
| 时间线编辑 | missing | 两处「时间线」都是只读 |
| 变体矩阵 | degraded | 三维，无钩子/口播/主播 |
| 自动 QC + 重试 | degraded | 只查烧字且生产从未真跑 |
| 品牌套件 | production | 尾卡通；无品牌色/字体 token，自然植入 code_only |
| 团队协作 | missing | 单人工作区，无成员/审批 |
| API（租户级） | degraded | 只有系统间 CRON_SECRET 接口 |
| 发布直推 | wired_not_exposed | 青砚拉取，白名单默认空 |
| 投放回流 | wired_not_exposed | 图文有，视频 recipeId 恒 null |

## 5. 底层模型格局（2026-10）与选型建议

> 本节数字已经过第二轮对抗性核实（官方页面逐条核对，明细见 §7）。价格按 1 USD ≈ 7.1 CNY 估算；方舟/百炼价为「5 秒 16:9 示例」折算的每秒价，实际按 token 计费。

**关键变化**
- **Sora 2 API 已于 2026-09-24 停用**，Sora App 04-26 关停，无替代；**Veo 3.1 preview 三个 ID 10-22 从 Gemini API 关停**，替代是 gemini-omni-1.1-flash，GA 版在 Gemini Enterprise Agent Platform（原 Vertex）退役日 2026-11-17 或之后。任何「单绑一家」的选型都已经被打脸一次。
- 商品短视频第一梯队：**Seedance 2.5 与 Wan 3.0**——都能单段 30 秒、1080p、原生音频、≥10 张参考图、接受音频参考。差别在口型承诺：**Wan 3.0 官方文档写明参考模式支持音频驱动**（但参考音频合计 ≤15s）；**Seedance 2.5 官方只确认「纯音频参考生视频」，「精准对口型」只出现在示例提示词里，没有功能承诺**。
- **Kling 4.0** 2026-10-15 网页端全量（3–30s，10 图 + 5 视频 + 7 主体 Elements，10 关键帧，720p/1080p/4K）；可灵自家 API 仍 Coming Soon，**但 fal 已于 2026-10-23 向所有客户开放 `kling/v4/*`**（$0.157/s 720p、$0.235/s 1080p）。Elements 商品主体库正对准「商品跨镜一致」，应进 bake-off。
- 「Kling 3.0 口型超 8 秒漂移」查无官方或可查实测来源，标为待验证。
- MiniMax H3 Max：I2V 榜第一，fal $0.16/s。HeyGen Video 1：$0.01–0.015/s、768p，适合便宜草稿。

**对比（已核实）**

| 模型 | 分辨率 | 单段 | 原生音频 | 参考 | 对我们可开通的渠道 | 1080p 每秒 |
|---|---|---|---|---|---|---|
| Seedance 2.5 | 480p/720p/1080p 10bit（无 4K） | 4–30s | 有，`generate_audio=false` 可关 | 30 图 + 10 视频 + 10 音频（合计 50，音视频总长 ≤30s） | **BytePlus ModelArk（ap-southeast-1，加拿大在官方可售名单）**、方舟（需 +86 手机 + 国内支付）、fal `/us/` 端点 | 方舟 ¥3.74；fal US $1.164 |
| Seedance 2.0（Shuyu 现用） | 1080p（Shuyu 已在售） | 4–15s | 有（Shuyu 不透传） | 9 图 + 3 视频 + 3 音频（Shuyu 只 9 图，不支持纯音频输入） | 方舟 / BytePlus / Shuyu | 方舟 ¥2.48；Shuyu 240 点 |
| Wan 3.0 | 1080p | ≤30s | 有，**官方支持音频驱动** | 10 图 + 5 视频（≤15s）+ 5 音频（≤15s），总 ≤20 | **阿里云国际站 Model Studio**（新加坡 $0.05/0.10/0.20 每秒）、百炼（华北2 ¥1.2，7 折到 2026-10-31）、fal | 百炼 ¥1.2（prime ¥1.8） |
| Kling 4.0 | 720p/1080p/4K | 3–30s | 有 | 10 图 + 5 视频 + 7 主体（Elements）+ 10 关键帧 | **fal `kling/v4/*`**（10-23 开放）；可灵官方 API Coming Soon | fal $0.235（720p $0.157） |
| Kling 3.0 Omni | 4K | ≤15s | 有，含西语 | Elements（2–4 图或 3–8s 视频建主体）| 可灵 / fal | fal V3 Pro $0.112 无音频 / $0.168 有音频 / 叠 Elements 最高 $0.392；4K $0.42 |
| MiniMax H3 Max | 1080p | 15s | 立体声 | 9 图 + 3 视频 + 3 音频 | MiniMax / fal | fal $0.16 |
| Gemini Omni Flash 1.1 | 720p 原生（1080p/4K 为放大） | 3–10s，可延展至 40s | 有，**不支持音频参考** | 图 + 视频 | Gemini API / fal | ≈$0.10–0.15 |
| Veo 3.1 | 4K | 8s | 有 | asset 参考 | GA 版退役中 | $0.12–0.40 |
| Sora 2 | — | — | — | — | **已关停** | — |

**选型建议**
- **主力：Seedance 2.5，走 BytePlus ModelArk 国际站**（官方可售地区名单含加拿大、英国、澳大利亚、新加坡，只缺美国；开通门槛 Credits ≥ USD 30，USD 结算）。仓库已有 `byteplus_international` 线路与 `dreamina-seedance-2-0-260128` 适配器，改 model ID 到 `dreamina-seedance-2-5-260628` + 补 30/10/10 参考参数；生产 `BYTEPLUS_ARK_API_KEY` 目前未配置。火山方舟国内版降为可选第二通道（现有 volcengine 账号欠费，且需 +86 手机、支付宝/微信/对公汇款）。
- **并列主力（成本档）：Wan 3.0，走阿里云国际站 Model Studio**（同样海外主体可开通），1080p 成本约 Seedance 2.5 的 1/3；**口播镜头若实测口型相当，默认导向 Wan**（它才有官方的音频驱动承诺）。注意吞吐硬顶 RPS 5 / 并发 5。
- **第三梯队：fal**——既是兜底，也是**唯一的 Kling 4.0 API 通道**；Seedance 2.5 在 fal 必须用 `/us/` 端点才有 1080p。
- **Shuyu 降为第四**，但**先开它的 1080P 档**（两行改动）作为过渡——它仍是 Seedance 2.0：单段 15s、9 图、无音频、无音频参考。
- 特定镜头：已有视频重配口型用 Sync Labs（lipsync-2-pro $0.067–0.083/s；sync-3 $0.107–0.133/s，处理侧脸/遮挡/特写）；「静帧 + 音轨 → 近景口播」用 OmniHuman 2.0（BytePlus 已开放 API，口型档 **$0.12/s**，不是 $0.07——**仓库的 `omnihuman.ts` 是封存桩，归档版面向火山 1.x，与 BytePlus 2.0 的 host/region/version/req_key/body 全不兼容，接 2.0 等于新写 provider**）；logo 英雄镜头继续静帧合成；超分用保真档（ByteDance Upscaler $0.0072/s、SeedVR2、Topaz Proteus $0.02/s），但 **Topaz 官方没承诺保真档不改小字/logo**，要用 SunnyShutter 真实 logo 成片做 before/after。
- 放弃：Sora、Veo、Pika、Runway / Luma 自研模型。
- **到期风险（已核实）**：`openai-tts.ts:19` 写死 `tts-1`，2027-01-06 关停；**官方唯一推荐替代是 `gpt-realtime-2.1-mini`（Realtime 接口，不是简单 REST），`gpt-4o-mini-tts` 同日关停、不是替代品**。gpt-image-1 已于 10-23 关停，1-mini / 1.5 于 12-01 关停，官方替代写的是 gpt-image-2.5-sunburst/flare；仓库默认 gpt-image-2 当前无弃用标记（`openai-image.ts:177` 注释仍写 gpt-image-1，已过期）。

## 6. 差距与优先级：接下一轮新功能之前先做稳的四块

原则：**只动核心链路上客户每条片都会经过的点；每项都有可量化的验收；复用已有但没接上的代码优先于新写。**

### P0（核心稳，建议本轮）

**P0-1 质检从「查烧字」升级为「查漂移」，并把批量故事板纳入审帧**
- 为什么：1026 验收 12 条样片 5 条不过，失败模式**全是**人物/产品/场景漂移，而现有质检对此零覆盖；批量路径关键帧从未被任何人或 AI 看过。同行也没有成熟的自动漂移质检（§3.3）——做成就是差异化。
- 做什么：① 段级 frame-qa 增加「商品相似」与「人物一致」判据：抽帧与商家实拍 / 已确认故事板帧做 DINOv2 或 CLIP 相似度 + vision rubric（`storyboard-gacha.ts:23-56` 的评审 rubric 已含产品几何/同房同人/手部畸形，直接复用）；② 批量故事板 AUTO 审批后加一道 AI 审帧，不过的帧自动重抽（上限沿用 3 次）；③ 影子检查结果接一个运维视图，否则阈值永远校不准；④ 成片级抽帧复检（PRD §5 B5），只问「有无可读文字 / 假字标 / 与首帧同一商品」。
- 依赖：OpenAI 额度（CEO 已去充值）；或改用 Shuyu 图像侧 / 其他 vision 做兜底，避免再一次「无额度 = 全 SKIPPED」。
- 验收：34 模板样片重跑，人物/产品漂移漏检率 < 10%；批量 20 条首次通过率（`first-pass-rate-service`）相对 1025 基线提升可量化。

**P0-2 参考图策略：商品锚点与人物槽位进视频链路**
- 为什么：图像级锚定只有两处，人物完全靠文字锁；`remove-bg` 是 TODO 桩；故事板每帧只吃 3 张实拍。
- 做什么：① 配 remove.bg / Clipdrop key，让产品锚点走出 `PENDING_CUTOUT`，锚点 RGBA 切片进故事板与视频参考图（实拍在前仍保留）；② 新增 `AssetRole = person`（主播参考图 1–4 张），进故事板首帧与视频参考；③ 故事板入参上限从 5 提到套餐允许的 6（Shuyu 图像档 `input_images_max=6`），前帧占位从 2 改 1；④ 派发改写时保留 bible 的 CHARACTER/PRODUCT 行（现在被丢）。
- 验收：ugc-testimonial / unboxing / value-proof 三条此前漂移的模板重出过检。

**P0-3 供应商：开 1080P，接第二条直连，批量加 failover**
- 为什么：1080P 是拉伸、单点、单段 15s、无音频——参考片要的「一次多镜头 + 原生口播」在 Shuyu 上拿不到。
- 做什么：① `auditShuyuVideoPlan` 放行 1080P（`shuyu.ts:317-321`），把 1080P 档作为「成片档」、720P 作「草稿/抽卡档」，成本按真实点数计（1080P 15s ≈ 3,600 点/段，是 720P 的 2.3–2.9×，定价要跟着改）；② 用 **BytePlus ModelArk 开 Seedance 2.5**（加拿大在官方可售名单，≥USD 30 开通；改现有 `byteplus_international` 线路的 model ID 到 `dreamina-seedance-2-5-260628`，补 30/10/10 参考与 `generate_audio` 参数）和 **阿里云国际站开 Wan 3.0**，加上 **fal 的 Kling 4.0**，三家跑同一批 20 条 bake-off；③ 批量 `createBatchJob` 加 failover 分支，Seedance 适配器补幂等键；④ 单条成本回写实际套餐；⑤ 线路注册表新增国际站 Wan 与 fal 两个 adapter（现在只有 byteplus / shuyu / mock）。
- 前提（采购）：登录 BytePlus 控制台核验 Seedance 2.5 模型卡没有 Restricted 标记并充 USD 30；开阿里云国际站 Model Studio；fal 开户。火山 ARK 国内账号要么充值要么注销，不再当作备用线。
- 验收：同一批 20 条在 Seedance 2.5 / Wan 3.0 / Kling 4.0 上的成功率、P50 耗时、每条成本、人工 QA 通过率（商品一致 / 人物一致 / 口型）并列出表；吞吐按 Wan 并发 5、Seedance 企业并发 10（非刚性）重算批次 SLA。

**P0-4 口播与字幕：先 TTS、再驱动、再对齐**
- 为什么：口播是祈祷式，字幕是均分；参考片的「原生口播 + 逐词高亮」是它最像真人的两点。`tts-1` 2027-01-06 关停，而且 **`gpt-4o-mini-tts` 同日关停、不是替代**。
- 做什么：① **先定 TTS 供应商**：验证 `gpt-realtime-2.1-mini` 在生产 key 可用（它是 Realtime 接口，要改写 provider 与 capability-probe），否则换 BytePlus/火山 TTS、ElevenLabs 或 MiniMax；② **「音轨作参考驱动口型」先当假设实测**：Wan 3.0 有官方音频驱动承诺（参考音频 ≤15s，30s 片要拆两段），Seedance 2.5 没有承诺——两家各跑 5/10/15/30s × 近景/中景对口型测试再定主路线；③ **B 计划**：Seedance 2.5 `generate_audio=false` 出无声片 + 外部 TTS + Sync Labs sync-3 后置口型（$0.107–0.133/s）；④ Shuyu 线路保留「尽力说」，但字幕改用 TTS 时间戳 / whisper 对齐；⑤ 字幕渲染补 `\k` 逐词高亮（ASS 已定义 SecondaryColour，只差标签），恢复 karaoke 选项。
- 验收：字幕与语音偏差 < 150ms（whisper 对词）；口型对齐率人工 + 自动双判；口播完整性 gate 进生产管线（现在只在验收脚本里）。

**P0-5 成片后局部重做**
- 为什么：铁律 #7「失败不能只给重试」在生成前落地了，成片后仍是「重投失败段 / 整条重来」；同行全部支持单镜重做。
- 做什么：① `render-retry` 允许点名重做**成功**段（按 segmentIndex，重投后重拼，只计该段费用）；② 故事板 regenerate 接 body（换提示词 / 换参考图）；③ 换口播 / 换字幕样式走「只重拼不重生成」路径（零生成计费，`retryStitch` 已有雏形）。
- 验收：成品库详情页三个新动作真机走通，额度按段计。

### P1（下一轮）

- 变体矩阵：钩子 × 口播 × 主播三维变体，视频行写 hookType/recipeId 进赛马（`winner-derivation-service.ts:30-39` 只认 `post:` 前缀要放开）。
- 批量成片后期：批量向导接 AudioCaptionControls，不再出裸片（1025 计划 A2 待办）。
- 链接起片升级：主图进锚点、批量向导加链接入口、Firecrawl key 进 `.env.example`。
- 脚本结构统一契约：批量三拍 / 单条分镜 / 故事板四拍收敛为一套「痛点钩子 → 产品入场 → 逐点证明 → 解决 + CTA」节拍，按平台（TikTok / Reels / 抖音）出时长与字幕规则。
- 转场（xfade）与 BGM 曲库（≥5 首按情绪）。

### P2（企业级）

团队协作（成员 / 审批）、租户级 API key、发布直推（TikTok / Meta OAuth）、投放回流的视频维度、品牌色 / 字体 token。

### 清理（铁律 8，单独 PR，不与功能混）

code_only 且无路线图归宿的：`storyboard-gacha` vision 评审（P0-1 要接，留）、`category-lock-registry` + `generic-shot-policy`（P0-2 决定接或删）、`director-methodology`（删或接进重试分诊）、`logo-fidelity-gate`（接进 P0-1 成片级复检或删）、`asset-qa-service` / `director-service` / `brand-placement-policy`（旧中台，删）、数字人封印链（整体删或整体解封，不留半截）。

## 7. 第二轮核实结果与不确定项

对第一轮调研里驱动推荐的 **39 条事实**逐条去官方来源找反证：**20 条确认、16 条部分确认、2 条推翻、1 条查无来源**。改变建议的几条：

| 第一轮说法 | 核实结果 | 对建议的影响 |
|---|---|---|
| BytePlus 不向美/加/英/澳/新销售 Seedance | **推翻**：BytePlus 官方《International Availability》名单含加拿大、英国、澳大利亚、新加坡，只缺美国；Seedance 2.5 已在 ap-southeast-1 上线，开通 ≥USD 30，无国别条款 | 主力通道改为 BytePlus 国际站；方舟国内版降为可选 |
| 方舟必须中国大陆主体实名 | 部分：海外主体可走证件人工审核；真实门槛是 +86 手机号、支付宝/微信/对公汇款、余额 >¥200 | 同上 |
| Seedance 2.5 原生音频不可关闭 | 部分：`generate_audio=false` 可出无声视频 | B 计划（无声片 + TTS + Sync）成立 |
| Seedance 2.5 可用参考音频驱动口型 | 部分：30/10/10 参考与纯音频生视频有官方确认；**「对口型」只在示例提示词里，无功能承诺** | P0-4 主路线降为待实测假设；Wan 3.0 有官方音频驱动承诺 |
| Wan 3.0 ¥1.2/s 限时 7 折 | 部分：7 折到 **2026-10-31** 止；prime 版 ¥1.8 无折扣；限流另有 RPS 5 / 并发 5 | 成本按原价算；批次 SLA 按并发 5 重算 |
| Kling 4.0 API coming soon | 部分：可灵自家 API 仍 Coming Soon，**fal 已于 10-23 全量开放 `kling/v4/*`** | Kling 4.0 进 bake-off |
| Kling 3.0 Pro 口型 >8s 漂移 | **查无来源** | 标待验证 |
| fal Kling V3 Pro $0.14–0.39 | 部分：无音频 $0.112、有音频 $0.168、+voice $0.196、叠 Elements 最高 $0.392；$0.14 是 Turbo Pro | 成本表已改 |
| tts-1 替代是 gpt-realtime-2.1-mini 或 gpt-4o-mini-tts | 部分：**gpt-4o-mini-tts 同日（2027-01-06）关停**，官方唯一替代 gpt-realtime-2.1-mini（Realtime 接口） | P0-4 先定 TTS 供应商 |
| OmniHuman 2.0 ≈$0.07/s | 部分：$0.07 是影视级运镜档，**口型档 $0.12/s**；它是「单图 + 音频 → 视频」生成器，不是给已有视频重配口型 | 成本与用途已改 |
| 仓库 omnihuman.ts 可解封即用 | **推翻**：活动文件是封存桩；归档版面向火山 1.x（host/region/version/req_key/body 与 BytePlus 2.0 全不兼容） | 接 2.0 = 新写 provider |
| Claude 在 blender-mcp 里只做场景/灯光/相机 | 部分：README 明说 Claude 用 bpy 自行建模/材质/绑定；外部生成器只负责 AI 生网格 | §2.1 论证改为「深度图不携带贴图与 logo」 |
| FLUX.2 支持 10 张参考 | 部分：API 8 张、dev 6 张、klein 4 张；10 是 Playground 口径 | 已改 |
| Wan VACE 接法线 | 部分：官方控制类型无法线；Blender→VACE 只有社区模板，停在 Wan 2.1 | 反而强化 §2 结论 |
| NVIDIA 蓝图 2026-02-26 下架 | 部分：现标 Deprecated，日期只在索引快照里 | 措辞已改 |
| 保真档超分不改 logo | 部分：Topaz 承认生成式超分会把小字当纹理拼错；**保真档官方也没承诺「不会」** | P0-1 成片级复检加「超分后 logo 区域对比」 |
| TopView 可单镜重做 | 部分：官方只有画布选区局部修改 / 改提示词重出 clip | 单镜重做是我们自己的产品判断，不引 TopView |

全部确认的：方舟价格（¥3.74 / ¥1.51 / ¥2.48）、企业限流 RPM 600 / 并发 10、Seedance 2.0 9/3/3 + 4–15s、fal `/us/` 端点 $1.164 且加拿大不受限、Wan 3.0 规格与国际站可开通、Wan 开源止于 2.2、Sora 关停、Gemini Omni 不支持音频参考、gpt-image 弃用与仓库默认值、Kling 3.0 Omni Elements、Creatify / Arcads / Higgsfield / CapCut / Runway 的做法、Sync Labs 价格、fal 超分价格。

**动手前必须实测的承重墙**
- **Seedance 2.5 参考音频 → 口型**（P0-4 的承重墙，官方无承诺）：真实 TTS 音轨（中英各一）作参考，在 BytePlus 跑 5/10/15/30s × 近景/中景，人工 + 自动判对齐率；不达标则主路线改 Wan 3.0 或 B 计划。
- **Wan 3.0 音频驱动**：同一组音轨对比；验证参考音频 ≤15s 对 30s 口播片的影响（两段拼接还是只能 15s 带口型）。
- **BytePlus 加拿大账号**：登录核验 Seedance 2.5 模型卡是否带 Restricted 标记、能否以 ≥USD 30 开通、USD 单价与配额、参数是否与方舟版一致。
- **Kling 4.0 via fal**：同一脚本跑 UGC 口播 + Elements 商品主体，10/15/30s，看口型是否随时长漂移与商品跨镜一致性。
- **TTS 供应商**：`gpt-realtime-2.1-mini` 在生产 key 是否可用（/v1/models + 实出一段）；不可用则 BytePlus TTS / ElevenLabs / MiniMax。
- **保真档超分对 logo 的影响**：SunnyShutter 真实 logo 成片 before/after 像素级 + 人工对比，为 QC 定 logo 区域阈值。
- **B 计划端到端**：Seedance 2.5 无声片 + 外部 TTS + Sync sync-3，测质量与总成本（¥3.74/s + $0.107–0.133/s）。
- **批次吞吐**：Wan 并发 5 / RPS 5 与 Seedance 企业并发 10 下，20 条批次排队耗时实测，重算 SLA 与取消/重试策略。
- **Seedance 2.5 单段 30s 多镜头的商品与 logo 跨镜一致性**（30 张参考含 logo 近景），决定「logo 永不过 I2V」规则是否保留。
- 1080P 对 Shuyu 排队时长的影响（1026 已有 2 条 720P 排了 50 分钟以上）。
- DINOv2 / CLIP 相似度阈值要用我们自己的过检 / 不过检样片校准，不能抄论文数。

## 8. 给 CEO 的回复（可直接发）

> 看了你发的头盔片，拆了一遍：18 秒 7 个镜头、西语原生口播、逐词高亮字幕、头盔护目镜面罩在每个镜头里都一致。它是用多参考图 + 原生口播的视频模型（Seedance 2.x 这类）做的真人 UGC，不是 3D 建模。Blender 建模 + SD 那条路解决的是机位和运镜可控，对我们现在最痛的三件事——商品 / 人物在镜头间漂移、logo 被重绘、口播和画面对不上——没有作用，而且 SD 重绘会让 logo 更差（我们 0805 就在 Seedance 上踩过）。它只对硬质商品的 360 展示片有点用，如果你想验证，我设计了一个 2 天 50 美金的对照实验，B 组赢不了 C 组就停。
>
> 同行又顺又好不是模型比我们好，大家用的是同一批模型。差距在产品路径：链接起片、先锁静帧或一次出多镜头、只改坏掉的一镜、批量出变体。我们现在的真实状态是：质检只查有没有烧字不查漂移（上周 12 条样片 5 条因为漂移不过）、成片是 720P 拉成 1080P、口播是让模型「尽力说」、字幕时间是均分的、成片后不能单独重做一镜。这四块都在每条片都会经过的核心链路上。我建议下一轮先把这四块做稳（质检查漂移、1080P + 第二条线路、先 TTS 再驱动口播 + 字幕对齐、单镜重做），再接新功能。顺便：Seedance 2.5 走 BytePlus 国际站加拿大公司可以直接开（查过官方名单），不用再绕国内账号；OpenAI 额度充上以后质检才能真跑，另外 OpenAI 的 tts-1 明年 1 月关停，TTS 供应商要一起定。

## 附录：来源

**R1 CEO 路线**（Blender / 3D / SD）：[1] https://rits.shanghai.nyu.edu/ai/anthropic-plugs-claude-into-adobe-blender-and-ableton-with-nine-new-connectors/ (2026-04-28) · [2] https://github.com/ahujasid/blender-mcp · [3] https://arxiv.org/abs/2606.01057 (2026-05-31) · [4] https://hackernoon.com/how-i-stress-tested-3-ai-3d-generators-on-the-same-inputs-what-the-numbers-actually-show (2026-06-03) · [5] https://www.strayspark.studio/blog/generative-3d-tools-comparison-meshy-rodin-tripo-csm-2026 · [6] https://comfyui-wiki.com/en/news/2025-12-18-microsoft-trellis2-3d-generation · [7] https://blogs.nvidia.com/blog/rtx-ai-garage-3d-guided-generative-ai-blueprint/ · [8] https://build.nvidia.com/nvidia/genai-3d-guided · [9] https://discuss.huggingface.co/t/need-advice-maintaining-product-fidelity-texture-in-generative-ai-mockup-automation-stable-diffusion-gemini/172102 · [10] https://bfl.ai/blog/flux-2 · [11] https://9to5google.com/2026/02/26/nano-banana-2-gemini-app/ · [12] https://seed.bytedance.com/en/seedream4_5 · [13] https://hackernoon.com/a-guide-to-flux2-dev-fun-controlnet-union · [14] https://www.runcomfy.com/comfyui-workflows/blender-to-comfyui-ai-renderer-2-0-workflow-cinematic-video-output · [15] https://openrouter.ai/runway/aleph-2/api · [16] https://techcrunch.com/2025/12/18/luma-releases-a-new-ai-model-that-lets-users-generate-a-video-from-a-start-and-end-frame · [17] https://pixverse.ai/en/blog/seedance-2-0-review-prompts-and-use-cases · [18] https://kling.ai/blog/kling-video-3-0-ai-director-features-guide · [19] https://vercel.com/docs/functions/limitations · [20] https://devtune.ai/verticals/aiml-infrastructure-llm-tools/modal/pricing

**R2 竞品工作流**：[1] https://higgsfield.ai/blog/best-ai-platforms-create-ads-from-url (2026-10-13) · https://topview.ai · https://pippit.capcut.com/create/tiktok-shop-products · [2] https://creatify.ai/blog/seedance-is-now-in-creatify-asset-generator (2026-05-01) · https://kling.ai/quickstart/klingai-video-3-model-user-guide · https://woshipm.com/ai/6347590.html · https://novoads.ai/blog/arcads-review · https://heygen.com/en-gb/academy/avatars/how-to-add-products-to-your-avatar · [3] https://heygen.com/blog/heygen-april-2026-release · [4] https://runway.com/changelog · https://arcads.ai · https://the-decoder.com (2026-03-28) · [5] https://capcut.com/features/seedance-2-mini-for-ugc-ads · https://help.captions.ai/docs/project/ad-studio · https://icon.com/products/adspy · [6] https://blog.google/technology/ai/veo-updates-flow · [7] https://producthunt.com/p/creatify/ai-media-buyer-by-creatify · [8] https://figma.com/solutions/ai-brand-video-generator · https://pingwest.com/w/314884 · 吐槽：trustpilot.com/review/higgsfield.ai、trustpilot.com/review/arcads.ai、bbb.org、fluxnote.io/guides/makeugc-ai-review、creatify.ai/blog/the-8-best-ai-ugc-ad-tools-in-2026、segwise.ai (2026-03-23)

**R3 底层模型**：Artificial Analysis 榜 https://artificialanalysis.ai/video/leaderboard/text-to-video · 火山方舟价格 https://ark.volcengine.com/region:cn-beijing/docs/model-pricing · Seedance 2.5：https://fal.ai/learn/devs/how-to-use-seedance-2-5 · https://docs.together.ai/docs/seedance2.5-quickstart · https://cellcog.ai/blog/seedance-2-5-pricing/ · Wan 3.0：https://www.alibabacloud.com/en/news/product/video-generation-model-wan30-officially-launched-nsb · https://help.aliyun.com/zh/model-studio/wan3-0-video · Kling：https://kling.ai/blog/kling-video-3-0-credit-cost-guide · https://www.wireflow.ai/blog/kling-4-0-pricing · fal：https://fal.ai/pricing · https://fal.ai/minimax-h3-max · Gemini：https://ai.google.dev/gemini-api/docs/video · https://ai.google.dev/gemini-api/docs/omni · Veo：https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate · OpenAI 弃用：https://developers.openai.com/api/docs/deprecations · HeyGen：https://www.heygen.com/models/heygen-video · 口型：https://maxfusion.ai/blog/ai-video-models-lip-sync-2026 · https://sync.so/docs/models · 超分：https://fal.ai/learn/tools/video-to-video-upscalers · 聚合商：https://kinovi.ai/blogs/kie-ai-alternatives · https://openrouter.ai/collections/video-models

**第二轮核实（官方页面）**：BytePlus 可售地区 https://docs.byteplus.com/en/docs/ModelArk/availability (2026-04-21) · BytePlus 模型列表 https://docs.byteplus.com/en/docs/ModelArk/1330310 (2026-10-23) · 方舟模型列表 https://ark.volcengine.com/region:cn-beijing/docs/model-list · 方舟 Seedance 2.5 https://ark.volcengine.com/region:cn-beijing/docs/seedance-2-5 · 方舟视频 API https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api · 方舟价格 https://docs.volcengine.com/docs/ark/model-pricing · 火山实名 https://docs.volcengine.com/docs/6261/940503 · Seed 官博 https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5 (2026-07-31) · fal Seedance 2.5 US https://fal.ai/models/bytedance/seedance-2.5/us/text-to-video · fal ToS https://fal.ai/terms (2026-09-08) · Wan 3.0 API https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference · Wan 3.0 价格 https://help.aliyun.com/zh/model-studio/wan3-0-video · 百炼限流 https://help.aliyun.com/zh/model-studio/rate-limit · 阿里云国际站 https://www.alibabacloud.com/help/en/model-studio/model-pricing (2026-10-22) · Wan 开源 https://github.com/Wan-Video · OpenAI 弃用 https://developers.openai.com/api/docs/deprecations · Gemini 弃用 https://ai.google.dev/gemini-api/docs/deprecations (2026-10-22) · Omni Flash 模型卡 https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash · Kling 3.0 指南 https://kling.ai/quickstart/klingai-video-3-model-user-guide (2026-02-06) · Kling 4.0 https://kling.ai/dev/model-release/kling-4 · Kling 官方 X https://x.com/Kling_ai/status/2110747537187709424 (2026-10-15) · fal Kling 4.0 https://fal.ai/models/kling/v4/image-to-video (2026-10-23) · fal Kling V3 Pro https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video · Creatify https://creatify.ai/blog/seedance-is-now-in-creatify-asset-generator (2026-05-01) · Arcads 帮助中心 https://help.arcads.ai/en/articles/13281882-how-to-show-a-product-in-a-video (2026-01-06) · TopView https://www.topview.ai/canvas · Higgsfield https://higgsfield.ai/blog/best-ai-platforms-create-ads-from-url (2026-10-13) · CapCut https://www.capcut.com/features/seedance-2-mini-for-ugc-ads · Runway changelog https://runway.com/changelog · Anthropic https://www.anthropic.com/news/claude-for-creative-work (2026-04-28) · Blender Lab https://www.blender.org/lab/mcp-server/ · NVIDIA https://build.nvidia.com/nvidia/genai-3d-guided/blueprintcard · BFL 规格 https://help.bfl.ai/articles/6944273991-what-are-the-flux-2-technical-specifications · FLUX.1-dev 许可 https://huggingface.co/black-forest-labs/FLUX.1-dev/blob/main/LICENSE.md · VACE 配置 https://github.com/ali-vilab/VACE · ComfyUI VACE https://docs.comfy.org/tutorials/video/wan/vace · Sync Labs https://sync.so/docs/models · https://sync.so/docs/billing · OmniHuman 2.0 https://docs.byteplus.com/en/docs/byteplus-vision/omnihuman-2-0-video-generation (2026-10-14) · https://www.byteplus.com/en/product/omnihuman · fal 超分 https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video · https://fal.ai/models/fal-ai/seedvr/upscale/video · https://fal.ai/models/topaz/upscale/video/precision · Topaz https://docs.topazlabs.com/topaz-video/project-starlight-series/starlight-precise-25

**内部**：`docs/acceptance/2026-10-26-consolidation-round-acceptance.md`、`docs/acceptance/2026-10-25-reliability-round-acceptance.md`、`docs/roadmap/2026-10-25-consolidation-plan.md`、`docs/roadmap/2026-07-29-competitive-review.md`、Shuyu `/prices` 实时探针（2026-10-26，57 档）。
