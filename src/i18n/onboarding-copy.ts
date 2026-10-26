import type { Locale } from "./config";
import type { BusinessIndustry } from "@/lib/onboarding/industries";

/**
 * 自助注册（补充字段）与上手向导 /app/welcome 的文案（1025 整合轮 C1）。纯数据：客户端组件可直接引用。
 * 不写价格、不写效果主张；试用额度的数字以服务端真实计量为准，这里只描述规则。
 */

/// 注册时同意的条款版本：改服务条款或隐私政策正文时同步改这里，注册记录里存的是这个值。
export const TERMS_VERSION = "terms-2026-10-25";

export type RegisterErrorCode =
  | "INVALID_EMAIL"
  | "WEAK_PASSWORD"
  | "BUSINESS_REQUIRED"
  | "INDUSTRY_REQUIRED"
  | "TERMS_REQUIRED"
  | "EMAIL_TAKEN"
  | "RATE_LIMITED"
  | "INVALID_INPUT";

type StepCopy = { title: string; body: string };

interface OnboardingCopy {
  register: {
    lead: string;
    businessName: string;
    businessNamePlaceholder: string;
    industry: string;
    industryPlaceholder: string;
    city: string;
    cityPlaceholder: string;
    termsBefore: string;
    termsLink: string;
    termsJoin: string;
    privacyLink: string;
    termsAfter: string;
    trialNote: string;
    errors: Record<RegisterErrorCode, string>;
  };
  industries: Record<BusinessIndustry, string>;
  welcome: {
    title: string;
    subtitle: string;
    readingsLabel: string;
    readingSteps: string;
    readingQuota: string;
    readingQuotaCaption: string;
    readingBrand: string;
    readingBrandNone: string;
    readingLeadPage: string;
    leadPageOff: string;
    leadPageRequested: string;
    leadPageLive: string;
    scope: string;
    skip: string;
    finish: string;
    finishing: string;
    edit: string;
    stepLabel: string;
    saved: string;
    failed: string;
    business: StepCopy & {
      businessName: string;
      website: string;
      websitePlaceholder: string;
      oneLiner: string;
      oneLinerPlaceholder: string;
      save: string;
      summary: string;
    };
    brand: StepCopy & {
      logo: string;
      logoHint: string;
      uploading: string;
      replaceLogo: string;
      brandName: string;
      contact: string;
      contactPlaceholder: string;
      cta: string;
      ctaDefaults: Record<BusinessIndustry, string>;
      preview: string;
      previewNote: string;
      save: string;
      logoRequired: string;
      ready: string;
      manage: string;
    };
    video: StepCopy & {
      quota: string;
      sampleTag: string;
      useTemplate: string;
      openCreate: string;
      noTemplates: string;
      started: string;
      done: string;
      library: string;
    };
    leadPage: StepCopy & {
      preview: string;
      previewNote: string;
      call: string;
      services: string;
      region: string;
      draftFromProfile: string;
      request: string;
      requesting: string;
      requested: string;
      live: string;
      manage: string;
      defaultHeadline: string;
      defaultServices: Record<BusinessIndustry, string[]>;
    };
  };
}

