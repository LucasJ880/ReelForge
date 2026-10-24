import type { Locale } from "./config";

/**
 * 获客闭环（1025 · A5）的全部界面文案：公开首页（试点申请）、商家询盘页 /l/[slug]、
 * 工作台「询盘」与管理员面板。纯数据、无服务端依赖——客户端组件与服务端都从这里取。
 *
 * 口径：
 *  - 不写价格、不写效果主张：试点费用与结果承诺的数字「申请后按试点单独约定」（计划 §7.3 待拍板）。
 *  - 「成交」只留给询盘（计划 B1.3），视频侧不用这个词。
 *  - 同意文本带版本号：改文案就改版本号，服务端按版本校验并原样落库（举证收集时展示了什么）。
 */

/// 同意文本版本：改下方 consent 文案时必须同时改版本号。
export const PILOT_CONSENT_VERSION = "pilot-2026-10-25";
export const LEAD_CONSENT_VERSION = "lead-2026-10-25";

export const LEAD_STATUSES = ["NEW", "CONTACTED", "BOOKED", "WON", "LOST"] as const;
export type LeadStatusKey = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = ["lead_page", "tracked_link", "booth", "manual"] as const;
export type LeadSourceKey = (typeof LEAD_SOURCES)[number];

/// 追踪链接渠道：按渠道手工建（计划 6.3）。schema 里还有 post（按帖子建），本轮界面不开放。
export const TRACKED_LINK_CHANNELS = ["ig_bio", "google_business", "facebook", "qr", "other"] as const;
export type TrackedLinkChannel = (typeof TRACKED_LINK_CHANNELS)[number];

/// 「您从哪里看到我们」：访客自报来源，存 key，展示时再翻译。
export const SELF_REPORTED_SOURCES = [
  "instagram",
  "facebook",
  "google",
  "tiktok",
  "xiaohongshu",
  "wechat",
  "referral",
  "other",
] as const;
export type SelfReportedSource = (typeof SELF_REPORTED_SOURCES)[number];

export const PREFERRED_TIMES = ["weekday_daytime", "weekday_evening", "weekend", "anytime"] as const;
export type PreferredTime = (typeof PREFERRED_TIMES)[number];

/// 试点申请里「现在每月在获客上花多少」——是商家自己的花费区间，不是我们的报价。
export const MONTHLY_LEAD_SPEND = ["none", "under_300", "300_1000", "over_1000", "unsure"] as const;
export type MonthlyLeadSpend = (typeof MONTHLY_LEAD_SPEND)[number];

interface PilotStep {
  when: string;
  title: string;
  body: string;
}

