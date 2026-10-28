# 商品主体轮：品牌跟着商品走（2026-10-28 计划，待评审）

起因：CEO 用测试账号拍保温杯，片尾冒出窗帘厂 SunnyShutter 的 logo 和「免费上门量尺」。Evan 的判断：
视频本身问题不大，问题是**品牌结合**——尾部加一帧品牌卡跟整条片子脱节；更好的做法是先把产品抠出来，
让产品自己带着 logo 进视频。方向参照 LibTV 这类企业级平台。

## 1. 代码里的现状（为什么会脱节）

| # | 事实 | 位置 |
|---|---|---|
| 1 | 「品牌包」是工作区级的 logo + 尾卡 + CTA + 电话，**跟商品无关**，逐视频选。闭环轮 dd6e751 又把它改成默认选中——保温杯配窗帘尾卡就是这么来的 | `streamlined-video-studio.tsx`、`src/lib/brand/default-brand-package.ts` |
| 2 | 故事板出帧提示词写着 `No text, subtitles, logos, watermark`，跟「商品自带 logo」直接冲突：模型可能把商品自己印的 logo 也抹掉 | `storyboard-service.ts:307` |
| 3 | 抠图通道已预埋：`ProductAnchor`（remove.bg / Clipdrop 抠图 + mask + logo 框 + 品牌名），品牌页也挂着 `ProductAnchorManager`；故事板留了 `anchor_cutout` 参考图槽位。**但 `anchorCutoutUrls` 从来没人写**（P02-E 没接），切片到不了视频 | `product-anchor-service.ts`、`storyboard-frame-inputs.ts` |
| 4 | 本地 `REMOVE_BG_API_KEY` 已配；生产是否配了没核实（P1 第一件事） | `.env.local` |
| 5 | 通用链路里夹着 SunnyShutter 客户专用分支：`sunnyshutter-*.ts` 5 个文件约 1600 行、`shutter-shot-policy`、`client-lock-profiles`（填品牌名会触发客户锁）、`brand-packaging.ts` 直接调 `applySunnyShutterBrandPack` | `src/lib/video-generation/` |

结论：品牌和视频是两套东西拼在一起的，商品身份（真正的品牌载体）反而没进视频链路。

## 2. LibTV 怎么解决

- **主体库**：用多张图或一段视频建一个可复用的「主体」（角色 / 商品 / 宠物），可智能补 2–3 个视角，
  一键生成主体描述并自动拼进后续提示词；目前绑 Kling O1 / O3。
- **抠图**是图像工具集里的基础功能；「焦点编辑」从多张图里抽元素再组合。
- **产品广告流程**（第三方实测）：脚本 → 分镜图 → 把产品图拖进画布，**替换每张分镜里的产品**再重出分镜 → Seedance 2.0 图生视频 → 剪辑。
- **我们 10-28 拆过的那条 TVC 画布**：产品单独一组（实拍多角度 + 多视图）；先出「禁止人物、宠物、产品」的空镜场景板，再往里放产品；
  每张参考图编号并写锁定范围（「唯一锁定产品形状、结构、比例和颜色」）；尾帧 / 海报是同一画风里单独出的一张图。
- **LibTV 没有「品牌包 / 模板尾卡」这个概念**：品牌露出靠商品本身，加一个同画风的产品定格。

这和 Evan 的直觉一致：品牌应该挂在商品上，不该挂在工作区上。

## 3. 开源项目与行业做法

