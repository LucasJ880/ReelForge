# 2026-07-29 同行调研与下一步建议

调研目标：不靠拍脑袋想功能，而是看清 AI 短视频广告赛道里已经跑通的产品做对了什么，
再判断 Aivora 该复现哪些、该避开哪些坑。

参考来源见文末。

---

## 一、同行在卖什么（已被验证的卖点）

| 产品 | 核心卖点 | 对 Aivora 的含义 |
|---|---|---|
| **Creatify** | 贴一个商品链接 → 60 秒出片；Batch Mode 批量变体；竞品广告库（1000 万+ Meta 广告）；直接投放（ad launcher）；Shopify / API 打通 | 「链接进、广告出」是获客入口，我们目前要求用户先上传图再写描述，门槛高一整档 |
| **Arcads** | 1000+ AI 真人演员；hook / body / CTA 结构化脚本；一个下午出 50 条变体；跑赢的广告自动派生新变体 | 变体矩阵（同产品 × N 个钩子）是投放团队真正买单的东西，比"多个模板"更贴需求 |
| **Pippit（CapCut）** | 一句话/一个链接同时产出视频、产品图、整套 campaign，再一键发布 | 图和视频在同一条流水线里，不是两个割裂工具 —— 这正是当前产品图工作台被吐槽"脱节"的根因 |
| **Seedance / 按量付费类** | 无月费门槛、按次计费、原生音频 | 低门槛试用路径；我们的 demo 账号承担了类似角色，但没有"先花小钱试一条"的自助入口 |
| **Photoroom / Pebblely / Claid** | 产品图批量处理：抠图、场景生成、模板化批处理 | 产品图侧的对标不是"生成一张好图"，而是"一次处理整个商品目录" |

## 二、同行踩过、我们不该重踩的坑

**积分模型惩罚迭代 = 头号流失原因。** 调研里反复出现同一句话：用户流失不是因为出片质量差，
而是因为定价惩罚正常使用 —— 有人 15 分钟烧完 10 个额度当天退订；周末试几次就用光一个月配额。

对应到 Aivora：

1. 失败 / 被安全拦截 / 用户明确不满意的那一版，**不应该按成功出片计费**（部分退分逻辑已有，要变成对用户可见的承诺）。
2. 迭代阶段（故事板、产品图改构图）应显著便宜于最终出片，让用户敢多试。
3. 价格页要能回答"我一个月大概花多少"，而不是只给积分数。

## 三、建议的优先级（P0 → P2）

### P0：把已有能力接成一条线

1. **商品链接 → 起片**（对标 Creatify / Pippit）
   输入一个电商详情页链接 → 抓标题/卖点/主图 → 自动填充产品图 + 创作描述 → 直接进故事板。
   现有的 `selling-point-service`、`product-image-service`、故事板流水线都能复用，缺的是抓取层与预填。
   这是获客漏斗上收益最大的一步。

2. **统一素材库**（用户已明确反馈）
   现在产品图只在工作台底部有"最近产品图"，成品库只装视频，文案却写"已进入素材库"。
   应该有一个素材库同时收纳：上传的原图、生成的产品图、故事板分镜、成片，
   每个资产都能下载、继续编辑、直接送进视频生产。

3. **每一轮任务都要有退出口**（本次已落地单条创作页）
   批量、产品图、故事板都应有一致的"取消这一轮 / 重开"语义，不依赖供应商恢复。

### P1：做投放团队真正买单的东西

4. **钩子变体矩阵**（对标 Arcads）
   批量生产目前围绕"模板"组织；真实需求是"同一个产品 × N 个开场钩子 × N 个角度"。
   把批量向导的第一维从模板改成钩子/角度，模板退居风格选项。

5. **赛马闭环变成卖点**
   我们已经有「投放与赛马」，同行大多只到"生成"为止。把它做实：
   投放数据回流 → 自动派生赢家变体 → 报告"这条为什么赢"。这是差异化护城河，不是跟随功能。

6. **一键发布 / 导出**
   至少覆盖 TikTok / Meta 素材规格导出与 Shopify 商品图回写。

### P2：规模化与信任

7. **口播演员库**：Arcads 的 1000+ 演员是硬护城河，我们有 HeyGen 通道但没有可选形象库。
8. **供应商漂移防护**：Shuyu 套餐 ID 轮换、分辨率下线、接口能力变化会直接打穿生产（0728、0729 都发生过）。
   需要：能力探测（不只是 health）+ 自动降级到备用线路 + 面向用户的"线路暂时不可用，已切换/可取消"。
9. **定价页与配额可预期性**：按上面第二节的三条改。

## 四、本次已经落地的修复

| 问题 | 根因 | 修复 |
|---|---|---|
| 品牌展示墙 / 品牌包 Logo 裂图 | `public/brand/` 被 .gitignore 排除（真实客户 Logo 不进仓库），线上 `/brand/sunny-logo.png` 404 | 资产改为上传对象存储、DB 存绝对 URL；新增回归测试禁止用被 ignore 的路径做静态投递；Logo 加载失败降级成品牌首字母而不是裂图 |
| 产品图下不下来 | 成品图跨域托管，`<a download>` 的 download 属性被浏览器忽略 | 改为取回字节后用 object URL 触发真实下载，失败回退新标签页 |
| 产品图操作看不懂（5 个纯图标按钮、3 个箭头） | 无文字标签 | 全部改为带文字的动作：用于单条视频 / 用于批量视频 / 下载 / 换个构图 / 接着改这张 |
| "已进入素材库"但找不到素材库 | 文案指向一个不存在的功能 | 文案改为"已存入下方产品图库"并锚点跳转；底部区块正式命名为产品图库（完整素材库见 P0-2） |
| 批量成片抽屉排版突兀 | 成片被压在最后，4 个空的"未记录"占位框占满全屏；AI 标签浮在容器角落而非视频上 | 成片提到最前并带下载按钮；历史成片只用一行说明代替 4 个空框；分镜限高；标题与正文对齐同一栏宽 |
| 供应商故障后卡在这一轮创作 | `markStoryboardRunDismissed` 写好了但从未被调用 | 失败提示条与故事板面板都提供"取消这一轮"，清运行态与幂等键、保留素材与描述 |
| 登录像永不过期 | 登录页承诺 7 天、实际 12 小时；过期只在下一次导航时才被发现 | 改为 7 天滚动会话（活动续期）；根布局挂会话监听，掉线立即带 `reason=expired` 回登录页并解释原因 |

---

### 来源

- [Seedance 2.0 vs Arcads, Creatify & HeyGen](https://lensgo.ai/blog/seedance-2-vs-arcads-creatify-heygen-best-ai-ugc-ads)
- [Best AI UGC Ad Tools 2026](https://lensgo.ai/blog/best-ai-ugc-ad-tools-2026)
- [Creatify — URL to Video](https://creatify.ai/features/url-to-video)
- [Creatify — Features](https://creatify.ai/features)
- [Arcads AI Review 2026](https://www.ezugc.ai/blog/arcads-ai)
- [The Double Conversion Problem in Credit-Based AI Pricing](https://thepricingconundrum.substack.com/p/the-double-conversion-problem-in)
- [Why Pricing Is the Biggest Trap in AI Video Tools](https://www.anangsha.me/why-pricing-is-the-biggest-trap-in-ai-video-tools-2026-reality-check/)
- [AI Product Photography Tools 2026](https://www.digitalapplied.com/blog/ai-product-photography-tools-ecommerce-2026-guide)
- [Pippit by CapCut](https://www.pippit.ai/)
