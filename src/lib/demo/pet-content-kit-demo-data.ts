/**
 * Aivora 宠物内容智能采集套件 —— 投资人 Demo 展示数据（全中文）。
 *
 * /showcase 主体验页使用。叙事按 CEO brief 的产品闭环组织：
 *
 *   硬件采集真实宠物瞬间 → AI 识别可爱/产品片段 → 自动生成给主人看的
 *   可分享视频 + 宠物日记 → 一键分享形成病毒式裂变 → 沉淀宠物社区，
 *   并为品牌提供真实产品使用证据（Product Proof Report）。
 *
 * 设计约束：
 * - 面向国内中文客户与投资人，全部文案中文；
 * - 所有指标均为「示例数据」，禁止写成「某真实账号某月真实数据」；
 * - 硬件 demo 阶段允许用 UI + 模拟数据展示，不要求真实硬件打通；
 * - 图片走 /public/demo/pet/ 下的 AI 生成素材；
 *   视频用本项目专门生成的「60s 产品讲解片」，不复用任何旧样片；
 * - 任何 URL 允许为 null，组件需自行降级，不能因缺素材崩溃。
 *
 * 修改时只改这份 data，不改组件结构。
 */

/* ------------------------------------------------------------------ */
/* 全局品牌文案                                                          */
/* ------------------------------------------------------------------ */

export const PET_BRAND_NAME = "Aivora";

/** 一句话定位（中文）。 */
export const PET_POSITIONING =
  "Aivora 把真实宠物瞬间，变成给主人看的温暖回忆，也变成给品牌使用的真实产品内容证据。";

/** 给投资人的一句话钩子。 */
export const PET_SLOGAN = "不只是宠物摄像头，而是一台宠物内容增长引擎。";

export const PET_HERO_OPENING =
  "人们天生爱分享自己的宠物。Aivora 用智能硬件自动采集宠物的真实瞬间，再由 AI 把它们变成可以马上分享的可爱视频——同时为宠物品牌沉淀真实可信的产品使用证据。";

export const SAMPLE_DATA_BADGE_LABEL = "示例数据";
export const SAMPLE_DATA_DISCLAIMER =
  "本页所有设备状态、行为数据、识别瞬间与传播指标均为示例（demo 模拟数据），用于演示产品闭环；硬件采集部分在 demo 阶段以 UI + 模拟数据呈现，不代表已量产的真实硬件数据。";

/**
 * 60 秒产品讲解片（即梦/Seedance 管线 + 中文字幕 + 中文配音旁白 + BGM）。
 *
 * 这是 hero 区投资人最先看到的视频：讲清「我们做什么 / 怎么自动生产可裂变的
 * 宠物视频 / 为什么要用我们」，而不是展示任何旧的样片。为 null 时 hero 降级。
 */
export const PET_WALKTHROUGH_VIDEO_URL: string | null =
  "/generated/aivora-pet-content-kit-walkthrough-60s-16x9.mp4";

/** 讲解片封面（从成片抽帧），未生成时回退到 AI 宠物素材。 */
export const PET_WALKTHROUGH_VIDEO_POSTER: string | null =
  "/demo/pet/walkthrough-poster.jpg";

export interface HeroStat {
  label: string;
  value: string;
  hint?: string;
}

export const heroStats: ReadonlyArray<HeroStat> = [
  { label: "每天自动产出", value: "3-5 条", hint: "可分享宠物短视频草稿" },
  { label: "从瞬间到成片", value: "< 5 分钟", hint: "识别 → 剪辑 → 字幕全自动" },
  { label: "产品闭环", value: "B2C + B2B", hint: "情绪陪伴 + 真实使用证据" },
];

/* ------------------------------------------------------------------ */
/* 区块 1 · 设备 Dashboard（智能硬件）                                    */
/* ------------------------------------------------------------------ */

export interface PetDeviceDemo {
  key: "camera" | "collar" | "mat";
  name: string;
  tagline: string;
  status: "online" | "syncing" | "standby";
  statusLabel: string;
  battery?: number;
  metrics: ReadonlyArray<{ label: string; value: string }>;
  capabilities: ReadonlyArray<string>;
}

