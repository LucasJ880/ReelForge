/**
 * C4 · 能力注册表：一份表回答「哪些 AI 能力现在在工作、哪些暂停、暂停时系统改用什么」。
 *
 * 背景（1025 真机验收）：OpenAI 账户 429「no credits」时，写作静默退回模板、实拍线路提交后才 503、
 * TTS 403、画面质检被跳过、Logo 失败——客户一个都看不见。现在每个能力一条状态，
 * 由每小时探测 + 生产调用实时回写（capability-status-service / capability-probe-service）维护，
 * 界面只从这里取词与判定。
 *
 * 纯数据 + 纯函数，不引任何服务端模块：'use client' 组件与服务端页面都能安全 import
 * （client-bundle-safety 与 capability-registry 测试守着这一点）。
 *
 * 能力键说明：
 *  - image    = 产品图与故事板出图（Shuyu 图像线路）
 *  - graphics = 图文帖配图与 Logo（OpenAI 图像模型，经 getAiProvider().generateImages）——
 *               与 image 分开，是因为两者走不同供应商，一个能用不代表另一个能用。
 */

export const CAPABILITY_KEYS = [
  "text",
  "vision",
  "image",
  "graphics",
  "video",
  "voice",
  "moderation",
  "stock",
  "scrape",
  "cutout",
  "email",
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export const CAPABILITY_STATUSES = ["available", "degraded", "unavailable", "not_configured"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

/** 粗粒度原因：只用来挑文案与给运维定位，不含任何供应商原始报错。 */
export const CAPABILITY_REASONS = [
  "ok",
  "unchecked",
  "quota",
  "auth",
  "permission",
  "rate_limited",
  "upstream",
  "contract_drift",
  "not_configured",
  "unknown",
] as const;
export type CapabilityReason = (typeof CAPABILITY_REASONS)[number];

/** 这条状态从哪来：定时探测 / 生产调用回写 / 由其它能力推断 / 只看配置。 */
export type CapabilitySource = "probe" | "runtime" | "derived" | "config";

export type Bilingual = { "zh-CN": string; "en-US": string };
type Lang = keyof Bilingual;

/** 只给运维看的细节：不进客户视图，也不许放 key、请求体或完整报错。 */
export type CapabilityDetail = {
  provider?: string;
  httpStatus?: number;
  model?: string;
  /** ≤160 字的脱敏说明 */
  note?: string;
  /** voice：最近一次真正发出 TTS 探测的时刻（每 24 小时最多一次） */
  ttsProbedAt?: string;
  /** Shuyu 余额（积分） */
  balancePoints?: number;
};

/** 一条能力的持久状态（CapabilityStatus 表一行的领域形状）。 */
export type CapabilityRecord = {
  key: CapabilityKey;
  status: CapabilityStatus;
  reason: CapabilityReason;
  source: CapabilitySource;
  checkedAt: string;
  failingSince: string | null;
  detail?: CapabilityDetail;
};

/** 一次观测（探测或生产调用）的结论。 */
export type CapabilityObservation = {
  status: CapabilityStatus;
  reason: CapabilityReason;
  detail?: CapabilityDetail;
};

export function isCapabilityKey(value: unknown): value is CapabilityKey {
  return typeof value === "string" && (CAPABILITY_KEYS as readonly string[]).includes(value);
}

export function isCapabilityStatus(value: unknown): value is CapabilityStatus {
  return typeof value === "string" && (CAPABILITY_STATUSES as readonly string[]).includes(value);
}

export function isCapabilityReason(value: unknown): value is CapabilityReason {
  return typeof value === "string" && (CAPABILITY_REASONS as readonly string[]).includes(value);
}

/** 「出问题了」：不稳定与暂停算，未开通不算（那是配置，不是故障）。 */
export function isFailingStatus(status: CapabilityStatus): boolean {
  return status === "degraded" || status === "unavailable";
}

/** 挡住功能的状态：暂停与未开通。 */
export function isBlockingStatus(status: CapabilityStatus): boolean {
  return status === "unavailable" || status === "not_configured";
}

/* ── 文案 ───────────────────────────────────────────────────────────── */

type CapabilityCopy = {
  label: Bilingual;
  messages: Record<CapabilityStatus, Bilingual>;
};

function b(zh: string, en: string): Bilingual {
  return { "zh-CN": zh, "en-US": en };
}

/**
 * 每个能力 × 每种状态一句人话：说清楚还有什么能用、系统改用什么。
 * 不写供应商名、不写模型名（客户文案门禁），恢复后自动启用的一律写明。
 */
export const CAPABILITY_COPY: Record<CapabilityKey, CapabilityCopy> = {
  text: {
    label: b("AI 写作", "AI writing"),
    messages: {
      available: b(
        "AI 写作正常：脚本、周计划与实拍线路拆段由 AI 撰写。",
        "AI writing is on: scripts, weekly plans and stock-route segments are written by AI.",
      ),
      degraded: b(
        "AI 写作不稳定：可能变慢；单次失败会先用模板顶上，不会卡住。",
        "AI writing is unstable: it may be slow, and a failed call falls back to a template instead of blocking you.",
      ),
      unavailable: b(
        "AI 写作暂停：脚本与周计划先用模板生成，恢复后自动启用。",
        "AI writing is paused: scripts and weekly plans use templates for now and switch back automatically once it recovers.",
      ),
      not_configured: b(
        "AI 写作尚未开通：脚本与周计划使用模板生成。",
        "AI writing isn't set up yet: scripts and weekly plans use templates.",
      ),
    },
  },
  vision: {
    label: b("AI 看图", "AI vision"),
    messages: {
      available: b(
        "AI 看图正常：成片会自动检查画面里的错字与水印。",
        "AI vision is on: finished clips are checked automatically for burned-in text and watermarks.",
      ),
      degraded: b(
        "AI 看图不稳定：个别成片可能跳过画面质检，成片照常生成。",
        "AI vision is unstable: some clips may skip frame checks; videos still render.",
      ),
      unavailable: b(
        "画面质检暂停：成片照常生成，但暂不自动检查错字与水印；恢复后自动启用。",
        "Frame checks are paused: videos still render, but burned-in text and watermarks aren't checked automatically. They resume once it recovers.",
      ),
      not_configured: b(
        "画面质检未开通：成片照常生成，不做自动画面检查。",
        "Frame checks aren't set up: videos render without automatic frame checks.",
      ),
    },
  },
  image: {
    label: b("产品图与故事板", "Product images & storyboards"),
    messages: {
      available: b("产品图与故事板出图正常。", "Product images and storyboards are rendering normally."),
      degraded: b(
        "产品图与故事板不稳定：可能变慢或个别失败，失败的那一张可以单独重出。",
        "Product images and storyboards are unstable: they may be slow or occasionally fail, and a failed image can be redone on its own.",
      ),
      unavailable: b(
        "产品图与故事板暂停：已出的图都保留，恢复后自动启用。",
        "Product images and storyboards are paused: images already made are kept, and rendering resumes once it recovers.",
      ),
      not_configured: b("产品图与故事板未开通。", "Product images and storyboards aren't set up."),
    },
  },
  graphics: {
    label: b("配图与 Logo", "Post images & logos"),
    messages: {
      available: b(
        "配图与 Logo 正常：图文帖配图与 Logo 由 AI 出图。",
        "Post images and logos are on: image posts and logos are drawn by AI.",
      ),
      degraded: b(
        "配图与 Logo 不稳定：可能变慢；已出的图都保留。",
        "Post images and logos are unstable: they may be slow; finished images are kept.",
      ),
      unavailable: b(
        "配图与 Logo 暂停：周计划文案照常排好，图文帖先不出图；已出的图都保留，恢复后再点「生成配图」即可。产品图不受影响。",
        "Post images and logos are paused: weekly copy is still planned, but image posts won't render yet. Finished images are kept; tap Generate images again once it recovers. Product images are unaffected.",
      ),
      not_configured: b(
        "配图与 Logo 未开通：图文帖只排文案。",
        "Post images and logos aren't set up: image posts include copy only.",
      ),
    },
  },
  video: {
    label: b("视频生成", "Video generation"),
    messages: {
      available: b("视频生成正常。", "Video generation is running normally."),
      degraded: b(
        "视频生成线路有波动：已自动切换备用线路，生成可能稍慢。",
        "The video line is fluctuating: we switched to a backup line automatically, so generation may be slower.",
      ),
      unavailable: b(
        "视频生成暂停：暂时无法提交新视频；已完成的成片不受影响，恢复后自动启用。",
        "Video generation is paused: new videos can't be submitted right now. Finished videos are unaffected, and it resumes once it recovers.",
      ),
      not_configured: b("视频生成未开通。", "Video generation isn't set up."),
    },
  },
  voice: {
    label: b("AI 配音", "AI voiceover"),
    messages: {
      available: b(
        "AI 配音正常：实拍图库线路可以自动配音。",
        "AI voiceover is on: the stock footage route can voice your script.",
      ),
      degraded: b(
        "AI 配音不稳定：实拍线路提交可能变慢。",
        "AI voiceover is unstable: stock-route submissions may be slow.",
      ),
      unavailable: b(
        "AI 配音暂停：实拍图库线路暂不可用；主线视频的原生口播不受影响，恢复后自动启用。",
        "AI voiceover is paused: the stock footage route is unavailable, while native voiceover in main-flow videos is unaffected. It resumes once it recovers.",
      ),
      not_configured: b(
        "AI 配音未开通：实拍图库线路不可用；主线视频的原生口播不受影响。",
        "AI voiceover isn't set up: the stock footage route is unavailable; native voiceover in main-flow videos is unaffected.",
      ),
    },
  },
  moderation: {
    label: b("内容审核", "Content review"),
    messages: {
      available: b("内容审核正常。", "Content review is on."),
      degraded: b("内容审核不稳定：上传可能稍慢。", "Content review is unstable: uploads may be slower."),
      unavailable: b(
        "内容审核暂停：上传可能暂时无法通过安全检查，请稍后再试。",
        "Content review is paused: uploads may not pass the safety check right now. Try again later.",
      ),
      not_configured: b("内容审核未开通。", "Content review isn't set up."),
    },
  },
  stock: {
    label: b("图库素材", "Stock footage"),
    messages: {
      available: b("图库素材正常。", "Stock footage is available."),
      degraded: b("图库素材不稳定：选片可能变慢。", "Stock footage is unstable: clip search may be slow."),
      unavailable: b(
        "图库素材暂停：实拍图库线路暂不可用，主线视频不受影响。",
        "Stock footage is paused: the stock route is unavailable; main-flow videos are unaffected.",
      ),
      not_configured: b(
        "图库素材未开通：实拍图库线路不可用。",
        "Stock footage isn't set up: the stock route is unavailable.",
      ),
    },
  },
  scrape: {
    label: b("链接抓取", "Link import"),
    messages: {
      available: b(
        "链接抓取正常：粘贴商品链接可自动读取商品信息。",
        "Link import is on: paste a product link to pull in its details.",
      ),
      degraded: b(
        "链接抓取不稳定：个别网站可能读不全，可以手动补充。",
        "Link import is unstable: some sites may not load fully, and you can fill in the rest yourself.",
      ),
      unavailable: b(
        "链接抓取受限：常规商品页照常读取，复杂网站暂时读不到，请手动填写。",
        "Link import is limited: regular product pages still load, but complex sites can't be read right now. Fill in the details manually.",
      ),
      not_configured: b(
        "链接抓取受限：只读取常规商品页，复杂网站请手动填写。",
        "Link import is limited: only regular product pages load; fill in complex sites manually.",
      ),
    },
  },
  cutout: {
    label: b("产品抠图", "Product cutout"),
    messages: {
      available: b("产品抠图正常。", "Product cutout is on."),
      degraded: b("产品抠图不稳定：可能变慢。", "Product cutout is unstable: it may be slow."),
      unavailable: b(
        "产品抠图暂停：暂时不能从照片里抠出产品做锚点，已上传的照片都保留。",
        "Product cutout is paused: products can't be cut out of photos for anchoring right now. Uploaded photos are kept.",
      ),
      not_configured: b(
        "产品抠图未开通：暂不能从照片里抠出产品做锚点。",
        "Product cutout isn't set up: products can't be cut out of photos for anchoring yet.",
      ),
    },
  },
  email: {
    label: b("邮件通知", "Email alerts"),
    messages: {
      available: b("邮件通知正常：新询盘会发邮件提醒。", "Email alerts are on: new leads trigger an email."),
      degraded: b(
        "邮件通知不稳定：个别提醒可能延迟，站内角标照常更新。",
        "Email alerts are unstable: some may be delayed; in-app badges still update.",
      ),
      unavailable: b(
        "邮件通知暂停：新询盘不发邮件，站内角标照常提醒。",
        "Email alerts are paused: new leads won't trigger emails, but in-app badges still notify you.",
      ),
      not_configured: b(
        "邮件通知未开通：新询盘只在站内角标提醒。",
        "Email alerts aren't set up: new leads show as in-app badges only.",
      ),
    },
  },
};

export function capabilityLabel(key: CapabilityKey, locale: Lang): string {
  return CAPABILITY_COPY[key].label[locale];
}

export function capabilityMessage(key: CapabilityKey, status: CapabilityStatus, locale: Lang): string {
  return CAPABILITY_COPY[key].messages[status][locale];
}

/* ── 功能依赖 ───────────────────────────────────────────────────────── */

export const FEATURE_KEYS = [
  "broll",
  "contentPlanWriting",
  "narrationDraft",
  "scriptWriting",
  "imagePosts",
  "logo",
  "productImages",
  "storyboardFrames",
  "videoGeneration",
  "frameQa",
  "uploadReview",
  "linkImport",
  "productCutout",
  "leadEmail",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

type FeatureSpec = {
  /** 这个功能要哪些能力全部可用才能跑 */
  needs: readonly CapabilityKey[];
  label: Bilingual;
  /** 被挡住时系统改用什么 / 你可以先做什么 */
  whenBlocked: Bilingual;
};

/**
 * 功能 → 能力依赖。Logo 走 OpenAI 图像模型（graphics）；产品图、故事板与图文配图走 Shuyu 图像线路（image）——
 * 图文配图 C2 起默认 Shuyu 异步出图（CONTENT_POST_IMAGE_PROVIDER=openai 才回到 graphics，属回滚，不在这里分支）。
 */
export const FEATURES: Record<FeatureKey, FeatureSpec> = {
  broll: {
    needs: ["text", "voice", "stock"],
    label: b("实拍图库线路", "Stock footage route"),
    whenBlocked: b(
      "可以先用上方主线生成视频，恢复后这里自动开放。",
      "Use the main flow above for now; this route reopens automatically once it recovers.",
    ),
  },
  contentPlanWriting: {
    needs: ["text"],
    label: b("周计划撰写", "Weekly plan writing"),
    whenBlocked: b(
      "周计划先按模板排好，恢复后重新排一周即可换成 AI 撰写。",
      "Weekly plans use a template for now; plan a new week after it recovers to get AI-written posts.",
    ),
  },
  narrationDraft: {
    needs: ["text"],
    label: b("口播稿起草", "Voiceover drafting"),
    whenBlocked: b(
      "口播稿按模板起稿，请按你的产品改一改再生成。",
      "This draft comes from a template, so tailor it to your product before generating.",
    ),
  },
  scriptWriting: {
    needs: ["text"],
    label: b("脚本与镜头规划", "Script and shot planning"),
    whenBlocked: b(
      "脚本与镜头先按模板规划，成片照常生成。",
      "Scripts and shots are planned from templates for now; videos still render.",
    ),
  },
  imagePosts: {
    needs: ["image"],
    label: b("图文配图", "Post images"),
    whenBlocked: b(
      "文案照常排好，图文帖先不出图；已出的图都保留，恢复后再点「生成配图」。",
      "Copy is still planned, but image posts won't render yet. Finished images are kept; tap Generate images again after it recovers.",
    ),
  },
  logo: {
    needs: ["graphics"],
    label: b("Logo 生成", "Logo generation"),
    whenBlocked: b(
      "暂时不能生成 Logo，可以先在品牌页上传现有 Logo。",
      "Logos can't be generated right now; upload an existing logo on the Brands page instead.",
    ),
  },
  productImages: {
    needs: ["image"],
    label: b("产品图", "Product images"),
    whenBlocked: b(
      "已出的图都保留，恢复后可以继续出图。",
      "Images already made are kept, and you can continue once it recovers.",
    ),
  },
  storyboardFrames: {
    needs: ["image"],
    label: b("故事板", "Storyboards"),
    whenBlocked: b(
      "故事板暂时出不了图；已出的帧都保留，恢复后可以单帧重出。",
      "Storyboard frames can't render right now. Finished frames are kept and can be redone one by one after it recovers.",
    ),
  },
  videoGeneration: {
    needs: ["video"],
    label: b("视频生成", "Video generation"),
    whenBlocked: b(
      "暂时无法提交新视频；已完成的成片不受影响。",
      "New videos can't be submitted right now; finished videos are unaffected.",
    ),
  },
  frameQa: {
    needs: ["vision"],
    label: b("画面质检", "Frame checks"),
    whenBlocked: b(
      "成片照常生成，但暂不自动检查画面里的错字与水印。",
      "Videos still render, but burned-in text and watermarks aren't checked automatically.",
    ),
  },
  uploadReview: {
    needs: ["moderation"],
    label: b("上传审核", "Upload review"),
    whenBlocked: b(
      "上传可能暂时无法通过安全检查，请稍后再试。",
      "Uploads may not pass the safety check right now. Try again later.",
    ),
  },
  linkImport: {
    needs: ["scrape"],
    label: b("链接起片", "Start from a link"),
    whenBlocked: b(
      "常规商品页照常读取；复杂网站读不到时请手动填写。",
      "Regular product pages still load; fill in the details manually when a site can't be read.",
    ),
  },
  productCutout: {
    needs: ["cutout"],
    label: b("产品抠图", "Product cutout"),
    whenBlocked: b(
      "暂时不能从照片里抠出产品做锚点；照片都保留。",
      "Products can't be cut out of photos for anchoring right now; your photos are kept.",
    ),
  },
  leadEmail: {
    needs: ["email"],
    label: b("询盘邮件提醒", "Lead email alerts"),
    whenBlocked: b(
      "新询盘不发邮件，站内角标照常提醒。",
      "New leads won't trigger emails; in-app badges still notify you.",
    ),
  },
};

/** 依赖这个能力的功能（状态页「影响」一栏）。 */
export function featuresForCapability(key: CapabilityKey): FeatureKey[] {
  return FEATURE_KEYS.filter((feature) => FEATURES[feature].needs.includes(key));
}

/* ── 状态推进 ───────────────────────────────────────────────────────── */

/** 跨观测保留的细节字段：TTS 探测时刻不能被一次生产回写抹掉，否则 24 小时节流失效。 */
const STICKY_DETAIL_KEYS = ["ttsProbedAt"] as const;

/**
 * 由上一条状态 + 一次观测算出下一条状态。
 * failingSince：从「正常」进入「不稳定 / 暂停」时记下当刻；一直失败就保留最早那刻；恢复或未开通即清空。
 */
export function nextCapabilityRecord(
  prev: CapabilityRecord | null | undefined,
  key: CapabilityKey,
  observation: CapabilityObservation,
  now: Date,
  source: CapabilitySource,
): CapabilityRecord {
  const failing = isFailingStatus(observation.status);
  const failingSince = failing
    ? prev && isFailingStatus(prev.status) && prev.failingSince
      ? prev.failingSince
      : now.toISOString()
    : null;
  const sticky: CapabilityDetail = {};
  for (const field of STICKY_DETAIL_KEYS) {
    const value = prev?.detail?.[field];
    if (value !== undefined) sticky[field] = value;
  }
  const detail = { ...sticky, ...(observation.detail ?? {}) };
  return {
    key,
    status: observation.status,
    reason: observation.reason,
    source,
    checkedAt: now.toISOString(),
    failingSince,
    ...(Object.keys(detail).length > 0 ? { detail } : {}),
  };
}

/* ── 客户视图 ───────────────────────────────────────────────────────── */

export type PublicCapability = {
  key: CapabilityKey;
  status: CapabilityStatus;
  reason: CapabilityReason;
  /** 最近一次检测（探测或生产调用）；从没检测过为 null */
  checkedAt: string | null;
  /** 从什么时候开始不稳定 / 暂停 */
  failingSince: string | null;
  label: Bilingual;
  message: Bilingual;
  features: FeatureKey[];
};

export type PublicCapabilities = {
  generatedAt: string;
  items: PublicCapability[];
  counts: Record<CapabilityStatus, number>;
  /** 至少一项暂停：壳层状态栏亮出「部分 AI 能力暂停」 */
  paused: boolean;
  /** 没有暂停、但至少一项不稳定 */
  unstable: boolean;
  /** 所有能力里最近的一次检测时刻 */
  lastCheckedAt: string | null;
};

/**
 * 这些能力走同一个 OpenAI 计费账户：账户没额度 / key 失效时它们一起停，
 * 哪怕各自的上一次观测还是「正常」（账户的观测更新时以账户为准）。
 * 内容审核端点免费，不受额度影响，不在此列。
 */
const OPENAI_ACCOUNT_DEPENDENTS: ReadonlySet<CapabilityKey> = new Set(["vision", "graphics", "voice"]);
const ACCOUNT_LEVEL_REASONS: ReadonlySet<CapabilityReason> = new Set(["quota", "auth"]);

function laterOrEqual(a: string, b: string): boolean {
  return Date.parse(a) >= Date.parse(b);
}

type Resolved = Pick<PublicCapability, "status" | "reason" | "checkedAt" | "failingSince">;

function resolveOne(
  key: CapabilityKey,
  byKey: ReadonlyMap<CapabilityKey, CapabilityRecord>,
  configured: Readonly<Record<CapabilityKey, boolean>>,
): Resolved {
  const record = byKey.get(key);
  if (!configured[key]) {
    return { status: "not_configured", reason: "not_configured", checkedAt: record?.checkedAt ?? null, failingSince: null };
  }
  if (OPENAI_ACCOUNT_DEPENDENTS.has(key) && configured.text) {
    const account = byKey.get("text");
    if (
      account &&
      account.status === "unavailable" &&
      ACCOUNT_LEVEL_REASONS.has(account.reason) &&
      (!record || laterOrEqual(account.checkedAt, record.checkedAt))
    ) {
      return {
        status: "unavailable",
        reason: account.reason,
        checkedAt: account.checkedAt,
        failingSince: account.failingSince,
      };
    }
  }
  if (record) {
    return {
      status: record.status,
      reason: record.reason,
      checkedAt: record.checkedAt,
      failingSince: isFailingStatus(record.status) ? record.failingSince : null,
    };
  }
  /// 配置齐了但从没检测过（新部署、或状态表还没建）：不拦客户，标「未检测」。
  return { status: "available", reason: "unchecked", checkedAt: null, failingSince: null };
}

/**
 * 持久状态 + 配置 → 客户视图。配置以运行时环境为准：key 被撤掉，哪怕上次探测「正常」也显示未开通。
 */
export function resolveCapabilities(input: {
  records: ReadonlyArray<CapabilityRecord>;
  configured: Readonly<Record<CapabilityKey, boolean>>;
  now: Date;
}): PublicCapabilities {
  const byKey = new Map<CapabilityKey, CapabilityRecord>();
  for (const record of input.records) {
    if (isCapabilityKey(record.key)) byKey.set(record.key, record);
  }
  const counts: Record<CapabilityStatus, number> = {
    available: 0,
    degraded: 0,
    unavailable: 0,
    not_configured: 0,
  };
  let lastCheckedAt: string | null = null;
  const items = CAPABILITY_KEYS.map((key): PublicCapability => {
    const resolved = resolveOne(key, byKey, input.configured);
    counts[resolved.status] += 1;
    if (resolved.checkedAt && (!lastCheckedAt || laterOrEqual(resolved.checkedAt, lastCheckedAt))) {
      lastCheckedAt = resolved.checkedAt;
    }
    return {
      key,
      ...resolved,
      label: CAPABILITY_COPY[key].label,
      message: CAPABILITY_COPY[key].messages[resolved.status],
      features: featuresForCapability(key),
    };
  });
  return {
    generatedAt: input.now.toISOString(),
    items,
    counts,
    paused: counts.unavailable > 0,
    unstable: counts.unavailable === 0 && counts.degraded > 0,
    lastCheckedAt,
  };
}

export function findCapability(
  capabilities: PublicCapabilities | null | undefined,
  key: CapabilityKey,
): PublicCapability | null {
  return capabilities?.items.find((item) => item.key === key) ?? null;
}

/* ── 功能闸门 ───────────────────────────────────────────────────────── */

export type FeatureGate = {
  feature: FeatureKey;
  /** blocked = 有依赖暂停或未开通；degraded = 依赖不稳定但能跑 */
  status: "available" | "degraded" | "blocked";
  blockedBy: CapabilityKey[];
  degradedBy: CapabilityKey[];
  /** 被挡住 / 不稳定时给客户的一句话；正常时为 null */
  message: Bilingual | null;
};

/** 中文接在拉丁字母后面时补一个空格（「配图与 Logo 暂不可用」），接在汉字后面不补。 */
function zhAppend(head: string, tail: string): string {
  return /[A-Za-z0-9]$/.test(head) ? `${head} ${tail}` : `${head}${tail}`;
}

/**
 * 被挡住的原因。英文写成「状态：名单」，不拼主谓一致（标签有单有复：Post images / Stock footage route）。
 * zh：AI 写作、AI 配音暂不可用；图库素材尚未开通
 * en：unavailable: AI writing, AI voiceover; not set up: Stock footage
 */
function causePhrase(keys: CapabilityKey[], status: "unavailable" | "not_configured", locale: Lang): string {
  const labels = keys.map((key) => capabilityLabel(key, locale));
  if (locale === "zh-CN") return zhAppend(labels.join("、"), status === "unavailable" ? "暂不可用" : "尚未开通");
  return `${status === "unavailable" ? "unavailable" : "not set up"}: ${labels.join(", ")}`;
}

function blockedMessage(feature: FeatureKey, capabilities: PublicCapability[]): Bilingual {
  const spec = FEATURES[feature];
  const paused = capabilities.filter((item) => item.status === "unavailable").map((item) => item.key);
  const missing = capabilities.filter((item) => item.status === "not_configured").map((item) => item.key);
  const sentence = (locale: Lang): string => {
    const causes = [
      paused.length ? causePhrase(paused, "unavailable", locale) : null,
      missing.length ? causePhrase(missing, "not_configured", locale) : null,
    ].filter((part): part is string => Boolean(part));
    return locale === "zh-CN"
      ? `${zhAppend(spec.label[locale], "暂停")}：${causes.join("；")}。${spec.whenBlocked[locale]}`
      : `${spec.label[locale]} paused (${causes.join("; ")}). ${spec.whenBlocked[locale]}`;
  };
  return { "zh-CN": sentence("zh-CN"), "en-US": sentence("en-US") };
}

function degradedMessage(feature: FeatureKey, keys: CapabilityKey[]): Bilingual {
  const spec = FEATURES[feature];
  return {
    "zh-CN": `${zhAppend(spec.label["zh-CN"], "可能变慢")}：${zhAppend(keys.map((key) => capabilityLabel(key, "zh-CN")).join("、"), "不稳定")}。`,
    "en-US": `${spec.label["en-US"]} may be slow (unstable: ${keys.map((key) => capabilityLabel(key, "en-US")).join(", ")}).`,
  };
}

/**
 * 一个功能现在能不能用。没有能力视图（老页面、读失败）时一律放行——
 * 我们自己的状态表出问题，不能变成拦客户的理由。
 */
export function featureGate(capabilities: PublicCapabilities | null | undefined, feature: FeatureKey): FeatureGate {
  const needs = FEATURES[feature].needs;
  if (!capabilities) {
    return { feature, status: "available", blockedBy: [], degradedBy: [], message: null };
  }
  const items = needs
    .map((key) => findCapability(capabilities, key))
    .filter((item): item is PublicCapability => item !== null);
  const blocking = items.filter((item) => isBlockingStatus(item.status));
  const blockedBy = blocking.map((item) => item.key);
  const degradedBy = items.filter((item) => item.status === "degraded").map((item) => item.key);
  if (blockedBy.length > 0) {
    return { feature, status: "blocked", blockedBy, degradedBy, message: blockedMessage(feature, blocking) };
  }
  if (degradedBy.length > 0) {
    return { feature, status: "degraded", blockedBy, degradedBy, message: degradedMessage(feature, degradedBy) };
  }
  return { feature, status: "available", blockedBy, degradedBy, message: null };
}