interface GrowthCopy {
  landing: {
    metaTitle: string;
    metaDescription: string;
    home: string;
    signIn: string;
    /** 标题按意群分行（避免在词中间折行），整句见 metaTitle 与读屏。 */
    titleLines: string[];
    subtitle: string;
    apply: string;
    samples: string;
    sampleTag: string;
    sampleFallbackName: string;
    sampleNote: string;
    structureTitle: string;
    structureHint: string;
    steps: PilotStep[];
    rulesTitle: string;
    rules: Array<{ title: string; body: string }>;
    applyTitle: string;
    applyLead: string;
    applyNext: string[];
    privacy: string;
    terms: string;
  };
  pilotForm: {
    label: string;
    name: string;
    company: string;
    industry: string;
    industryPlaceholder: string;
    city: string;
    contactGroup: string;
    email: string;
    phone: string;
    whatsapp: string;
    wechat: string;
    website: string;
    spend: string;
    spendPlaceholder: string;
    message: string;
    consent: string;
    submit: string;
    submitting: string;
    successTitle: string;
    successBody: string;
    contactRequired: string;
    consentRequired: string;
    invalid: string;
    rateLimited: string;
    rateLimitedContact: string;
    genericError: string;
    honeypot: string;
  };
  leadPage: {
    metaTitle: string;
    defaultHeadline: string;
    defaultIntro: string;
    fallbackBusiness: string;
    callUs: string;
    services: string;
    region: string;
    poweredBy: string;
    privacy: string;
    switchLocale: string;
  };
  leadForm: {
    label: string;
    name: string;
    phone: string;
    email: string;
    service: string;
    serviceOther: string;
    servicePlaceholder: string;
    preferredTime: string;
    source: string;
    message: string;
    choose: string;
    consent: string;
    submit: string;
    submitting: string;
    successTitle: string;
    successBody: string;
    phoneInvalid: string;
    consentRequired: string;
    invalid: string;
    rateLimited: string;
    genericError: string;
    callFallback: string;
    honeypot: string;
  };
  leads: {
    title: string;
    subtitle: string;
    statsLabel: string;
    inquiries7: string;
    inquiriesCaption: string;
    clicks7: string;
    clicksCaption: string;
    topSource: string;
    topSourceCaption: string;
    topSourceEmpty: string;
    scope: string;
    openPage: string;
    listTitle: string;
    listHint: string;
    listEmpty: string;
    columns: {
      when: string;
      who: string;
      service: string;
      source: string;
      status: string;
      actions: string;
    };
    selfReported: string;
    verified: string;
    markVerified: string;
    unmarkVerified: string;
    archive: string;
    archiveConfirm: string;
    moveTo: string;
    conflict: string;
    actionFailed: string;
    manualTitle: string;
    manualHint: string;
    /** 手工登记是商家替客户填：字段用商家的口吻，不借访客表单的「怎么称呼你」。 */
    manualName: string;
    manualService: string;
    manualSource: string;
    manualContactRequired: string;
    manualSubmit: string;
    manualCreated: string;
    manualDeduped: string;
    linksTitle: string;
    linksHint: string;
    linksEmpty: string;
    linksDisabled: string;
    linkLabel: string;
    linkLabelPlaceholder: string;
    linkChannel: string;
    linkDestination: string;
    linkDestinationHint: string;
    linkCreate: string;
    linkCreated: string;
    linkCopy: string;
    linkCopied: string;
    linkArchive: string;
    linkArchiveConfirm: string;
    linkClicks: string;
    linkToPage: string;
    qrNote: string;
    destinationRejected: string;
    pageTitle: string;
    pageEnabled: string;
    pageDisabled: string;
    pageAddress: string;
    pageNoAddress: string;
    pageAdminOnly: string;
    pageNotEnabledHint: string;
    pageBusinessName: string;
    pageHeadline: string;
    pageIntro: string;
    pageServices: string;
    pageServicesHint: string;
    pagePhone: string;
    pageRegion: string;
    pageLocale: string;
    pageLocaleAuto: string;
    pageSave: string;
    pageSaved: string;
    saving: string;
  };
  admin: {
    pilotTitle: string;
    pilotHint: string;
    pilotEmpty: string;
    pilotColumns: {
      when: string;
      who: string;
      contact: string;
      business: string;
      source: string;
      message: string;
    };
    enableTitle: string;
    enableHint: string;
    lookupLabel: string;
    lookup: string;
    notFound: string;
    enabled: string;
    slug: string;
    slugHint: string;
    allowedHosts: string;
    allowedHostsHint: string;
    save: string;
    saved: string;
    slugTaken: string;
    slugReserved: string;
    slugInvalid: string;
    slugRequired: string;
    hostsInvalid: string;
    activeTitle: string;
    activeEmpty: string;
  };
  statuses: Record<LeadStatusKey, string>;
  sources: Record<LeadSourceKey, string>;
  channels: Record<TrackedLinkChannel, string>;
  selfReported: Record<SelfReportedSource, string>;
  preferredTimes: Record<PreferredTime, string>;
  spend: Record<MonthlyLeadSpend, string>;
}