export const petDevices: ReadonlyArray<PetDeviceDemo> = [
  {
    key: "camera",
    name: "Aivora 智能摄像头",
    tagline: "自动识别宠物出现并追踪移动，捕捉真实片段",
    status: "online",
    statusLabel: "在线 · 正在采集",
    battery: 86,
    metrics: [
      { label: "今日触发拍摄", value: "12 次" },
      { label: "可用素材", value: "8 段" },
      { label: "画质", value: "2K · 60fps" },
    ],
    capabilities: [
      "自动识别宠物出现，无人时不录",
      "自动追踪移动，锁定主体",
      "捕捉吃饭 / 睡觉 / 玩耍 / 撒娇 / 使用产品",
    ],
  },
  {
    key: "collar",
    name: "Aivora 智能项圈",
    tagline: "记录活动状态，支持主人远程发声互动",
    status: "syncing",
    statusLabel: "同步中 · 模拟数据",
    battery: 73,
    metrics: [
      { label: "今日活跃", value: "1 小时 48 分" },
      { label: "休息", value: "6 小时 12 分" },
      { label: "状态", value: "平静" },
    ],
    capabilities: [
      "判断运动 / 休息 / 异常安静 / 焦虑",
      "主人远程发声，与宠物沟通",
      "自动捕捉宠物听到主人声音后的反应",
    ],
  },
  {
    key: "mat",
    name: "Aivora 智能宠物垫",
    tagline: "判断宠物是否真实接触并使用产品",
    status: "online",
    statusLabel: "在线 · 正在记录",
    metrics: [
      { label: "今日使用", value: "5 次" },
      { label: "累计时长", value: "3 小时 20 分" },
      { label: "常用时段", value: "20:00-22:00" },
    ],
    capabilities: [
      "记录使用频率、时长与常用时段",
      "与摄像头联动，使用时自动触发拍摄",
      "为品牌提供真实使用证据",
    ],
  },
];

/* ------------------------------------------------------------------ */
/* 区块 2 · 宠物行为时间线                                                */
/* ------------------------------------------------------------------ */

export interface ActivityEventDemo {
  time: string;
  type: "eating" | "sleeping" | "playing" | "product" | "quiet" | "greeting";
  typeLabel: string;
  title: string;
  detail: string;
  captured: boolean;
}

export const activityTimeline: ReadonlyArray<ActivityEventDemo> = [
  {
    time: "07:20",
    type: "eating",
    typeLabel: "进食",
    title: "早餐时间",
    detail: "摄像头识别到进食行为，自动记录 45 秒片段。",
    captured: true,
  },
  {
    time: "09:05",
    type: "playing",
    typeLabel: "玩耍",
    title: "和逗猫棒疯玩",
    detail: "高活跃度片段，AI 标记为「高传播潜力」。",
    captured: true,
  },
  {
    time: "12:30",
    type: "sleeping",
    typeLabel: "睡觉",
    title: "窗边午睡",
    detail: "安静休息，项圈状态：平静。",
    captured: true,
  },
  {
    time: "15:10",
    type: "product",
    typeLabel: "使用产品",
    title: "趴在智能宠物垫上",
    detail: "宠物垫触发拍摄，记录为真实产品使用证据。",
    captured: true,
  },
  {
    time: "18:40",
    type: "greeting",
    typeLabel: "互动",
    title: "听到主人远程发声",
    detail: "项圈触发，捕捉到抬头寻找主人的反应。",
    captured: true,
  },
  {
    time: "21:15",
    type: "quiet",
    typeLabel: "异常安静",
    title: "长时间不动",
    detail: "系统提示主人留意，可远程查看。",
    captured: false,
  },
];

/* ------------------------------------------------------------------ */
/* 区块 3 · AI 识别精彩瞬间                                               */
/* ------------------------------------------------------------------ */

