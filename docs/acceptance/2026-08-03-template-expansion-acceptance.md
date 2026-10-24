# 模板库扩容真机验收记录(2026-08-03,0804 增补)

> **0804 终态**:目录 34 条(无缝循环两轮未过循环点验收被砍);26 个扩容模板中
> **18 条真机样片过检并上线**,8 条仍在续跑/重掷(triple-proof·pet·home·food·
> fashion·outdoor·dual·gift),不阻塞营销测试。当天另根治了 Shuyu 套餐轮换假停机
> (语义化动态解析+多套餐可选+提交级降级,见 main 提交记录),并揪出三台「旧代码
> 收割机」进程(周末残留 next start:3210、dev server 旧 chunk、tsx 编译缓存)——
> 它们伪装成供应商故障猎杀同库任务多轮。管线缺口两处待修:①故事板单帧
> ACK_UNKNOWN 会判死整个 run 并把任务悬死在 QUEUED;②波内 deadline 翻页会把
> 已提交仍在渲染的任务孤儿化,配合硬 timeoutAt 造成「供应商还在渲染却被扫成失败」。

> **1025 增补**:对 0805 已入库(未上白名单)的 4 条样片补做第四轮人工 QA——
> 户外实战场景、食欲声色过检上白名单;穿搭动线、萌宠陪伴时刻不过。目录真机样片
> **28/34**,剩 6 条待补:一点三证·萌宠陪伴·家居空间·穿搭动线·一物双景·礼盒仪式感。
> 详见文末「1025 第四轮 QA」。

范围:27 个新模板逐条真机出样(设计:[扩容决策](../roadmap/2026-08-03-template-library-expansion.md))。
线路:客户主线路 buddy(Shuyu image2video `studio-video`,900pt/条),持久化批量管线
(含故事板锚定),复用 batch20 验收套路 + 分波提交。参考图:gpt-image-2 真机生成
31 张(10 个无品牌产品集)落 blob 并注册 MediaAsset。QA:逐条 15 帧接触表人工全检。

## 结果总览

| 状态 | 数量 | 模板 |
|---|---|---|
| ✅ 样片过检,资产+白名单已上 | **9** | 口播真人实测·播客对谈背书·创始人自述·街头随机安利·情绪钩子快切·多色阵列·开箱全家福·掌上真实比例·上妆质地演示 |
| 🔁 出片成功但 QA 不过,配方已修(升版)待重出 | 9 | 一点三证·真实反应种草·数码功能聚焦·旅行收纳动线·晨间仪式感·同机位前后对照·环绕产品秀·无缝循环钩子·暗调奢品光影 |
| ⏸ 未出片(供应商双线中断) | 9 | 材质微距巡礼(供应商失败 1 次)·第一视角上手·一物双景·萌宠陪伴时刻·家居空间焕新·穿搭动线·食欲声色·户外实战场景·礼盒仪式感 |

首轮真机通过率 9/18=50%,全部失败模式都定位到配方语言层并已修复(见下)。

## QA 失败模式与修复(全部真机复现)

| 失败模式 | 命中模板 | 修复 |
|---|---|---|
| 多宫格拼贴/分屏(模型把"多角度/反应+产品"拼成 grid) | 一点三证、真实反应种草、暗调奢品光影 | **框架级** PRODUCTION LOCK 加单画幅铁律 + 负面词(split screen/grid collage/tiled panels/PiP);一点三证 beats 另加"任一时刻只有一个满幅镜头" |
| 道具违规(陶瓷假耳人台、道具笔记本烧第三方 logo) | 数码功能聚焦、旅行收纳动线 | 框架级道具纪律(no mannequins/body-part props/third-party logos)+ 两模板 beats 显式禁令 |
| 产品身份漂移(钢盖变圆顶+钢环;复制出第二只表) | 一点三证、无缝循环钩子、暗调奢品光影 | beats 加部件保真("lid, cap, every part keep exact referenced shape")与唯一实例锁 |
| 模板核心运动未兑现(环绕变拉远;前后对切变人物摆放+叠化) | 环绕产品秀、同机位前后对照 | beats 把运动写成不可回避的物理描述(视差持续扫过/单次硬切/禁叠化/禁人物) |
| 产品包装未入画(参考里的咖啡袋全程缺席) | 晨间仪式感 | beats 要求包装/本体至少清晰入画一次 |

