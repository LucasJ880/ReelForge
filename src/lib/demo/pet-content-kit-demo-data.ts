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

/**
 * Aivora 自有硬件套装的精修产品渲染图（/public/demo/pet/）。
 *
 * 用于「自有硬件套装」展示区与 hero 点缀。奶白/米色 studio 风，统一放在干净
 * 卡片里呈现，强化「这是一家有自有硬件品牌的公司」的实感。缺图时 PetImage 降级。
 */
export const PET_RENDER = {
  cam360: "/demo/pet/cam-360.png",
  collarCam: "/demo/pet/collar-cam.png",
  smartMat: "/demo/pet/smart-mat.png",
  kitGroup: "/demo/pet/kit-group.png",
  poster: "/demo/pet/hardware-kit-poster.png",
} as const;

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
  videoUrl: "/generated/pet-evidence-highlight.mp4",
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
    videoUrl: "/generated/pet-evidence-highlight.mp4",
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
    videoUrl: "/generated/pet-evidence-headtilt.mp4",
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
    videoUrl: "/generated/pet-evidence-mat.mp4",
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
      phase: "P0 · Demo",
      status: "shipped",
      statusLabel: "已完成",
      body: "围绕核心产品闭环，已完成可演示版本：支持宠物素材输入、AI 识别、自动成片、宠物日记与 Product Proof Report 展示，并初步呈现分享与社区化界面。重点：展示 Aivora 的产品价值与商业路径。",
    },
    {
      phase: "P1 · 产品力，硬件 Demo",
      status: "in_progress",
      statusLabel: "进行中",
      body: "加入更具体验感的功能模块，包括项目数据、主人远程发声、宠物垫传感器模拟、心情卡 / 每周回顾 / 桌面小宠物，以及挑战模板与品牌试用页。重点：提升产品真实感、感染力与记忆点。",
    },
    {
      phase: "P2 · 真实产品化",
      status: "next",
      statusLabel: "下一步",
      body: "逐步接入真实摄像头、项圈与宠物垫硬件，打通内容采集、社媒分发与效果回收链路，并建立基于结果的自动优化能力。重点：从 Demo 走向可落地的软硬件一体化产品。",
    },
    {
      phase: "P3 · 平台与生态",
      status: "next",
      statusLabel: "规划中",
      body: "拓展宠物社区、品牌 Campaign Hub 与产品试用中心，形成「内容生产 — 用户增长 — 社区沉淀 — 品牌付费」的长期飞轮。重点：从产品升级为平台，建立持续增长的生态价值。",
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
/* Why Now · 为什么是现在                                              */
/* ------------------------------------------------------------------ */

export interface WhyNowShiftItem {
  index: string;
  title: string;
  body: string;
}

export const WHY_NOW_SECTION = {
  eyebrow: "Why Now · 为什么是现在",
  title: "宠物，正在成为新一代情绪消费入口",
  intro:
    "在经济不确定的周期里，消费者会减少大额支出，但不会停止寻找情绪安慰。过去，人们用一支口红获得即时满足；今天，越来越多年轻人把这种情绪价值，投向每天陪伴自己的毛孩子。宠物不只是宠物——它们正在成为家庭成员、社交内容、生活方式和情绪消费的核心入口。",
  lipstick: {
    eyebrow: "The New Lipstick Effect",
    title: "新一代「口红效应」",
    body: "经济下行时，用户并不是不消费，而是更倾向于选择：",
    bullets: ["更低门槛的消费", "更高频的陪伴", "更即时的情绪满足", "更值得分享的生活片段"],
    footer:
      "宠物消费正好符合这些特征。一只宠物带来的价值，不只是食品、用品和护理，而是每天持续发生的陪伴感、治愈感和分享欲。这也是为什么宠物赛道在消费承压的环境下，依然具备韧性。",
  },
  emotion: {
    eyebrow: "From Pet Care to Pet Emotion",
    title: "从「养宠」到「宠物情绪经济」",
    body: "中国宠物市场正在从功能型消费，进入情绪型消费阶段。",
    from: {
      label: "过去 · 功能型消费",
      items: ["食品", "清洁", "护理", "基础用品"],
    },
    to: {
      label: "现在 · 情绪型消费",
      items: ["陪伴", "记录", "分享", "智能硬件", "内容表达", "社交身份", "品牌体验"],
    },
    footer:
      "用户不只是想「照顾好宠物」，而是希望记录它、理解它、分享它，并通过它获得持续的情绪价值。",
  },
  whyAivora: {
    eyebrow: "Why Aivora",
    title: "为什么是 Aivora",
    body: "Aivora 切入的不是普通宠物用品市场，也不是单纯的宠物摄像头市场，而是一个正在形成的新场景：",
    formula: "真实宠物日常 × AI 内容生成 × 智能硬件 × 社交分享 × 品牌证据",
    generates: [
      "可爱短视频",
      "宠物日记",
      "主人陪伴内容",
      "社交分享素材",
      "品牌 Product Proof Report",
    ],
    footer:
      "我们通过自有硬件套装捕捉宠物真实行为，再用 AI 自动生成上述内容，让宠物日常不再只是被记录，而是被转化成内容资产和商业价值。",
  },
  marketShift: {
    eyebrow: "The Market Shift",
    title: "市场正在发生的变化",
    items: [
      {
        index: "01",
        title: "宠物主人更愿意为情绪价值付费",
        body: "宠物已经成为年轻人、独居人群和城市家庭的重要陪伴对象。用户愿意为毛孩子购买更好的产品，也愿意为「被治愈」「被陪伴」「被理解」的体验付费。",
      },
      {
        index: "02",
        title: "宠物内容天然适合传播",
        body: "宠物视频低门槛、高接受度、强情绪价值，用户分享宠物不需要复杂理由。一个表情、一次撒娇、一个睡姿、一次听到主人声音后的反应，都可能成为愿意主动发布的内容。Aivora 的机会，是把这种天然分享欲自动化、产品化。",
      },
      {
        index: "03",
        title: "品牌越来越需要真实 UGC",
        body: "宠物品牌最难证明的不是「产品有没有功能」，而是宠物真的喜欢吗、真实家庭里会不会用、用户看到后会不会相信。Aivora 用摄像头、项圈与宠物垫捕捉真实使用场景，生成品牌可用的 Product Proof Report——不只是视频，而是真实、可验证、可传播的内容证据。",
      },
      {
        index: "04",
        title: "AI 正在降低内容生产成本",
        body: "过去品牌要一条高质量宠物视频，需要达人、拍摄、剪辑、脚本和投放团队。Aivora 把它变成：采集真实行为 → AI 识别高光 → 自动成片 → 自动标题字幕 → 自动报告 → 自动分享，让宠物内容规模化生产，也让普通宠物主人变成内容节点。",
      },
    ] satisfies ReadonlyArray<WhyNowShiftItem>,
  },
  timing: {
    eyebrow: "Aivora's Timing",
    title: "为什么现在切入",
    intro: "现在是 Aivora 的窗口期，因为五个趋势正在同时发生：",
    trends: [
      "宠物陪伴正在成为年轻人的情绪出口",
      "短视频仍是消费品牌获客的核心渠道",
      "AI 正在重构内容生产方式",
      "智能硬件正在成为真实场景的数据入口",
      "品牌越来越需要真实 UGC 和产品使用证据",
    ],
    closing: "Aivora 正好站在这些趋势的交汇点。",
  },
  positioning: {
    en: "Aivora is not just a pet camera. It is an AI-powered pet content and product proof platform.",
    zh: "Aivora 不是宠物摄像头，而是一个由 AI 和自有硬件驱动的宠物内容与产品证据平台。",
  },
  highlights: [
    "经济下行时，情绪需求不会消失，只会转向更轻、更高频、更有陪伴感的消费。",
    "过去的口红效应是一次小额安慰；今天的宠物经济，是每天持续发生的治愈陪伴。",
    "Aivora 把宠物日常变成可分享的内容，也变成品牌愿意付费的真实证据。",
    "我们不只是记录宠物，而是在重构宠物内容、陪伴与品牌营销的连接方式。",
  ],
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
  /** 较长的个人简介段落（可选）。 */
  bio?: string;
  bullets: ReadonlyArray<string>;
  /** 这个人在 Aivora 的价值（可选）。 */
  value?: string;
}

export const TEAM_SECTION = {
  eyebrow: "团队",
  title: "核心团队",
  description:
    "小而精的双核创始团队，工程与商业互补：一端把 AI 内容与软硬件真正落地，一端把产品变成可增长、可变现的生意。",
  members: [
    {
      name: "Lucas Jiang",
      role: "联合创始人 & CEO",
      initials: "LJ",
      focus: "北美社媒增长 · 商业化 · 品牌生态",
      bio: "Lucas 多年深耕北美社媒推广与品牌营销，熟悉本地消费品牌从内容定位、用户触达到商业转化的完整路径。他长期接触北美市场客户，理解品牌在 TikTok、Instagram、Amazon 和本地渠道推广时遇到的真实问题：内容生产成本高、真实 UGC 难获取、产品卖点难验证、跨语言和跨文化表达不够本地化。在 Aivora 中，Lucas 负责整体战略、商业模式、品牌定位、市场合作和 B2B/B2C 增长路径。",
      bullets: [
        "北美社媒推广与品牌营销，懂本地消费品牌增长路径",
        "负责整体战略、商业模式、品牌定位与市场合作",
        "主导 B2B/B2C 增长与商业化落地",
      ],
      value:
        "Aivora 不只是一个 AI 工具，而是一个连接宠物主人、内容创作者和品牌方的商业系统。Lucas 负责把「用户为什么愿意分享」和「品牌为什么愿意付费」这两个关键问题跑通。",
    },
    {
      name: "Evan Liao",
      role: "联合创始人 & CTO",
      initials: "EL",
      focus: "AI 产品工程化 · 系统架构 · 软硬件闭环",
      bio: "Evan 拥有多年软件工程经验，曾在 Amazon 担任开发相关工作，具备复杂系统架构、AI 产品落地和服务化交付经验。他理解一个 AI 产品从 Demo 到真实可用系统所需要解决的关键问题，包括视频处理、AI 识别、自动剪辑、云端架构、硬件数据接入和多端产品体验。在 Aivora 中，Evan 负责 AI 内容管线、视频生成流程、硬件数据接入、系统架构和从 Demo 到 MVP 的产品化落地。",
      bullets: [
        "多年软件工程经验，曾在 Amazon 担任开发相关工作",
        "主导即梦/Seedance 视频生成、AI 识别与自动成片管线",
        "负责硬件采集—云端 AI—内容分发的端到端架构",
      ],
      value:
        "Aivora 不是简单的 AI 生成页面，而是需要连接摄像头、项圈、宠物垫、视频识别、内容生成、报告输出和用户端应用的端到端系统。Evan 负责把这个复杂系统真正做出来。",
    },
  ] satisfies ReadonlyArray<TeamMember>,
  whyFit: {
    title: "为什么这个团队适合做 Aivora",
    intro:
      "Aivora 处在五个领域的交叉点：宠物消费、AI 内容生成、智能硬件、社交分享、品牌营销。这个项目要同时具备两种能力：",
    points: [
      {
        title: "懂市场",
        body: "知道宠物主人为什么愿意分享，什么内容易传播，品牌为什么需要真实 UGC 和 Product Proof。",
      },
      {
        title: "能落地",
        body: "能把硬件采集、AI 识别、视频生成、数据报告和产品体验连接成完整系统。",
      },
    ],
    closing:
      "Lucas 负责市场、品牌、增长和商业化，Evan 负责 AI、系统、工程和产品落地。这让 Aivora 不只是一个概念 Demo，而是具备从 Demo 到 MVP、再到平台化发展的团队基础。",
  },
  note: "我们正在寻找在宠物供应链、品牌 BD 与社区运营上互补的早期伙伴。",
} as const;

/* ------------------------------------------------------------------ */
/* Aivora 自有硬件套装                                                  */
/* ------------------------------------------------------------------ */

export type HardwareStageTag = "mvp" | "b2b" | "future";

export interface HardwareProductDemo {
  key: "camera" | "collar" | "mat";
  image: string;
  name: string;
  englishName: string;
  /** 路线图定位标签 */
  stage: HardwareStageTag;
  stageLabel: string;
  /** 一句话定位 */
  tagline: string;
  /** 核心能力 */
  capabilities: ReadonlyArray<string>;
  /** 市场验证参考（不是「我们接入这些设备」，而是市场已被验证） */
  marketReferences: ReadonlyArray<string>;
  /** Aivora 在参考品类之上的差异化 */
  aivoraDifference: ReadonlyArray<string>;
  cta: { label: string; href: string };
}

export const HARDWARE_KIT_SECTION = {
  eyebrow: "Aivora 自有硬件套装",
  title: "不是接在别人摄像头上的软件层，而是 Aivora 自有的宠物内容采集套装",
  description:
    "三类智能采集入口协同工作，把真实宠物行为转化为主人愿意分享的内容，和品牌愿意付费的产品使用证据。它们共同服务一个闭环，构成 Aivora 的数据入口与品牌壁垒。",
  /** 策略文档的投资人核心话术（中英双语，中文先行）。 */
  investorLine:
    "Aivora 要做的是自有 AI 宠物内容硬件套装，而不是依附在现有摄像头上的软件层。",
  investorLineEn:
    "Aivora is building its own AI pet content hardware kit, not just a software layer on top of existing cameras.",
  /** 顶部主视觉：信息图海报。 */
  heroImage: PET_RENDER.poster,
  heroImageAlt: "Aivora Pet Content Intelligence Kit 产品全景",
  products: [
    {
      key: "camera",
      image: PET_RENDER.cam360,
      name: "Aivora 360° 宠物内容摄像头",
      englishName: "Aivora Smart Pet Content Cam",
      stage: "mvp",
      stageLabel: "核心设备",
      tagline:
        "360° AI 追踪宠物、捕捉可爱瞬间，并自动生成可分享视频。",
      capabilities: [
        "360° 可旋转 · AI 宠物识别与自动追踪",
        "双向语音 / 主人远程发声",
        "自动捕捉吃饭、睡觉、玩耍、撒娇、使用产品",
        "每天自动生成 3–5 条短视频 + 宠物日记",
        "自动生成标题、字幕、话题标签，可触发 Product Proof",
      ],
      marketReferences: [
        "Petlibro Scout",
        "Furbo 360",
        "Petcube Cam 360",
        "eufy Pet D605",
      ],
      aivoraDifference: [
        "从「监控回顾」升级为「可发布内容」",
        "AI 自动成片 + 宠物日记 + 主人陪伴",
        "病毒式分享裂变 + 品牌 UGC 证据",
      ],
      cta: { label: "生成一条可爱视频", href: "#auto-videos" },
    },
    {
      key: "mat",
      image: PET_RENDER.smartMat,
      name: "Aivora 智能宠物垫传感器",
      englishName: "Aivora Smart Pet Mat Sensor",
      stage: "b2b",
      stageLabel: "记录宠物身体数据",
      tagline:
        "记录宠物是否真实使用产品，并把真实使用转化为品牌可用的视频内容与 Product Proof Report。",
      capabilities: [
        "压力 / 存在感应，判断宠物是否主动使用产品",
        "记录使用频率、时长与常用时段",
        "与摄像头联动触发拍摄",
        "自动生成 Product Proof Report",
        "适配宠物毯、窝、垫子、玩具等品类测试",
      ],
      marketReferences: [
        "Carepet Smart Bed",
        "Sensor Pet Bed",
        "压力感应宠物垫",
        "ODM Smart Mat",
      ],
      aivoraDifference: [
        "不是「智能床」，而是「产品使用证据传感器」",
        "把使用数据转化为 AI 视频 + 品牌报告",
        "为品牌证明「宠物真的主动使用了产品」",
      ],
      cta: { label: "查看 Product Proof Demo", href: "#proof-report" },
    },
    {
      key: "collar",
      image: PET_RENDER.collarCam,
      name: "Aivora 宠物第一视角项圈摄影机",
      englishName: "Aivora Pet POV Collar Cam",
      stage: "future",
      stageLabel: "未来差异化 · 第一视角内容入口",
      tagline:
        "从宠物第一视角记录它看到的世界，并自动生成可爱的 AI 冒险视频。",
      capabilities: [
        "宠物第一视角拍摄 · 户外散步 POV",
        "GPS / 活动状态记录",
        "主人远程发声，捕捉宠物听到声音后的反应",
        "AI 自动生成宠物冒险日记与短视频",
        "未来接入宠物社区分享",
      ],
      marketReferences: [
        "Enabot ROLA PetTracker",
        "FetchLink C10",
        "Fi Smart Collar",
        "Invoxia Minitailz",
      ],
      aivoraDifference: [
        "不是 GPS 训练项圈，而是「宠物 POV 内容入口」",
        "AI 生成第一视角冒险视频与回忆短片",
        "远程语音反应成片 + 社交分享",
      ],
      cta: { label: "查看宠物第一视角愿景", href: "#community" },
    },
  ] satisfies ReadonlyArray<HardwareProductDemo>,
} as const;

/* ------------------------------------------------------------------ */
/* 增长飞轮                                                            */
/* ------------------------------------------------------------------ */

export interface FlywheelNodeDemo {
  label: string;
  hint: string;
}

export const GROWTH_FLYWHEEL = {
  eyebrow: "增长飞轮",
  title: "硬件采集真实行为 → AI 内容 → 分享裂变 → 社区与品牌付费 → 更多数据",
  description:
    "每一次真实宠物行为都被转化为内容与数据资产：主人主动分享带来近乎零成本的获客，社区沉淀关系链，品牌为真实使用证据付费，反过来又带来更多硬件与更多真实数据，形成复利。",
  nodes: [
    { label: "智能摄像头 / 项圈 / 宠物垫", hint: "三类采集入口" },
    { label: "真实宠物行为数据", hint: "自有数据壁垒" },
    { label: "AI 可爱视频 + 宠物日记", hint: "全自动成片" },
    { label: "主人主动分享", hint: "高情绪价值、低门槛" },
    { label: "病毒式低成本获客", hint: "CAC 趋近于零" },
    { label: "宠物社区", hint: "关系链与数据资产" },
    { label: "品牌 Campaign + Product Proof", hint: "B2B 付费" },
  ] satisfies ReadonlyArray<FlywheelNodeDemo>,
  closingNote: "→ 更多硬件、更多真实数据，飞轮持续转动。",
} as const;

/* ------------------------------------------------------------------ */
/* 对标痛点对比矩阵                                                      */
/* ------------------------------------------------------------------ */

export type BenchmarkCell = "yes" | "partial" | "no" | "core";

export interface BenchmarkRowDemo {
  feature: string;
  ordinary: BenchmarkCell;
  aiCamera: BenchmarkCell;
  wearableMat: BenchmarkCell;
  aivora: BenchmarkCell;
}

export const BENCHMARK_MATRIX = {
  eyebrow: "对标对比 · 为什么是 Aivora",
  title: "现有产品只解决单点需求，Aivora 把真实行为变成内容资产与商业资产",
  description:
    "现有宠物摄像头只是「看宠物、互动、追踪或健康监测」。我们不跟 Furbo、Petlibro、Petcube 比摄像头参数，而是比谁能把宠物真实行为转化成主人愿意分享的内容、品牌愿意付费的证据。",
  columns: ["普通宠物摄像头", "AI 宠物摄像头", "智能项圈 / 床垫", "Aivora Kit"],
  rows: [
    { feature: "看宠物", ordinary: "yes", aiCamera: "yes", wearableMat: "partial", aivora: "yes" },
    { feature: "远程发声", ordinary: "yes", aiCamera: "yes", wearableMat: "partial", aivora: "yes" },
    { feature: "自动追踪", ordinary: "partial", aiCamera: "yes", wearableMat: "no", aivora: "yes" },
    { feature: "AI 行为识别", ordinary: "no", aiCamera: "yes", wearableMat: "partial", aivora: "yes" },
    { feature: "自动生成短视频", ordinary: "no", aiCamera: "partial", wearableMat: "no", aivora: "core" },
    { feature: "宠物语气字幕", ordinary: "no", aiCamera: "partial", wearableMat: "no", aivora: "yes" },
    { feature: "一键社交分享", ordinary: "partial", aiCamera: "partial", wearableMat: "no", aivora: "core" },
    { feature: "产品使用证据", ordinary: "no", aiCamera: "no", wearableMat: "partial", aivora: "core" },
    { feature: "品牌报告", ordinary: "no", aiCamera: "no", wearableMat: "no", aivora: "core" },
    { feature: "硬件套装", ordinary: "no", aiCamera: "no", wearableMat: "no", aivora: "yes" },
  ] satisfies ReadonlyArray<BenchmarkRowDemo>,
  painPoints: [
    "每日可爱视频、宠物日记、字幕，Aivora 给到客户每日的及时反馈。",
    "稳定成片、内容归主人所有、品牌商用需二次授权、可删除、可不上云。",
    "摄像头负责室内、项圈负责户外第一视角、宠物垫负责使用证据，AI 后台统一成片与分发。",
  ],
  sourceNote:
    "对比与参考价格来自公开渠道与同类产品资料，仅用于 Demo / 投资人沟通的市场参照，实际以各品牌官方为准。",
} as const;

/* ------------------------------------------------------------------ */
/* 真实产品输出证据短片（由 Seedance 生成 + 烧字幕 + 纯音乐）             */
/* ------------------------------------------------------------------ */

/**
 * 这些竖版 9:16 成片由 `npm run demo:gen:evidence` 生成，放在 public/generated/。
 * 它们是「产品真的能自动产出可分享视频」的证据——文件不存在时，所有引用处都会
 * 优雅降级回退到 poster 图（PhoneVideoMockup / video fallback），不影响页面。
 */
export const PET_EVIDENCE_CLIP = {
  highlight: "/generated/pet-evidence-highlight.mp4",
  headtilt: "/generated/pet-evidence-headtilt.mp4",
  mat: "/generated/pet-evidence-mat.mp4",
  raw: "/generated/pet-evidence-raw.mp4",
} as const;

/* ------------------------------------------------------------------ */
/* Demo Story · 一日闭环叙事                                            */
/* ------------------------------------------------------------------ */

export type StoryActor = "owner" | "camera" | "collar" | "mat" | "ai" | "brand";

export interface DemoStoryStepDemo {
  time: string;
  actor: StoryActor;
  actorLabel: string;
  title: string;
  body: string;
  output?: string;
}

export const DEMO_STORY = {
  eyebrow: "Demo Story · 一天里发生了什么",
  title: "主人出门上班的一天，Aivora 如何把真实瞬间变成内容与证据",
  description:
    "跟着「奶豆」的一天，看硬件、AI 与增长如何在一条闭环里协作——主人几乎什么都不用做，下班就收到可发布的视频、宠物日记，品牌端则收到一份真实使用证据。",
  steps: [
    {
      time: "08:10",
      actor: "owner",
      actorLabel: "主人",
      title: "出门上班，留奶豆一个人在家",
      body: "出门前对着 App 说了句「乖乖的」。从这一刻起，采集与成片全部自动进行。",
    },
    {
      time: "10:30",
      actor: "camera",
      actorLabel: "360° 摄像头",
      title: "捕捉到窗边晒太阳的睡颜",
      body: "AI 识别到「睡觉 / 放松」高情绪价值场景，自动追踪并录下最可爱的片段。",
      output: "高光片段 · 睡颜",
    },
    {
      time: "13:00",
      actor: "mat",
      actorLabel: "智能宠物垫",
      title: "奶豆主动趴上新垫子 3 小时",
      body: "压力传感器记录到真实使用：主动接触、长时间停留，并联动摄像头拍下使用画面。",
      output: "产品使用证据 · 时长 / 频次",
    },
    {
      time: "18:40",
      actor: "ai",
      actorLabel: "AI 成片",
      title: "下班路上，收到今日份可爱",
      body: "AI 自动把当天高光剪成一条 30s 竖版视频，配好宠物语气字幕、标题、话题标签，并写好今日宠物日记。",
      output: "可发布短视频 + 宠物日记",
    },
    {
      time: "21:15",
      actor: "owner",
      actorLabel: "主人",
      title: "一键分享到朋友圈 / 抖音",
      body: "视频自带 Aivora 水印与体验链接，朋友点开就能上传自家宠物试用——分享即获客。",
      output: "自然裂变 · 内容获客",
    },
    {
      time: "次日",
      actor: "brand",
      actorLabel: "品牌端",
      title: "宠物垫品牌收到一份真实使用证据",
      body: "近 14 天的真实使用数据 + 使用画面自动汇成 Product Proof Report，成为品牌愿意付费的种草素材。",
      output: "B2B · Product Proof Report",
    },
  ] satisfies ReadonlyArray<DemoStoryStepDemo>,
  closing:
    "一天下来，主人几乎零操作，却收获了内容、记忆与陪伴；品牌收获了真实证据；Aivora 收获了数据与传播。",
} as const;

/* ------------------------------------------------------------------ */
/* Before / After · 原始素材 → AI 成片                                  */
/* ------------------------------------------------------------------ */

export const BEFORE_AFTER = {
  eyebrow: "Before / After · 产品真的能跑",
  title: "同一段真实素材，AI 自动剪成可以马上发的可爱视频",
  description:
    "左边是主人随手录的、平淡冗长的原始素材；右边是 Aivora 自动产出的成片。没有人工剪辑，全流程自动完成——这正是产品每天为每位用户做的事。",
  before: {
    label: "原始素材 · 主人随手录",
    durationLabel: "10s · 未剪辑",
    videoUrl: PET_EVIDENCE_CLIP.raw,
    posterUrl: "/demo/pet/moment-sleeping.png",
    caption: null as string | null,
    notes: ["平淡、冗长、没有重点", "画面晃、没有字幕和配乐", "主人没时间也没精力剪"],
  },
  after: {
    label: "AI 成片 · 自动产出",
    durationLabel: "8s · 9:16 可发布",
    videoUrl: PET_EVIDENCE_CLIP.highlight,
    posterUrl: "/demo/pet/moment-greeting.png",
    caption: "今天的我，可爱依旧 🐾",
    notes: [
      "自动挑出最可爱、最值得分享的瞬间",
      "自动配宠物语气字幕 + 纯音乐 + 节奏",
      "自动生成标题、话题标签，一键可发",
    ],
  },
  aiSteps: ["识别高光", "智能剪辑", "字幕配乐", "标题标签", "一键发布"],
  note: "示例成片由 Aivora 视频管线自动生成，用于演示产品输出能力。",
} as const;

/* ------------------------------------------------------------------ */
/* Collar POV · 远程发声 → 自动成片                                     */
/* ------------------------------------------------------------------ */

export interface CollarPovStepDemo {
  step: number;
  title: string;
  detail: string;
}

export const COLLAR_POV = {
  eyebrow: "宠物第一视角 · 远程发声成片",
  title: "在公司喊一声，项圈摄影机自动剪出它听到你的反应",
  description:
    "Aivora 第一视角项圈摄影机从宠物视角记录世界。主人远程发声，AI 自动捕捉宠物听到声音后的反应并剪成短片——记忆点强、传播性高，是未来差异化的内容入口。",
  povImage: PET_RENDER.collarCam,
  steps: [
    {
      step: 1,
      title: "主人远程发声",
      detail: "在 App 里点一下或说句话，声音通过项圈实时传到宠物耳边。",
    },
    {
      step: 2,
      title: "捕捉第一视角反应",
      detail: "项圈摄影机从宠物视角记录它抬头、找你、奔跑的瞬间。",
    },
    {
      step: 3,
      title: "AI 自动剪成短片",
      detail: "自动挑出「听到主人声音的反应」高光，配字幕音乐生成可分享冒险短片。",
    },
  ] satisfies ReadonlyArray<CollarPovStepDemo>,
  challengeLabel: "模板挑战 · 听到主人声音的反应",
  futureNote: "第一视角项圈为扩展阶段产品，此处为体验概念演示。",
} as const;

/* ------------------------------------------------------------------ */
/* 品牌 Product Proof 场景化流程（垫子触发 → 摄像头 → 报告）             */
/* ------------------------------------------------------------------ */

export interface BrandProofStepDemo {
  step: number;
  actorLabel: string;
  title: string;
  detail: string;
}

export const BRAND_PROOF_SCENARIO = {
  eyebrow: "B2B 闭环 · 从真实使用到品牌付费",
  title: "宠物垫被踩上的那一刻，一条品牌证据链自动启动",
  description:
    "品牌最想知道的不是「投放曝光」，而是「宠物真的用了我的产品吗」。Aivora 把真实使用变成可交付、可信的证据链——这是商家愿意付费的根本理由。",
  steps: [
    {
      step: 1,
      actorLabel: "智能宠物垫",
      title: "传感器感知到真实使用",
      detail: "压力 / 存在感应判断宠物主动趴上产品，并记录时长、频次、时段。",
    },
    {
      step: 2,
      actorLabel: "360° 摄像头",
      title: "联动拍下使用画面",
      detail: "传感器触发摄像头，捕捉宠物真实使用产品的可用画面（非摆拍）。",
    },
    {
      step: 3,
      actorLabel: "AI 内容引擎",
      title: "生成种草素材 + 证据报告",
      detail: "自动剪出产品使用短片，并汇总真实使用数据，生成 Product Proof Report。",
    },
    {
      step: 4,
      actorLabel: "品牌方",
      title: "付费获取真实证据与素材",
      detail: "品牌用它做投放素材、做产品测评、做 Campaign——为「被验证的真实使用」付费。",
    },
  ] satisfies ReadonlyArray<BrandProofStepDemo>,
  pricingHint: "示例 · 品牌真实使用证据报告 + 素材包：3-15 万 / 次（按品类与规模）",
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