export interface DetectedMomentDemo {
  id: string;
  title: string;
  behaviorLabel: string;
  imageUrl: string | null;
  cuteScore: number;
  shareScore: number;
  forBrand: boolean;
  note: string;
}

export const detectedMoments: ReadonlyArray<DetectedMomentDemo> = [
  {
    id: "m1",
    title: "歪头杀",
    behaviorLabel: "撒娇 · 高传播",
    imageUrl: "/demo/pet/moment-tilt.png",
    cuteScore: 96,
    shareScore: 94,
    forBrand: false,
    note: "歪头瞬间，最适合做封面，停留率最高。",
  },
  {
    id: "m2",
    title: "干饭瞬间",
    behaviorLabel: "进食 · 日常",
    imageUrl: "/demo/pet/moment-eating.png",
    cuteScore: 88,
    shareScore: 82,
    forBrand: true,
    note: "可作为「宠物食品/食碗」品类的真实使用片段。",
  },
  {
    id: "m3",
    title: "窗边午睡",
    behaviorLabel: "睡觉 · 治愈",
    imageUrl: "/demo/pet/moment-sleeping.png",
    cuteScore: 91,
    shareScore: 85,
    forBrand: false,
    note: "治愈系内容，适合做宠物日记与心情卡。",
  },
  {
    id: "m4",
    title: "智能垫上打滚",
    behaviorLabel: "使用产品 · 证据",
    imageUrl: "/demo/pet/moment-product.png",
    cuteScore: 84,
    shareScore: 80,
    forBrand: true,
    note: "宠物垫真实使用片段，直接进 Product Proof Report。",
  },
  {
    id: "m5",
    title: "飞扑接玩具",
    behaviorLabel: "玩耍 · 高能",
    imageUrl: "/demo/pet/moment-playing.png",
    cuteScore: 90,
    shareScore: 92,
    forBrand: false,
    note: "高能瞬间，适合做挑战赛模板。",
  },
  {
    id: "m6",
    title: "抬头找主人",
    behaviorLabel: "互动 · 情感",
    imageUrl: "/demo/pet/moment-greeting.png",
    cuteScore: 93,
    shareScore: 88,
    forBrand: false,
    note: "听到主人声音的反应，情感价值最高。",
  },
];

/* ------------------------------------------------------------------ */
/* 区块 4 · 主人陪伴内容（B2C 情绪价值）                                  */
/* ------------------------------------------------------------------ */

export interface DailyClipDemo {
  title: string;
  durationLabel: string;
  videoUrl: string | null;
  posterUrl: string | null;
  caption: string;
}

export const dailyClip: DailyClipDemo = {
  title: "今日份可爱 · 自动合成",
  durationLabel: "30 秒 · 9:16",
  videoUrl: null,
  posterUrl: "/demo/pet/moment-tilt.png",
  caption: "把今天的高光瞬间自动剪成一条，每天打开都有惊喜。",
};

export interface PetDiaryEntryDemo {
  date: string;
  mood: string;
  moodEmoji: string;
  imageUrl: string | null;
  body: string;
  highlights: ReadonlyArray<string>;
}

export const petDiary: PetDiaryEntryDemo = {
  date: "今天 · 晴",
  mood: "元气满满",
  moodEmoji: "🐾",
  imageUrl: "/demo/pet/diary-cover.png",
  body: "今天我七点就起来催饭啦！上午和逗猫棒大战三百回合，中午在窗边晒着太阳睡了好久。下午赖在我的新垫子上打滚，软软的好舒服～晚上听到你的声音，我抬头找了你好久。",
  highlights: ["催饭成功 1 次", "玩耍 48 分钟", "在智能垫上待了 3 小时"],
};

export interface MoodCardDemo {
  mood: string;
  emoji: string;
  line: string;
  imageUrl: string | null;
}

export const moodCard: MoodCardDemo = {
  mood: "今日心情：被宠爱",
  emoji: "🧡",
  line: "“有人记得我的每一个可爱瞬间，真好。”",
  imageUrl: "/demo/pet/mood-card.png",
};