框架修订 `COMMERCE_FRAME_REVISION=1`:全目录 35 模板统一升版重 seed(生产库 129 行,
ACTIVE 35,旧版本全部归档保留 FK 溯源)。修订后配方尚未真机复验(供应商中断),
重出即用新框架。

## 供应商中断证据(验收被迫中止的原因)

- **Shuyu(buddy)**:17:49Z 起 `shuyu_unavailable`(fail-closed 拦截),余额接口正常
  (101,324 pt)但视频运行时不可用——与 0718-0719 中断同征兆(视频套餐从 /prices 消失)。
  重试 4 次(每 5 分钟)未恢复。
- **volcengine_cn_legacy(C1 客户降级线)**:18:07Z 全波提交被拒
  `HTTP 403 AccountOverdueError`——**火山账户欠费,需要人工充值**。未产生扣费。

## 花费(Shuyu points,观测值)

- 起始 122,004 → 结束 101,324,消耗 20,680 pt ≈ 18 条成片 ×900(16,200)+ 故事板
  锚定帧图(image-plan)。19 条排队超时未提交 0 扣费;2 次供应商失败已退款;
  volcengine 0 扣费。参考图走 OpenAI(美元侧,量级 ~31 张 medium)。

## 上线决策(偏差声明)

按扩容决策的闸门,"没有真样片的模板不进 main"。实际执行到 9/27 时两条真机线路
同时中断,余下 18 条无法出样。**决策:全目录 35 上 main,样片白名单只放过检的 17
(8 旧 + 9 新),未过检模板如实显示无样片态。**理由:

1. 线上已部署代码存在诚实性缺陷(路径匹配即挂"生成样例帧"徽标 + 404 图),模板
   已 seed 的现状下必须尽快用白名单修复;
2. 全部 35 模板的结构锁(骨架/负面词/参数)已过 1306 项测试与契约校验,模板本身
   可安全使用;样片只是展示层;
3. 供应商恢复时间不可控(0719 同类中断持续 2 天),阻塞整条交付不成比例。

## 续跑 runbook(供应商恢复后)

```bash
# 1) 未出片 9 条(建议 Shuyu 恢复后跑;或欠费解决后 REAL_SAMPLES_ROUTE=volcengine_cn_legacy)
REAL_SAMPLES_SLUGS=commerce-macro-texture-asmr,commerce-pov-immersive,commerce-dual-context,commerce-pet-companion,commerce-home-space-styling,commerce-fashion-lookbook,commerce-food-sizzle,commerce-outdoor-rugged,commerce-gift-unwrap \
REAL_SAMPLES_FORCE=1 REAL_SAMPLES_CONFIRM_SPEND=1 npx tsx scripts/real-template-samples-expansion.ts

# 2) QA 重跑 9 条(配方已升版,force 键并入模板版本,不会与历史批次冲突)
REAL_SAMPLES_SLUGS=commerce-triple-proof,commerce-creator-reaction,commerce-tech-feature-focus,commerce-travel-pack-flow,commerce-morning-routine,commerce-before-after-match,commerce-360-hero-orbit,commerce-seamless-loop,commerce-dark-luxury-light \
REAL_SAMPLES_FORCE=1 REAL_SAMPLES_CONFIRM_SPEND=1 npx tsx scripts/real-template-samples-expansion.ts

# 3) QA → 装配 → 白名单
scripts/build-template-preview-assets.sh qa          # 出接触表,逐条人工检查
scripts/build-template-preview-assets.sh build <slug>  # 过检的装配进 public/template-previews/
# 最后把过检 slug 加进 src/lib/video-generation/template-sample.ts 的
# EXPANSION_QA_PASSED_SLUGS,typecheck + npm test 后提交。
```

