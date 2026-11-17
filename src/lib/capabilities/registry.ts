/**
 * C4 · 能力注册表：一份表回答「哪些 AI 能力现在在工作、哪些暂停、暂停时系统改用什么」。
 *
 * 背景（1025 真机验收）：OpenAI 账户 429「no credits」时，写作静默退回模板、
 * Logo 失败——客户一个都看不见。现在每个能力一条状态，
 * 由每小时探测 + 生产调用实时回写（capability-status-service / capability-probe-service）维护，
 * 界面只从这里取词与判定。
 *
 * 纯数据 + 纯函数，不引任何服务端模块：'use client' 组件与服务端页面都能安全 import
 * （client-bundle-safety 与 capability-registry 测试守着这一点）。
 *
 * 能力键说明：
 *  - image    = 故事板出图（Shuyu 图像线路）
 *  - graphics = Logo 生成（OpenAI 图像模型，经 getAiProvider().generateImages）——
 *               与 image 分开，是因为两者走不同供应商，一个能用不代表另一个能用。
 *
 * 2026-11-16 收尾：产品图工作台、图文帖配图、周计划随页面一起删了，这里的名字与文案只写还在做的事
 * （image 只剩故事板，graphics 只剩 Logo，text 只剩脚本与口播稿）；键名不变，CapabilityStatus 表里的旧行照用。
 */