export const desktopPet = {
  title: "桌面小宠物",
  description:
    "把你的宠物变成桌面 / 手机里的小伙伴：休息时探出头、完成任务时来蹭一下，随时陪着你。",
  comingSoonLabel: "陪伴体验 · 即将上线",
} as const;

/* ------------------------------------------------------------------ */
/* 区块 5 · 自动生成视频草稿（3-5 条）                                    */
/* ------------------------------------------------------------------ */

export interface AutoVideoDraftDemo {
  id: string;
  title: string;
  audience: "owner" | "brand";
  audienceLabel: string;
  durationLabel: string;
  petVoiceCaption: string;
  postTitle: string;
  caption: string;
  hashtags: ReadonlyArray<string>;
  posterUrl: string | null;
  videoUrl: string | null;
  recommended: boolean;
}

export const autoVideoDrafts: ReadonlyArray<AutoVideoDraftDemo> = [
  {
    id: "v1",
    title: "今日高光合集",
    audience: "owner",
    audienceLabel: "给主人 · 情绪陪伴",
    durationLabel: "30s · 9:16",
    petVoiceCaption: "今天的我，可爱依旧～",
    postTitle: "我家主子今天的高光时刻",
    caption: "歪头、干饭、打滚，一个都没落下。每天的份可爱已送达 🐾",
    hashtags: ["#萌宠日常", "#我家有猫", "#治愈瞬间", "#Aivora"],
    posterUrl: "/demo/pet/moment-greeting.png",
    videoUrl: null,
    recommended: true,
  },
  {
    id: "v2",
    title: "歪头杀特辑",
    audience: "owner",
    audienceLabel: "给主人 · 高传播",
    durationLabel: "15s · 9:16",
    petVoiceCaption: "歪头是我的必杀技！",
    postTitle: "这个歪头谁顶得住啊",
    caption: "AI 自动挑出最萌的歪头瞬间，做成最容易爆的封面。",
    hashtags: ["#歪头杀", "#萌宠", "#每日一萌"],
    posterUrl: "/demo/pet/moment-tilt.png",
    videoUrl: null,
    recommended: false,
  },
  {
    id: "v3",
    title: "智能垫真实使用",
    audience: "brand",
    audienceLabel: "给品牌 · 产品证据",
    durationLabel: "20s · 9:16",
    petVoiceCaption: "我的新垫子也太舒服了吧",
    postTitle: "毛孩子主动趴上去的宠物垫",
    caption: "真实使用场景：宠物主动接触并长时间使用，可作为产品种草素材。",
    hashtags: ["#宠物好物", "#真实测评", "#宠物垫"],
    posterUrl: "/demo/pet/moment-product.png",
    videoUrl: null,
    recommended: false,
  },
];

/* ------------------------------------------------------------------ */
/* 区块 6 · 病毒式分享裂变                                                */
/* ------------------------------------------------------------------ */

export interface ShareStepDemo {
  step: number;
  title: string;
  detail: string;
}

export const viralSharing = {
  intro:
    "宠物内容低门槛、高情绪价值、不尴尬，天然适合社交传播。Aivora 把「分享」做成增长引擎。",
  platforms: ["抖音", "微信朋友圈", "小红书", "视频号", "快手"],
  watermarkNote:
    "每条视频自带 Aivora 水印与体验链接，朋友点开即可上传自己宠物的视频试用。",
  steps: [
    {
      step: 1,
      title: "一键分享",
      detail: "成片自动配好标题、字幕、话题标签，一键发到各大平台。",
    },
    {
      step: 2,
      title: "自带水印 + 体验链接",
      detail: "视频角标带品牌水印和邀请链接，传播即获客。",
    },
    {
      step: 3,
      title: "朋友点击体验",
      detail: "好友上传自家宠物视频即可试用，形成自然裂变。",
    },
    {
      step: 4,
      title: "模板挑战裂变",
      detail: "「最可爱睡姿」「听到主人声音的反应」等挑战模板加速扩散。",
    },
  ] satisfies ReadonlyArray<ShareStepDemo>,
  metrics: [
    { label: "示例 · 单条平均分享", value: "23 次" },
    { label: "示例 · 邀请转化", value: "1 带 4" },
    { label: "示例 · 内容获客成本", value: "趋近于 0" },
  ],
} as const;