const ZH: OnboardingCopy = {
  register: {
    lead: "免费试做 3 条：建好工作区，下一步带你走完上手。",
    businessName: "店名 / 公司名",
    businessNamePlaceholder: "例如：SunnyShutter 窗饰",
    industry: "做什么生意",
    industryPlaceholder: "请选择",
    city: "所在城市（选填）",
    cityPlaceholder: "例如：温哥华",
    termsBefore: "我已阅读并同意",
    termsLink: "服务条款",
    termsJoin: "与",
    privacyLink: "隐私政策",
    termsAfter: "。",
    trialNote: "试用版：每月 3 条视频额度，不用绑卡；失败与取消返还额度。",
    errors: {
      INVALID_EMAIL: "请输入有效的邮箱。",
      WEAK_PASSWORD: "密码至少 8 位。",
      BUSINESS_REQUIRED: "请填写店名。",
      INDUSTRY_REQUIRED: "请选择你做什么生意。",
      TERMS_REQUIRED: "请先勾选同意服务条款与隐私政策。",
      EMAIL_TAKEN: "这个邮箱已经注册过了，请直接登录。",
      RATE_LIMITED: "注册太频繁了，请过一会儿再试。",
      INVALID_INPUT: "有一项填得不太对，请检查后再提交。",
    },
  },
  industries: {
    window_coverings: "窗帘 / 窗饰",
    renovation: "装修 / 翻新",
    cleaning: "清洁",
    landscaping: "园艺 / 景观",
    handyman: "水电 / 维修",
    moving: "搬家",
    other: "其他上门服务",
  },
  welcome: {
    title: "上手",
    subtitle: "四步把你的生意、品牌、第一条视频和询盘页接起来。每一步都能先跳过，之后在对应页面接着做。",
    readingsLabel: "上手进度",
    readingSteps: "已完成",
    readingQuota: "本月视频额度",
    readingQuotaCaption: "提交时预占，失败与取消返还",
    readingBrand: "品牌包",
    readingBrandNone: "还没有",
    readingLeadPage: "询盘页",
    leadPageOff: "未开通",
    leadPageRequested: "已申请",
    leadPageLive: "已开通",
    scope: "数据口径：本工作区实时读取；每一步做没做完，按档案、品牌包、成片和询盘页的真实状态判断",
    skip: "先跳过，去创作",
    finish: "完成上手，去创作",
    finishing: "正在进入创作…",
    edit: "修改",
    stepLabel: "第 {n} 步",
    saved: "已保存",
    failed: "没保存成功，请稍后再试。",
    business: {
      title: "你的生意",
      body: "店名、行业和城市会用在推荐模板、视频结尾的联系卡和询盘页上。",
      businessName: "店名 / 公司名",
      website: "网站或主页（选填）",
      websitePlaceholder: "例如：sunnyshutter.ca",
      oneLiner: "一句话介绍（选填）",
      oneLinerPlaceholder: "例如：本地定制电动卷帘与百叶窗，免费上门量尺",
      save: "保存，下一步",
      summary: "{industry} · {city}",
    },
    brand: {
      title: "品牌",
      body: "上传 Logo、留一个联系方式：成片结尾的联系卡用它，所有视频保持同一个样子。",
      logo: "Logo",
      logoHint: "PNG / JPG，透明底最好",
      uploading: "上传中…",
      replaceLogo: "换一张",
      brandName: "品牌名",
      contact: "联系电话或微信",
      contactPlaceholder: "例如：604-555-0123",
      cta: "结尾一句话",
      ctaDefaults: {
        window_coverings: "免费上门量尺",
        renovation: "免费上门报价",
        cleaning: "预约上门清洁",
        landscaping: "免费上门评估",
        handyman: "预约上门维修",
        moving: "免费估价",
        other: "欢迎来电咨询",
      },
      preview: "结尾联系卡预览",
      previewNote: "示意：实际尾卡按视频画幅渲染",
      save: "保存品牌包",
      logoRequired: "请先上传 Logo。",
      ready: "品牌包「{name}」已就绪",
      manage: "去品牌页编辑",
    },
    video: {
      title: "第一条视频",
      body: "选一个有真机样片的风格，上传你的作品照片；先出 AI 故事板逐帧确认，再生成竖版成片，不满意随时取消。",
      quota: "本月视频额度 {used} / {limit}",
      sampleTag: "样例",
      useTemplate: "用这个风格",
      openCreate: "直接去创作",
      noTemplates: "模板库暂时取不到推荐，可以直接去创作页从头开始。",
      started: "已经在生成第一条视频",
      done: "第一条成片已就绪",
      library: "去成品库看看",
    },
    leadPage: {
      title: "询盘页",
      body: "客人留电话的那一页：每条询盘都记下来源。先看预览，满意就申请开通，我们给你分配地址并联系你。",
      preview: "询盘页预览",
      previewNote: "示意：开通后访客看到的就是这些内容",
      call: "电话",
      services: "服务",
      region: "服务地区",
      draftFromProfile: "用我的资料生成",
      request: "申请开通",
      requesting: "提交中…",
      requested: "已申请 · 我们开通后会联系你",
      live: "已开通",
      manage: "去询盘页设置",
      defaultHeadline: "{business} · 预约上门",
      defaultServices: {
        window_coverings: ["电动卷帘", "百叶窗", "斑马帘", "窗帘定制"],
        renovation: ["厨房翻新", "卫浴翻新", "地板", "全屋装修"],
        cleaning: ["日常保洁", "深度清洁", "搬家清洁"],
        landscaping: ["庭院设计", "草坪养护", "围栏与步道"],
        handyman: ["水电维修", "灯具安装", "家具组装"],
        moving: ["同城搬家", "长途搬家", "打包服务"],
        other: ["上门服务"],
      },
    },
  },
};