const ZH: GrowthCopy = {
  landing: {
    metaTitle: "Aivora · 30 天试点",
    metaDescription: "给上门服务的小商家：每周内容由我们出，询盘页与追踪链接把每一条询盘记在账上。先试 30 天。",
    home: "Aivora 首页",
    signIn: "登录",
    titleLines: ["先试 30 天：", "内容我们来做，", "询盘你来数。"],
    subtitle:
      "给上门服务的小商家——窗帘、装修、清洁、园艺。每周的短视频和图文由我们出，另配一张询盘页和按渠道区分的追踪链接：每条询盘从哪来、跟进到哪一步，都记在你的工作台里。",
    apply: "申请 30 天试点",
    samples: "模板库样片",
    sampleTag: "样例",
    sampleFallbackName: "模板样片",
    sampleNote: "模板库真机样片，不是客户数据",
    structureTitle: "试点怎么走",
    structureHint: "30 天 · 每一步都看得见",
    steps: [
      {
        when: "第 0 周",
        title: "开通",
        body: "整理品牌包，开通你的询盘页，按渠道建好追踪链接：IG 主页、Google 商家主页、Facebook、二维码。",
      },
      {
        when: "第 1–4 周",
        title: "每周内容",
        body: "按你的服务和地区排好一周的短视频与图文，你确认之后再发。",
      },
      {
        when: "全程",
        title: "询盘登记",
        body: "表单来的询盘自动入账，电话来的你手工记一笔；每一条都有来源和跟进状态。",
      },
      {
        when: "第 30 天",
        title: "一起复盘",
        body: "对着追踪到的点击和询盘，决定继续、调整还是停。",
      },
    ],
    rulesTitle: "规则写在前面",
    rules: [
      { title: "失败与取消不计数", body: "生成失败、被质检拦下或你取消的内容，都不算进交付。" },
      {
        title: "价格与结果承诺单独约定",
        body: "试点费用和结果承诺的具体数字，按你的生意在申请后一对一约定，这里不写。",
      },
      { title: "只看追踪到的数字", body: "我们不替你估算效果：读数只来自询盘页、追踪链接和你手工登记的询盘。" },
      { title: "随时可停", body: "不想继续就停；已交付的内容和询盘记录照样保留。" },
    ],
    applyTitle: "申请试点",
    applyLead: "留下至少一种联系方式。我们会用它和你约时间，先了解你的生意，再定试点安排。",
    applyNext: ["我们用你留下的方式联系你", "约一次通话，了解你的服务、地区和现在的获客方式", "约定试点内容、费用与结果口径后再开通"],
    privacy: "隐私政策",
    terms: "服务条款",
  },
  pilotForm: {
    label: "试点申请表",
    name: "你的称呼",
    company: "店名 / 公司",
    industry: "做什么生意",
    industryPlaceholder: "例如：窗帘安装、厨房翻新",
    city: "所在城市",
    contactGroup: "联系方式（至少填一项）",
    email: "邮箱",
    phone: "电话",
    whatsapp: "WhatsApp",
    wechat: "微信",
    website: "网站或主页（选填）",
    spend: "现在每月在获客上大概花多少（广告、平台费）",
    spendPlaceholder: "请选择（选填）",
    message: "想先聊什么（选填）",
    consent: "我同意 Aivora 用我留下的联系方式联系我，商量试点事宜；这些信息不会用于其他用途。",
    submit: "提交申请",
    submitting: "提交中…",
    successTitle: "收到了",
    successBody: "我们会用你留下的联系方式和你约时间。",
    contactRequired: "请至少留一种联系方式：邮箱、电话、WhatsApp 或微信。",
    consentRequired: "请先勾选同意，我们才能联系你。",
    invalid: "有一项填得不太对，请检查后再提交。",
    rateLimited: "提交太频繁了，请过一会儿再试。",
    rateLimitedContact: "也可以直接写信到 {email}。",
    genericError: "没提交成功，请再试一次。",
    honeypot: "请勿填写此项",
  },
  leadPage: {
    metaTitle: "预约与询价",
    defaultHeadline: "预约上门量尺 · 询价",
    defaultIntro: "留下电话和想做的项目，我们会尽快联系你确认时间。",
    fallbackBusiness: "我们",
    callUs: "直接致电",
    services: "服务项目",
    region: "服务地区",
    poweredBy: "询盘页由 Aivora 提供",
    privacy: "隐私说明",
    switchLocale: "English",
  },
  leadForm: {
    label: "预约表单",
    name: "怎么称呼你",
    phone: "电话",
    email: "邮箱（选填）",
    service: "想做的项目",
    serviceOther: "其他",
    servicePlaceholder: "例如：客厅电动卷帘",
    preferredTime: "方便的时间（选填）",
    source: "您从哪里看到我们（选填）",
    message: "补充说明（选填）",
    choose: "请选择",
    consent: "我同意 {business} 用我留下的电话或邮箱联系我，处理这次预约。信息由 Aivora 代为保存，只用于这次询盘。",
    submit: "提交预约",
    submitting: "提交中…",
    successTitle: "已收到",
    successBody: "{business} 会尽快联系你确认时间。",
    phoneInvalid: "请填写有效的电话号码。",
    consentRequired: "请先勾选同意，商家才能联系你。",
    invalid: "有一项填得不太对，请检查后再提交。",
    rateLimited: "提交太频繁了，请过一会儿再试。",
    genericError: "没提交成功，请再试一次。",
    callFallback: "着急的话可以直接致电 {phone}。",
    honeypot: "请勿填写此项",
  },
  leads: {
    title: "询盘",
    subtitle: "每条询盘从哪来、跟进到哪一步。读数只来自询盘页、追踪链接和你手工登记的询盘，不做估算。",
    statsLabel: "询盘读数",
    inquiries7: "询盘 · 7 天",
    inquiriesCaption: "30 天 {n} 条",
    clicks7: "点击 · 7 天",
    clicksCaption: "30 天 {n} 次 · 不含预览爬虫",
    topSource: "来源第一 · 30 天",
    topSourceCaption: "{n} 条 · 占 {pct}%",
    topSourceEmpty: "30 天内还没有询盘",
    scope: "按提交时间滚动统计 · 同一访客 30 分钟内的点击只算一次 · 归档的询盘不计入",
    openPage: "打开询盘页",
    listTitle: "询盘列表",
    listHint: "最近 200 条 · 状态改动会记下时间",
    listEmpty: "还没有询盘。询盘页开通后，表单提交会自动出现在这里；电话来的可以在下面手工登记。",
    columns: {
      when: "时间",
      who: "联系人",
      service: "项目",
      source: "来源",
      status: "状态",
      actions: "操作",
    },
    selfReported: "自报：{source}",
    verified: "已核实",
    markVerified: "核实为真实询盘",
    unmarkVerified: "取消核实",
    archive: "归档",
    archiveConfirm: "归档后这条询盘不再计入读数（记录保留）。确定归档？",
    moveTo: "改为",
    conflict: "这条询盘刚被改过，已刷新，请再操作一次。",
    actionFailed: "没改成功，请再试一次。",
    manualTitle: "手工登记",
    manualHint: "电话、到店或熟人介绍来的询盘",
    manualName: "客户称呼",
    manualService: "客户想做的项目",
    manualSource: "客户从哪里知道你（选填）",
    manualContactRequired: "请至少填电话或邮箱，方便跟进。",
    manualSubmit: "登记",
    manualCreated: "已登记。",
    manualDeduped: "7 天内已有同一联系方式的询盘，已合并到那一条。",
    linksTitle: "追踪链接",
    linksHint: "每个渠道一条：放在 IG 主页、Google 商家主页、Facebook，或印成二维码。",
    linksEmpty: "还没有追踪链接。",
    linksDisabled: "询盘页开通后才能建追踪链接。",
    linkLabel: "名称",
    linkLabelPlaceholder: "例如：IG 主页链接",
    linkChannel: "渠道",
    linkDestination: "跳转到（选填）",
    linkDestinationHint: "留空则跳到你的询盘页；外部网址只能用 Aivora 登记过的 https 域名。",
    linkCreate: "新建链接",
    linkCreated: "已建好。",
    linkCopy: "复制",
    linkCopied: "已复制",
    linkArchive: "停用",
    linkArchiveConfirm: "停用后这条链接会打不开（点击记录保留）。确定停用？",
    linkClicks: "点击",
    linkToPage: "询盘页",
    qrNote: "二维码：把链接交给印刷厂或用手机生成二维码即可。",
    destinationRejected: "这个网址不能用：只允许 Aivora 登记过的 https 商家域名。",
    pageTitle: "询盘页",
    pageEnabled: "已开通",
    pageDisabled: "未开通",
    pageAddress: "地址",
    pageNoAddress: "还没有地址",
    pageAdminOnly: "地址与开通状态由 Aivora 管理员设置。",
    pageNotEnabledHint: "询盘页由 Aivora 为试点商家开通；需要的话，联系你的 Aivora 对接人。",
    pageBusinessName: "店名",
    pageHeadline: "页面标题",
    pageIntro: "介绍",
    pageServices: "服务项目",
    pageServicesHint: "每行一项，最多 12 项",
    pagePhone: "联系电话（表单出错时给访客的备用电话）",
    pageRegion: "服务地区",
    pageLocale: "页面默认语言",
    pageLocaleAuto: "跟随访客",
    pageSave: "保存",
    pageSaved: "已保存。",
    saving: "保存中…",
  },
  admin: {
    pilotTitle: "试点申请",
    pilotHint: "仅管理员可见 · 只读 · 最近 100 条",
    pilotEmpty: "还没有试点申请。",
    pilotColumns: {
      when: "时间",
      who: "申请人",
      contact: "联系方式",
      business: "生意",
      source: "来源",
      message: "留言",
    },
    enableTitle: "开通询盘页",
    enableHint: "仅管理员 · 开通后 /l/地址 与追踪链接才生效",
    lookupLabel: "账号邮箱",
    lookup: "查找",
    notFound: "没找到这个账号。",
    enabled: "开通询盘页",
    slug: "地址",
    slugHint: "2–64 位小写字母、数字或连字符，例如 sunny-shutter",
    allowedHosts: "允许跳转的商家域名",
    allowedHostsHint: "每行一个，只填域名（例如 www.example.com），仅 https 生效",
    save: "保存",
    saved: "已保存。",
    slugTaken: "这个地址已被占用。",
    slugReserved: "这个地址是保留词，换一个。",
    slugInvalid: "地址格式不对：2–64 位小写字母、数字或连字符，不能以连字符开头或结尾。",
    slugRequired: "开通前要先设地址。",
    hostsInvalid: "有域名格式不对：只填域名，不带 https:// 和路径。",
    activeTitle: "已设地址的工作台",
    activeEmpty: "还没有开通询盘页的商家。",
  },
  statuses: {
    NEW: "新询盘",
    CONTACTED: "已联系",
    BOOKED: "已预约",
    WON: "已成交",
    LOST: "未成交",
  },
  sources: {
    lead_page: "询盘页",
    tracked_link: "追踪链接",
    booth: "展位",
    manual: "手工登记",
  },
  channels: {
    ig_bio: "IG 主页",
    google_business: "Google 商家主页",
    facebook: "Facebook",
    qr: "二维码",
    other: "其他渠道",
  },
  selfReported: {
    instagram: "Instagram",
    facebook: "Facebook",
    google: "Google 搜索 / 地图",
    tiktok: "TikTok",
    xiaohongshu: "小红书",
    wechat: "微信",
    referral: "朋友介绍",
    other: "其他",
  },
  preferredTimes: {
    weekday_daytime: "工作日白天",
    weekday_evening: "工作日晚上",
    weekend: "周末",
    anytime: "都可以",
  },
  spend: {
    none: "还没投",
    under_300: "300 加元以下",
    "300_1000": "300–1,000 加元",
    over_1000: "1,000 加元以上",
    unsure: "不方便说",
  },
};

