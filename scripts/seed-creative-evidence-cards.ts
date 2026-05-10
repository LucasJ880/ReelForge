/**
 * Seed Creative Evidence Cards.
 *
 * 重要边界（写在脚本头部，避免后续误用）：
 * - 不下载第三方视频，referenceUrl 一律留空或填占位（本地 demo 无外链依赖）；
 * - thumbnailUrl 一律留空（不复制原平台缩略图）；
 * - publicMetricsJson 仅作示例，observedAt = "demo-seed"，禁止用于对外承诺；
 * - 所有 hookPattern / structureBreakdown / whyItWorks / clientPreviewSummary
 *   都是 Aivora 团队的「原创结构性解读」，不复制任何原视频的字幕/口播/镜头脚本。
 *
 * 用法：
 *   npm run db:seed:creative-cards
 */
import { loadEnvConfig } from "@next/env";
import { db } from "../src/lib/db";
import { upsertCreativeEvidenceCard } from "../src/lib/services/creative-evidence-service";
import type { CreativeEvidenceCardCore } from "../src/lib/schemas/creative-evidence";

loadEnvConfig(process.cwd());

type SeedCard = Omit<CreativeEvidenceCardCore, "status"> & {
  status: "DRAFT" | "REVIEWED" | "PUBLISHED" | "ARCHIVED";
};