/* ------------------------------------------------------------------ */
/* 区块 7 · Product Proof Report（B2B 付费理由）                          */
/* ------------------------------------------------------------------ */

export interface ProofMetricDemo {
  label: string;
  value: string;
  hint?: string;
}

export const productProofReport = {
  brandName: "示例品牌 · 暖暖宠物垫",
  productName: "恒温记忆棉宠物垫",
  period: "示例 · 近 14 天",
  summary:
    "基于智能宠物垫 + 摄像头联动采集的真实使用数据，自动生成可交付给品牌的产品使用证据报告。",
  coverImageUrl: "/demo/pet/moment-product.png",
  metrics: [
    { label: "真实使用天数", value: "13 / 14 天" },
    { label: "日均使用时长", value: "3 小时 12 分" },
    { label: "主动接触次数", value: "67 次" },
    { label: "常用时段", value: "20:00-22:00" },
  ] satisfies ReadonlyArray<ProofMetricDemo>,
  sellingPoints: [
    "宠物主动、高频使用，验证「舒适度」卖点真实可信",
    "夜间使用集中，契合「恒温保暖」核心场景",
    "真实使用片段可直接做种草素材，比摆拍更可信",
  ],
  scenes: [
    "宠物主动趴上垫子打滚",
    "夜间长时间安睡场景",
    "多只宠物轮流使用",
  ],
  whyPay:
    "品牌愿意付费，是因为 Aivora 提供的是「真实使用场景视频 + 数据报告」，比传统广告更可信，可直接用于电商详情页与投放素材。",
} as const;

/* ------------------------------------------------------------------ */
/* 区块 8 · 宠物社区生态预览                                              */
/* ------------------------------------------------------------------ */

export interface CommunityPostDemo {
  petName: string;
  ownerHandle: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  caption: string;
  likes: number;
  badge?: string;
}

export interface CommunityChallengeDemo {
  title: string;
  participants: string;
  tag: string;
}

export const community = {
  intro:
    "长期沉淀为以宠物为核心的内容社区：宠物主页、内容流、挑战赛与品牌试用入口，形成主人关系链与商业生态。",
  featuredProfile: {
    petName: "团子",
    species: "英短 · 2 岁",
    ownerHandle: "@团子的日常",
    avatarUrl: "/demo/pet/avatar-tuanzi.png",
    coverUrl: "/demo/pet/moment-tilt.png",
    stats: [
      { label: "粉丝", value: "1.2 万" },
      { label: "作品", value: "186" },
      { label: "获赞", value: "8.6 万" },
    ],
  },
  feed: [
    {
      petName: "团子",
      ownerHandle: "@团子的日常",
      avatarUrl: "/demo/pet/avatar-tuanzi.png",
      coverUrl: "/demo/pet/moment-sleeping.png",
      caption: "今天也是元气满满的一天～",
      likes: 3280,
      badge: "高传播",
    },
    {
      petName: "煤球",
      ownerHandle: "@煤球不是球",
      avatarUrl: "/demo/pet/avatar-meiqiu.png",
      coverUrl: "/demo/pet/moment-playing.png",
      caption: "飞扑接玩具，稳稳的！",
      likes: 2156,
    },
    {
      petName: "奶豆",
      ownerHandle: "@奶豆和我",
      avatarUrl: "/demo/pet/avatar-naidou.png",
      coverUrl: "/demo/pet/moment-product.png",
      caption: "新垫子已被本喵承包。",
      likes: 1890,
      badge: "品牌试用",
    },
  ] satisfies ReadonlyArray<CommunityPostDemo>,
  challenges: [
    { title: "最可爱睡姿挑战", participants: "1.8 万人参与", tag: "#最可爱睡姿" },
    {
      title: "听到主人声音的反应",
      participants: "2.3 万人参与",
      tag: "#听到主人声音",
    },
    { title: "干饭十级运动员", participants: "9600 人参与", tag: "#干饭瞬间" },
  ] satisfies ReadonlyArray<CommunityChallengeDemo>,
  brandTrial: {
    title: "品牌试用中心",
    description:
      "品牌方在这里发起新品试用，宠物主人免费领样并产出真实内容，品牌获得 UGC 授权与产品使用证据。",
    examples: ["恒温宠物垫试用", "冻干新品试吃", "智能逗猫玩具体验"],
  },
} as const;