| 环节 | 可选方案 | 许可 / 状态 | 本计划怎么用 |
|---|---|---|---|
| 抠图 | remove.bg、Clipdrop（都已接）；开源 BiRefNet | BiRefNet 为 MIT；BRIA RMBG 是非商用许可，避开 | 现在用 remove.bg，一个商品只抠一次；量上来后自托管 BiRefNet 省钱 |
| 产品放进场景 + 光影匹配 | IC-Light（lllyasviel，换背景 + 重打光），Replicate 上有托管版 | v2 许可需单独确认 | 第一版只做确定性贴回 + 接触阴影；IC-Light 列为回款后的 API 通道 |
| 物体插入 | Insert Anything（浙大，FLUX 系，开源） | 开源 | 备选，不在本轮 |
| 主体一致的视频 | SkyReels-A2（多元素生视频，定位就是产品演示）、VACE（阿里 Wan，参考生视频，ICCV 2025）；商用：Kling O 系主体、Seedance 2.0 全能参考 | 自托管要 GPU | 本轮继续用 Shuyu Seedance 2.5 + 参考图，把切片作为参考喂进去 |
| 人手持产品带货 | AnchorCrafter（研究项目，代码状态未确认） | — | 观察 |
| 运动镜头里 logo 变形 | 从业者共识：logo 必须与原稿一致时用真实像素合成；固定机位一条 ffmpeg，运动镜头要平面跟踪（corner-pin）；产品本身变形就重抽 | — | 本轮：定格镜头用真实像素；运动镜头靠切片参考 + 关键帧 QA 自动重抽；跟踪贴回放到回款后 |

## 4. 方案：品牌跟着商品走

核心：**「商品」成为一等公民**（对应 LibTV 的主体）。一个商品包括：名称、1–4 张实拍、抠图切片、自动描述（形状 / 材质 / 颜色 / 印着的字样），
以及可选的品牌名和一句 CTA。logo 就是实拍上的像素，商品自己带着。创作页第一步选商品，**不再选品牌包**。

### P0 · 止血（约 0.5 天，可单独上线）

1. 撤回 dd6e751 的「默认选中品牌包」，回到默认出干净视频。
2. 创作页隐藏「结尾联系方式帧」入口（A 级下线，代码保留），成片默认不带尾卡。
3. 出帧提示词改成：「不要**额外添加**文字、logo、水印；商品本身印着的 logo 和字样必须和参考图一致」；
   视频提示词里的 `PRODUCT INVARIANTS` 同步改。
4. 回归测试：提示词断言、默认不带尾卡。

### P1 · 商品库（对应 LibTV 主体库，约 2 天）

1. 核实生产的抠图 key；没有就先配上（Evan 来做）。
2. 「品牌」页改成「商品」页：上传 1–4 张实拍 → remove.bg 抠图（走现有锚点管线）→ LLM 看图写描述 → 生成商品卡。
   失败要写清原因，可以「换图」或「重新抠图」，素材保留；抠图任务可取消。
3. 数据：沿用 `ProductAnchor`，只加可空列（展示名、额外实拍、描述、CTA），走 `db:migrate:deploy`，**执行前单独确认**。
4. 创作页第一步「选商品」，也可以当场上传新图（自动建商品）。选中后自动带入实拍、切片和描述。

### P2 · 让商品进视频（把切图通道接到故事板，约 2–3 天）

1. 从商品建故事板时写入 `anchorCutoutUrls`（补上 P02-E）；参考图说明标明「第 N 张是商品切片，唯一锁定形状 / 颜色 / logo」。
2. 商品描述自动拼进故事板上下文（LibTV 主体描述的做法）。
3. 关键帧过 `logo-fidelity-gate`：商品 logo 走样就自动重抽一次（复用 `storyboard-gacha`），还不行就在帧上标出来让用户决定。
4. **商品定格取代品牌尾卡**：最后一镜固定为定格——先出同画风的空镜场景，再把抠图切片按真实像素贴进去
   （现成的 `compositeAnchorOnto`，补接触阴影），用 `still-motion-clip` 做缓推镜。品牌名和 CTA 用和字幕同一套字体压在画面上。
   这一镜是真实像素，logo 100% 准确，画风也和前面一致。电话 / 地址只有商家在这个商品上填了才出现。

### P3 · 一致性收口（单独提 PR）