const EN: GrowthCopy = {
  landing: {
    metaTitle: "Aivora · 30-day pilot",
    metaDescription:
      "For local service businesses: we produce your weekly content, and an inquiry page plus tracked links log every inquiry. Try it for 30 days.",
    home: "Aivora home",
    signIn: "Sign in",
    titleLines: ["Try it for 30 days:", "we make the content,", "you count the inquiries."],
    subtitle:
      "For local service businesses — blinds, renovation, cleaning, landscaping. We produce your weekly short videos and posts, plus an inquiry page and per-channel tracked links: every inquiry, where it came from and how far it got, is logged in your dashboard.",
    apply: "Apply for the 30-day pilot",
    samples: "Template samples",
    sampleTag: "Sample",
    sampleFallbackName: "Template sample",
    sampleNote: "Real renders from our template library — not customer data",
    structureTitle: "How the pilot runs",
    structureHint: "30 days · every step visible",
    steps: [
      {
        when: "Week 0",
        title: "Set up",
        body: "We assemble your brand kit, open your inquiry page and create a tracked link per channel: Instagram bio, Google Business Profile, Facebook, QR code.",
      },
      {
        when: "Weeks 1–4",
        title: "Weekly content",
        body: "A week of short videos and posts planned around your services and area; nothing goes out until you approve it.",
      },
      {
        when: "Throughout",
        title: "Inquiry log",
        body: "Form inquiries are logged automatically; log phone calls with one entry. Every inquiry carries its source and follow-up status.",
      },
      {
        when: "Day 30",
        title: "Review together",
        body: "Look at the tracked clicks and inquiries, then decide to continue, adjust or stop.",
      },
    ],
    rulesTitle: "Ground rules, up front",
    rules: [
      {
        title: "Failures and cancellations don't count",
        body: "Anything that fails to generate, is stopped by our quality check, or that you cancel is never counted as delivered.",
      },
      {
        title: "Pricing and guarantees are agreed per pilot",
        body: "Pilot fees and the numbers behind any results guarantee are agreed one-to-one after you apply, based on your business — not listed here.",
      },
      {
        title: "Only tracked numbers count",
        body: "We don't estimate results for you: readings come only from your inquiry page, tracked links and the inquiries you log.",
      },
      { title: "Stop any time", body: "Stop whenever you like; delivered content and your inquiry log stay on record." },
    ],
    applyTitle: "Apply for a pilot",
    applyLead: "Leave at least one way to reach you. We'll use it to book a time, learn about your business, then plan the pilot.",
    applyNext: [
      "We reach out using the contact you leave",
      "A short call about your services, area and how you get customers today",
      "We agree scope, fees and how results are measured before anything starts",
    ],
    privacy: "Privacy",
    terms: "Terms",
  },
  pilotForm: {
    label: "Pilot application",
    name: "Your name",
    company: "Business name",
    industry: "What your business does",
    industryPlaceholder: "e.g. blinds installation, kitchen renovation",
    city: "City",
    contactGroup: "How to reach you (at least one)",
    email: "Email",
    phone: "Phone",
    whatsapp: "WhatsApp",
    wechat: "WeChat",
    website: "Website or profile (optional)",
    spend: "Roughly what you spend on getting customers each month (ads, platform fees)",
    spendPlaceholder: "Choose (optional)",
    message: "Anything you'd like to discuss first (optional)",
    consent: "I agree that Aivora may contact me using the details above to discuss a pilot. They won't be used for anything else.",
    submit: "Submit application",
    submitting: "Submitting…",
    successTitle: "Got it",
    successBody: "We'll reach out using the contact you left to book a time.",
    contactRequired: "Please leave at least one contact: email, phone, WhatsApp or WeChat.",
    consentRequired: "Please tick the consent box so we can contact you.",
    invalid: "Something doesn't look right — please check the form and try again.",
    rateLimited: "Too many submissions — please try again in a little while.",
    rateLimitedContact: "You can also email {email}.",
    genericError: "That didn't go through. Please try again.",
    honeypot: "Leave this field empty",
  },
  leadPage: {
    metaTitle: "Book & get a quote",
    defaultHeadline: "Book an in-home measure · Get a quote",
    defaultIntro: "Leave your number and what you need — we'll call to confirm a time.",
    fallbackBusiness: "our team",
    callUs: "Call us",
    services: "Services",
    region: "Service area",
    poweredBy: "Inquiry page by Aivora",
    privacy: "Privacy",
    switchLocale: "中文",
  },
  leadForm: {
    label: "Booking form",
    name: "Your name",
    phone: "Phone",
    email: "Email (optional)",
    service: "What you need",
    serviceOther: "Something else",
    servicePlaceholder: "e.g. motorized living-room blinds",
    preferredTime: "Best time to reach you (optional)",
    source: "Where did you hear about us? (optional)",
    message: "Anything else (optional)",
    choose: "Choose",
    consent:
      "I agree that {business} may contact me by the phone or email above about this booking. Aivora stores this information on their behalf, only for this inquiry.",
    submit: "Request booking",
    submitting: "Sending…",
    successTitle: "Request received",
    successBody: "{business} will be in touch shortly to confirm a time.",
    phoneInvalid: "Please enter a valid phone number.",
    consentRequired: "Please tick the consent box so the business can contact you.",
    invalid: "Something doesn't look right — please check the form and try again.",
    rateLimited: "Too many submissions — please try again in a little while.",
    genericError: "That didn't go through. Please try again.",
    callFallback: "In a hurry? Call {phone}.",
    honeypot: "Leave this field empty",
  },
  leads: {
    title: "Inquiries",
    subtitle:
      "Where every inquiry came from and how far it got. Readings come only from your inquiry page, tracked links and inquiries you log — nothing is estimated.",
    statsLabel: "Inquiry readings",
    inquiries7: "Inquiries · 7 days",
    inquiriesCaption: "{n} in 30 days",
    clicks7: "Clicks · 7 days",
    clicksCaption: "{n} in 30 days · link previews excluded",
    topSource: "Top source · 30 days",
    topSourceCaption: "{n} inquiries · {pct}%",
    topSourceEmpty: "No inquiries in 30 days",
    scope: "Rolling windows by submission time · repeat clicks from one visitor within 30 min count once · archived inquiries excluded",
    openPage: "Open inquiry page",
    listTitle: "Inquiry log",
    listHint: "Latest 200 · status changes are time-stamped",
    listEmpty: "No inquiries yet. Once your inquiry page is live, form submissions land here automatically; log phone inquiries below.",
    columns: {
      when: "Time",
      who: "Contact",
      service: "Request",
      source: "Source",
      status: "Status",
      actions: "Actions",
    },
    selfReported: "Said: {source}",
    verified: "Verified",
    markVerified: "Mark as verified",
    unmarkVerified: "Unverify",
    archive: "Archive",
    archiveConfirm: "Archived inquiries no longer count in readings (the record is kept). Archive it?",
    moveTo: "Move to",
    conflict: "This inquiry just changed — refreshed. Please try again.",
    actionFailed: "That didn't save. Please try again.",
    manualTitle: "Log an inquiry",
    manualHint: "Phone calls, walk-ins and referrals",
    manualName: "Customer name",
    manualService: "What the customer needs",
    manualSource: "How the customer found you (optional)",
    manualContactRequired: "Add a phone number or email so you can follow up.",
    manualSubmit: "Log it",
    manualCreated: "Logged.",
    manualDeduped: "An inquiry with the same contact arrived in the last 7 days — merged into it.",
    linksTitle: "Tracked links",
    linksHint: "One per channel: your Instagram bio, Google Business Profile, Facebook, or printed as a QR code.",
    linksEmpty: "No tracked links yet.",
    linksDisabled: "Tracked links become available once your inquiry page is live.",
    linkLabel: "Name",
    linkLabelPlaceholder: "e.g. Instagram bio link",
    linkChannel: "Channel",
    linkDestination: "Send visitors to (optional)",
    linkDestinationHint: "Leave empty to use your inquiry page; external URLs must be on an https domain registered by Aivora.",
    linkCreate: "Create link",
    linkCreated: "Created.",
    linkCopy: "Copy",
    linkCopied: "Copied",
    linkArchive: "Disable",
    linkArchiveConfirm: "A disabled link stops working (click history is kept). Disable it?",
    linkClicks: "Clicks",
    linkToPage: "Inquiry page",
    qrNote: "QR code: hand the link to your printer or turn it into a QR code on your phone.",
    destinationRejected: "That URL isn't allowed: only https domains registered by Aivora.",
    pageTitle: "Inquiry page",
    pageEnabled: "Live",
    pageDisabled: "Not live",
    pageAddress: "Address",
    pageNoAddress: "No address yet",
    pageAdminOnly: "The address and live status are set by an Aivora admin.",
    pageNotEnabledHint: "Inquiry pages are switched on by Aivora for pilot businesses — ask your Aivora contact.",
    pageBusinessName: "Business name",
    pageHeadline: "Page title",
    pageIntro: "Introduction",
    pageServices: "Services",
    pageServicesHint: "One per line, up to 12",
    pagePhone: "Phone (shown to visitors if the form fails)",
    pageRegion: "Service area",
    pageLocale: "Default page language",
    pageLocaleAuto: "Follow the visitor",
    pageSave: "Save",
    pageSaved: "Saved.",
    saving: "Saving…",
  },
  admin: {
    pilotTitle: "Pilot applications",
    pilotHint: "Admins only · read-only · latest 100",
    pilotEmpty: "No pilot applications yet.",
    pilotColumns: {
      when: "Time",
      who: "Applicant",
      contact: "Contact",
      business: "Business",
      source: "Source",
      message: "Message",
    },
    enableTitle: "Switch on an inquiry page",
    enableHint: "Admins only · /l/address and tracked links only work once switched on",
    lookupLabel: "Account email",
    lookup: "Look up",
    notFound: "No account with that email.",
    enabled: "Inquiry page live",
    slug: "Address",
    slugHint: "2–64 lowercase letters, digits or hyphens, e.g. sunny-shutter",
    allowedHosts: "Allowed merchant domains",
    allowedHostsHint: "One per line, domain only (e.g. www.example.com); https only",
    save: "Save",
    saved: "Saved.",
    slugTaken: "That address is taken.",
    slugReserved: "That address is reserved — pick another.",
    slugInvalid: "Invalid address: 2–64 lowercase letters, digits or hyphens, not starting or ending with a hyphen.",
    slugRequired: "Set an address before switching the page on.",
    hostsInvalid: "A domain is invalid: enter the domain only, without https:// or a path.",
    activeTitle: "Accounts with an address",
    activeEmpty: "No inquiry pages switched on yet.",
  },
  statuses: {
    NEW: "New",
    CONTACTED: "Contacted",
    BOOKED: "Booked",
    WON: "Won",
    LOST: "Lost",
  },
  sources: {
    lead_page: "Inquiry page",
    tracked_link: "Tracked link",
    booth: "Booth",
    manual: "Logged by hand",
  },
  channels: {
    ig_bio: "Instagram bio",
    google_business: "Google Business",
    facebook: "Facebook",
    qr: "QR code",
    other: "Other channel",
  },
  selfReported: {
    instagram: "Instagram",
    facebook: "Facebook",
    google: "Google Search / Maps",
    tiktok: "TikTok",
    xiaohongshu: "Xiaohongshu",
    wechat: "WeChat",
    referral: "Friend or referral",
    other: "Other",
  },
  preferredTimes: {
    weekday_daytime: "Weekday daytime",
    weekday_evening: "Weekday evening",
    weekend: "Weekend",
    anytime: "Any time",
  },
  spend: {
    none: "Nothing yet",
    under_300: "Under CA$300",
    "300_1000": "CA$300–1,000",
    over_1000: "Over CA$1,000",
    unsure: "Prefer not to say",
  },
};

const COPY: Record<Locale, GrowthCopy> = { "zh-CN": ZH, "en-US": EN };

export function getGrowthCopy(locale: Locale): GrowthCopy {
  return COPY[locale] ?? ZH;
}

/** 简单占位替换：{key} → value。 */
export function fillGrowth(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

/** 已知 key 走翻译，未知值（旧数据、自由文本）原样显示。 */
export function labelFor<T extends string>(table: Record<T, string>, value: string | null | undefined): string | null {
  if (!value) return null;
  return Object.prototype.hasOwnProperty.call(table, value) ? table[value as T] : value;
}

/** 试点申请同意文本（落库进 consentJson.text）。 */
export function pilotConsentText(locale: Locale): string {
  return getGrowthCopy(locale).pilotForm.consent;
}

/** 询盘页同意文本（带商家名）。 */
export function leadConsentText(locale: Locale, business: string): string {
  return fillGrowth(getGrowthCopy(locale).leadForm.consent, { business });
}