/* ------------------------------------------------------------------ */
/* 投资人专区                                                            */
/* ------------------------------------------------------------------ */

export interface InvestorMetric {
  label: string;
  value: string;
  hint?: string;
}

export interface InvestorPillar {
  title: string;
  body: string;
}

export interface InvestorRoadmapItem {
  phase: string;
  status: "shipped" | "in_progress" | "next";
  statusLabel: string;
  body: string;
}

export const INVESTOR_SECTION = {
  eyebrow: "投资亮点 · 给投资人与孵化器的快速摘要",
  title: "Aivora 不只是一个宠物摄像头，而是一个 AI 驱动的宠物内容、陪伴与商业社区。",
  description:
    "Aivora 连接三个高价值场景：宠物主人的情感陪伴（B2C）、宠物内容的社交传播（增长）、宠物品牌的真实 UGC 营销（B2B）。硬件采集真实瞬间，AI 自动生产内容，分享形成裂变，社区沉淀数据资产。",
  metrics: [
    {
      label: "每天自动产出",
      value: "3-5 条",
      hint: "可分享宠物短视频草稿",
    },
    {
      label: "从瞬间到成片",
      value: "< 5 分钟",
      hint: "识别 → 剪辑 → 字幕全自动",
    },
    {
      label: "双向商业化",
      value: "B2C + B2B",
      hint: "情绪订阅 + 品牌内容/数据付费",
    },
    {
      label: "增长方式",
      value: "内容自传播",
      hint: "水印 + 邀请 + 挑战赛裂变",
    },
  ] satisfies ReadonlyArray<InvestorMetric>,
  pillars: [
    {
      title: "B2C 情绪入口",
      body: "每天看到自己宠物的可爱视频、宠物日记和心情卡，有惊喜感和陪伴感——这是高频打开、长期留存的情绪入口。",
    },
    {
      title: "天然分享裂变",
      body: "宠物内容低门槛、高情绪价值、不尴尬，天然适合社交平台传播。视频自带水印与邀请链接，分享即获客，内容获客成本趋近于零。",
    },
    {
      title: "B2B 真实证据",
      body: "智能宠物垫 + 摄像头联动，提供真实产品使用场景视频与数据报告（Product Proof Report），比传统广告更可信，品牌愿意为真实内容和真实数据付费。",
    },
    {
      title: "社区与数据资产",
      body: "宠物主页、内容流、挑战赛与品牌试用中心会沉淀社区关系链与数据资产，形成长期平台价值与商业生态。",
    },
  ] satisfies ReadonlyArray<InvestorPillar>,
  roadmap: [
    {
      phase: "P0 · 投资人 Demo",
      status: "shipped",
      statusLabel: "已完成",
      body: "宠物素材输入 + AI 识别 + 自动成片 + 宠物日记/可爱视频 + Product Proof Report demo + 分享与社区 UI 雏形，本页即可演示。",
    },
    {
      phase: "P1 · 增强说服力",
      status: "in_progress",
      statusLabel: "进行中",
      body: "项圈数据与主人远程发声、宠物垫传感器模拟、心情卡/每周回忆视频/桌面小宠物、挑战模板与品牌试用页。",
    },
    {
      phase: "P2 · 真实产品化",
      status: "next",
      statusLabel: "下一步",
      body: "接入真实摄像头/项圈/宠物垫硬件，打通社媒发布与数据回收，根据表现自动优化下一轮内容。",
    },
    {
      phase: "P3 · 平台与生态",
      status: "next",
      statusLabel: "规划中",
      body: "搭建宠物社区、品牌 Campaign Hub 与产品试用中心，形成「内容 → 增长 → 社区 → 品牌付费」的飞轮。",
    },
  ] satisfies ReadonlyArray<InvestorRoadmapItem>,
  cta: {
    primary: { label: "申请套件体验 / 商务合作", href: "#book-demo" },
    secondary: { label: "查看自动生成的宠物视频", href: "#auto-videos" },
  },
} as const;