1. 工作区品牌包冻结（B 级），之后单独提删除 PR（C 级），不和功能改动混。
2. SunnyShutter 专用分支从通用链路摘出来，只留给内部批量脚本；删除同样单独提 PR，按 A→B→C 走。
3. 全站用词统一叫「商品」：导航、创作页、成品库（卡片标明是哪个商品，可按商品筛选）、使用指南。

### 验收

真机跑一条带 logo 的商品（例如印着字的保温杯）：4 张关键帧 logo 对得上；定格镜头 logo 与原图逐像素一致；
片中不出现任何别的品牌；整个流程可取消。typecheck、lint、全量测试全绿。demo 账号不跑付费生成。

## 5. 回款后要开的 API 通道（按收益排序）

1. **IC-Light 重打光**（Replicate 托管）：解决定格镜头「贴上去」的假感，收益最直接。
2. **Kling O 系主体 API**：LibTV 主体库用的就是这个，多镜头商品一致性更强。
3. **运动镜头 logo 跟踪贴回**（分割 + 平面跟踪）：要自托管 GPU。
4. **BiRefNet 自托管**替代 remove.bg：纯省钱。
5. **同一提示词多模型择优**（LibTV 的做法）：成本 ×N，适合做付费「精修」档。

## 5.1 CEO 提议：换 / 加 Runway（2026-10-28 补充）

Runway 的开发者 API 现在是一个**模型聚合平台**，一个 key 能调的东西基本覆盖了上面第 5 节的清单
（价格取自 Runway 官方模型页，「起」为最低档，需开户后核实）：

| 我们要的 | Runway API 上的对应 | 起价 |
|---|---|---|
| 现在的 Seedance 2.5（Shuyu 卡在 VIP 720P） | `seedance2_5`，最长 30 s，480p / 720p / 1080p | $0.20 / 秒起 |
| LibTV 主体库同款的商品一致性 | `klingO3_pro` / `klingO3_standard`（支持参考图） | $0.13–0.17 / 秒 |
| 把商品换进已有镜头 | `aleph2`（视频改视频，可钉关键帧；Edit Studio 宣传支持换商品） | $0.28 / 秒 |
| 出关键帧 | `gpt_image_2`、`seedream5_*`、`gen4_image`（带参考） | $0.01–0.05 / 张起 |
| 配音 / 放大 | ElevenLabs v3 / v4、Magnific 视频放大 | — |

判断：

- **方向对，但它是「引擎」，不是答案。** 保温杯配窗帘尾卡、提示词让模型抹 logo、切片没接进视频——这些是我们产品结构的问题，换哪家模型都会照样出现。
  Runway 也没有专门保证 logo 准确的功能，靠的仍是参考图和关键帧；定格镜头用真实像素这一步仍然要做。
- **最大的好处是稳定。** Shuyu 是转售商，一直在漂移（套餐下架、积分改价、参考图 9→4、标准档下架只剩 VIP 720P）。官方 API 能少很多事故，还能直接上 1080p。
- **要注意的两点：**
  1. API 额度和网页版订阅是两个钱包，公司现在推广用的 Runway 订阅**不能**拿来付 API。
  2. 按秒计费不便宜：15 秒 Seedance 2.5 起步约 $3。要和 Shuyu 的真实单条成本比过再决定。
- 「Muse 也用 Runway」没查到确证；Runway 的模型列表里有一个 `muse_image` 图像模型，可能是 CEO 看到的那个。

落地方式（CEO 已批，2026-10-28 晚已接好，等 key）：

1. P0 已完成（6559734）。
2. 已接好的部分：
   - `src/lib/providers/runway.ts`（HTTP 客户端）与 `runway-video-provider.ts`（实现 VideoProvider）。
   - `runway` 线路已注册，适配器为 Runway，模型为 Seedance 2.5；派发、轮询、取消都按线路快照走。
   - Runway 产出 24–48 小时过期：成功时先转存到自己的 blob，再交给拼接，以免几天后重拼、换字幕找不到这一段。
   - 开关：
     - `RUNWAYML_API_SECRET`：key。
     - `VIDEO_CUSTOMER_ROUTE=runway`：把客户线路切到 Runway，缺省仍是 Shuyu。
     - `RUNWAY_VIDEO_RESOLUTION=1080p`：缺省 720p，最便宜。
   - 单测全过；真机未验证。
