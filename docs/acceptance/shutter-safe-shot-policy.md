# SunnyShutter 客户锁死前置（安全镜头 / 五锁 / 故事版）

> 用途：基于 2026-07-19 CEO 对现有成品的反馈，约束 Seedance / 火山出片策略。  
> 目标：把「可商用通过率」做高，而不是承诺零幻觉。  
> **客户范围：仅 `sunnyshutter`（Sunny Shutter）——该客户名下所有产品共用本套通用锁死前置。**  
> **其他客户：默认不启用。** 后续接入新客户时，再单独讨论并新增其 `ClientLockProfileId` 模版。  
> 工程入口：`src/lib/video-generation/client-lock-profiles.ts`

---

## 1. 总原则

1. **模型擅长整扇开合与光影，不擅长细杆 + 手部精密操作。**
2. **产品外观以参考图为真值；运动只做模型做过的简单机械动作。**
3. **品牌信息（logo / CTA / 电话 / 地址）一律后期叠，不让模型写字。**
4. **原生配乐默认关闭**；BGM 后期铺，避免「燥点」。
5. **宁可少动、少碰，也不要追求“演示拧中杆”的高难度镜头。**

---

## 2. 安全镜头白名单（优先拍）

以下镜头允许进入批量模板 / 验收脚本，默认安全：

| 优先级 | 镜头类型 | 画面要求 | 为什么相对稳 |
|--------|----------|----------|--------------|
| P0 | 静景产品墙 | 整墙 / 整窗百叶，相机微推或固定，人不出镜或远景站立 | 无手物交互 |
| P0 | 光影穿过叶片 | 日光透过叶片在地板打出平行光影，叶片角度固定或极慢统一倾角 | 平行线变化小 |
| P0 | 整扇绕铰链打开 | **整块面板**像门一样绕侧边铰链开合，露出窗外；手可不入镜或只轻扶边框 | CEO 说「像门」——模型更懂门 |
| P1 | 人站景指景 | 人物站在百叶旁，手势指向产品，**不接触中杆 / 不拨叶片** | 避免细结构交互 |
| P1 | 房间氛围切换 | 同一房间不同景别（全景→中景），产品静止 | 一致性压力低 |
| P2 | 缓慢统一倾角 | 所有叶片同步、缓慢改变倾角；**无手入镜**；中杆保持一根连续直线 | 可试，但需人工过检 |

**白名单口播可配动作（示例）：**

- “整墙定制、量尺安装” → 静景 / 全景  
- “需要采光时，整扇打开看风景” → 整扇铰链开合  
- “想调节光线，轻轻一倾” → 无手的缓慢统一倾角（可选）  
- “预约免费上门量尺” → 人物对镜说话，产品作背景  

---

## 3. 禁拍清单（默认禁止进模板）

出现以下任一描述，**脚本层应拒绝或改写**，不要提交给模型碰运气：

| 禁止项 | CEO / 实测对应问题 | 处理 |
|--------|-------------------|------|
| 手指拧 / 握 / 拨 **tilt bar（中杆）** 特写 | 中杆断裂、手糊进杆、锯齿伪结构 | 改成整扇开合或无手倾角 |
| 单根叶片被手指单独拨动 | 叶片融边框、间距崩坏 | 删动作 |
| 快速折页、连续开关多扇 | 运动轨迹错、场景重贴 | 最多 1 扇、慢速一次 |
| 相机贴脸扫一遍密叶片 | 平行线几何变形 | 拉远到中景/全景 |
| 要求模型“演示复杂五金结构” | 幻觉发明零件 | 只说结果（光线/隐私），不讲内部机械 |
| 模型内烧 logo / 字幕 / 电话 / 地址 | 品牌幻觉与错字 | 走 brand-overlay + end-card |
| 依赖模型原生 BGM / 嘈杂配乐 | BGM 燥点 | `generate_audio: false` 或仅口播环境音 |

---

## 4. Prompt 前置条件（必贴块）

每条 Seedance prompt 在产品描述后、分镜时间轴前，插入以下英文约束块（可按模板复用）：

```text
PRODUCT MECHANICS PRECONDITIONS (must obey):
- These are plantation shutters (solid louvers on a hinged panel), NOT a door and NOT curtains.
- Allowed motions only: (1) whole panel swings open/closed on side hinges like a door; (2) all louvers tilt together slowly as one unit; (3) camera move with shutters static.
- Forbidden: fingers gripping/twisting the thin vertical tilt bar; broken/discontinuous tilt bar; jagged teeth on the tilt bar; melting hands into wood; inventing hardware; uneven louver spacing; warping frames.
- The vertical tilt bar, if visible, must remain one continuous straight rod — never split, float, or offset.
- Keep shutter geometry identical to the reference images: louver width, frame color, panel layout, hinge side.
- Prefer medium/wide shots. Avoid extreme close-ups of hand-on-tilt-bar.
```