/* ------------------------------------------------------------------ */
/* 市场机会                                                            */
/* ------------------------------------------------------------------ */

export interface MarketStat {
  value: string;
  label: string;
  hint?: string;
}

export interface MarketWedge {
  tier: "TAM" | "SAM" | "SOM";
  title: string;
  body: string;
}

export const MARKET_SECTION = {
  eyebrow: "市场机会",
  title: "站在 3000 亿宠物经济的「情绪 + 内容」拐点上",
  description:
    "中国宠物经济已迈过 3000 亿大关，人口红利见顶、单宠消费却创历史新高——行业正从「流量增长」转向「价值深耕」与「情绪消费」。增量不在红海的食品/用品本身，而在我们切入的「情绪陪伴 + 内容生产 + 品牌真实营销」这一价值层。",
  stats: [
    {
      value: "3126 亿元",
      label: "2025 城镇犬猫消费市场规模",
      hint: "同比 +4.1%，连续多年稳健增长",
    },
    {
      value: "3800 万+ 户",
      label: "城镇养宠（犬猫）家庭",
      hint: "对应 1.26 亿只犬猫",
    },
    {
      value: "约 69%",
      label: "90后 + 00后宠主占比",
      hint: "Z 世代为主，愿为情绪与品质付费",
    },
    {
      value: "4050 亿元",
      label: "2028 市场规模预测",
      hint: "存量竞争 → 价值深耕",
    },
  ] satisfies ReadonlyArray<MarketStat>,
  trends: [
    "70% 宠物消费已线上化，内容与社媒是关键种草与决策入口。",
    "单只犬年均消费约 3006 元、单只猫约 2085 元，且持续上行——「悦己 + 情绪」型支出占比快速提升。",
    "行业同质化、价格内卷加剧，品牌迫切需要更可信、更低成本的真实内容与营销证据。",
  ],
  wedges: [
    {
      tier: "TAM",
      title: "3126 亿元 · 宠物消费整体",
      body: "中国城镇犬猫消费大盘，2028 年预计达 4050 亿元。",
    },
    {
      tier: "SAM",
      title: "宠物内容 · 营销 · 智能硬件",
      body: "情绪陪伴订阅 + 宠物品牌内容/UGC 营销预算 + 智能宠物硬件，是其中增速最快、最具数字化空间的价值层。",
    },
    {
      tier: "SOM",
      title: "Z 世代线上养宠家庭 + 宠物品牌",
      body: "初期聚焦愿为情绪与内容付费的年轻养宠家庭，以及需要真实使用证据的宠物品牌，作为切入楔子。",
    },
  ] satisfies ReadonlyArray<MarketWedge>,
  sourceNote:
    "数据来源：《2026 年中国宠物行业白皮书（消费报告）》、USDA FAS 2026 等公开资料，仅用于市场体量参考。",
} as const;

/* ------------------------------------------------------------------ */
/* 商业模式（暂定）                                                     */
/* ------------------------------------------------------------------ */

export interface RevenueLine {
  tag: string;
  title: string;
  body: string;
  pricing: ReadonlyArray<string>;
}