const SEED_CARDS: SeedCard[] = [
  // ============ Real Estate（4 张） ============
  {
    slug: "real-estate-listing-walkthrough-pov",
    title: "POV listing walkthrough · 30s",
    industry: "real_estate",
    platform: "tiktok",
    objective: "promote_listing",
    sourcePlatform: "TikTok",
    publicMetrics: {
      observedAt: "demo-seed",
      views: 482000,
      likes: 38900,
      shares: 6200,
      saves: 9100,
      comments: 540,
    },
    hookPattern: {
      pattern: "POV: 从大门口推进客厅，2 秒内点出地段 + 总价",
      openingSeconds: 3,
      hookType: "POV",
      whyItStops:
        "潜在买家最关心「这房在哪+多少钱」，前 3 秒一次性给出，让目标人群立刻判断「值不值得继续看」",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "POV 推门 + 大字幕地段 + 总价" },
        { from: 3, to: 18, role: "proof", narrative: "客厅 → 厨房 → 主卧的连续 walkthrough，每段 2-3s 加 1 行卖点字幕" },
        { from: 18, to: 26, role: "demo", narrative: "户型亮点 close-up（采光 / 储物 / 学区位置）" },
        { from: 26, to: 30, role: "cta", narrative: "DM/电话联系经纪人，附 fair-housing disclaimer" },
      ],
      pacingNotes: "前快后慢；CTA 留 1.5s 静帧",
    },
    whyItWorks:
      "本地买家在短视频上做的是「初筛」决定，POV walkthrough 把所有他们最想看的细节按观看习惯排好序，符合短视频快判断的节奏。",
    visualStyle: "竖屏 9:16、自然光为主、稳定推进、字幕居中加粗",
    suggestedUseCase:
      "适合任何在售房源 listing 推广，尤其是新挂牌前 7 天的曝光冲量。",
    riskNotes:
      "必须显示 Equal Housing Opportunity 与 NMLS / 经纪人执照编号；不要承诺升值或贷款回报。",
    clientPreviewSummary:
      "如果你刚挂牌一套房，用这条结构在前 7 天能快速把房源送到本地潜在买家眼前。",
    recommendationScore: 88,
    status: "PUBLISHED",
  },
  {
    slug: "real-estate-curiosity-stat-hook",
    title: "Curiosity + 数据 hook · 45s",
    industry: "real_estate",
    platform: "instagram_reels",
    objective: "get_leads",
    sourcePlatform: "Instagram Reels",
    publicMetrics: { observedAt: "demo-seed", views: 215000, likes: 18000, saves: 5400 },
    hookPattern: {
      pattern: "「过去 30 天本区域成交了 X 套」+ 一个反直觉的数字",
      openingSeconds: 3,
      hookType: "Stat",
      whyItStops:
        "用一个本地区域级的具体数字直接挑战观众的直觉（「我以为现在没人买房」），让目标人群停留 5 秒",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "本地数据大字幕 + 经纪人本人镜头" },
        { from: 3, to: 25, role: "proof", narrative: "用 3 个真实成交案例的封面图过场（已签约 SOLD 章）" },
        { from: 25, to: 40, role: "demo", narrative: "经纪人 talking head 解释为什么这个数据对买家/卖家意味着什么" },
        { from: 40, to: 45, role: "cta", narrative: "评论 'PRICE' 私信获取本地区域价格分析报告" },
      ],
      pacingNotes: "数据驱动，每个 proof 用同一个字幕模板",
    },
    whyItWorks:
      "本地房产消费者最缺的不是房源，而是对市场状态的判断。用具体数字制造「我需要找专业人」的感受，把短视频流量转成 lead magnet 提交。",
    visualStyle: "经纪人本人出镜 talking head，主光 45° 角，背景虚化，字幕大",
    suggestedUseCase: "适合每月初做一次区域市场快报，长期沉淀 lead",
    riskNotes:
      "数据来源必须可追溯（MLS 截图或公开记录），不允许编造；fair-housing disclaimer 必须出现在描述或片尾",
    clientPreviewSummary:
      "如果你想稳定收 lead 而不是只靠运气爆火，这个「数据 + 我能帮你解读」结构适合每月固定发一条。",
    recommendationScore: 84,
    status: "PUBLISHED",
  },
  {
    slug: "real-estate-before-after-staging",
    title: "Before/After staging reveal · 30s",
    industry: "real_estate",
    platform: "tiktok",
    objective: "brand_awareness",
    publicMetrics: { observedAt: "demo-seed", views: 1100000, likes: 92000 },
    hookPattern: {
      pattern: "前 1 秒展示 staging 前的「丑」状态，第 2 秒切到 after",
      openingSeconds: 2,
      hookType: "Reveal",
      whyItStops: "对比反差是短视频最稳定的 hook 之一，本地买家也容易被房屋改造内容拉住",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 2, role: "hook", narrative: "before / after 双画面切换" },
        { from: 2, to: 18, role: "proof", narrative: "细分 4 个房间逐个 before/after，节奏 4s 一组" },
        { from: 18, to: 26, role: "demo", narrative: "成本简述：staging 花了多少 / 多久成交" },
        { from: 26, to: 30, role: "cta", narrative: "Follow 经纪人看更多本地房源 reveal" },
      ],
    },
    whyItWorks:
      "把 staging 当成 entertainment 内容来发，比硬广效果好很多，并且建立经纪人「懂如何让房子卖出去」的专业感。",
    visualStyle: "横平竖直构图，每张 before/after 严格同机位",
    suggestedUseCase: "适合做经纪人/staging 团队的长期 brand 内容",
    riskNotes: "需获得房主授权使用其房屋画面",
    clientPreviewSummary:
      "如果你或你的合作伙伴做 staging，这个结构能稳定累积粉丝，让你的经纪人形象有 entertainment 价值。",
    recommendationScore: 80,
    status: "PUBLISHED",
  },
  {
    slug: "real-estate-buyer-faq-question",
    title: "Buyer FAQ talking head · 30s",
    industry: "real_estate",
    platform: "youtube_shorts",
    objective: "get_leads",
    publicMetrics: { observedAt: "demo-seed", views: 76000, likes: 4200 },
    hookPattern: {
      pattern: "「90% 的首套买家都问错了这个问题」",
      openingSeconds: 3,
      hookType: "Question",
      whyItStops: "首套买家焦虑感强，开场就标出「我可能问错了」会触发自我代入",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "经纪人特写 + 大字幕问题" },
        { from: 3, to: 20, role: "proof", narrative: "拆解三个常见误解，每个 5s 一段" },
        { from: 20, to: 27, role: "demo", narrative: "给一个买家可以马上做的 next step（pre-approval / 看 listing 的顺序）" },
        { from: 27, to: 30, role: "cta", narrative: "评论 'GUIDE' 私信获取首套买家 PDF" },
      ],
    },
    whyItWorks:
      "教育型 FAQ + 私信 lead magnet 组合是房地产稳定 lead 的经典套路；竖屏 talking head 制作成本低，可以每周更新。",
    visualStyle: "talking head 9:16，背景柔光，字幕加粗居中",
    suggestedUseCase: "每周固定一条，沉淀「首套买家 educator」人设",
    riskNotes: "fair-housing 必须出现；不要给出贷款数字承诺",
    clientPreviewSummary:
      "如果你想长期建立首套买家信任，这条结构最适合每周一发，沉淀 lead。",
    recommendationScore: 76,
    status: "PUBLISHED",
  },

  // ============ Pet Business（4 张） ============
  {
    slug: "pet-store-pet-reaction-hook",
    title: "Pet reaction storefront walk-in · 20s",
    industry: "pet_business",
    platform: "tiktok",
    objective: "increase_bookings",
    publicMetrics: { observedAt: "demo-seed", views: 320000, likes: 41000 },
    hookPattern: {
      pattern: "POV: 你的狗第一次进店那 3 秒",
      openingSeconds: 3,
      hookType: "POV",
      whyItStops: "宠物的真实反应是养宠家庭最爱看的内容，本地相关性高",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "POV 推门 + 狗的真实反应" },
        { from: 3, to: 12, role: "proof", narrative: "店内货架与服务过程的真实镜头" },
        { from: 12, to: 17, role: "demo", narrative: "员工与宠物互动的暖心瞬间" },
        { from: 17, to: 20, role: "cta", narrative: "Save + 周末过来 / 预约 grooming" },
      ],
    },
    whyItWorks:
      "宠物店本质是情绪生意。真实反应建立信任比文案承诺有效得多。",
    visualStyle: "手持自然光、抓拍真实瞬间、背景音乐温暖不抢戏",
    suggestedUseCase:
      "适合本地宠物店、宠物美容、宠物医院做「这家可信」的内容",
    riskNotes:
      "不要承诺医疗/治疗效果；不要展示其它客户家宠物时未授权的画面",
    clientPreviewSummary:
      "如果你想让本地养宠家庭周末来店里逛，这个 POV 结构最容易让他们「想带狗来看看」。",
    recommendationScore: 90,
    status: "PUBLISHED",
  },
  {
    slug: "pet-grooming-before-after",
    title: "Grooming before/after · 30s",
    industry: "pet_business",
    platform: "instagram_reels",
    objective: "increase_bookings",
    publicMetrics: { observedAt: "demo-seed", views: 280000, likes: 32000 },
    hookPattern: {
      pattern: "脏到不像话的开场 → 干净到发光的结尾",
      openingSeconds: 2,
      hookType: "Reveal",
      whyItStops: "强烈反差天然吸睛，养宠家庭尤其爱看 grooming reveal",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 2, role: "hook", narrative: "before close-up + 大字幕预告 reveal" },
        { from: 2, to: 22, role: "proof", narrative: "全程 grooming 步骤，每步 2-3s" },
        { from: 22, to: 28, role: "demo", narrative: "after reveal + 主人/宠物表情" },
        { from: 28, to: 30, role: "cta", narrative: "DM 预约 grooming" },
      ],
    },
    whyItWorks: "Before/after 是 grooming 内容的最稳模板，转化率远超口播广告",
    visualStyle: "稳定机位，主光柔和，强对比剪辑",
    suggestedUseCase: "适合每周更新 1-2 条，长期沉淀 grooming 预约 lead",
    riskNotes: "需获得主人对宠物画面使用的授权",
    clientPreviewSummary:
      "Grooming reveal 是预约转化最稳的内容结构，每周一条就能稳定填档期。",
    recommendationScore: 87,
    status: "PUBLISHED",
  },
  {
    slug: "pet-product-shelf-walkthrough",
    title: "店内货架 walkthrough · 15s",
    industry: "pet_business",
    platform: "tiktok",
    objective: "brand_awareness",
    publicMetrics: { observedAt: "demo-seed", views: 95000, likes: 7800 },
    hookPattern: {
      pattern: "「locals don't gatekeep this pet store」",
      openingSeconds: 3,
      hookType: "Curiosity",
      whyItStops: "「本地人不藏着的宝藏小店」是社交平台稳定 hook 模板",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "门口推近 + 大字幕" },
        { from: 3, to: 12, role: "proof", narrative: "货架细节 + 真实定价标签" },
        { from: 12, to: 15, role: "cta", narrative: "Save 收藏，下次过来" },
      ],
    },
    whyItWorks: "本地隐藏小店的角度比直接广告更容易获得自然分享",
    visualStyle: "自然光 + 手持 + 紧凑剪辑",
    suggestedUseCase: "用真实存货证明品类丰富度，建立「这家货齐」印象",
    riskNotes: "如展示其它品牌商品需注意品牌方政策",
    clientPreviewSummary:
      "如果你想让附近的人「至少进来一次」，这个结构能把好奇心直接转成到店。",
    recommendationScore: 74,
    status: "PUBLISHED",
  },
  {
    slug: "pet-vet-faq-talking-head",
    title: "兽医 FAQ talking head · 45s",
    industry: "pet_business",
    platform: "youtube_shorts",
    objective: "get_leads",
    publicMetrics: { observedAt: "demo-seed", views: 180000, likes: 14000 },
    hookPattern: {
      pattern: "「这 3 个症状要立刻带狗去医院」",
      openingSeconds: 3,
      hookType: "Authority",
      whyItStops: "权威告警 + 焦虑驱动，养狗家长会立即停留",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "兽医出镜 + 大字幕警示" },
        { from: 3, to: 35, role: "proof", narrative: "三个症状逐条说明，配真实就诊画面" },
        { from: 35, to: 42, role: "demo", narrative: "提供「自检 checklist」的 PDF" },
        { from: 42, to: 45, role: "cta", narrative: "评论 'CHECK' 索取 PDF" },
      ],
    },
    whyItWorks: "教育型 + lead magnet 是兽医诊所稳定收咨询的方式",
    visualStyle: "talking head + 真实诊室背景，字幕大、配色专业",
    suggestedUseCase: "适合兽医诊所每周固定一条，建立专业人设",
    riskNotes:
      "不要给出具体药物剂量；必须提示「以上为科普，请到诊所就诊」",
    clientPreviewSummary:
      "如果你是兽医诊所，这个结构帮你把「教育」变成稳定的咨询入口。",
    recommendationScore: 82,
    status: "PUBLISHED",
  },

  // ============ Local Service（4 张） ============
  {
    slug: "local-service-customer-walkthrough",
    title: "Customer walkthrough · 30s",
    industry: "local_service",
    platform: "tiktok",
    objective: "increase_bookings",
    publicMetrics: { observedAt: "demo-seed", views: 132000, likes: 11200 },
    hookPattern: {
      pattern: "「当 [本地痛点] 发生时，我们这样修」",
      openingSeconds: 3,
      hookType: "Pain",
      whyItStops: "把本地痛点直接喊出来，让目标客户立刻知道「这是讲我」",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "痛点场景 + 大字幕" },
        { from: 3, to: 22, role: "proof", narrative: "技师真实工作过程，每步 3-4s" },
        { from: 22, to: 27, role: "demo", narrative: "after + 客户口碑（一句话）" },
        { from: 27, to: 30, role: "cta", narrative: "拨打/DM 预约" },
      ],
    },
    whyItWorks: "「真实修理过程」远比成交案例图更能建立信任",
    visualStyle: "现场手持 + 真实环境音，字幕在屏幕底部",
    suggestedUseCase: "本地家政、家电维修、汽修、装修等",
    riskNotes: "客户隐私（住址 / 车牌）需打码或避开",
    clientPreviewSummary: "如果你做本地维修类生意，这个结构是稳定预约的标配。",
    recommendationScore: 86,
    status: "PUBLISHED",
  },
  {
    slug: "local-service-time-lapse-job",
    title: "Time-lapse job result · 20s",
    industry: "local_service",
    platform: "instagram_reels",
    objective: "brand_awareness",
    publicMetrics: { observedAt: "demo-seed", views: 410000, likes: 36000 },
    hookPattern: {
      pattern: "前 1.5s 显示工作前烂状态 → 跳进 time-lapse",
      openingSeconds: 2,
      hookType: "Reveal",
      whyItStops: "Time-lapse 自带满足感，本身就是娱乐内容",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 2, role: "hook", narrative: "before 状态" },
        { from: 2, to: 16, role: "proof", narrative: "time-lapse 全过程" },
        { from: 16, to: 19, role: "demo", narrative: "after reveal + 用时数字" },
        { from: 19, to: 20, role: "cta", narrative: "Save + DM 预约" },
      ],
    },
    whyItWorks: "Time-lapse 把劳动过程压缩成「值得分享」的内容",
    visualStyle: "固定机位 + 加速 + 干净大字幕",
    suggestedUseCase: "清洁、装修、园艺、汽车美容",
    riskNotes: "客户场地 / 车辆需获授权",
    clientPreviewSummary:
      "把每一单工作变成 time-lapse 内容，长期能稳定建立「专业 + 高效」品牌印象。",
    recommendationScore: 78,
    status: "PUBLISHED",
  },
  {
    slug: "local-service-flash-offer",
    title: "Flash 优惠倒计时 · 15s",
    industry: "local_service",
    platform: "facebook",
    objective: "announce_offer",
    publicMetrics: { observedAt: "demo-seed", views: 64000, likes: 4200 },
    hookPattern: {
      pattern: "「48 小时内本地用户专享 [offer]」",
      openingSeconds: 3,
      hookType: "Stat",
      whyItStops: "时间限制 + 本地限制，制造稀缺感",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "倒计时 + 大字幕 offer" },
        { from: 3, to: 10, role: "proof", narrative: "店面/服务真实镜头" },
        { from: 10, to: 13, role: "demo", narrative: "如何 redeem 的步骤" },
        { from: 13, to: 15, role: "cta", narrative: "Save + 上门" },
      ],
    },
    whyItWorks: "稀缺 + 本地直播感强；适合 Facebook 算法",
    visualStyle: "高对比配色 + 倒计时 motion graphic",
    suggestedUseCase: "节日 / 周年庆 / 短期清库存",
    riskNotes: "offer 必须真实可兑现，避免 bait-and-switch",
    clientPreviewSummary: "短期想拉一波到店，这条结构最直接。",
    recommendationScore: 72,
    status: "PUBLISHED",
  },
  {
    slug: "local-service-faq-myth-busting",
    title: "Myth-busting FAQ · 30s",
    industry: "local_service",
    platform: "youtube_shorts",
    objective: "get_leads",
    publicMetrics: { observedAt: "demo-seed", views: 88000, likes: 6100 },
    hookPattern: {
      pattern: "「关于 [行业] 你被骗了多少？」",
      openingSeconds: 3,
      hookType: "Question",
      whyItStops: "拆穿行业潜规则的内容能建立专业人设",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "talking head + 大字幕问题" },
        { from: 3, to: 22, role: "proof", narrative: "三个常见行业误解，每个 5-7s" },
        { from: 22, to: 27, role: "demo", narrative: "如何避免被坑 checklist" },
        { from: 27, to: 30, role: "cta", narrative: "DM 'CHECK' 拿 checklist" },
      ],
    },
    whyItWorks: "拆穿误解 = 站到客户一边，建立长期信任",
    visualStyle: "talking head 9:16，柔光，干净背景",
    suggestedUseCase: "本地服务行业的长期 lead 沉淀",
    riskNotes: "不要点名指向具体竞争对手",
    clientPreviewSummary:
      "如果你想用「专家身份」建立信任，这条结构最适合每两周更新一次。",
    recommendationScore: 76,
    status: "PUBLISHED",
  },

  // ============ Restaurant（3 张） ============
  {
    slug: "restaurant-signature-dish-asmr",
    title: "Signature dish ASMR · 15s",
    industry: "restaurant",
    platform: "tiktok",
    objective: "increase_bookings",
    publicMetrics: { observedAt: "demo-seed", views: 720000, likes: 95000 },
    hookPattern: {
      pattern: "前 2 秒招牌菜特写 + 真实 sizzle 声",
      openingSeconds: 2,
      hookType: "Demo",
      whyItStops: "食欲驱动 + ASMR 声音，短视频最稳的餐饮 hook",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 2, role: "hook", narrative: "招牌菜 close-up + sizzle" },
        { from: 2, to: 11, role: "proof", narrative: "厨房真实出餐过程 + 食客反应" },
        { from: 11, to: 14, role: "demo", narrative: "餐厅环境 + 招牌字" },
        { from: 14, to: 15, role: "cta", narrative: "Save + 预约/到店" },
      ],
    },
    whyItWorks: "把感官体验压缩到 15 秒；ASMR 是餐饮内容的最稳模板",
    visualStyle: "高细节近景 + 自然色调 + 真实环境声",
    suggestedUseCase: "适合任何有「招牌菜」的餐厅",
    riskNotes:
      "不声称未经验证的健康效果；如展示酒类需符合平台规则",
    clientPreviewSummary:
      "如果你有招牌菜，这条结构能稳定拉新到店。每月固定 2-3 条。",
    recommendationScore: 91,
    status: "PUBLISHED",
  },
  {
    slug: "restaurant-owner-story-talking-head",
    title: "Owner story talking head · 45s",
    industry: "restaurant",
    platform: "instagram_reels",
    objective: "brand_awareness",
    publicMetrics: { observedAt: "demo-seed", views: 130000, likes: 11000 },
    hookPattern: {
      pattern: "「我把家里的配方搬到这家店」",
      openingSeconds: 3,
      hookType: "Authority",
      whyItStops: "本地小店最大的差异化是 owner 故事",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "Owner 出镜 + 大字幕配方背景" },
        { from: 3, to: 30, role: "proof", narrative: "厨房真实操作 + 食材近景" },
        { from: 30, to: 40, role: "demo", narrative: "客人吃完反应" },
        { from: 40, to: 45, role: "cta", narrative: "Follow 看更多 / 预约" },
      ],
    },
    whyItWorks: "Owner 故事 = 本地小店的护城河；陌生客户更愿意支持有故事的小店",
    visualStyle: "暖光、近景特写、字幕配色与品牌一致",
    suggestedUseCase: "每月固定 1 条，沉淀品牌长期内容",
    riskNotes: "故事需真实可验证；不要夸大食材产地",
    clientPreviewSummary:
      "把你的故事讲出来，是本地餐饮最被低估的增长杠杆。",
    recommendationScore: 80,
    status: "PUBLISHED",
  },
  {
    slug: "restaurant-limited-offer-countdown",
    title: "Limited offer countdown · 15s",
    industry: "restaurant",
    platform: "facebook",
    objective: "announce_offer",
    publicMetrics: { observedAt: "demo-seed", views: 54000, likes: 3800 },
    hookPattern: {
      pattern: "「今晚 5pm 之前，限量 50 份」",
      openingSeconds: 3,
      hookType: "Stat",
      whyItStops: "限量 + 即时性是最稳的促销 hook",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "倒计时 + 大字幕 offer" },
        { from: 3, to: 10, role: "proof", narrative: "菜品 + 餐厅" },
        { from: 10, to: 13, role: "demo", narrative: "如何 redeem" },
        { from: 13, to: 15, role: "cta", narrative: "Save + 立即到店" },
      ],
    },
    whyItWorks: "稀缺 + 本地 + 时间限制三件套",
    visualStyle: "高饱和 + 倒计时 motion + 大字幕",
    suggestedUseCase: "周末特惠 / 节日特餐",
    riskNotes: "offer 必须真实可兑现",
    clientPreviewSummary: "短期想拉一波客流，这条结构最直接。",
    recommendationScore: 70,
    status: "PUBLISHED",
  },

  // ============ General（3 张通用结构） ============
  {
    slug: "general-3-step-explainer",
    title: "3-step 教程 · 30s",
    industry: "general",
    platform: "mixed",
    objective: "brand_awareness",
    publicMetrics: { observedAt: "demo-seed", views: 240000, likes: 21000 },
    hookPattern: {
      pattern: "「3 步搞定 [目标]，第 2 步最关键」",
      openingSeconds: 3,
      hookType: "Curiosity",
      whyItStops: "明确步骤数 + 「最关键的一步」吊住观众到中段",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "3 个圆角卡片预告" },
        { from: 3, to: 25, role: "proof", narrative: "每步 ~7s 演示" },
        { from: 25, to: 30, role: "cta", narrative: "Save + Follow" },
      ],
    },
    whyItWorks: "教程类内容的稳定模板，跨行业通用",
    visualStyle: "清晰大字幕 + 步骤卡片 motion",
    suggestedUseCase: "任何「我教你做 X」的内容",
    riskNotes: "如涉及医疗/金融/法律行业，要加 disclaimer",
    clientPreviewSummary: "适合长期内容沉淀，跨行业可复用。",
    recommendationScore: 78,
    status: "PUBLISHED",
  },
  {
    slug: "general-relatable-skit",
    title: "Relatable skit · 20s",
    industry: "general",
    platform: "mixed",
    objective: "brand_awareness",
    publicMetrics: { observedAt: "demo-seed", views: 980000, likes: 120000 },
    hookPattern: {
      pattern: "用 1 句话把目标人群的尴尬时刻演出来",
      openingSeconds: 3,
      hookType: "Pain",
      whyItStops: "「这是讲我」的代入感是社交平台传播的核心",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "演出尴尬瞬间" },
        { from: 3, to: 14, role: "proof", narrative: "推进剧情，植入产品/服务" },
        { from: 14, to: 18, role: "demo", narrative: "用产品/服务给出解决方案的小段演示" },
        { from: 18, to: 20, role: "cta", narrative: "Follow / DM" },
      ],
    },
    whyItWorks: "Relatable skit 是非教程类品牌内容的最稳模板",
    visualStyle: "人物表演为主，背景简洁，字幕辅助",
    suggestedUseCase: "任何想做 brand awareness 的本地商家",
    riskNotes: "不要 stereotype 任何群体",
    clientPreviewSummary:
      "适合品牌想做「让人记得住」的内容，跨行业都能借鉴。",
    recommendationScore: 75,
    status: "PUBLISHED",
  },
  {
    slug: "general-testimonial-quote",
    title: "客户口碑 quote · 20s",
    industry: "general",
    platform: "mixed",
    objective: "get_leads",
    publicMetrics: { observedAt: "demo-seed", views: 88000, likes: 7400 },
    hookPattern: {
      pattern: "「在试过 [N] 家之后，这家是真的」",
      openingSeconds: 3,
      hookType: "Authority",
      whyItStops: "用客户原声的 social proof 是最低风险的转化型 hook",
    },
    structureBreakdown: {
      segments: [
        { from: 0, to: 3, role: "hook", narrative: "客户原声 quote 大字幕" },
        { from: 3, to: 14, role: "proof", narrative: "真实服务 / 商品 / 团队画面" },
        { from: 14, to: 17, role: "demo", narrative: "客户的 outcome" },
        { from: 17, to: 20, role: "cta", narrative: "Save + 立即联系" },
      ],
    },
    whyItWorks: "客户原声比商家自己说有效 5-10 倍",
    visualStyle: "干净构图 + 大字幕 + 暖色调",
    suggestedUseCase: "Lead 沉淀类的稳定内容",
    riskNotes: "客户授权必须有书面/截图记录；行业合规须遵守 (e.g. 房产 fair-housing)",
    clientPreviewSummary:
      "把每一个真实好评变成 20s 视频，是最稳的 lead 沉淀。",
    recommendationScore: 82,
    status: "PUBLISHED",
  },
];

async function main() {
  console.log(`🌱 Seeding ${SEED_CARDS.length} CreativeEvidenceCards (upsert by slug)...`);
  for (const card of SEED_CARDS) {
    const upserted = await upsertCreativeEvidenceCard(card);
    console.log(`  ✓ ${upserted.slug} (${upserted.industry}/${upserted.objective}) → ${upserted.status}`);
  }
  console.log(`✅ Seeded ${SEED_CARDS.length} cards.`);
}

main()
  .catch((err) => {
    console.error("❌ Seed CreativeEvidenceCards failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