中文脚本侧给策划的对应口径（不必原样进模型）：

- 这是**实木百叶窗扇**，不是布艺窗帘，也不是普通门（但**整扇开合可以按“像门一样绕铰链”来演**）。  
- 只允许：整扇开合 / 全体叶片同倾 / 产品静止。  
- 禁止：手拧中杆、单片拨动、中杆断裂或长刺。  

---

## 5. 音频政策

| 项 | 政策 |
|----|------|
| Seedance `generate_audio` | 默认 `false`（广告片）；若需要口播再开，并禁 BGM |
| BGM | 后期 FFmpeg 铺自有床，响度按现有 stitch / loudness 流程 |
| 验收拒收 | 出现爆音、循环毛刺、不明“燥点” → 重铺音频，不重生成画面（除非口播也坏） |

---

## 6. 人工 / 抽帧拒收标准（出片门禁）

任一命中 → **FAILED，不进品牌包装，不给客户**：

1. 中杆断开、错位、悬浮、锯齿状伪结构  
2. 手与百叶“融化”、手指数量/关节明显错  
3. 叶片间距明显不均、边框弯曲扭曲  
4. 开合运动像错误物体（乱变形、穿模、重影重贴）  
5. 参考图中的房间/窗型被改成另一套产品  
6. 画面内出现乱码字、假 logo、假电话  

抽帧建议：每条至少看 **0s / 中点 / 动作峰值帧 / 末帧**；有手部镜头再加 2 帧特写。

---

## 7. 和现有成品的映射（便于复盘）

| CEO 原话 | 归类 | 本政策对应动作 |
|----------|------|----------------|
| 模拟运动轨迹出现问题 | 禁拍 / 简化运动 | 禁复杂折页；只保留整扇慢开 |
| 变形 | 门禁拒收 + 少特写 | 密叶片特写降级为静景 |
| 场景重贴 | 少切镜、强参考、短运动 | 15s 内动作 ≤ 1 次 |
| BGM 燥点 | 音频政策 | 关原生配乐，后期铺 |
| 运动不对 | 前置条件 | 明确允许/禁止运动 |
| 得要 + 前置条件；这东西和门一样 | 前置条件 + 白名单 | 整扇铰链开合作为主演示 |
| 布艺以前不错，百叶本身难 | 品类预期 | 不承诺零幻觉；用策略换通过率 |

---

## 8. 五锁 + Image2 故事版优先（同行建议）

同行口径：要把「跑偏」压住，必须**锁死**下面五项，并**先用 Image2（`gpt-image-2`）生成故事版关键帧**，再提交 Seedance。  
同行口头提到「成功率才有 90%」——这是**经验主张，不是本仓库的 SLA / 保证**；工程上只承诺硬闸与拒收，不承诺通过率数字。

| 锁 | 意图 | 代码现状 |
|----|------|----------|
| 锁人物 | 身份/着装/年龄不漂 | `renderSafeShutterPrompt({ characterLock })` → `CHARACTER LOCK` 文案块；**未**做人脸 embedding 校验 |
| 多角度锁产品 | 参考图为产品真值 | `productLock` + 上传 product/reference 图；`quality-reviewer` 在 i2v 模式拦缺图 |
| 锁剧情 | 分镜节拍不发明动作 | `beats` → `PLOT LOCK`（必填）；仍是文本锁 |
| 锁声音语气 | 口播语气/环境音 | `voiceLock` → `VOICE/TONE LOCK`；**未**接 TTS 参数硬校验 |
| 锁微表情 | 表情幅度 | `microExpressionLock` → `MICRO-EXPRESSION LOCK`；**未**做帧级表情模型 |

### 8.1 Image2 故事版优先（硬步骤）

顺序固定：

1. **Image2 / gpt-image-2** 出每镜关键帧（或人工审过的 keyframe PNG）  
2. 人工过故事版（可选但强烈建议）  
3. **再**把关键帧作 first_frame / reference 提交 Seedance  

已有实现参考：

- Provider：`src/lib/providers/openai-image.ts`（内部代号 Image 2，默认 `gpt-image-2`）  
- 完整 Phase 流水线：`scripts/sunny-shutter-investor-demo-v21.ts`（Phase 1 storyboard → Phase 2 submit）  
- 可复用门禁：`src/lib/video-generation/storyboard-lock.ts` → `requireStoryboardBeforeVideo`

产物契约（canonical）：

```json
{
  "source": "openai_image2",
  "model": "gpt-image-2",
  "purpose": "shutter-acceptance-storyboard",
  "frames": [
    { "id": "frame-1", "order": 1, "imageUrl": "https://…/01.png", "beat": "…" },
    { "id": "frame-2", "order": 2, "imageUrl": "https://…/02.png", "beat": "…" }
  ]
}
```