export const BUSINESS_MODEL_SECTION = {
  eyebrow: "商业模式 · 暂定方向",
  title: "一套硬件，三条变现曲线",
  description:
    "硬件作为入口与数据来源，真正的复利来自「情绪订阅」与「品牌内容/数据付费」两条高毛利曲线；而内容自传播把获客成本压到趋近于零，反哺前两条。以下定价为暂定锚点，待小范围验证后调整。",
  lines: [
    {
      tag: "B2C · 硬件 + 情绪订阅",
      title: "硬件一次性 + 「陪伴会员」订阅",
      body: "硬件负责采集与入口，会员解锁无限 AI 成片、宠物日记、云存储、桌面小宠物与挑战模板。Freemium：免费版每日 1 条带水印，付费转无限去水印。",
      pricing: [
        "智能摄像头 ¥399 起 · 全套件（摄像头+项圈+宠物垫）¥899",
        "陪伴会员 ¥25/月 · ¥199/年",
      ],
    },
    {
      tag: "B2B · 品牌内容与数据",
      title: "真实使用证据 + UGC Campaign",
      body: "把真实使用场景视频与数据报告（Product Proof Report）卖给宠物品牌，比摆拍广告更可信；品牌试用中心撮合「品牌发样 → 宠物主产出真实内容」并抽佣。",
      pricing: [
        "品牌 Campaign ¥3 万–¥15 万/次（按规模）",
        "数据看板年框订阅 · 试用撮合抽佣",
      ],
    },
    {
      tag: "增长引擎 · 降本",
      title: "内容自传播压低 CAC",
      body: "每条视频自带水印 + 邀请链接 + 挑战模板，分享即获客，内容获客成本趋近于零，反哺 B2C 拉新与 B2B 内容供给。",
      pricing: [
        "邀请裂变 · 挑战赛模板 · 水印传播",
        "目标：内容驱动的 CAC 远低于行业投放",
      ],
    },
  ] satisfies ReadonlyArray<RevenueLine>,
  unitEconomics:
    "单只犬猫年均消费 2000–3000 元，情绪订阅 ARPU 仅占其中极小比例即可获得高粘性；叠加自传播的低获客成本，单位经济模型具备健康的毛利与回收空间。",
} as const;

/* ------------------------------------------------------------------ */
/* 团队                                                                */
/* ------------------------------------------------------------------ */

export interface TeamMember {
  name: string;
  role: string;
  initials: string;
  focus: string;
  bullets: ReadonlyArray<string>;
}

export const TEAM_SECTION = {
  eyebrow: "团队",
  title: "懂 AI 落地，也懂增长与品牌",
  description:
    "小而精的双核创始团队，工程与商业互补：一端把 AI 内容与软硬件真正落地，一端把产品变成可增长、可变现的生意。",
  members: [
    {
      name: "Lucas Jiang",
      role: "联合创始人 & CEO",
      initials: "LJ",
      focus: "战略 · 商业化 · 品牌与生态",
      bullets: [
        "负责整体战略、商业模式设计与资本/品牌生态合作",
        "深耕消费与宠物赛道的增长与品牌建设",
        "主导从 0 到 1 的市场进入与 B2B/B2C 商业化落地",
      ],
    },
    {
      name: "Evan Liao",
      role: "联合创始人 & CTO",
      initials: "EL",
      focus: "技术架构 · AI 内容管线 · 软硬件打通",
      bullets: [
        "加拿大 10 年资深工程师，长期深耕 AI 产品落地与服务化交付",
        "主导即梦/Seedance 视频生成、AI 识别与自动成片管线",
        "负责硬件采集—云端 AI—内容分发的端到端技术架构",
      ],
    },
  ] satisfies ReadonlyArray<TeamMember>,
  note: "我们正在寻找在宠物供应链、品牌 BD 与社区运营上互补的早期伙伴。",
} as const;

/* ------------------------------------------------------------------ */
/* 合规边界文案                                                          */
/* ------------------------------------------------------------------ */

export const COMPLIANCE_NOTES: ReadonlyArray<string> = [
  "本页设备状态、行为数据与识别瞬间均为 demo 模拟数据，用于演示产品闭环。",
  "硬件采集部分在 demo 阶段以 UI + 模拟数据呈现，不代表已量产硬件的真实数据。",
  "所有传播与使用指标均为示例数据，非任何真实账号的真实业绩。",
  "正式上线后，用户须对上传的宠物素材拥有合法使用权。",
  "品牌试用产生的 UGC 内容需经宠物主人显式授权后方可商用。",
];