const EN: OnboardingCopy = {
  register: {
    lead: "Make 3 videos free: set up your workspace, then we walk you through the first steps.",
    businessName: "Business name",
    businessNamePlaceholder: "e.g. SunnyShutter Window Coverings",
    industry: "What do you do?",
    industryPlaceholder: "Choose one",
    city: "City (optional)",
    cityPlaceholder: "e.g. Vancouver",
    termsBefore: "I have read and agree to the ",
    termsLink: "Terms",
    termsJoin: " and the ",
    privacyLink: "Privacy Policy",
    termsAfter: ".",
    trialNote: "Trial: 3 videos a month, no card needed; failures and cancellations refund quota.",
    errors: {
      INVALID_EMAIL: "Enter a valid email.",
      WEAK_PASSWORD: "Use at least 8 characters for the password.",
      BUSINESS_REQUIRED: "Enter your business name.",
      INDUSTRY_REQUIRED: "Choose what your business does.",
      TERMS_REQUIRED: "Please agree to the Terms and Privacy Policy first.",
      EMAIL_TAKEN: "This email is already registered. Please sign in.",
      RATE_LIMITED: "Too many sign-ups just now. Please try again shortly.",
      INVALID_INPUT: "Something doesn't look right. Check the form and try again.",
    },
  },
  industries: {
    window_coverings: "Blinds & window coverings",
    renovation: "Renovation",
    cleaning: "Cleaning",
    landscaping: "Landscaping",
    handyman: "Handyman & repairs",
    moving: "Moving",
    other: "Other home services",
  },
  welcome: {
    title: "Get started",
    subtitle: "Four steps connect your business, brand, first video and inquiry page. Skip any step and pick it up later on its own page.",
    readingsLabel: "Setup progress",
    readingSteps: "Done",
    readingQuota: "Videos this month",
    readingQuotaCaption: "Reserved on submit; failures and cancellations refund",
    readingBrand: "Brand kit",
    readingBrandNone: "None yet",
    readingLeadPage: "Inquiry page",
    leadPageOff: "Off",
    leadPageRequested: "Requested",
    leadPageLive: "Live",
    scope: "Live from this workspace; each step counts as done from the real profile, brand kits, videos and inquiry page state",
    skip: "Skip for now, go create",
    finish: "Finish setup, go create",
    finishing: "Opening the studio…",
    edit: "Edit",
    stepLabel: "Step {n}",
    saved: "Saved",
    failed: "Couldn't save. Please try again.",
    business: {
      title: "Your business",
      body: "Your name, trade and city shape the recommended templates, the contact card at the end of each video and your inquiry page.",
      businessName: "Business name",
      website: "Website or profile (optional)",
      websitePlaceholder: "e.g. sunnyshutter.ca",
      oneLiner: "One-line description (optional)",
      oneLinerPlaceholder: "e.g. Custom motorized shades and blinds, free in-home measure",
      save: "Save and continue",
      summary: "{industry} · {city}",
    },
    brand: {
      title: "Brand",
      body: "Upload a logo and leave one way to reach you: the contact card at the end of every video uses it, so all your videos look the same.",
      logo: "Logo",
      logoHint: "PNG or JPG, transparent background works best",
      uploading: "Uploading…",
      replaceLogo: "Replace",
      brandName: "Brand name",
      contact: "Phone or messaging handle",
      contactPlaceholder: "e.g. 604-555-0123",
      cta: "Closing line",
      ctaDefaults: {
        window_coverings: "Free in-home measure",
        renovation: "Free in-home quote",
        cleaning: "Book a cleaning",
        landscaping: "Free on-site assessment",
        handyman: "Book a repair",
        moving: "Free moving estimate",
        other: "Call us today",
      },
      preview: "Closing card preview",
      previewNote: "Illustration: the real card is rendered at the video's aspect ratio",
      save: "Save brand kit",
      logoRequired: "Upload a logo first.",
      ready: "Brand kit “{name}” is ready",
      manage: "Edit on the Brand page",
    },
    video: {
      title: "First video",
      body: "Pick a style with a verified sample render and upload photos of your work; approve an AI storyboard frame by frame, then render the vertical video. Cancel any time.",
      quota: "Videos this month {used} / {limit}",
      sampleTag: "Sample",
      useTemplate: "Use this style",
      openCreate: "Go to the studio",
      noTemplates: "Recommendations aren't available right now — start from scratch in the studio.",
      started: "Your first video is generating",
      done: "Your first video is ready",
      library: "Open the library",
    },
    leadPage: {
      title: "Inquiry page",
      body: "The page where customers leave their number, with every inquiry's source logged. Preview it, then ask us to switch it on — we assign the address and get in touch.",
      preview: "Inquiry page preview",
      previewNote: "Illustration: once live, visitors see this content",
      call: "Call",
      services: "Services",
      region: "Service area",
      draftFromProfile: "Fill from my profile",
      request: "Request activation",
      requesting: "Sending…",
      requested: "Requested · we'll get in touch once it's live",
      live: "Live",
      manage: "Inquiry page settings",
      defaultHeadline: "{business} · Book an in-home visit",
      defaultServices: {
        window_coverings: ["Motorized shades", "Blinds", "Zebra blinds", "Custom drapery"],
        renovation: ["Kitchen remodels", "Bathroom remodels", "Flooring", "Whole-home renovation"],
        cleaning: ["Regular cleaning", "Deep cleaning", "Move-out cleaning"],
        landscaping: ["Garden design", "Lawn care", "Fences and paths"],
        handyman: ["Plumbing and electrical", "Fixture installation", "Furniture assembly"],
        moving: ["Local moves", "Long-distance moves", "Packing"],
        other: ["In-home services"],
      },
    },
  },
};

export function getOnboardingCopy(locale: Locale): OnboardingCopy {
  return locale === "en-US" ? EN : ZH;
}