也兼容 investor-demo 的 `StoryboardRecord`（`segments[].blobUrl`）。

---

## 9. 工程硬闸（已落地）

代码真相源（比本文档更硬）：

| 层 | 位置 | 作用 |
|----|------|------|
| 镜头枚举 | `shutter-shot-policy.ts` → `ALLOWED_SHOT_MOTIONS` | 只允许 4 种运动；非法 motion 直接 throw |
| Prompt 渲染器 | `renderSafeShutterPrompt` | 强制注入机械前置条件 + 五锁字段（人物/产品/剧情必填 beats；其余按传入注入） |
| 自杀镜头门禁 | `quality-reviewer` → `shutter_*` blocker | 手拧中杆等 **canDispatch=false** |
| 故事版优先门禁 | `storyboard-lock` + `quality-reviewer` → `missing_image2_storyboard` | 含 `PLOT LOCK` / `PRODUCT MECHANICS` 的 prompt **缺 Image2 帧则不可 dispatch** |
| 验收脚本 | `scripts/real-video-acceptance-30s.ts` | 新提交 Seedance 前 `requireStoryboardBeforeVideo`（读 `tmp/real-video-acceptance/storyboard.json` 或 `ACCEPTANCE_STORYBOARD_JSON`） |
| Investor demo | `sunny-shutter-investor-demo-v21.ts` | Phase 1 无 storyboard → Phase 2 不 submit |

### 续跑勾选

- [x] 30s 口播段改为安全镜头渲染器（整扇开合 / 无手倾角 / 只指不碰）  
- [x] 前置条件块 + 五锁进入 `renderSafeShutterPrompt`  
- [x] `quality-reviewer` / `checkSeedancePromptStatic` 硬拦截自杀镜头  
- [x] Image2 故事版优先契约 + `requireStoryboardBeforeVideo` fail-closed  
- [x] 验收脚本新提交前强制故事版 JSON  
- [ ] 统一 supervisor / plan API 自动跑 Image2 故事版（目前需脚本或手工落 JSON；未做大 UI）  
- [ ] 五锁除文案外的运行时校验（TTS / 微表情模型）  
- [ ] 15s 批量模板文案全面对齐白名单（dispatch 已被门禁兜底）  
- [ ] 所有真实提交默认 `generate_audio: false`（口播需求另开特例）  
- [ ] 品牌包装前人工抽帧 checklist（第 6 节）  
- [ ] 报告拒收原因码：`tilt_bar_break` / `hand_melt` / `geometry_warp` / `bad_motion` / `bgm_noise`

---

## 10. 对内预期（跟业务对齐用）

- **可控：** 镜头选择、音频、品牌包装、拒收重抽、降低手部特写比例、**故事版优先硬闸**。  
- **部分可控：** 变形、错运动、场景重贴——能降频，不能清零。  
- **不可靠承诺：** 每次手拧中杆特写都物理正确；**不承诺 90% 通过率**（同行经验数字，非保证）。  
- **同行参考：** 同类 Seedance 路线同样受模型天花板限制；差异主要在模板是否敢拍自杀镜头、是否先 Image2 锁分镜，以及有没有人工门禁。

---

## 11. 强制真实广告尾卡（logo + 电话 + 地址）

> 每一条 SunnyShutter 视频结尾必须接这家客户的真实广告尾卡，不得省略。  
> 代码：`src/lib/video-generation/sunnyshutter-brand-pack.ts`

| 字段 | 锁定值 |
|------|--------|
| 电话 | `647-857-8669` |
| 地址 | `690 Progress Ave, Unit 7&8, Scarborough, ON` |
| Logo | `public/brand/sunny-logo.png`（本地；prod 走 Blob，目录 gitignore） |
| Logo 角标位置 | **左上角**（CEO 锁死；禁止右下角） |
| 尾卡底图 | `assets/sunnyshutter/end-card-9x16.png`（16:9 另有一份；可提交） |
| 时长 | 3s |

工程行为：

1. `buildBrandPackagingPlan` 对 `sunnyshutter` **强制** `auto_end_card` + 上表联系方式（即使用户选 `none`）。  
2. `quality-reviewer` 缺电话/地址 → `sunnyshutter_end_card_*` blocker，不可 dispatch。  
3. `brand-end-card-renderer` 优先铺设计底图，再叠**精确**品牌/电话/地址字（不交给模型写字）。  
4. 全程 logo 水印：`SUNNYSHUTTER_LOGO_OVERLAY_PLACEMENT = top-left`（`applySunnyShutterLogoOverlayLock` 强制覆盖任何 bottom-right / top-right）。  
5. 重生尾卡底图：`npm run brand:sunnyshutter:end-card`

---

