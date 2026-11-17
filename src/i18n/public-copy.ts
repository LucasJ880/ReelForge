import type { Locale } from "./config";

interface LegalSectionCopy {
  title: string;
  body: string;
}

interface PublicPageCopy {
  privacy: {
    metadata: { title: string; description: string };
    /** 法务状态：不是眉题，放在标题下方的状态行。 */
    /// 标题上方的版本标签（生效日期）；2026-11-17 之前这里是「草案 · 待律师复核」
    versionLabel: string;
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
    termsLink: string;
    signInLink: string;
  };
  terms: {
    metadata: { title: string; description: string };
    /** 法务状态：不是眉题，放在标题下方的状态行。 */
    /// 标题上方的版本标签（生效日期）；2026-11-17 之前这里是「草案 · 待律师复核」
    versionLabel: string;
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
  };
  persona: {
    metadata: { title: string; description: string };
    homeLabel: string;
    studioLabel: string;
    signIn: string;
    getStarted: string;
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
        title: "隐私政策 · Aivora",
        description: "Aivora 如何收集、使用、保存与处理你的信息，以及你享有的权利。",
      },
      versionLabel: "2026 年 11 月 17 日生效",
      title: "隐私政策",
      intro: "适用于由加拿大安大略省团队运营的 Aivora。最后更新于 2026 年 11 月 17 日。",
      information: {
        title: "我们处理的信息",
        body: "我们会处理账户与工作区资料、你上传的产品图片和视频、提示词与创意指令、生成媒体、任务与质量记录、用量和成本事件，以及保障和运营服务所需的技术日志。在商家询盘页或试点申请表里留下的称呼、电话、邮箱和留言，只用于处理那一次询盘或申请：商家询盘页上的信息由该商家收集，Aivora 代为保存并转交给商家。这类记录会一直保存到你申请删除为止（归档不会清除它们）。",
      },
      purpose: {
        title: "我们为何使用这些信息",
        body: "这些信息用于用户认证、视频生成与质量检查、成片交付与故障排查、防止滥用、套餐用量统计、客户支持及提升服务可靠性。我们不会出售客户媒体或提示词。",
      },
      processors: {
        title: "处理方与数据路径",
        body: "目前参与处理数据的服务商：Neon（数据库托管，北美）；Vercel（应用托管与文件存储，美国）；OpenAI（写镜头脚本与文案、看你上传的商品图，美国）；Seedance 2.5 视频模型与 GPT Image 2 图片模型（出片和出开场画面；经接口服务商 Shuyu 调用，会收到你提交的产品图、提示词与创意指令）。只在用到对应功能时参与：Resend（开通邮件通知后，发送新询盘与试点申请提醒）。经接口服务商调用视频和图片模型时，你提交的内容可能在加拿大和美国以外的地区处理；我们只发送完成这次生成所必需的内容。",
      },
      retention: {
        title: "保存与删除",
        beforeContact: "我们只为上述运营、合同、安全与审计目的保存记录。账户资料、你上传的素材、提示词和生成的成片没有自动清除的期限，会一直保存到你申请删除或关闭账户为止；技术日志由托管服务商按其周期滚动清除。你可以发送邮件至",
        afterContact: "申请访问、更正、导出或删除数据。我们会先核验身份，并在 30 天内处理完毕；因法律或安全原因必须保留的记录，会告诉你是哪些、为什么保留。",
      },
      security: {
        title: "安全与跨境处理",
        body: "生产密钥保存在代码库之外，访问权限按角色限制，生成活动会留痕以便追溯。数据可能在加拿大、美国或其他已披露的服务商所在区域内，依据合同保障措施进行处理。",
      },
      contactTitle: "联系我们",
      contactLead: "隐私问题或权利请求：",
      termsLink: "阅读服务条款",
      signInLink: "返回登录",
    },
    terms: {
      metadata: {
        title: "服务条款 · Aivora",
        description: "Aivora 商业试点服务条款，涵盖输入授权、AI 输出、禁止用途与服务边界。",
      },
      versionLabel: "2026 年 11 月 17 日生效",
      title: "服务条款",
      intro: "适用于由加拿大安大略省团队运营的 Aivora。最后更新于 2026 年 11 月 17 日。",
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
        body: "套餐限制与试点费用以适用的订单或客户协议为准。试用额度按页面上写明的条数提供，失败与取消的生成会返还额度。模型服务与容量可能变化；为保障安全与可靠性，我们可以排队或暂停任务。目前不提供自助支付。",
      },
      liability: {
        title: "保证与责任",
        body: "服务按「现状」提供：我们会尽力保持服务可用、生成结果符合你的描述，但不保证不中断、无错误，也不保证生成内容适合某一特定用途。在法律允许的范围内，Aivora 对因使用本服务产生的间接损失、利润损失不承担责任；任何情况下的赔偿总额不超过你在索赔前三个月内为本服务实际支付的费用，没有付费的，以 100 加元为限。你对自己上传的素材、发布的内容以及由此引起的第三方主张负责。任何一方都可以随时停止使用或终止账户；终止后你仍可按隐私政策申请导出或删除数据。本条款受加拿大安大略省法律管辖；你另外和我们签了书面协议的，以那份协议为准。",
      },
      questions: "问题：",
      privacyLink: "隐私政策",
      signInLink: "返回登录",
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
      title: "从一支视频开始，扩展到可控的批量生产。",
      description: "创作、模板、批量与成品都在同一个工作区。新账号从试用额度开始，正式套餐在试点协议里开通。",
      partnerLead: "投资人 / 孵化器 / 战略合作？",
      showcaseLink: "看真实交付（SunnyShutter，关联方）",
      enterWorkspace: "进入工作区",
      createStarter: "创建账号",
      browseTemplates: "浏览模板库",
      existingAccount: "登录已有账号",
      footer: "AI 视频增长平台",
    },
  },
  "en-US": {
    privacy: {
      metadata: {
        title: "Privacy Policy · Aivora",
        description: "How Aivora collects, uses, retains and processes your information, and the rights you have.",
      },
      versionLabel: "EFFECTIVE NOVEMBER 17, 2026",
      title: "Privacy Policy",
      intro: "Applies to Aivora, operated from Ontario, Canada. Last updated November 17, 2026.",
      information: {
        title: "Information we handle",
        body: "We process account and workspace details, product images and videos you upload, prompts and creative instructions, generated media, job and quality records, usage and cost events, and technical logs needed to secure and operate the service. Names, phone numbers, emails and messages left on a business's inquiry page or our pilot application form are used only to handle that inquiry or application; on a business's inquiry page, the business collects the information and Aivora stores it and passes it on to them. These records are kept until you ask us to delete them (archiving does not erase them).",
      },
      purpose: {
        title: "Why we use it",
        body: "We use this information to authenticate users, create and quality-check videos, deliver and troubleshoot finished videos, prevent abuse, measure plan usage, support customers, and improve service reliability. We do not sell customer media or prompts.",
      },
      processors: {
        title: "Processors and data routes",
        body: "Processors that handle data today: Neon (database hosting, North America); Vercel (application hosting and file storage, United States); OpenAI (writing shot scripts and copy, and viewing the product photos you upload, United States); and the Seedance 2.5 video model and GPT Image 2 image model (filming and the opening frame; called through the API provider Shuyu, which receives the product photos, prompts and creative instructions you submit). Used only when the matching feature runs: Resend (sends new-inquiry and pilot-application alerts once email notifications are turned on). When the video and image models are called through that API provider, the content you submit may be processed outside Canada and the United States; we send only what that generation needs.",
      },
      retention: {
        title: "Retention and deletion",
        beforeContact: "Records are retained only for the operating, contractual, security, and audit purposes described above. Account details, the assets you upload, prompts and finished videos have no automatic expiry: they are kept until you ask us to delete them or close your account. Technical logs are rotated by our hosting providers on their own schedule. You may request access, correction, export, or deletion by emailing",
        afterContact: "We verify identity first and complete the request within 30 days; if any records must be retained for legal or security reasons, we will tell you which ones and why.",
      },
      security: {
        title: "Security and international processing",
        body: "Production secrets are kept outside source control, access is role-limited, and generation activity is logged for traceability. Data may be processed in Canada, the United States, or another disclosed provider region under contractual safeguards.",
      },
      contactTitle: "Contact",
      contactLead: "Questions or privacy requests:",
      termsLink: "Read the Terms of Service",
      signInLink: "Return to sign in",
    },
    terms: {
      metadata: {
        title: "Terms of Service · Aivora",
        description: "Aivora's business-pilot terms covering input rights, AI output, prohibited use, and service boundaries.",
      },
      versionLabel: "EFFECTIVE NOVEMBER 17, 2026",
      title: "Terms of Service",
      intro: "Applies to Aivora, operated from Ontario, Canada. Last updated November 17, 2026.",
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
        body: "Plan limits and any pilot fees are defined in the applicable order form or customer agreement. Trial allowances are provided as stated on the page, and failed or cancelled generations are returned to your allowance. Model services and capacity may change. We may queue or pause work to preserve safety and reliability. Self-serve payment is not available yet.",
      },
      liability: {
        title: "Warranty and liability",
        body: "The service is provided as is. We work to keep it available and to make results match your description, but we do not promise it will be uninterrupted or error-free, or that generated content is fit for a particular purpose. To the extent the law allows, Aivora is not liable for indirect losses or lost profits arising from use of the service, and our total liability is limited to the fees you actually paid for the service in the three months before the claim, or CAD 100 if you paid nothing. You are responsible for the assets you upload, the content you publish, and third-party claims arising from them. Either party may stop using the service or close the account at any time; after that you may still request export or deletion under the Privacy Policy. These terms are governed by the laws of Ontario, Canada. If you have signed a separate written agreement with us, that agreement prevails.",
      },
      questions: "Questions:",
      privacyLink: "Privacy Policy",
      signInLink: "Return to sign in",
    },
    persona: {
      metadata: {
        title: "Get Started · Aivora",
        description: "Enter Aivora's unified workspace for video creation, templates, batch production, campaign racing, and deliverables.",
      },
      homeLabel: "Aivora home",
      studioLabel: "Creative studio",
      signIn: "Sign in",
      getStarted: "Get started",
      title: "Start with one video. Scale into controlled batch production.",
      description: "Creation, templates, batch production, and deliverables live in one workspace. New accounts start on a trial allowance; full plans are opened through your pilot agreement.",
      partnerLead: "Investor, incubator, or strategic partner?",
      showcaseLink: "See real deliveries (SunnyShutter, related party)",
      enterWorkspace: "Enter workspace",
      createStarter: "Create an account",
      browseTemplates: "Browse templates",
      existingAccount: "Sign in to your account",
      footer: "AI Video Growth Platform",
    },
  },
};

export function getPublicPageCopy(locale: Locale): PublicPageCopy {
  return PUBLIC_PAGE_COPY[locale];
}