export const CAPABILITY_KEYS = [
  "text",
  "vision",
  "image",
  "graphics",
  "video",
  "email",
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/**
 * 线路精简（2026-11-09）：对外只留 Shuyu（出图 / 出片）与只做出方案的 OpenAI
 * （当时还留着的 Runway 出片备选 2026-11-16 也下线了，代码已删）。
 *
 * 2026-11-16 第 2 批瘦身：配音（voice）、实拍图库（stock）、链接抓取（scrape）、抠图（cutout）四条线路的
 * 代码整段删除，四个键也不再是能力键——CapabilityStatus 表里它们的旧行照旧留着，读的时候
 * 被 isCapabilityKey 过滤掉（rowToCapabilityRecord 返回 null），不进任何页面，也不再有探测去写。
 *
 * 2026-11-17 第 4 批瘦身：内容审核（moderation）一直关着，代码、开关与这个键一并删了；旧行同样被 isCapabilityKey 过滤。
 * 原先为它留的「已下线但还登记着」这一档（RETIRED_CAPABILITY_KEYS）也就没有成员了，概念一起拿掉：
 * 现在登记在册的能力键都是真在用的，状态页全列，状态翻转都发运维告警。
 */

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
 * 不写供应商名（客户文案门禁）；2026-11-17 起按用户要求写明实际用的模型（出片 Seedance 2.5、出图 GPT Image 2）。恢复后自动启用的一律写明。
 */
export const CAPABILITY_COPY: Record<CapabilityKey, CapabilityCopy> = {
  text: {
    label: b("AI 写作", "AI writing"),
    messages: {
      available: b(
        "AI 写作正常：镜头脚本由 AI 导演撰写。",
        "AI writing is on: shot scripts are written by the AI director.",
      ),
      degraded: b(
        "AI 写作不稳定：可能变慢；单次失败会先用模板顶上，不会卡住。",
        "AI writing is unstable: it may be slow, and a failed call falls back to a template instead of blocking you.",
      ),
      unavailable: b(
        "AI 写作暂停：脚本与口播稿先用模板生成，恢复后自动启用。",
        "AI writing is paused: scripts and narration drafts use templates for now and switch back automatically once it recovers.",
      ),
      not_configured: b(
        "AI 写作尚未开通：脚本与口播稿使用模板生成。",
        "AI writing isn't set up yet: scripts and narration drafts use templates.",
      ),
    },
  },
  vision: {
    label: b("AI 看图", "AI vision"),
    messages: {
      /// 只写现在真在用的事。成片画面质检 2026-11-16 整套删除，
      /// 看图这项能力现在用在出方案时看商品图：把商品的样子写进提示词与镜头卡。
      available: b(
        "AI 看图正常：写镜头脚本时会看你的商品图，把商品的样子写进每个镜头。",
        "AI vision is on: your product photos are looked at while the shot script is written, so every shot describes the product as it really looks.",
      ),
      degraded: b(
        "AI 看图不稳定：个别时候看不成商品图，商品按你的文字描述来；成片照常生成。",
        "AI vision is unstable: sometimes your product photos can't be looked at and the product follows your written description; videos still render.",
      ),
      unavailable: b(
        "AI 看图暂停：出方案时不看商品图，商品按你的文字描述来；成片照常生成，恢复后自动启用。",
        "AI vision is paused: planning doesn't look at your product photos and the product follows your written description. Videos still render, and it resumes once it recovers.",
      ),
      not_configured: b(
        "AI 看图未开通：出方案时不看商品图，成片照常生成。",
        "AI vision isn't set up: planning doesn't look at your product photos; videos still render.",
      ),
    },
  },
  image: {
    label: b("开场画面出图（GPT Image 2）", "Opening frame (GPT Image 2)"),
    messages: {
      available: b("开场画面出图正常。", "Storyboard images are rendering normally."),
      degraded: b(
        "开场画面出图不稳定：可能变慢或个别失败，失败的那一帧可以单独重出。",
        "Storyboard images are unstable: they may be slow or occasionally fail, and a failed frame can be redone on its own.",
      ),
      unavailable: b(
        "开场画面出图暂停：已出的帧都保留，恢复后自动启用。",
        "Storyboard images are paused: frames already made are kept, and rendering resumes once it recovers.",
      ),
      not_configured: b("开场画面出图未开通。", "Storyboard images aren't set up."),
    },
  },
  graphics: {
    label: b("Logo", "Logos"),
    messages: {
      available: b("Logo 生成正常：Logo 由 AI 出图。", "Logo generation is on: logos are drawn by AI."),
      degraded: b(
        "Logo 生成不稳定：可能变慢；已出的 Logo 都保留。",
        "Logo generation is unstable: it may be slow; finished logos are kept.",
      ),
      unavailable: b(
        "Logo 生成暂停：可以先在品牌页上传现有 Logo；已出的 Logo 都保留，恢复后自动启用。故事板与视频不受影响。",
        "Logo generation is paused: upload an existing logo on the Brands page for now. Finished logos are kept, and it resumes once it recovers. Storyboards and videos are unaffected.",
      ),
      not_configured: b(
        "Logo 生成未开通：可以在品牌页上传现有 Logo。",
        "Logo generation isn't set up: upload an existing logo on the Brands page.",
      ),
    },
  },
  video: {
    label: b("视频生成（Seedance 2.5）", "Video generation (Seedance 2.5)"),
    messages: {
      available: b("视频生成正常。", "Video generation is running normally."),
      /// 不承诺「已切换备用线路」：生产没有可切的备用套餐，只有自动重试。
      degraded: b(
        "视频生成线路有波动：正在自动重试，生成可能稍慢；已完成的成片不受影响。",
        "The video line is fluctuating: we're retrying automatically, so generation may be slower. Finished videos are unaffected.",
      ),
      unavailable: b(
        "视频生成暂停：暂时无法提交新视频；已完成的成片不受影响，恢复后自动启用。",
        "Video generation is paused: new videos can't be submitted right now. Finished videos are unaffected, and it resumes once it recovers.",
      ),
      not_configured: b("视频生成未开通。", "Video generation isn't set up."),
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
  "narrationDraft",
  "scriptWriting",
  "logo",
  "storyboardFrames",
  "videoGeneration",
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
 * 功能 → 能力依赖。Logo 走 OpenAI 图像模型（graphics）；故事板走 Shuyu 图像线路（image）。
 * 周计划撰写、图文配图、产品图三项随页面一起删了（2026-11-16），状态页「影响哪些功能」不再列它们。
 */
export const FEATURES: Record<FeatureKey, FeatureSpec> = {
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
  logo: {
    needs: ["graphics"],
    label: b("Logo 生成", "Logo generation"),
    whenBlocked: b(
      "暂时不能生成 Logo，可以先在品牌页上传现有 Logo。",
      "Logos can't be generated right now; upload an existing logo on the Brands page instead.",
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
  const detail = { ...(observation.detail ?? {}) };
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
 */
const OPENAI_ACCOUNT_DEPENDENTS: ReadonlySet<CapabilityKey> = new Set(["vision", "graphics"]);
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

/** 中文接在拉丁字母后面时补一个空格（「Logo 暂不可用」），接在汉字后面不补。 */
function zhAppend(head: string, tail: string): string {
  return /[A-Za-z0-9]$/.test(head) ? `${head} ${tail}` : `${head}${tail}`;
}

/**
 * 被挡住的原因。英文写成「状态：名单」，不拼主谓一致（标签有单有复：Storyboard images / AI vision）。
 * zh：AI 写作、AI 看图暂不可用；邮件通知尚未开通
 * en：unavailable: AI writing, AI vision; not set up: Email alerts
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
