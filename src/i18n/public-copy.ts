import type { Locale } from "./config";

interface LegalSectionCopy {
  title: string;
  body: string;
}

interface PublicPageCopy {
  privacy: {
    metadata: { title: string; description: string };
    kicker: string;
    title: string;
    intro: string;
    information: LegalSectionCopy;
    purpose: LegalSectionCopy;
    processors: LegalSectionCopy;
    retention: {
      title: string;
      beforeContact: string;
      afterContact: string;
    };
    security: LegalSectionCopy;
    contactTitle: string;
    contactLead: string;
    assumptionLabel: string;
    assumption: string;
    termsLink: string;
    signInLink: string;
  };
  terms: {
    metadata: { title: string; description: string };
    kicker: string;
    title: string;
    intro: string;
    usage: LegalSectionCopy;
    inputs: LegalSectionCopy;
    output: LegalSectionCopy;
    prohibited: LegalSectionCopy;
    plans: LegalSectionCopy;
    liability: LegalSectionCopy;
    questions: string;
    privacyLink: string;
    signInLink: string;
    assumptionLabel: string;
    assumption: string;
  };
  persona: {
    metadata: { title: string; description: string };
    homeLabel: string;
    studioLabel: string;
    signIn: string;
    getStarted: string;
    eyebrow: string;
    title: string;
    description: string;
    partnerLead: string;
    showcaseLink: string;
    enterWorkspace: string;
    createStarter: string;
    browseTemplates: string;
    existingAccount: string;
    footer: string;
  };
}