## 12. SunnyShutter 电商专用模版族（批量固定）

> CEO 质量风格标准（2026-07-19 录屏 + 微信）：**多 CTA**、**土土的硬广 OK**、**产品不变形**；结构仍是钩子 → 冲突/对比 → 回归产品 + 强制尾卡。  
> 代码：`src/lib/video-generation/sunnyshutter-commerce-template.ts`  
> 家族：`sunnyshutter-commerce-cta`（**11** 个风格/剧情变体，batch10 轮转）

### 风格车道（对齐 CEO 喜欢的 TikTok）

| lane | 参考感 | 用途 |
|------|--------|------|
| `cozy_warm_lifestyle` | 暖光治愈家居 | 暖灯 / 纹理 / 生活感，但仍收硬 CTA |
| `pov_before_after` | POV 空房前后对比 | 基础窗饰 → 定制百叶 |
| `hard_sell_presenter` | 高能量硬广主持人 | 土一点、急一点、指景卖点 |
| `product_hero_proof` | 产品几何稳定英雄镜 | 强调不变形 + 卖点 |

### 变体 slug（节选）

| slug 后缀 | lane | 安全运动 |
|-----------|------|----------|
| `-glare` / `-privacy` / `-comfort` / `-view` / `-geometry` / `-morning` | hero / cozy | 静景 / 整扇 / 无手倾角 |
| `-presenter` / `-hard-sell` | hard_sell_presenter | `presenter_point_only` |
| `-cozy` / `-night-privacy` | cozy_warm_lifestyle | 静景 / 整扇 |
| `-pov-ba` | pov_before_after | `static_product` |

批量验收：

```bash
npm run acceptance:sunnyshutter:batch10
ACCEPTANCE_SUBMIT=1 npm run acceptance:sunnyshutter:batch10:submit
```

种子即全部 `BATCH_STYLE_TEMPLATE_SEEDS`（**通用风格库已下线，仅 SunnyShutter**）。  
上线/本地跑一次 `seedBatchStyleTemplates`：写入缺失 SunnyShutter 行，并 **归档** 其它 ACTIVE 通用模版。

---

## 13. Shades / Curtains 附加锁（2026-07-20 CEO WeChat）

> 适用产品：`roller_blackout` / `zebra` / `sheer_sfold`（卷帘 / 斑马帘 / S 褶纱帘）。  
> 代码：`sunnyshutter-shade-template.ts` + `sunnyshutter-shade-pipeline.ts`（家族 `sunnyshutter-shade-cta`，10 变体，Plan A ≈ 6 卷帘 + 2 斑马 + 2 纱帘）。

### 13.1 拉珠侧边硬锁（写死）

- 拉珠 / 珠链 / 循环拉绳 **只允许出现在帘头左边缘或右边缘**（变体里 `pullSide` 锁定具体侧）。
- **禁止**：拉珠居中、飘在窗中间、脱离侧轨。故事版评审与人工抽检均按此一票否决。

### 13.2 窗户主角锁（CEO：「重点是窗帘，把故事版的重点放窗上」）

- 故事版每一帧：**同一扇窗 + 窗饰是画面主角**（约占画面一半以上、完整入画、机位角度不变）。
- 人物只做配角，永不遮挡产品；`product_only` 变体可完全无人。

### 13.3 单场景防幻视锁

- 全片一个房间、一扇窗、一个机位；节拍推进只靠画面内真实运动（帘动 / 人动）。
- **禁止**交叉溶解 / 叠影 / 双重曝光 / 房间变形切换（v1 成片曾出现卧室→办公室→客厅漂移 + 人帘叠影幻视）。

### 13.4 故事版抽卡 + 择优（一致性关键路径）

- 每帧并行生成 N 个候选（默认 3，`STORYBOARD_GACHA_CANDIDATES` 可调），vision 评审按
  「窗主角 / 同房同窗同人 / 拉珠侧边 / 零文字」打分择优；评审不可用时 fail-open 取第一张。
- 帧 2/3 生成时把**已选前帧作为首个输入图**（图像锚定，不再纯靠文字锁一致性）。
- 代码：`src/lib/video-generation/storyboard-gacha.ts`。

### 13.5 裁尾 + 帧质检

- 品牌包装前一律 `trimVideoTail` 裁掉原片最后 0.8s（Seedance 假名片幻觉高发区），再接真尾卡。
- 下载原片后跑 `runFrameTextQa` 抽帧文字质检，结论写进验收报告 `frameQa` 字段（fail-open，仅记录）。

### 13.6 人工抽检清单（发片前）

1. 拉珠是否只在侧边；2. 有无任何模型画的文字 / logo / 假名片；3. 房间与人物是否全程一致、无叠影；
4. 左上角 logo 是否清晰无重合；5. 尾卡电话 `647-857-8669` 与地址是否正确。