3. key 到了怎么验：先只在本地 `.env.local` 配上 key 和 `VIDEO_CUSTOMER_ROUTE=runway`，用 CEO 测试账号走一遍真实界面。
   在成品库对本轮 E2E 那条 NORDA 测试订单点「重新生成」（同一张图、同一段描述），跟 Shuyu 出的那条比 logo、成本和耗时。过了再在 Vercel 上拨开关。
4. 还没做：
   - 员工线路选择器（`video-route-options` 契约仍只有 Shuyu）。
   - Kling O3 / Aleph 的线路，现在只在适配器里。
   - 故事板出帧仍走 Shuyu 图像接口（Runway 也有 GPT Image 2，可后续切过去）。
   - Runway 的参考音频可以补上「参考音频口播」（P04-E）。

来源：[Runway API 模型列表](https://docs.dev.runwayml.com/guides/models/)、
[API 额度与订阅分开计费](https://www.eesel.ai/blog/runway-ai-pricing)、
[Aleph 2.0 换商品与关键帧](https://help.scenario.com/articles/6499445829-runway-aleph-the-essentials)

## 6. 需要 Evan 拍板

1. 品牌尾卡：**直接下线**，还是改成上面的「商品定格 + CTA」？（建议后者）
2. 联系方式（电话 / 地址）：挂到商品上作为可选项，还是干脆不要？（建议挂商品、默认不出）
3. P1 的生产库加列：到时候单独确认再执行。

## 来源

- LibTV 主体库 / 抠图 / 焦点编辑：[LibTV 全攻略（CSDN）](https://deepseek.csdn.net/6a3207ef662f9a54cb803c49.html)
- LibTV 产品广告流程：[我用哩布哩布 LibTV 做条产品广告（搜狐）](https://www.sohu.com/a/1022278439_121124370)
- LibTV 主体库锁商品三视图：[LibTV 节点式工作流教程（CSDN）](https://blog.csdn.net/Harrytutu_ZuiYue/article/details/162815335)
- LibTV 官方 skill 仓库（只有会话接口）：[libtv-labs/libtv-skills](https://github.com/libtv-labs/libtv-skills)
- 我们自己的 TVC 画布拆解：[2026-10-28-libtv-generation-teardown.md](2026-10-28-libtv-generation-teardown.md)
- IC-Light 与 BiRefNet、RMBG 许可：[IC-Light（ComfyUI wiki）](https://comfyui-wiki.com/en/models/ic-light)、[Background Replacement Using BiRefNet](https://debuggercafe.com/background-replacement-using-birefnet/)
- SkyReels-A2 / VACE：[SkyReels-A2 工作流](https://www.runcomfy.com/comfyui-workflows/skyreel-a2-element-to-video-e2v-technology)、[VACE](https://gittrend.io/repo/ali-vilab/VACE)
- Insert Anything：[comfyui-wiki 介绍](https://comfyui-wiki.com/es/news/2025-05-09-insert-anything-image-insertion-framework)
- AnchorCrafter：[arXiv 2411.17383 概览](https://www.alphaxiv.org/overview/2411.17383)
- logo 变形的处理方式：[Fix Logo Distortion in AI Video](https://blog.laozhang.ai/zh/posts/fix-logo-distortion-ai-product-video)
- Seedance 2.0 参考图做产品广告：[Opus 指南](https://www.opus.pro/blog/product-photo-to-commercial-seedance)、[Atlas Cloud 全能参考指南](https://www.atlascloud.ai/blog/generative-ai-model-seedance-2-0-a-guide-to-all-round-reference)