export const PUBLIC_PAGE_COPY: Record<Locale, PublicPageCopy> = {
  "zh-CN": {
    privacy: {
      metadata: {
        title: "隐私政策草案 · Aivora",
        description: "Aivora 关于信息收集、使用、保存、处理方与用户权利的隐私政策工程草案。",
      },
      kicker: "草案 · 待加拿大律师复核",
      title: "隐私政策",
      intro: "适用于由加拿大安大略省团队运营的 Aivora。本草案最后更新于 2026 年 7 月 13 日。",
      information: {
        title: "我们处理的信息",
        body: "我们会处理账户与工作区资料、你上传的产品图片和视频、提示词与创意指令、生成媒体、任务与质量记录、用量和成本事件，以及保障和运营服务所需的技术日志。",
      },
      purpose: {
        title: "我们为何使用这些信息",
        body: "这些信息用于用户认证、视频生成与质量检查、批次交付与故障排查、防止滥用、套餐用量统计、客户支持及提升服务可靠性。我们不会出售客户媒体或提示词。",
      },
      processors: {
        title: "处理方与数据路径",
        body: "当前基础设施可能包括：Neon 提供北美数据库托管；Vercel 及其 IAD1 Blob 提供应用与对象存储；OpenAI 承担已配置的语言、产品图生成与编辑、视觉和内容审核任务；BytePlus 国际端点承担已配置的 Seedance 视频生成。只有在 Buddy 的处理区域与合同获得确认且该 provider 正式启用后，我们才会把它加入本节。",
      },
      retention: {
        title: "保存与删除",
        beforeContact: "我们只会为上述运营、合同、安全与审计目的保存记录。客户数据的确切保存期限仍属于上线配置决策，并将在律师复核版本中明确。你可以发送邮件至",
        afterContact: "申请访问、更正、导出或删除数据。我们会核验身份，并说明因法律或安全原因必须保留的记录。",
      },
      security: {
        title: "安全与跨境处理",
        body: "生产密钥保存在代码库之外，访问权限按角色限制，生成活动会留痕以便追溯。数据可能在加拿大、美国或其他已披露的 provider 区域内，依据合同保障措施进行处理。",
      },
      contactTitle: "联系我们",
      contactLead: "隐私问题或权利请求：",
      assumptionLabel: "假设：",
      assumption: "privacy@aivora.ai 是当前草案联系邮箱。运营负责人必须确认该邮箱有人值守，或在客户上线前配置 NEXT_PUBLIC_PRIVACY_EMAIL。",
      termsLink: "阅读服务条款",
      signInLink: "返回登录",
    },
    terms: {
      metadata: {
        title: "服务条款草案 · Aivora",
        description: "Aivora 商业试点服务条款工程草案，涵盖输入授权、AI 输出、禁止用途与服务边界。",
      },
      kicker: "草案 · 待加拿大律师复核",
      title: "服务条款",
      intro: "供商业试点审阅的工程草案。本草案最后更新于 2026 年 7 月 13 日。",
      usage: {
        title: "使用 Aivora",
        body: "你必须提供准确的账户信息、妥善保护登录凭据，并且仅将服务用于合法商业目的。发布前，你仍需负责审阅生成媒体，并完成目标分发平台要求的披露。",
      },
      inputs: {
        title: "你的输入与授权",
        body: "你保留上传材料中的权利。你授予 Aivora 及已披露处理方为处理、存储、生成、质量检查和交付所请求结果而必需的有限权限。你确认自己已取得所提交产品媒体、人物、品牌、音乐和指令所需的权利与同意。",
      },
      output: {
        title: "AI 生成结果",
        body: "图片和视频由概率系统生成，可能包含错误、产品细节变化或与其他内容相似的部分。Aivora 会应用身份保持提示、技术检查和生成约束，但不保证结果在事实、法律、平台或品牌层面必然适用。请勿移除必须保留的 AI 披露；客户发布前仍须人工审阅。",
      },
      prohibited: {
        title: "禁止用途",
        body: "不得创建违法、欺骗、侵权、侮辱、性剥削、侵犯隐私或冒充他人的内容；不得绕过安全控制、上传恶意软件、探查其他客户数据或使服务过载。为保护客户与平台，我们可以暂停生成、移除内容或暂停访问。",
      },
      plans: {
        title: "套餐、可用性与试点",
        body: "套餐限制与试点费用以适用的订单或客户协议为准。Provider 与容量可能变化；为保障安全与可靠性，我们可以排队、停止或重新路由任务。当前 B2B 试点不包含自助支付。",
      },
      liability: {
        title: "保证与责任草案",
        body: "服务适用的保证、责任限制、赔偿、管辖法律与终止条款，以最终律师复核协议为准。这些商业条款在本工程草案中有意保持未定稿状态。",
      },
      questions: "问题：",
      privacyLink: "隐私政策",
      signInLink: "返回登录",
      assumptionLabel: "假设：",
      assumption: "privacy@aivora.ai 目前仅为草案联系邮箱；运营负责人必须在客户上线前确认该邮箱有人值守。",
    },
    persona: {
      metadata: {
        title: "开始使用 · Aivora",
        description: "进入 Aivora 的统一视频创作、模板、批量生产、赛马与成品工作区。",
      },
      homeLabel: "Aivora 首页",
      studioLabel: "创意工作室",
      signIn: "登录",
      getStarted: "开始使用",
      eyebrow: "AI 视频生产",
      title: "从一支视频开始，扩展到可控的批量生产。",
      description: "创作、模板、批量、赛马与成品都在同一个工作区。新账号默认使用 starter，studio 由正式权益流程授予。",
      partnerLead: "投资人 / 孵化器 / 战略合作？",
      showcaseLink: "查看真实客户案例展示",
      enterWorkspace: "进入工作区",
      createStarter: "创建 starter 账号",
      browseTemplates: "浏览模板库",
      existingAccount: "登录已有账号",
      footer: "AI 视频增长平台",
    },
  },
  "en-US": {
    privacy: {
      metadata: {
        title: "Privacy Policy Draft · Aivora",
        description: "Aivora's engineering draft covering information collection, use, retention, processors, and customer rights.",
      },
      kicker: "DRAFT · PENDING CANADIAN LEGAL REVIEW",
      title: "Privacy Policy",
      intro: "Engineering draft for Aivora, operated from Ontario, Canada. Last updated July 13, 2026.",
      information: {
        title: "Information we handle",
        body: "We process account and workspace details, product images and videos you upload, prompts and creative instructions, generated media, job and quality records, usage and cost events, and technical logs needed to secure and operate the service.",
      },
      purpose: {
        title: "Why we use it",
        body: "We use this information to authenticate users, create and quality-check videos, deliver and troubleshoot batches, prevent abuse, measure plan usage, support customers, and improve service reliability. We do not sell customer media or prompts.",
      },
      processors: {
        title: "Processors and data routes",
        body: "Current infrastructure may include Neon for North American database hosting, Vercel and its IAD1 Blob store for application and object hosting, OpenAI for configured language, product-image generation and editing, vision, and moderation tasks, and BytePlus international endpoints for configured Seedance video generation. Buddy will be added here only after its processing location and contract are confirmed and the provider is enabled.",
      },
      retention: {
        title: "Retention and deletion",
        beforeContact: "Records are retained only for the operating, contractual, security, and audit purposes described above. Exact customer retention periods remain a launch configuration decision and will be stated in the lawyer-reviewed version. You may request access, correction, export, or deletion by emailing",
        afterContact: "We will verify identity and explain any records that must be retained for legal or security reasons.",
      },
      security: {
        title: "Security and international processing",
        body: "Production secrets are kept outside source control, access is role-limited, and generation activity is logged for traceability. Data may be processed in Canada, the United States, or another disclosed provider region under contractual safeguards.",
      },
      contactTitle: "Contact",
      contactLead: "Questions or privacy requests:",
      assumptionLabel: "ASSUMPTION:",
      assumption: "privacy@aivora.ai is the draft contact address. Human operations must confirm that this mailbox is monitored or configure NEXT_PUBLIC_PRIVACY_EMAIL before customer launch.",
      termsLink: "Read the Terms of Service",
      signInLink: "Return to sign in",
    },
    terms: {
      metadata: {
        title: "Terms of Service Draft · Aivora",
        description: "Aivora's business-pilot terms draft covering input rights, AI output, prohibited use, and service boundaries.",
      },
      kicker: "DRAFT · PENDING CANADIAN LEGAL REVIEW",
      title: "Terms of Service",
      intro: "Engineering draft for business pilot review. Last updated July 13, 2026.",
      usage: {
        title: "Using Aivora",
        body: "You must provide accurate account information, protect your credentials, and use the service only for lawful business purposes. You remain responsible for reviewing generated media before publication and for disclosures required by the destination platform.",
      },
      inputs: {
        title: "Your inputs and permissions",
        body: "You retain your rights in uploaded materials. You grant Aivora and disclosed processors the limited permission needed to process, store, generate, quality-check, and deliver your requested output. You confirm that you have the rights and consents required for all product media, people, brands, music, and instructions you submit.",
      },
      output: {
        title: "AI-generated output",
        body: "Images and videos are produced by probabilistic systems and can contain errors, altered product details, or similarities to other content. Aivora applies identity-preservation prompts, technical checks, and generation constraints, but does not guarantee factual, legal, platform, or brand suitability. Do not remove required AI disclosures. Human review remains required before customer publication.",
      },
      prohibited: {
        title: "Prohibited use",
        body: "Do not create illegal, deceptive, infringing, abusive, sexually exploitative, privacy-invasive, or impersonating content; bypass safety controls; upload malware; probe other customers' data; or overload the service. We may pause generation, remove content, or suspend access to protect customers and the platform.",
      },
      plans: {
        title: "Plans, availability, and pilots",
        body: "Plan limits and any pilot fees are defined in the applicable order form or customer agreement. Providers and capacity may change. We may queue, stop, or reroute work to preserve safety and reliability. Self-serve payment is not part of the current B2B pilot.",
      },
      liability: {
        title: "Warranty and liability draft",
        body: "The service is provided subject to the warranties, liability limits, indemnities, governing law, and termination terms in the final lawyer-reviewed agreement. Those commercial clauses are intentionally not finalized in this engineering draft.",
      },
      questions: "Questions:",
      privacyLink: "Privacy Policy",
      signInLink: "Return to sign in",
      assumptionLabel: "ASSUMPTION:",
      assumption: "privacy@aivora.ai is a draft contact only; human operations must confirm it before customer launch.",
    },
    persona: {
      metadata: {
        title: "Get Started · Aivora",
        description: "Enter Aivora's unified workspace for video creation, templates, batch production, campaign racing, and deliverables.",
      },
      homeLabel: "Aivora home",
      studioLabel: "Editorial Studio",
      signIn: "Sign in",
      getStarted: "Get started",
      eyebrow: "AI video production",
      title: "Start with one video. Scale into controlled batch production.",
      description: "Creation, templates, batch production, campaign racing, and deliverables live in one workspace. New accounts start on starter; studio access is granted through the formal entitlement flow.",
      partnerLead: "Investor, incubator, or strategic partner?",
      showcaseLink: "View the customer proof showcase",
      enterWorkspace: "Enter workspace",
      createStarter: "Create a starter account",
      browseTemplates: "Browse templates",
      existingAccount: "Sign in to your account",
      footer: "AI Video Growth Platform",
    },
  },
};

export function getPublicPageCopy(locale: Locale): PublicPageCopy {
  return PUBLIC_PAGE_COPY[locale];
}
