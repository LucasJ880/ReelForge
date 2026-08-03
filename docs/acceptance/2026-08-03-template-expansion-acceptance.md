# 模板库扩容真机验收记录(2026-08-03)

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