预算余量:18 条 ×900 = 16,200 pt(当前余额 101,324 充足)。

## 顺带发现(待办)

1. **frame-qa 门禁被跳过**:批量出片时 `[frame-qa] 门禁跳过: 401 Incorrect API key
   provided: missing-***-key`——frame-QA 读的 OpenAI key 环境名与 .env.local 不匹配,
   门禁 fail-open。本轮由人工接触表兜底,需修 env 接线并让门禁 fail-closed。
2. 排队超时机制:一次性创建超过并发窗口的批次会让队尾越过 `timeoutAt+10min` 被
   sweep 判死(v2 轮 19 条零提交阵亡)。样片脚本已改分波;客户侧大批量是否存在
   同样风险值得复核(创建时定死 timeoutAt vs 派发时)。
3. 两次供应商侧失败(已退款)都是腕表产品集(暗调光影 v1、材质微距),若重试再失败
   考虑换产品集。

## 1025 第四轮 QA(0804 r7 成片,0805 已装配入库)

0805 的提交 `008d24e` 只为防 404 把 4 条样片资产装配进 `public/template-previews/`,
没有记录 QA 结论也没上白名单。本轮按上文清单补检,不新出片、不花点数。

**来源核验**:4 条源片都在 `tmp/real-template-samples/template-samples-20260803-v1-videos/`,
与生产库对应 r7 批次(`…:v3:t{版本}:r7`,全部 COMPLETED / SUCCEEDED,产出在 Shuyu R2)
的成片逐字节一致(Content-Length 相同),且均为该模板当前 ACTIVE 版本出片
(户外 v2、食欲 v3、穿搭 v2、萌宠 v2)。只做了只读查询。

**检查方式**:每条 15 帧接触表(1 帧/秒)对照配方 beats 与参考产品图,逐条过失败模式表;
再检查装配后的 3 秒预览与封面(客户实际看到的部分)。

| 模板 | 结论 | 依据 |
|---|---|---|
| 户外实战场景 `commerce-outdoor-rugged` | ✅ 过检 | 三拍全部兑现(林地巨石开场 → 手扣卷顶扣具、拉链与织带特写 → 背上身 → 回到巨石旁收尾);背包(橄榄卷顶、单条黑织带、竖拉链、黑底)全程一致;无拼贴、无第三方 logo、无道具违规。预览沿用默认 6s 起(手扣扣具 + 拉链特写)。 |
| 食欲声色 `commerce-food-sizzle` | ✅ 过检 | 咖啡豆满幅开场 → 手封袋 → 豆、杯与袋同框收尾;牛皮纸袋与金色封口条每一镜不变;手部自然;8.3s、12.3s 是镜头间的叠化(时间上的过渡,不是画面拼贴)。**预览改为 0s 起**(`build-template-preview-assets.sh` 的 OFFSETS):原 6s 起只剩纸袋中段 + 叠化,不体现配方的「食欲」钩子。 |
| 穿搭动线 `commerce-fashion-lookbook` | ❌ 不过 | 钩子特写里产品失真:2.2s 鞋面靠鞋眼处出现锈褐色污渍,2.8–4.2s 鞋舌一带变琥珀色——违反配方「颜色与参考完全一致」;10s 处模特由男换女。已装配的预览按人物上裁,封面与大部分时长只拍到上半身,看不到鞋。 |
| 萌宠陪伴时刻 `commerce-pet-companion` | ❌ 不过 | 配方锁「the animal stays a single consistent subject」,成片里先后出现三只不同的狗(0s 与 5–8s 卷毛杏色、1–4s 直毛金毛、9–12s 奶白色);玩具本身一致。 |

不过的两条资产留在仓库里但不在白名单,前端照常显示「样片待补」。重出时沿用上文 runbook,
建议:穿搭动线换无污渍风险的产品集或在 beats 里加「鞋面洁净、鞋舌同色」锁;萌宠陪伴在
beats 里强化单一主体(品种、毛色、体型写死)并在 QA 时逐帧核对主体。
