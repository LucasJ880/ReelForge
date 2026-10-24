/* Aivora 展台套件 · 共享层
   - 双语（EN / 中文，等权）
   - 离线草稿库：只回答明确识别的问题；没把握就交给店主；价格、折扣、免费、工期、服务范围、资质不承诺；问到 AI 如实说；
     诱导指令、骚扰、外链直接拦截；客户想换私聊渠道时交给店主决定；繁体（含粤语）留言回繁体
   - 设备总线：局域网中继（relay.mjs）优先，其次同设备 BroadcastChannel，同页模块走本地回环；发送失败会重试
   - 诚实计数：只记本展位真实约好的次数，按本地日期，不放示例数字
   classic script：挂在 window.Booth 上 */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };
  const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduce = !!(mq && mq.matches);
  if (mq && mq.addEventListener) mq.addEventListener("change", (e) => { reduce = e.matches; });

  /* ───────── 配置（config.json 可覆盖，所有设备从中继读同一份） ───────── */
  const DEFAULTS = {
    proof: { chains: [], counts: { posts: 0, triaged: 0, booked: 0 }, asOf: null, relatedParty: true, consentOnFile: false },
    channels: {
      live: [{ en: "Instagram & Facebook comments (pilot)", zh: "Instagram 与 Facebook 评论（试点中）" }],
      pending: [{ en: "Instagram / Facebook DMs", zh: "Instagram / Facebook 私信" }],
      roadmap: [{ en: "WhatsApp", zh: "WhatsApp" }, { en: "Xiaohongshu (RED)", zh: "小红书" }, { en: "Douyin", zh: "抖音" }, { en: "WeChat", zh: "微信" }],
    },
    resultBase: "",
    leadFallback: { email: "", whatsapp: "", wechat: "" },
    consentEntity: { name: "", address: "", email: "" },
    idleSeconds: 90,
  };
  let CONFIG = DEFAULTS;
  async function loadConfig() {
    try {
      const r = await fetch("config.json", { cache: "no-store" });
      if (r.ok) CONFIG = deepMerge(DEFAULTS, await r.json());
    } catch { /* 离线或 file://：用内置默认 */ }
    return CONFIG;
  }
  function deepMerge(a, b) {
    if (Array.isArray(a) || typeof a !== "object" || a === null) return b === undefined ? a : b;
    const out = { ...a };
    for (const k of Object.keys(b || {})) if (!k.startsWith("_")) out[k] = deepMerge(a[k], b[k]);
    return out;
  }
  const L10 = (v, lang) => (v && typeof v === "object" ? v[lang] || v.en || "" : String(v ?? ""));

  /* ───────── 双语 ───────── */
  const T = {
    en: {
      tagline: "AI growth agent for home-service shops",
      claim1: "A question in your comments → a booked in-home visit.",
      claim2: "You just tap Approve.",
      simNote: "Simulated comment thread for this booth. Our pilot runs on the official Instagram / Facebook API.",
      start_h: "Be your own customer.",
      start_p: "Set up your shop in two taps, then ask anything your customers ask you.",
      q_sell: "What do you sell?",
      q_city: "Where do you install or deliver?",
      city_ph: "City, e.g. Vaughan",
      go: "Start",
      yourVideo: "Your product video goes here",
      sampleVideo: "Sample video",
      ask_h: "Now you're the customer.",
      ask_p: "Comment like your customers do — any language.",
      ask_ph: "Write a comment…",
      send: "Post",
      you: "You (customer)",
      waiting: "The shop is replying…",
      bookBtn: "Book a visit",
      linkWord: "Book a visit",
      pick_h: "Pick a time for the visit",
      confirm: "Confirm",
      booked_h: "You're booked.",
      booked_p: "You booked {measure} for {slot}. The shop got it instantly.",
      elapsed: "From your comment to a booked visit",
      startOver: "Start over",
      done: "Done",
      noReply: "The shop chose not to reply to this one.",
      blockedCustomer: "Your comment is waiting for the shop.",
      sugs: ["Do you install in {city}?", "How much for 3 windows?", "Can I get it before next week?", "Are you a bot?"],
      owner_title: "Shop owner · approvals",
      o_idle_h: "Waiting for a customer comment",
      o_idle_p: "Hand the iPad to the visitor. Their comment appears here.",
      o_waiting: "The visitor is setting up their shop…",
      o_cmt: "New comment",
      o_draft: "AI draft · nothing is sent until you approve",
      o_offline: "Offline draft library",
      o_tr: "Translation",
      o_origDraft: "Original AI draft, for reference",
      skel_hi: "Hi! Thanks for your message. ",
      approve: "Approve & send",
      replyMyself: "Reply myself",
      dontReply: "Don't reply",
      sendMine: "Send",
      cancelEdit: "Back to draft",
      attachLink: "Attach booking link",
      endRound: "End this round",
      o_sent: "Sent · simulated delivery",
      o_waitBook: "Waiting for the customer to pick a time…",
      o_noLink: "Replied without a booking link. End the round when you're done.",
      o_custGone: "The customer's phone timed out and went back to the start. Your text is kept; end this round when you're ready.",
      o_notDelivered: "The customer's phone hasn't confirmed it got this reply.",
      o_resend: "Resend",
      o_noFallback: "No fallback contact in config.json: if a visitor's sign-up fails later, they'll have no way to reach us.",
      o_booked: "Booked",
      o_scan: "Scan to take your result home",
      o_scan_p: "Your reply, your timeline, our pricing structure and a 20-minute setup call.",
      o_qrMaking: "Making your QR code…",
      o_lanWarn: "This QR points to the booth network. Phones on 4G/5G can't open it — set a public result address in config.json.",
      o_next: "Next visitor",
      o_nextReady: "The next visitor has started on iPad A.",
      o_qualify: "Staff only · how do they take inquiries today?",
      qual: ["Phone", "WhatsApp", "WeChat", "IG / FB DMs", "Website form", "Walk-ins", "No system"],
      o_code: "Staff code",
      o_skipped: "No reply sent. Nothing left the shop.",
      o_blocked: "Blocked · nothing will be sent",
      cites: "Sample facts cited",
      sampleFacts: "Sample facts for this demo shop. At setup we load the facts you confirm.",
      sampleFactsShort: "Sample shop facts",
      flag_price: "Price or discount → you handle it. AI never quotes.",
      flag_time: "No date promised",
      flag_bot: "Discloses it's an AI assistant",
      flag_place: "Area not on your list → you confirm",
      flag_unknown: "Not sure what they need → you answer",
      flag_private: "Wants to move to a private chat → you decide",
      flag_block: "Manipulation / abuse / spam link",
      by_approved: "approved by you", by_edited: "edited & approved by you", by_manual: "written by you",
      step_video: "Video", step_post: "Post", step_comment: "Comment", step_draft: "AI draft", step_approve: "You approve", step_booked: "Booked",
      live: "Live on this booth",
      simChannel: "simulated channel",
      visitorTyping: "A visitor is writing a comment…",
      blockedOne: "One comment was blocked",
      runsToday: "Tried it here today",
      lastRun: "Last run · comment → booked",
      beFirst: "Be the first — try it on the iPad",
      tryBadge: "Try it on the iPad",
      proof_h: "Proof we can show you",
      proof_empty: "First verifiable pilot chain: in progress",
      proof_empty_p: "When the pilot is complete, every step shows the platform's own post ID and timestamps. Until then we show zeros, not samples.",
      c_posts: "Posts published", c_triaged: "Comments handled", c_booked: "Customer-confirmed visits",
      realPilot: "Real pilot · customer-confirmed visits",
      soFar: "real numbers only",
      relatedAsOf: "related-party pilot · as of {d}",
      related: "Our pilot shop (Sunny Shutter) is a related party.",
      relatedAnon: "Our pilot shop is a related party.",
      offer_h: "Founding Dealer Pilot",
      offer: [
        "Limited pilot seats in each service area.",
        "Nothing to pay until your first customer-confirmed booking.",
        "A confirmed booking means your customer picked a time through your booking link and didn't cancel.",
        "Then a monthly fee + a fee per confirmed booking, with a monthly cap.",
        "Any ad spend is paid by you directly to the platform, never through us.",
        "Cancel anytime. Ask us any time to export your videos and leads.",
      ],
      offer_price: "Pilot prices are set on your setup call. No deposits at the fair.",
      safety_h: "What the AI will never do",
      safety: [
        ["Quote prices, discounts, dates or contract terms", "Those go to you."],
        ["Send anything you didn't approve", "Every reply waits for your tap."],
        ["Pretend to be a person", "It says it's your AI assistant."],
        ["Keep running when you say stop", "Pause or cancel anything; your files stay."],
        ["Use unofficial bots or scraping", "Official platform APIs only."],
      ],
      channels_h: "Channels",
      ch_live: "In pilot", ch_pending: "Waiting for platform review", ch_roadmap: "Planned · not live",
      ch_h: "Where it runs today", ch_note: "Official platform APIs only. A channel goes live after the platform approves it.",
      res_title: "Your Aivora booth result",
      res_intro: "You tried it yourself at our booth. Here's what happened, in your words.",
      res_q: "Your customer asked",
      res_a: "The reply you sent",
      res_timeline: "Your timeline",
      res_cut: "(shortened for the QR code)",
      res_cta_h: "Set it up for your shop",
      res_cta_p: "A 20-minute call in your time zone. We check whether your Instagram / Facebook page can join the pilot, and load your service area and FAQs.",
      email: "Email", whatsapp: "WhatsApp", wechat: "WeChat ID",
      consentEmail: "Email me about setting up Aivora. I can unsubscribe anytime.",
      consentWa: "Message me on WhatsApp about setting up Aivora. I can opt out anytime.",
      consentWx: "Message me on WeChat about setting up Aivora. I can opt out anytime.",
      consentBy: "Consent requested by {name}{addr}{mail}. You can withdraw it anytime.",
      consentTbd: "[legal entity, address and contact email to be filled in config.json before the fair]",
      res_privacy: "We only use these details to contact you about the pilot. {name} keeps them; to see or delete them, email {email}.",
      res_noEntity: "Online sign-up isn't open yet. Please contact us directly:",
      res_introSample: "A sample of the page a visitor takes home after trying it at our booth.",
      res_queued: "Not sent yet: your phone is offline. It will be sent automatically when you're back online, so keep this page open.",
      res_askStaff: "Ask our staff at the booth, or scan the code again later.",
      submit: "Request my setup call",
      thanks: "Thanks — we'll reach out within 24 hours, by the channel you ticked.",
      notSent: "Not sent — we couldn't reach our sign-up server. Please contact us directly:",
      notSentNoContact: "Not sent — we couldn't reach our sign-up server. Please show this page to our staff.",
      needConsent: "Add a contact and tick its box.",
      badContact: "Please check the contact details.",
      roi_h: "What one more booked visit is worth to you",
      roi_job: "Average job value", roi_rate: "Visits that turn into a sale (%)", roi_extra: "Extra booked visits per month",
      roi_yours: "Your number",
      roi_out: "Extra revenue per month (your estimate)",
      roi_note: "Your inputs, simple multiplication. Not a promise of results.",
      sample: "Sample page",
      sampleNote: "This is the page layout. Scan the QR code at the booth to see the one you tried yourself.",
      notOnBooth: "Not on booth network",
      pairedDevice: "Paired on this device",
      pairedRelay: "Paired over booth Wi-Fi",
      reconnecting: "Reconnecting…",
      thisScreen: "This screen only",
    },
    zh: {
      tagline: "给家居服务小商家的 AI 获客助手",
      claim1: "客户在评论里问一句 → 约好上门。",
      claim2: "你只需要点「批准」。",
      simNote: "展台用的模拟评论区。我们的试点走 Instagram / Facebook 官方接口。",
      start_h: "当一回你自己的客户。",
      start_p: "点两下设好你的店，然后像你的客户那样随便问。",
      q_sell: "你卖什么？",
      q_city: "你在哪个城市安装或送货？",
      city_ph: "城市，例如 佛山 或 Vaughan",
      go: "开始",
      yourVideo: "这里放你的产品视频",
      sampleVideo: "示例视频",
      ask_h: "现在，你是客户。",
      ask_p: "像你的客户那样留言，中文英文都行。",
      ask_ph: "写一条评论…",
      send: "发布",
      you: "你（客户）",
      waiting: "店家正在回复…",
      bookBtn: "选个时间",
      linkWord: "点此预约",
      pick_h: "选一个上门的时间",
      confirm: "确认",
      booked_h: "约好了。",
      booked_p: "{slot} · {measure}。店家那边马上就收到了。",
      elapsed: "从你留言到约好上门",
      startOver: "重新开始",
      done: "完成",
      noReply: "店家这条选择不回复。",
      blockedCustomer: "你的留言在等店家处理。",
      sugs: ["你们在{city}能上门吗？", "3 扇窗大概多少钱？", "下周之前能装好吗？", "你是机器人吗？"],
      owner_title: "店主 · 待你批准",
      o_idle_h: "等客户留言",
      o_idle_p: "把 iPad 递给访客，他的留言会出现在这里。",
      o_waiting: "访客正在设置他的店…",
      o_cmt: "新留言",
      o_draft: "AI 草稿 · 你批准之前什么都不会发出",
      o_offline: "离线草稿库",
      o_tr: "对照翻译",
      o_origDraft: "原 AI 草稿（对照）",
      skel_hi: "你好！谢谢你的留言。",
      approve: "批准并发送",
      replyMyself: "我亲自回",
      dontReply: "不回复",
      sendMine: "发送",
      cancelEdit: "回到草稿",
      attachLink: "附上预约链接",
      endRound: "结束本轮",
      o_sent: "已发出 · 模拟送达",
      o_waitBook: "等客户选时间…",
      o_noLink: "已回复，没有附预约链接。处理完点「结束本轮」。",
      o_custGone: "客户手机已超时回到开头。你写的内容还在，准备好了就点「结束本轮」。",
      o_notDelivered: "客户手机还没确认收到这条回复。",
      o_resend: "重发",
      o_noFallback: "config.json 里没填备用联系方式：访客之后提交失败，就没有任何办法联系到我们。",
      o_booked: "已预约",
      o_scan: "扫码把结果带走",
      o_scan_p: "你的回复、你的时间线、我们的价格结构，以及 20 分钟开通沟通。",
      o_qrMaking: "正在生成二维码…",
      o_lanWarn: "这个二维码指向展台局域网，走 4G/5G 的手机打不开。请在 config.json 里填结果页公网地址。",
      o_next: "下一位访客",
      o_nextReady: "下一位访客已经在 iPad A 上开始了。",
      o_qualify: "店员填写 · 他现在怎么接询盘？",
      qual: ["电话", "WhatsApp", "微信", "IG / FB 私信", "官网表单", "到店", "没有固定方式"],
      o_code: "店员代号",
      o_skipped: "没有回复，什么都没发出去。",
      o_blocked: "已拦截 · 不会发出",
      cites: "引用的示例资料",
      sampleFacts: "这是演示店的示例资料。开通时换成你确认过的店铺资料。",
      sampleFactsShort: "示例店铺资料",
      flag_price: "价格或折扣 → 转给你。AI 从不报价。",
      flag_time: "不承诺日期",
      flag_bot: "如实说明自己是 AI 助理",
      flag_place: "不在你的服务区名单 → 由你确认",
      flag_unknown: "没看懂客户要什么 → 由你回答",
      flag_private: "客户想换私聊渠道 → 由你决定",
      flag_block: "诱导指令 / 骚扰 / 广告链接",
      by_approved: "由你批准", by_edited: "你改过后批准", by_manual: "你亲自写的",
      step_video: "成片", step_post: "帖子", step_comment: "评论", step_draft: "AI 草稿", step_approve: "你批准", step_booked: "已预约",
      live: "本展位实时",
      simChannel: "模拟渠道",
      visitorTyping: "有访客正在写留言…",
      blockedOne: "拦截了一条留言",
      runsToday: "今天在这里亲手试过",
      lastRun: "上一位 · 从评论到预约",
      beFirst: "第一个来试 —— iPad 上点开始",
      tryBadge: "在 iPad 上亲手试试",
      proof_h: "我们能拿给你核对的证据",
      proof_empty: "第一条可核对的试点记录：进行中",
      proof_empty_p: "试点完成后，每一步都显示平台自己回传的帖子 ID 和时间。在那之前这里写零，不放示例。",
      c_posts: "已发布帖子", c_triaged: "已处理评论", c_booked: "客户确认的上门预约",
      realPilot: "真实试点 · 客户确认的上门预约",
      soFar: "只放真实数字",
      relatedAsOf: "关联方试点 · 截至 {d}",
      related: "我们的试点店 Sunny Shutter 是关联方。",
      relatedAnon: "我们的试点店是关联方。",
      offer_h: "首批经销商试点",
      offer: [
        "每个服务区的试点席位有限。",
        "第一个客户确认的预约之前，不收费。",
        "「客户确认的预约」指客户通过你的预约链接选定了时间，并且没有取消。",
        "之后按「月费 + 每个确认预约计费」收，设月度封顶。",
        "如果投广告，广告费由你直接付给平台，不经过我们。",
        "随时可以取消；你的视频和线索，随时可以找我们导出。",
      ],
      offer_price: "试点价格在开通沟通时定。展会现场不收订金。",
      safety_h: "AI 绝不会做的事",
      safety: [
        ["报价、承诺折扣、日期或合同条款", "这些一律转给你。"],
        ["发出你没批准的内容", "每条回复都等你点一下。"],
        ["假装是真人", "它会说明自己是你的 AI 助理。"],
        ["你喊停还继续跑", "任何任务都能暂停或取消，素材保留。"],
        ["用非官方机器人或抓取", "只走平台官方接口。"],
      ],
      channels_h: "渠道",
      ch_live: "试点中", ch_pending: "等平台审核", ch_roadmap: "规划中 · 未上线",
      ch_h: "现在能接哪些渠道", ch_note: "只走平台官方接口；平台审核通过后才上线。",
      res_title: "你在 Aivora 展台的体验结果",
      res_intro: "这是你在我们展台亲手试的那一次，用的是你自己的话。",
      res_q: "你的客户问",
      res_a: "你发出的回复",
      res_timeline: "你的时间线",
      res_cut: "（为了放进二维码做了缩短）",
      res_cta_h: "给你的店开通",
      res_cta_p: "约一次 20 分钟的线上沟通，按你的时区。我们确认你的 Instagram / Facebook 主页能否加入试点，并录入服务区和常见问答。国内平台暂未支持。",
      email: "邮箱", whatsapp: "WhatsApp", wechat: "微信号",
      consentEmail: "同意通过邮件联系我开通 Aivora，随时可以退订。",
      consentWa: "同意通过 WhatsApp 联系我开通 Aivora，随时可以退订。",
      consentWx: "同意通过微信联系我开通 Aivora，随时可以退订。",
      consentBy: "征求同意的主体：{name}{addr}{mail}。你可以随时撤回。",
      consentTbd: "［法律主体、地址和联系邮箱，开展前在 config.json 填写］",
      res_privacy: "这些信息只用于就试点联系你，由 {name} 保存；要查看或删除，请发邮件到 {email}。",
      res_noEntity: "线上登记还没开放，请直接联系我们：",
      res_introSample: "访客在展台亲手试完后，带回家的就是这样一页（示例）。",
      res_queued: "还没发出去：手机现在没有网络。恢复联网后会自动再发一次，请别关掉这一页。",
      res_askStaff: "请直接找展台的工作人员，或稍后再扫一次。",
      submit: "预约我的开通沟通",
      thanks: "收到了。我们会在 24 小时内，用你勾选的方式联系你。",
      notSent: "没有发出去：连不上我们的登记服务器。请直接联系我们：",
      notSentNoContact: "没有发出去：连不上我们的登记服务器。请把这一页给我们的店员看。",
      needConsent: "请填写一种联系方式，并勾选对应的同意。",
      badContact: "请检查联系方式。",
      roi_h: "多约到一次上门，对你值多少",
      roi_job: "平均客单价", roi_rate: "上门后成交的比例（%）", roi_extra: "每月多约到的上门次数",
      roi_yours: "填你的数字",
      roi_out: "每月多出的营业额（你的估算）",
      roi_note: "数字是你填的，我们只做了乘法，不代表效果承诺。",
      sample: "示例页面",
      sampleNote: "这是页面版式。在展台扫二维码，才会看到你自己试的那一次。",
      notOnBooth: "未连上展台网络",
      pairedDevice: "本机多窗口配对",
      pairedRelay: "展台局域网已配对",
      reconnecting: "重新连接中…",
      thisScreen: "仅本屏",
    },
  };
  const LANGS = ["en", "zh"];
  function t(lang, key, vars) {
    const v = (T[lang] && own(T[lang], key) ? T[lang][key] : undefined) ?? T.en[key] ?? key;
    if (typeof v !== "string" || !vars) return v;
    return v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
  }
  const DEFAULT_LANG = { customer: "en", owner: "en", result: null, screen: "both" };
  const uiLang = (role) => store.get(`booth.lang.${role}`, DEFAULT_LANG[role] ?? "en");
  const setUiLang = (role, l) => store.set(`booth.lang.${role}`, l);
  function langToggle(role, current, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "lang"; wrap.setAttribute("role", "group"); wrap.setAttribute("aria-label", "Language / 语言");
    wrap.innerHTML = LANGS.map((l) => `<button type="button" data-l="${l}" aria-pressed="${l === current}" lang="${l === "zh" ? "zh-CN" : "en"}">${l === "en" ? "EN" : "中文"}</button>`).join("");
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest("[data-l]"); if (!b) return;
      setUiLang(role, b.dataset.l);
      $$("button", wrap).forEach((x) => x.setAttribute("aria-pressed", x === b));
      onChange(b.dataset.l);
    });
    return wrap;
  }

  /* ───────── 品类与示例资料（演示店的示例，不代表访客自己的店）
     示例资料只陈述产品事实；价格、免费、日期、服务范围、资质一律不写，交给店主。
     svc：讲「可以安排安装 / 送货 / 拆旧」的服务类资料，地点没确认时不引用（否则读起来像答应能去） ───────── */
  /* 「可拆卸 / 我自己拆 / 拆开搬上楼」不是在问拆旧服务 */
  const NOT_REMOVAL = /\bremovable\b|\bdetachable\b|\bremov\w*\s+(?:[\w'-]+\s+){0,4}?(?:myself|ourselves)\b|\b(?:can|could|should|may|do)\s+(?:i|we)\s+remove\b|\b(?:i|we)(?:'ll|\s+will|\s+can)?\s+remove\b|拆开|拆卸|可拆|自己拆|(?<!旧[^，,。？?！!]{0,6})拆(?:得|唔|不)?下(?:来|嚟)?(?![^，,。？?！!]{0,4}旧)/i;
  const CATS = {
    blinds: { icon: "house", en: "Blinds & shutters", zh: "窗饰（窗帘 / 百叶 / 卷帘）", shortEn: "Blinds", shortZh: "窗饰", media: "loop-1", poster: "thumb-1",
      measure: { en: "an in-home measure", zh: "上门量尺" },
      facts: [
        { id: "KF-P1", key: /(motor|battery|recharg\w*|wired|plug|remote|smart|\bwi-?fi\b|\bbluetooth\b|\b(?:from|with|via|using|through|on|by)\s+(?:my|your|our|a|the)?\s*(?:smart\s*)?(?:phones?|smartphones?|cell\s*phones?|mobiles?|ipads?|tablets?)\b|\b(?:phone|smartphone|mobile)\s+(?:app|control)|\bvoice\s+control|电动|电池|插电|遥控|智能|智慧|手机(?!号|號))/i, en: "Motorized options come in rechargeable-battery and plug-in versions.", zh: "电动款有充电电池和插电两种。", label: { en: "Motor options", zh: "电动款供电" } },
        { id: "KF-P2", key: /(blackout|room.?darken|light.?filter|sheer|privacy|\bdark(?:er|en|ness)?\b(?!\s*(?:wood|walnut|oak|grey|gray|brown|blue|green|colou?rs?|finish|stain|tones?))|bedroom|skylight|sunlight|\bsun(?:ny|shine)?\b|glare|\bsolar\s+(?:shades?|blinds?|screens?|fabrics?|rollers?)\b|(?:west|south)[- ]facing|\b(?:west|south)\s+windows?\b|\bfac(?:e|es|ing)\s+(?:the\s+)?(?:west|south)\b|\bnursery\b|\bmorning\s+(?:light|sun)\b|\bblock\w*\s+(?:out\s+)?(?:the\s+)?(?:light|sun)\b|遮光|透光|卧室|睡房|天窗|隐私|西晒|西斜|朝西|朝南|向西|向南|防晒|晒|阳光|太阳|刺眼|纱帘|薄纱|窗纱|白纱|柔纱)/i, en: "There are blackout and light-filtering fabrics.", zh: "有遮光和透光两类面料。", label: { en: "Fabrics", zh: "面料" } },
      ] },
    furniture: { icon: "store", en: "Furniture", zh: "家具", shortEn: "Furniture", shortZh: "家具", measure: { en: "a design consultation", zh: "设计咨询" },
      facts: [
        { id: "KF-P1", key: /(\bsizes?\b|custom|\bfits?\b|made to|made\s+(?:a\s+(?:bit|little|tad|touch)\s+|slightly\s+|even\s+|much\s+|a\s+lot\s+)?(?:longer|bigger|smaller|wider|shorter|narrower|deeper|taller|lower)|\b(?:make|build|go)\b[^.?!]{0,24}\b(?:longer|bigger|smaller|wider|shorter|narrower|deeper|taller|lower)\b|尺寸|定制|客制|定做|订造|订做|订制|做大|做小|加长|加宽|加大|做长|做宽|做短|改尺寸|做成|小户型|放得下|放不下|(?:摆|放)(?:唔|不)?(?:摆|放)?得(?:落|下)|(?:摆|放)(?:唔|不)(?:落|下)|整(?:大|细|长|阔|宽|高|矮|短)|度身)/i, en: "Many sofas and tables can be made to custom sizes.", zh: "很多沙发和桌子可以定制尺寸。", label: { en: "Custom sizes", zh: "定制尺寸" } },
        { id: "KF-P2", svc: true, key: /(deliver|setup|set up|assembl|送货|送到|送上门|送[^，,。？?！!\s]{1,6}上门|能送|可以送|送吗|组装|安装|可唔可以(?:送|装|组装)(?!修|饰|潢)|能装(?!修|饰|潢)|可以装(?!修|饰|潢)|装(?:吗|嗎|唔装|不装)|(?:帮|幫)(?:忙|手|我)?装(?!修|饰|潢))/i, en: "Delivery and setup can be arranged; the owner confirms the area and any cost.", zh: "送货和安装可以安排，范围和费用由店主确认。", label: { en: "Delivery", zh: "送货安装" } },
      ] },
    lighting: { icon: "eye", en: "Lighting", zh: "灯具", shortEn: "Lighting", shortZh: "灯具", measure: { en: "a lighting consultation", zh: "灯光方案咨询" },
      facts: [
        { id: "KF-P1", key: /(\bdimm|smart|\bremotes?\b|\bwi-?fi\b|\bbluetooth\b|\b(?:via|with|through|using|by|from|on|in)\s+(?:an?\s+|the\s+|my\s+|your\s+)?(?:phone\s+|mobile\s+)?app\b|\bapp[- ]?control\w*|\bapp\s+to\s+(?:control|dim|adjust|switch|turn)|\bwarm(?:er)?\s*(?:white|light|lights|lighting|glow|tones?|colou?rs?|temp\w*|bulbs?|leds?)\b|colou?r temp|\b(?:from|with|via|using|through|on|by)\s+(?:my|your|our|a|the)?\s*(?:smart\s*)?(?:phones?|smartphones?|cell\s*phones?|mobiles?|ipads?|tablets?)\b|\b(?:phone|smartphone|mobile)\s+(?:app|control)|\bvoice\s+control|调光|智能|智慧|色温|暖(?:黄|白)?光|黄光|白光|冷光|手机(?:控制|操控|遥控|app|调)|app控制|遥控)/i, en: "There are smart dimming and adjustable colour temperature options.", zh: "有智能调光和可调色温款。", label: { en: "Smart options", zh: "智能款" } },
        { id: "KF-P2", svc: true, key: /(\binstall(?:s|ed|er|ers|ing|ation|ations)?\b|\bhang(?:s|ing)?\b|\bhung\b|\bput\s+up\b|\bwir(?:e|es|ed|ing)\b|安装|电工|挂(?=[^，,。？?！!]{0,4}灯)|(?<=灯[^，,。？?！!]{0,4})挂|布线|接线|能装(?!修|饰|潢)|可以装(?!修|饰|潢)|装(?:吗|嗎|不装|唔装)|(?:帮|幫)(?:忙|手|我)?装(?!修|饰|潢))/i, en: "Installation can be arranged; the owner confirms who does the wiring.", zh: "安装可以安排，具体由谁接线由店主确认。", label: { en: "Installation", zh: "安装" } },
      ] },
    bath: { icon: "house", en: "Kitchen & bath", zh: "厨卫", shortEn: "Kitchen & Bath", shortZh: "厨卫", measure: { en: "an in-home measure", zh: "上门测量" },
      facts: [
        { id: "KF-P1", key: /(vanit|cabinet|cupboard|\bsizes?\b|custom|柜|尺寸|定制|客制|订造|订做|订制)/i,
          objs: "vanity vanities cabinet cabinets cupboard cupboards 浴室柜 橱柜 吊柜 地柜 镜柜 柜 柜子 系统柜 洗脸盆柜 脸盆柜 洗手盆柜 台盆柜 面盆柜",
          /* 衣柜、鞋柜、电视柜之类不是厨卫柜 */
          not: /衣柜|鞋柜|电视柜|书柜|酒柜|床头柜|斗柜|展示柜|\b(?:tv|media|display|shoe|china|filing|liquor|wine)\s+cabinets?\b|\bwardrobes?\b|\bclosets?\b|\bdressers?\b/i, en: "Vanities and cabinets come in standard and custom sizes.", zh: "浴室柜和橱柜有标准和定制尺寸。", label: { en: "Sizes", zh: "尺寸" } },
        { id: "KF-P2", svc: true, key: /(remov|haul|tear.?out|rip.?(?:out|up)|old (fixture|vanity|cabinet|tub|toilet|sink)|拆|旧的|清运|垃圾(?!桶|处理|袋|分类|服务|店|东西|玩意|商家|公司|铺))/i, not: NOT_REMOVAL, en: "Removing the old fixtures can be arranged; the owner confirms any cost.", zh: "拆旧可以一起安排，费用由店主确认。", label: { en: "Removal", zh: "拆旧" } },
      ] },
    flooring: { icon: "house", en: "Flooring", zh: "地板", shortEn: "Flooring", shortZh: "地板", measure: { en: "an in-home measure", zh: "上门测量" },
      facts: [
        { id: "KF-P1", key: /(water|kitchen|basement|vinyl|\blv[pt]s?\b|\bwpc\b|moist\w*|humid\w*|\bdamp\w*|\bwet\b|\bwood|hardwood|engineered|laminate|\bmaterials?\b|材质|材料|什么材|啥材|咩材|防水|防潮|潮湿|厨房|地下室|实木|木地板|海岛型|spc)/i, en: "There are waterproof vinyl and engineered wood options.", zh: "有防水 SPC 和多层实木地板。", label: { en: "Materials", zh: "材质" } },
        { id: "KF-P2", svc: true, key: /(remov|tear.?out|rip.?(?:out|up)|haul|old (floor|carpet|tile)|拆|旧地板|旧地毯|清运|垃圾(?!桶|处理|袋|分类|服务|店|东西|玩意|商家|公司|铺))/i, not: NOT_REMOVAL, en: "Old floor removal and haul-away can be arranged; the owner confirms any cost.", zh: "拆旧地板和清运可以安排，费用由店主确认。", label: { en: "Removal", zh: "拆旧清运" } },
      ] },
    /* noInstall：示例资料没讲到安装窗帘（只讲定做和布样）。「装 / 挂 + 窗帘」交给店主；不带对象的「Do you install in X」仍按服务区问题回答 */
    textiles: { icon: "house", en: "Home textiles", zh: "家纺", shortEn: "Textiles", shortZh: "家纺", measure: { en: "an in-home swatch visit", zh: "上门看布样" }, noInstall: true,
      facts: [
        { id: "KF-P1", key: /(\bsizes?\b|custom|curtain|\bpanels?\b|length|made to|尺寸|定制|客制|定做|订造|订做|订制|窗帘|长度)/i,
          objs: "curtain curtains drape drapes drapery draperies sheer sheers valance valances panel panels 窗帘 窗纱 纱帘 帘子 遮光布 门帘 布帘",
          /* 床品、配件（挂钩 / 杆 / 轨道）、浴帘、安装、材质：这条资料没讲到 */
          not: /被套|被子|被单|被铺|床单|床笠|床品|床上用品|四件套|枕头|枕套|抱枕|靠垫|毛巾|浴巾|地毯|桌布|沙发套|浴帘|挂钩|钩子|窗帘杆|罗马杆|杆子|轨道|滑轨|导轨|配件|五金|绑带|绑绳|安装|装吗|装不装|装唔装|帮(?:忙|我)?装|能装|可以装|挂上|挂起|材质|什么布|布料|面料|\b(?:fabrics?|duvets?|bedding|sheets?|pillow\w*|cushions?|throws?|blankets?|towels?|rugs?|tablecloths?|shower\s+curtains?|hooks?|rods?|tracks?|rails?|brackets?|tie-?backs?|rings?|grommets?|hardware|install\w*|hang|hanging|mount\w*|materials?)\b/i, en: "Curtains can be made to your window size.", zh: "窗帘可以按你家窗户尺寸定做。", label: { en: "Made to size", zh: "按尺寸定做" } },
        { id: "KF-P2", key: /(sample|swatch|fabric|colou?r|\b(?:grey|gray|white|black|beige|ivory|navy|cream|charcoal|taupe|blue|green|red|pink|yellow|brown|orange|purple)\b|布样|布办|布板|面料|颜色|花色|[红橙黄绿青蓝紫灰白黑棕粉米咖驼杏啡]色|米白|奶白|浅色|深色)/i, en: "There are fabric swatches to choose from.", zh: "有布样可以挑。", label: { en: "Swatches", zh: "布样" } },
      ] },
  };
  const catOf = (k) => (own(CATS, k) ? CATS[k] : CATS.blinds);
  const shopLabel = (cat, ci, lang) => {
    const c = catOf(cat);
    return lang === "zh" ? `${ci}${c.shortZh}` || c.shortZh : `${ci ? ci + " " : ""}${c.shortEn}`;
  };
  /* 城市框是自由输入：「Vaughan, ON」「广东佛山」「Toronto (GTA)」先规整再显示 */
  const shopName = (cat, city, lang) => { const C = cityInfo(city); return shopLabel(cat, lang === "zh" ? C.show.zhTyped : C.show.en, lang); };

  /* ───────── 繁简字形 ─────────
     H2S：繁 → 简，用于匹配意图与判定字形；S2H：简 → 繁，检测到繁体留言时把中文回复整句转成繁体。
     每组两个字「繁简」。一简多繁的字按回复模板选定写法，词级例外放在 PHRASE_S2H。 */
  const PAIRS = [
    "愛爱 礙碍 襖袄 擺摆 敗败 闆板 辦办 幫帮 寶宝 報报 貝贝 備备 筆笔 幣币 畢毕 邊边 變变 標标 錶表 賓宾 補补 參参 倉仓 產产 長长 嘗尝 嚐尝 場场 廠厂 車车 徹彻 陳陈 塵尘 襯衬 稱称 懲惩 遲迟 齒齿 衝冲 蟲虫",
    "醜丑 礎础 處处 觸触 傳传 闖闯 創创 錘锤 純纯 詞词 辭辞 聰聪 從从 叢丛 錯错 達达 帶带 單单 擔担 膽胆 彈弹 當当 擋挡 黨党 導导 島岛 燈灯 鄧邓 敵敌 遞递 點点 電电 墊垫 澱淀 釣钓 調调 頂顶 訂订 東东 動动",
    "凍冻 棟栋 鬥斗 獨独 讀读 賭赌 斷断 鍛锻 隊队 對对 噸吨 奪夺 惡恶 噁恶 兒儿 爾尔 發发 髮发 罰罚 閥阀 範范 飯饭 訪访 紡纺 飛飞 廢废 費费 墳坟 奮奋 豐丰 風风 鳳凤 膚肤 婦妇 復复 複复 負负 該该 蓋盖 趕赶",
    "乾干 幹干 岡冈 剛刚 鋼钢 綱纲 崗岗 擱搁 鴿鸽 閣阁 個个 給给 鞏巩 貢贡 溝沟 構构 購购 穀谷 顧顾 颳刮 關关 觀观 館馆 慣惯 貫贯 廣广 歸归 龜龟 規规 軌轨 櫃柜 貴贵 國国 過过 漢汉 號号 賀贺 後后 鬍胡 護护",
    "滬沪 戶户 劃划 華华 話话 懷怀 壞坏 歡欢 環环 還还 換换 喚唤 黃黄 揮挥 輝辉 匯汇 彙汇 會会 繪绘 渾浑 夥伙 獲获 貨货 禍祸 擊击 機机 積积 飢饥 雞鸡 極极 級级 擠挤 幾几 計计 記记 際际 繼继 紀纪 傢家 價价",
    "駕驾 堅坚 間间 艱艰 監监 揀拣 檢检 簡简 鹼碱 見见 艦舰 劍剑 薦荐 鑑鉴 鍵键 漸渐 踐践 將将 獎奖 講讲 醬酱 膠胶 驕骄 嬌娇 腳脚 攪搅 繳缴 轎轿 較较 階阶 節节 潔洁 結结 屆届 緊紧 儘尽 盡尽 進进 驚惊 經经",
    "頸颈 競竞 靜静 鏡镜 糾纠 舊旧 劇剧 據据 懼惧 捲卷 覺觉 決决 軍军 開开 凱凯 殼壳 課课 墾垦 懇恳 庫库 褲裤 誇夸 塊块 寬宽 礦矿 虧亏 擴扩 闊阔 臘腊 蠟蜡 來来 賴赖 藍蓝 欄栏 攔拦 籃篮 蘭兰 爛烂 濫滥 勞劳",
    "樂乐 類类 壘垒 淚泪 離离 禮礼 裡里 裏里 歷历 曆历 厲厉 勵励 麗丽 連连 聯联 蓮莲 簾帘 憐怜 戀恋 煉炼 練练 糧粮 兩两 輛辆 療疗 遼辽 瞭了 獵猎 臨临 鄰邻 靈灵 齡龄 嶺岭 領领 劉刘 龍龙 樓楼 婁娄 爐炉 盧卢",
    "蘆芦 擄虏 魯鲁 錄录 陸陆 驢驴 鋁铝 慮虑 綠绿 亂乱 論论 羅罗 邏逻 蘿萝 絡络 媽妈 馬马 碼码 罵骂 嗎吗 買买 賣卖 麥麦 邁迈 滿满 貓猫 麼么 沒没 門门 們们 夢梦 彌弥 覓觅 綿绵 麵面 廟庙 滅灭 閩闽 鳴鸣 銘铭",
    "謬谬 畝亩 難难 惱恼 腦脑 鬧闹 膩腻 鳥鸟 寧宁 擰拧 農农 濃浓 諾诺 歐欧 盤盘 賠赔 噴喷 鵬鹏 騙骗 飄飘 頻频 貧贫 蘋苹 評评 憑凭 撲扑 鋪铺 樸朴 譜谱 齊齐 騎骑 豈岂 啟启 啓启 氣气 棄弃 遷迁 簽签 牽牵 鉛铅",
    "錢钱 淺浅 譴谴 槍枪 牆墙 搶抢 橋桥 喬乔 僑侨 竅窍 竊窃 親亲 寢寝 輕轻 氫氢 傾倾 慶庆 窮穷 區区 驅驱 軀躯 趨趋 權权 勸劝 確确 讓让 熱热 認认 榮荣 軟软 銳锐 潤润 灑洒 賽赛 傘伞 喪丧 掃扫 澀涩 殺杀 紗纱",
    "篩筛 曬晒 閃闪 陝陕 傷伤 賞赏 燒烧 紹绍 捨舍 攝摄 設设 紳绅 審审 嬸婶 腎肾 滲渗 聲声 繩绳 勝胜 聖圣 師师 獅狮 濕湿 溼湿 詩诗 屍尸 時时 實实 識识 勢势 適适 釋释 飾饰 視视 試试 壽寿 獸兽 書书 輸输 屬属",
    "術术 樹树 數数 帥帅 雙双 誰谁 稅税 順顺 說说 碩硕 絲丝 飼饲 鬆松 聳耸 訟讼 頌颂 蘇苏 訴诉 肅肃 雖虽 隨随 歲岁 孫孙 損损 筍笋 縮缩 瑣琐 鎖锁 臺台 檯台 颱台 態态 壇坛 嘆叹 談谈 攤摊 灘滩 癱瘫 貪贪 湯汤",
    "燙烫 濤涛 討讨 騰腾 題题 體体 條条 鐵铁 聽听 廳厅 頭头 圖图 塗涂 團团 橢椭 窪洼 襪袜 彎弯 灣湾 頑顽 萬万 網网 為为 爲为 違违 圍围 偉伟 衛卫 穩稳 問问 無无 務务 霧雾 誤误 犧牺 習习 係系 繫系 戲戏 細细",
    "蝦虾 嚇吓 鮮鲜 閒闲 顯显 險险 現现 獻献 縣县 憲宪 線线 綫线 廂厢 鑲镶 鄉乡 詳详 響响 項项 嚮向 銷销 曉晓 協协 脅胁 寫写 瀉泻 謝谢 鋅锌 興兴 選选 懸悬 學学 尋寻 訓训 訊讯 遜逊 壓压 鴉鸦 鴨鸭 啞哑 亞亚",
    "訝讶 嚴严 鹽盐 顏颜 豔艳 驗验 楊杨 陽阳 養养 樣样 堯尧 窯窑 謠谣 搖摇 遙遥 藥药 爺爷 頁页 業业 葉叶 醫医 儀仪 藝艺 億亿 憶忆 義义 議议 異异 譯译 陰阴 隱隐 銀银 飲饮 應应 嬰婴 鷹鹰 營营 蠅蝇 贏赢 擁拥",
    "傭佣 湧涌 優优 憂忧 郵邮 猶犹 遊游 魚鱼 漁渔 與与 語语 譽誉 預预 禦御 慾欲 鬱郁 獄狱 園园 員员 圓圆 緣缘 遠远 願愿 約约 躍跃 鑰钥 閱阅 雲云 運运 醞酝 雜杂 災灾 載载 贓赃 髒脏 臟脏 鑿凿 棗枣 竈灶 責责",
    "擇择 則则 澤泽 賊贼 贈赠 紮扎 閘闸 詐诈 齋斋 債债 氈毡 盞盏 斬斩 嶄崭 棧栈 戰战 張张 漲涨 帳帐 賬账 脹胀 趙赵 這这 針针 偵侦 診诊 鎮镇 陣阵 掙挣 睜睁 爭争 幀帧 鄭郑 證证 織织 職职 執执 紙纸 摯挚 擲掷",
    "幟帜 質质 鐘钟 鍾钟 種种 腫肿 眾众 衆众 晝昼 諸诸 豬猪 燭烛 囑嘱 貯贮 築筑 鑄铸 專专 磚砖 轉转 賺赚 樁桩 莊庄 裝装 妝妆 壯壮 狀状 準准 濁浊 資资 漬渍 綜综 總总 縱纵 鄒邹 詛诅 組组 鑽钻 製制 詢询 測测",
    "層层 櫥橱 廚厨 臥卧 溫温 濱滨 錦锦 倫伦 紐纽 磯矶 奧奥 頓顿 維维 濟济 錫锡 廈厦 禪禅 週周 請请 卻却 於于 紋纹 粵粤 贛赣 滾滚 殘残 搵揾 囉啰 諗谂 煙烟 貼贴 鏈链 釘钉 鉤钩 銅铜 鈕钮 綢绸 緞缎 絨绒 滌涤",
    "綸纶 纖纤 縫缝 繡绣 纜缆 瀋沈 鹹咸 鈣钙 鏽锈 撐撑 屜屉 畫画 涼凉 黴霉 籠笼 額额 檔档 誌志 誠诚 謂谓 謊谎 妳你 纔才 剎刹 盃杯 麪面 衹只 況况 續续 濾滤",
    "鑼锣 鏟铲 舖铺 減减 隻只 內内 牀床 枱台 剷铲 別别 掛挂",
    /* 港台厨卫 / 预约常用字：坐廁、洗臉盆、設計諮詢、寵物、釐米、系統櫃、儲物、淨色、唔駛錢 */
    "廁厕 臉脸 諮咨 寵宠 釐厘 統统 儲储 淨净 駛驶 鍍镀 緻致 韌韧 摺折 疊叠 籬篱 閂闩 柵栅",
  ].join("").replace(/\s+/g, "");
  const H2S = {};
  const S2H = {};
  /* 繁体里也照常这样写的字：不算「简体残留」，也不逐字转换（需要时走词级） */
  const KEEP_TRAD = new Set("板表丑斗范干谷刮后胡伙家卷了里面朴舍松台系向游于御欲郁扎准制志才只杯沈咸霉你周云涌佣晒致折厘");
  const S2H_PREF = { 发: "發", 复: "復", 汇: "匯", 尽: "盡", 历: "歷", 钟: "鐘", 脏: "髒", 恶: "惡", 启: "啟", 为: "為", 众: "眾", 湿: "濕", 线: "線", 尝: "嘗", 后: "後", 云: "雲" };
  for (let i = 0; i + 1 < PAIRS.length; i += 2) {
    const tr = PAIRS[i], si = PAIRS[i + 1];
    if (tr === si) continue;
    H2S[tr] = si;
    if (!own(S2H, si)) S2H[si] = tr;
  }
  for (const [si, tr] of Object.entries(S2H_PREF)) S2H[si] = tr;
  for (const si of KEEP_TRAD) if (si !== "后" && si !== "云") delete S2H[si];
  const SIMP_ONLY = new Set(Object.values(H2S).filter((si) => !KEEP_TRAD.has(si)));
  const PHRASE_S2H = { 这里: "這裡", 那里: "那裡", 哪里: "哪裡", 回复: "回覆", 联系: "聯繫", 关系: "關係", 标准: "標準", 范围: "範圍", 定制: "定製", 皇后: "皇后", 周末: "週末", 下周: "下週", 这周: "這週", 本周: "本週", 每周: "每週", 一周: "一週", 沈阳: "瀋陽", 链接: "連結", 咨询: "諮詢" };
  const PHRASE_RX = new RegExp(`${Object.keys(PHRASE_S2H).join("|")}|[\\u3400-\\u9fff]`, "g");
  /* 全角数字和字母折成半角（１３８…、ＩＤ）；逐字替换，长度不变，下标仍和原文对齐 */
  const foldW = (s) => String(s || "").replace(/[０-９Ａ-Ｚａ-ｚ＠]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const norm = (s) => foldW(s).replace(/[㐀-鿿]/g, (c) => H2S[c] || c);
  const toHans = norm;
  const toHant = (s) => String(s || "").replace(PHRASE_RX, (w) => (w.length > 1 ? PHRASE_S2H[w] : S2H[w] || w));
  /* 自检：繁体回复里不应残留只属于简体的字 */
  const hantResidue = (s) => [...new Set([...String(s || "")].filter((ch) => SIMP_ONLY.has(ch)))];
  /* 留言里的店主城市（含它的各段、简繁两种写法）不参与字形 / 语言判定 */
  const stripCity = (raw, city) => {
    let s = String(raw || "");
    const C = cityInfo(city);
    for (const x of new Set([...C.raws, ...C.parts.map((P) => P.n)])) if (x) for (const v of new Set([x, norm(x), toHant(x)])) s = s.split(v).join(" ");
    return s;
  };
  /* 粤语专用字：简繁写法相同，单凭它们分不出字形 */
  const CANTO = /[冇唔啲嘅喺嚟咩㗎咗哋嘢乜佢睇畀俾嗰噉咁啱]/;
  function detectScript(text, city) {
    let tr = 0, si = 0;
    const probe = stripCity(String(text || ""), city);
    for (const ch of probe) { if (own(H2S, ch)) tr++; else if (SIMP_ONLY.has(ch)) si++; }
    if (tr !== si) return tr > si ? "hant" : "hans";
    /* 一个区分字都没有：+852/+853/+886 的号码、店在港澳台，或粤语留言 + 店在内地以外 → 繁体 */
    if (!tr && /[㐀-鿿]/.test(probe)) {
      const C = cityInfo(city);
      if (/\+\s?(?:852|853|886)/.test(probe) || C.hant) return "hant";
      if (C.ci && CANTO.test(probe) && !C.cn) return "hant";
    }
    return "hans";
  }

  /* ───────── 离线草稿库：意图 ───────── */
  const rx = (parts, flags = "i") => new RegExp(parts.join("|"), flags);
  const isHan = (ch) => /[㐀-鿿]/.test(ch || "");
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const factHit = (s) => Object.values(CATS).some((c) => c.facts.some((f) => f.key.test(s)));
  const zhBase = (s) => String(s || "").replace(/[市区县镇]$/, "");
  /* 英文骂词只在冲着店或人时拦：「stupid question」「fucking gorgeous」、对安装师傅的投诉都放行（投诉交给店主） */
  const INSULT = String.raw`(?:stupid|idiots?|idiotic|morons?|dumb(?:ass)?|assholes?|bitch(?:es)?|losers?|clowns?|scam(?:mers?)?|frauds?|liars?|crooks?|thieves|trash|garbage|useless|pathetic|shit(?:ty)?|crap(?:py)?|jerks?|retard(?:s|ed)?|incompetent)`;
  const INSULT_N = String.raw`(?:idiots?|morons?|losers?|clowns?|scammers?|liars?|crooks?|jerks?|assholes?|bitch(?:es)?|retards?|frauds?|thieves|dumbass(?:es)?|scum|pigs?|trash|garbage|cheats?)`;
  /* 打星号 / 拆开 / 缩写的 fuck：f*ck、f**k、fk、fck、f u c k、phuck */
  const FUCK = String.raw`(?:f+u+c*k+|f[*#@]+c?k*|f[*#@]+|f[\s.]+u[\s.]+c[\s.]+k|fck|fk|fuk|fuq|fcuk|phuck|fvck)`;
  /* 裸域名（不带 http / www / 路径）：常见平台、零售商、邮箱域名不算引流 */
  const DOMAIN_SRC = String.raw`(?<![@\w.-])(?=[a-z0-9-]*[a-z])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|ca|co|io|ly|me|info|biz|xyz|shop|store|site|online|link|top|cn|hk|tw|uk|us|au|app)\b(?![.@-]?\w)`;
  const DOMAIN_OK = String.raw`(?<!(?:amazon|ikea|wayfair|costco|homedepot|hunterdouglas|levolor|graber|somfy|lutron|bali|silhouette|lowes|walmart|bestbuy|google|gmail|hotmail|outlook|yahoo|icloud|live|msn|qq|163|126|instagram|facebook|fb|youtube|tiktok|pinterest|houzz|etsy|kijiji|craigslist|whatsapp|wechat|apple|microsoft|canadiantire|structube|bouclair|homesense|rona|canada|gc|ontario)\.[a-z]{2,6})`;
  /* 同行引流（中文 / 粤语）：「我哋做窗簾平一半，搵我啦」「有冇布辦？搵我啦，平一半」「我們也做窗帘，便宜一半，找我」。
     三类信号：我们也做 X（SOL_WE_DO）、陈述句的「平一半 / 半价 / 比X便宜」（SOL_CHEAP_BIG）、「搵我啦 / 找我吧」（SOL_CONTACT）；
     「我哋平啲 / 我们更便宜」（SOL_WE_CHEAP）自己就是拉客。顾客的问句（可唔可以平一半？/ 我们做窗帘要多久？/ 给我们便宜点）不算：
     前面是情态 / 给 / 帮，或后面几字内是吗 / 呢 / ？ / 可唔可以 / 要 / 想 / 了，都放过。单独的「搵我啦」只算想私联（privateCh） */
  const SOL_Q = String.raw`(?![^，,。！!；;]{0,6}(?:吗|嗎|么|嘛|呢|\?|？|得唔得|可唔可以|可不可以|可以吗|可以不|行不行|行吗|好唔好|好不好|得吗|未))`;
  const SOL_NOTASK = String.raw`(?<!(?:可唔可以|可不可以|可以|能不能|能否|能|会不会|会唔会|有冇得|有没有得|有冇|有没有|有|可否|得唔得|是不是|系唔系|系咪|要不要|想要|想|要|使唔使|给|俾|畀|帮|算|再)\s*)`;
  const SOL_WE = String.raw`(?:我们家|我们|我哋|我地|本人|本店|我司|本公司|我公司|我店|我厂|我们店|我哋间铺|我哋铺头|我(?=(?:都|也|亦|仲|自己)(?:有得|有)?(?:做|整|卖|批发|供应|生产|代工|订做|定做|接单)))`;
  const SOL_WE_DO = String.raw`${SOL_WE}(?:都|也|亦|仲|专|专门|专业|自己)?(?:有得|有)?(?:做|整|卖|批发|供应|生产|代工|订做|定做|接单)(?![了过咗紧完好])(?![^，,。！!；;]{0,8}(?:吗|嗎|么|嘛|呢|\?|？|多久|几耐|几时|几钱|多少|要|想|可以|可唔可以|得唔得|能不能|了|咗|过))`;
  const SOL_CHEAP_BIG = String.raw`${SOL_NOTASK}(?:平一半|平(?:咗)?好多|一半价|半价|便宜一半|便宜好多|便宜很多|五折|对折|(?:平|便宜)过(?:佢哋|他们|佢|人哋|别人|别家|你们|你哋|呢间|这家|外面|市面|街外|门市)|比(?:佢哋|他们|佢|你们|你哋|呢间|这家|外面|市面|人哋|别人|别家|门市)(?:都|仲|还|更)?(?:平(?![时常日米方面板台安])|便宜))(?![的嘅])${SOL_Q}`;
  const SOL_CHEAP_ANY = String.raw`${SOL_NOTASK}(?:平一半|平(?:咗)?好多|一半价|半价|便宜一半|便宜好多|便宜很多|五折|对折|更便宜|更平|仲平|平啲|平d|平滴|便宜点|便宜啲|便宜些)(?![的嘅]|啦|吧|喇|嘛|啊|呀|点吧|点啦|一点吧)${SOL_Q}`;
  const SOL_CONTACT = String.raw`(?:揾|找|联系|联络|私信|私讯|私聊|私|pm|dm|inbox|call|whatsapp|加)(?:返)?我(?:哋|们|地)?(?:啦|吧|呀|啊|喇|啰|咯|喔|哦|la|lor)?(?=$|[\s，,。！!？?~…；;]|平|便宜|半价|更|仲|比|会|微信|wechat|weixin|wx|vx|v(?![a-z])|line|赖|whatsapp)`;
  const SOL_WE_CHEAP = String.raw`(?<![给俾畀帮同跟对为替])${SOL_WE}(?:的|嘅)?(?:价钱|价格|价|货|产品|嘢|东西)?(?:都|仲|还|更|会|一定|保证|绝对|比较|系|是)?(?:便宜(?:啲|d|滴|点|好多|很多|一半|过|得多)?|平(?:啲|d|滴|好多|一半|过|得多|咗|晒)|平(?=$|[，,。！!~…\\s]|㗎|架|喎|啊|呀))(?![的嘅啲d滴点好很一过得])(?!\s*(?:吧|啦|喇|嘛|呀|啊|好吗|好唔好|得唔得|行吗|行不行|可以吗|得吗))${SOL_Q}`;
  /* 同行引流（结构）：第一人称（我们 / 我哋 / 我家 / 本人 / 我这里）+ 做 / 卖 / 有 + 产品或价格 + 比较价（平过X / 比X便宜 / 一半 / 半价 / 五折 / 平三成 / 价钱系佢哋一半 / 工厂价）。
     整条留言里有问句（吗 / ？ / 能不能 / 可唔可以）就不算：那是顾客在砍价；中间提到买过 / 看到 / 朋友 / 别家 / 预算 / 想要，也是顾客在比价 */
  const SOL_ME = String.raw`(?:我们家|我们这里|我们这边|我们店|我们厂|我们|我哋屋企|我哋呢度|我哋呢边|我哋间铺|我哋铺头|我哋|我地|我家|我这里|我这边|我这儿|我呢度|我呢边|我间铺|我嘅铺|我的店|本人|本店|我司|本公司|我公司|我店|我厂)`;
  const SOL_CMP = String.raw`(?:(?:平|便宜)过(?:佢哋|佢地|他们|佢|人哋|人家|别人|别家|你们|你哋|呢间|呢家|这家|这间|呢度|这里|外面|市面|街外|门市)|比(?:佢哋|佢地|他们|佢|你们|你哋|呢间|呢家|这家|这间|呢度|这里|外面|市面|人哋|人家|别人|别家|门市)(?:都|仲|还|更|要)?(?:平(?![时常日米方面板台安])|便宜)|平(?:咗)?一半|便宜一半|一半价(?:钱|格)?|半价|价(?:钱|格)?减半|减半|[一二三四五六七八九\d](?:\.\d)?折|对折|(?:平|便宜)[一二三四五六七八九\d]成|(?:价钱|价格|价)(?:系|是|只有|只要|只系|得)?(?:佢哋|他们|佢|这家|呢间|这里|呢度)?(?:的|嘅)?一半|(?:只要|只收|只卖|只系|才)一半|厂价|工厂价|出厂价|批发价)`;
  const SOL_ASKMSG = String.raw`^(?![^]*(?:[?？]|吗|嗎|么|能不能|可不可以|可唔可以|得唔得|有冇得|有没有得|行不行|可以不|你们|你哋|你地|贵店|预算|给我|俾我|畀我))`;
  const SOL_GAP = String.raw`(?:(?!看到|见到|看见|睇到|朋友|别家|别处|别人|人哋|人家|网上|听说|问过|问了|问咗|报价给|买|购|入手|抢|淘|拿到|上次|之前|以前|去年|领|券|团购|活动|员工|会员|内部|预算|想|要|希望|附近|楼下|隔壁|那边|那家|外面)[^。！!？?\n]){0,12}?`;
  const SOL_ME_CMP = String.raw`${SOL_ASKMSG}[^]*?${SOL_ME}${SOL_GAP}${SOL_NOTASK}${SOL_CMP}(?![的嘅]|啦|吧|喇|嘛|啊|呀|点吧|点啦|一点吧|买|入|购|拿|抢|淘|到手|订)`;
  /* 同款 / 一样的，我这里便宜 */
  const SOL_SAME = String.raw`${SOL_ASKMSG}[^]*?(?:${SOL_ME}(?:同款|同样(?:的|嘅)?|一样(?:的|嘅)?|呢款|这款)[^，,。！!？?]{0,6}?|(?:同款|同样|一样)[^，,。！!？?]{0,8}?${SOL_ME}[^，,。！!？?]{0,4}?)(?:都|仲|还|更|会|就|只要)?(?:便宜|平(?![时常日米方面板台安]))(?!点|啲|些|的|嘅|啦|吧)`;
  /* 别买这家，找我 / 唔好帮衬呢间，搵我啦 */
  const SOL_CONTACT_ANY = String.raw`(?:揾|找|联系|联络|私信|私讯|私聊|私|pm|dm|inbox|call|whatsapp|加)(?:返)?我(?!老公|老婆|家人|爸|妈|朋友|同事|屋企人)`;
  const SOL_DISSUADE = String.raw`(?:别|不要|唔好|咪|莫|千万别|千万不要)(?:在|喺|再)?(?:买|帮衬|光顾|找|揾|落单|下单|订)(?:这家|这间|呢间|呢家|佢哋|他们|佢|呢度|这里|这个|这)[^]*?(?:${SOL_CONTACT_ANY}|${SOL_ME}|便宜|平(?![时常日米方面板台安]))`;
  /* 想平就搵我 / 私信我更便宜 / 搵我平啲 / 厂家直销，找我 / 这家贵，我家便宜 */
  const SOL_WANT_CHEAP = String.raw`(?:想|要)(?:平|便宜)(?:啲|d|点|些|的|嘅)?(?:话|嘅话|的话)?(?:就|可以|即管|尽管)?[,，\s]*${SOL_CONTACT_ANY}`;
  const SOL_CONTACT_CHEAP = String.raw`${SOL_ASKMSG}[^]*?${SOL_CONTACT_ANY}(?:啦|吧)?[,，\s]*(?:更|仲|会|就|会更|仲会|都|比较)?(?:便宜|平(?![时常日米方面板台安]))(?!点(?:吗|的|嘅)|啲(?:嘅|的)|的|嘅)`;
  const SOL_HERE_CHEAP = String.raw`${SOL_ASKMSG}[^]*?(?:我这里|我这边|我这儿|我呢度|我哋呢度|我呢边|我们这里|我们这边)(?:的|嘅)?(?:价钱|价格|价|货)?(?:都|仲|还|更|会|一定|绝对|比较)(?:便宜|平(?![时常日米方面板台安]))(?!点|啲|些|的|嘅|啦|吧)`;
  const SOL_FACTORY = String.raw`(?:厂家直销|厂价直销|工厂直销|工厂直供|厂家直供|厂直|厂家直营|工厂直营|源头工厂|源头厂家|厂价|工厂价|出厂价|批发价)`;
  const SOL_FACTORY_ANY = String.raw`${SOL_ASKMSG}[^]*?(?:${SOL_FACTORY}[^]*?(?:${SOL_CONTACT_ANY}|看我主页|睇我主页|我主页|${SOL_CMP})|(?:${SOL_CONTACT_ANY}|${SOL_CMP})[^]*?${SOL_FACTORY}|${SOL_ME}(?:是|系|都|有|开)?[^，,。]{0,6}?(?:厂|工厂)[^]*?${SOL_FACTORY})`;
  const SOL_CONTRAST = String.raw`${SOL_ASKMSG}[^]*?(?:这家|这间|呢间|呢家|呢度|这里|佢哋|他们|佢)(?:好|太|很|咁|真系|真是|都几)?贵[^]*?(?:${SOL_CONTACT_ANY}|${SOL_ME}(?:的|嘅)?[^，,。！!？?]{0,4}?(?:便宜|平(?![时常日米方面板台安])))`;
  /* 英文：we / I / our shop + do / make / sell + 比较价（cheaper / half the price / 40% less / beat their price），或比较价 + at my shop / our store、factory direct + DM me；
     问句（can I do it for half the price? / can we do it cheaper?）、买过 / 看到 / 想要、自己动手（myself）都是顾客 */
  const EN_CMP = String.raw`(?:cheaper|less\s+expensive|lower\s+prices?|better\s+prices?|half\s+(?:the\s+)?(?:price|cost)|half[- ]price|for\s+half|at\s+half|\d+\s*%\s*(?:less|cheaper|lower|off|below)|(?:a\s+)?(?:third|quarter)\s+(?:of\s+)?(?:the\s+)?(?:price|cost)|beat\s+(?:their|his|her|the|these|those|this\s+\w+|that\s+\w+|any|anyone'?s?|everyone'?s?|competitors?'?|your)\s+(?:price|prices|quote|quotes)|undercut\w*)`;
  const EN_NOQ = String.raw`(?![^.!\n]*\?)(?![^.!?\n]*\b(?:myself|ourselves|diy|on\s+my\s+own|on\s+our\s+own)\b)`;
  const EN_FIRST = String.raw`(?<!\b(?:can|could|would|will|should|may|might|do|did|does|if|how|what|why|when|whether|where|shall|chance|hoping|wondering|hope|wish|maybe|perhaps|possible|possibly)\s+)\b(?:we|i|my\s+(?:shop|store|company|factory|business|team|place|brand|showroom|guys)|our\s+(?:shop|store|company|factory|business|team|place|brand|showroom|prices?|quotes?|stuff|products?|blinds|shades|shutters|curtains|drapes|furniture|sofas|lights|lighting|floors|flooring|vanities|cabinets|rugs|carpets))\b`;
  const EN_GAP = String.raw`(?:(?!\b(?:need|needs|want|wants|prefer|like|wish|hope|looking|found|saw|seen|got|get|bought|paid|pay|paying|deposit|upfront|quoted|elsewhere|online|costco|ikea|amazon|wayfair|depot|another|other|myself|ourselves|diy)\b)[^.!?\n]){0,40}?`;
  const EN_PEER = [
    String.raw`${EN_FIRST}(?:\s+(?:also|too|can|could|will|'ll|just|even|literally|actually|really|easily|always))*\s+(?:(?:do|does|make|makes|sell|sells|carry|carries|offer|offers|install|installs|supply|supplies|manufacture|produce)\b${EN_GAP}|(?=beat\b))\b${EN_CMP}\b${EN_NOQ}`,
    String.raw`(?<!\b(?:can|could|would|will|should|may|might|do|did|does|if|how|what|why|when|whether|where|shall)\s+)\bwe\s+(?:also\s+)?(?:have|got)\s+(?:the\s+same|them|these|those|this|it)\b${EN_GAP}\b${EN_CMP}\b${EN_NOQ}`,
    String.raw`\b(?:we['’]re|we\s+are|i['’]m|i\s+am|(?:our|my)\s+(?:shop|store|company|factory|prices?|quotes?|stuff|products?|blinds|shades|shutters|curtains|drapes|furniture|sofas|lights|lighting|floors|flooring|vanities|cabinets|rugs|carpets)\s+(?:is|are))\s+(?:(?:way|much|a\s+lot|even|also|literally|probably|definitely|\d+\s*%)\s+)*(?:cheaper|less\s+expensive|half\s+(?:the\s+)?(?:price|cost)|lower\s+priced)\b${EN_NOQ}`,
    String.raw`\b${EN_CMP}\b[^.!?\n]{0,30}?\b(?:at|from|in|with|on)\s+(?:my|our)\s+(?:shop|store|place|factory|showroom|company|business|page|profile|website|site|ig|instagram)\b${EN_NOQ}`,
    String.raw`\b(?:factory[- ]direct|direct\s+from\s+(?:the|our|my)\s+factory|wholesale\s+prices?|factory\s+prices?)\b[^]*?(?:\b(?:dm|pm|inbox|message|msg|text|call|whatsapp|email|contact)\s+(?:me|us)\b|\bdm\b|\bcheck\s+(?:out\s+)?(?:my|our)\s+\w+|\b${EN_CMP}\b)${EN_NOQ}`,
    String.raw`\b(?:don'?t|do\s+not|never)\s+(?:buy|order|shop|purchase)\s+(?:here|from\s+(?:them|these\s+guys|this\s+(?:shop|store|place|guy|company)))\b[^]*?\b(?:i'?ll|i\s+can|i\s+will|we'?ll|we\s+can|dm\s+me|message\s+me|text\s+me|call\s+me|my\s+(?:shop|store|page|profile)|our\s+(?:shop|store|page|profile))\b`,
  ];
  const RX = {
    block: rx([
      String.raw`ignore (?:all|any|previous|the|your) (?:instructions|rules)`, "system prompt", String.raw`disregard (?:the|all)`, "jailbreak", "pretend you are",
      "忽略(?:之前|以上|所有)(?:的)?(?:指令|规则|要求)", "系统提示", "越狱",
      String.raw`\b${FUCK}(?:ing|in)?\s+(?:you|u|off|this|that|your|ur|yourselves|yourself|y'?all|them)\b`, String.raw`\bstfu\b`, String.raw`\bgtfo\b`,
      String.raw`^\W*${FUCK}(?:ing|in|er|ers)?\W*$`, String.raw`\bscrew\s+(?:you|u|this|your|y'?all)\b`, String.raw`\bpiss\s+off\b`, String.raw`\bgo\s+to\s+hell\b`, String.raw`\bgo\s+die\b`, String.raw`\bdrop\s+dead\b`,
      String.raw`\bkill\s+(?:yo)?ursel(?:f|ves)\b`, String.raw`\bkys\b`, String.raw`\beat\s+shit\b`, String.raw`\bpiece\s+of\s+(?:shit|crap|garbage|trash)\b`,
      String.raw`\bmotherf\w*`, String.raw`\bbitch(?:es)?\b`, String.raw`\bassholes?\b`, String.raw`\bcunts?\b`, String.raw`\bdickheads?\b`, String.raw`\bwankers?\b`,
      String.raw`(?:^|[,.!?;:]\s*)(?:you|u|ya)\s+(?:(?:fucking|stupid|bloody|little|absolute|complete|total|dumb)\s+)*${INSULT_N}\b`,
      String.raw`\b(?:you'?re|youre|ur|you\s+are|you\s+guys\s+are|you\s+people\s+are|y'?all\s+are)\s+(?:(?:all|such|so|a|an|bunch\s+of|fucking|total|complete|real|bloody)\s+)*${INSULT}\b`,
      String.raw`\b(?:your|ur|this|that)\s+(?:\w+\s+)?(?:shop|store|company|business|service|staff|team|page|bot|place|website|site|people|guys)\s+(?:is|are)\s+(?:(?:a|an|so|such|total|fucking|complete)\s+)*${INSULT}\b`,
      String.raw`\b(?:stupid|shitty|crappy|garbage|trash|useless|scammy|scam|fucking|dumb|idiot)\s+(?:shop|store|company|business|people|guys|bot|page|website|scammers?)\b`,
      String.raw`^\W*(?:you\s+)?${INSULT}\W*$`,
      "傻逼|傻b|煞笔|脑残|操你|草泥马|干你娘|姦你娘|靠北|靠杯|机掰|鸡掰|屌你|屌那|仆街|扑街|冚家铲|顶你个肺|食屎|躝开|你老母|丢那星|戆鸠|柒头|on9",
      "去死(?!角)", "你妈(?:的|逼|个)(?!(?:房|家|卧|屋|窗|客厅|厨房|阳台))",
      /* 「他妈的」：咒骂用法才拦；「给他妈的新房装百叶」是他的妈妈 */
      "(?:真|太|好|特|去你|操|草)他妈的?", String.raw`他妈的(?=$|[\s，,。！!？?…~]|什么|破|垃圾|烂|贵|慢|鬼|狗|傻|混|蛋|服务|店)`,
      "破店", "垃圾(?:店|玩意儿?|商家|铺头|老板|老细|店主|客服|师傅|员工|窗帘|沙发|产品|公司|服务|质量)", String.raw`(?:^|[\s，。！!？?])滚(?:开|蛋|吧|出去|$|[\s，。！!？?])`,
      /* 冲着人说的「滚」（老板滚）、台湾的「幹 / 北七 / 87」、粤语的「柒」（壹贰叁……柒佰 的柒是数字） */
      String.raw`(?:老板|老细|店主|客服|师傅|你|你们|你哋|你地)\s*滚(?:开|蛋|吧|出去)?(?=$|[\s，,。！!？?~…])`,
      String.raw`(?:^|[\s，,。！!？?…~])干(?=$|[\s，,。！!？?…~])`, "^干(?:你|妳|您|恁)", "干(?:你|妳|恁)(?:娘|妈|老师|老母)", "北七", String.raw`(?:是|很|好|超|真|有够|太|根本|就是)\s*87(?![\d万千百元块蚊刀kK%米寸尺号]|\s*\d)`,
      "(?:好|真|咁|超|劲|太|很|你|佢|老板|老细)\\s*柒(?![\\d佰仟万元圆块拾])", "柒(?:头|样|嘢|人|仔)",
      /* 同行引流：来我店看看 / 我们店也做 / 卖一半价 / visit my store / check my page / for half */
      "(?:来|嚟)我(?:们|哋|地)?(?:的|嘅)?(?:店|铺头?|门店|工厂|展厅|档口)(?:里|度)?(?:看看|睇睇|睇下|睇吓|逛逛|坐坐|了解|选|挑|买|更便宜|便宜)", "(?:我们|我哋|我地|我)(?:的|嘅)?(?:店|铺头?|门店|工厂|档口)(?:也|都|仲)(?:做|有|卖|装)",
      "(?:我们|我哋|我地|我)(?:的|嘅)?(?:店|铺头?|门店|工厂|档口)[^，,。？?！!]{0,8}(?:更便宜|平啲|平过|便宜一半|一半价|半价)", "卖(?:一)?半价", "关注我",
      `${SOL_WE_DO}[^]*?(?:${SOL_CHEAP_ANY}|${SOL_CONTACT})`, `(?:${SOL_CHEAP_ANY}|${SOL_CONTACT})[^]*?${SOL_WE_DO}`,
      `${SOL_CHEAP_BIG}[^]*?${SOL_CONTACT}`, `${SOL_CONTACT}[^]*?${SOL_CHEAP_BIG}`, SOL_WE_CHEAP,
      `${SOL_WE_DO}[^]*?${SOL_CMP}`, SOL_ME_CMP, SOL_SAME, SOL_HERE_CHEAP, SOL_DISSUADE, SOL_WANT_CHEAP, SOL_CONTACT_CHEAP, SOL_FACTORY_ANY, SOL_CONTRAST, ...EN_PEER,
      /* We do curtains for half the price / I make them at half price：同行报半价（Can I do it for half the price? 是顾客在问，不算） */
      String.raw`(?<!\b(?:can|could|would|should|do|did|if|may|might|will|shall|when|how|where|what|why|whether|chance|hoping|wondering|hope|wish|maybe|perhaps|possible|possibly)\s+)\b(?:we|i)\s+(?:also\s+|can\s+|could\s+|will\s+|'ll\s+|'d\s+)?(?:do|make|sell|install|supply|offer|carry)\b[^.!?]{0,40}?\b(?:for|at)\s+half\s+(?:the\s+)?(?:price|cost)\b(?![^.!\n]*\?)`,
      String.raw`\b(?:visit|check\s+out|check|come\s+to|go\s+to|follow|see|try)\s+(?:my|our)\s+(?:store|shop|website|site|showroom|business|channel|company)\b`,
      /* 「check my profile for photos of my windows」是客户给店主看照片；带 too / for better / instead 才是拉客 */
      String.raw`\b(?:check\s+out|check|follow|visit|see)\s+(?:my|our)\s+(?:page|profile|ig|insta(?:gram)?|account|tiktok|fb|facebook|bio|link)\s+(?:too|also|as\s+well|instead|for\s+(?:a\s+)?(?:better|cheaper|lower|more|great))\b`,
      String.raw`\b(?:our|my)\s+(?:shop|store|factory|showroom)\s+(?:also\s+)?(?:sells?|offers?|carries|makes?|installs?|is\s+cheaper)\b`,
      String.raw`\b(?:we|i)\s+(?:also|too)\s+(?:sell|do|install|make|carry|offer|supply)\s+(?:the\s+same|blinds|shades|shutters|curtains|drapes|furniture|sofas|lighting|lights|flooring|floors|vanities|cabinets|it|them)\b(?=[^]*\b(?:visit|check|cheaper|cheap|half|less|better|store|shop|page|dm|website|site)\b)`,
      String.raw`(?<!\b(?:can|could|would|will|should|may|might|do|did|does|if|how|what|why|when|whether|shall)\s+)\b(?:we|i|my\s+\w+|our\s+\w+|they)\s+(?:[\w'’]+\s+){0,4}?for\s+half\b(?!\s+(?:of|my|the|our|a|an|those|these|them|it)\b)`, String.raw`(?<!\b(?:can|could|would|will|should|may|might|do|did|does|if|how|what|why|when|whether|shall)\s+(?:i|we|you|u|ya|y'?all|they|someone|somebody)(?:\s+guys)?\s+)\b(?:sells?|do|does|installs?)\s+(?:it|them|the\s+same(?:\s+\w+)?)\s+for\s+(?:half|less|cheaper)\b`,
      String.raw`\b(?:google|search|look\s+up)\s+[\w\s]{2,40}?\bfor\s+(?:a\s+)?(?:better|cheaper|lower)\s+(?:price|deal)s?\b`,
      "你(?:们|哋|地)?(?:是|系|真是?|真系|就是)?(?:这些|呢班|呢啲|班|群|一群|一班|个|一个|只)?(?:死|大|臭)?(?:白痴|白癡|智障|废物|蠢货|蠢材|弱智|混蛋|王八蛋|神经病|痴线|黐线|骗子)",
      /* 骗子（死骗子 / 骗子公司）、骂人话放在句首再接「你」（痴線㗎你）、收皮 */
      "(?:死|大|臭|这些|呢班|一群|一班)骗子", "骗子(?:公司|店|商家|铺头|团伙|嚟㗎|来的)", "(?:白痴|智障|弱智|脑残|神经病|痴线|黐线)(?:㗎|嘅|啊|呀|咩|吗|喎)?\\s*(?:你|你哋|你们)", "收皮",
      /* 刷单 / 兼职 / 投资 / 代运营 / 卖线索之类的广告 */
      String.raw`\b(?:earn|make)\s+(?:up\s+to\s+)?\$\s?\d[\d,]*(?:\s*k)?\s*(?:\/|per|a|each|every)\s*(?:day|week|wk|month|hour|hr)\b`, String.raw`\b(?:invest\w*|trad(?:e|ing))\s+(?:in\s+)?(?:bitcoin|btc|crypto\w*|forex|ethereum|eth|usdt|nfts?)\b`,
      String.raw`\b\d+\s*%\s*(?:profit|returns?|roi)\b`, String.raw`\b(?:get|generate|bring|send)\s+(?:you|u)\s+(?:\d+\+?\s+)?(?:more\s+)?(?:leads|clients|customers|sales|traffic)\b`, String.raw`\b\d+\+?\s+(?:leads|clients)\s+(?:a|per|each|every)\s+(?:day|week|month)\b`,
      String.raw`\bseo\s+(?:services?|experts?|agency)\b`, String.raw`\brank\s+your\s+(?:site|website|business|page)\b`, String.raw`\bmarketing\s+agency\b`, "代运营", String.raw`(?:包|帮你|助你|保证)上热门`, "上热门推广", "刷流量", "刷播放", "引流服务", "代发广告", "兼职日结", "日赚", "躺赚",
      String.raw`(?<!\byour\s+(?:website|web\s*site|site|url|domain|page)\s+(?:is\s+|=\s*|:\s*)?)` + DOMAIN_SRC + DOMAIN_OK,
      /* 外链与引流：带或不带 http/www 的链接、短链、买粉 */
      String.raw`https?:\/\/`, String.raw`www\.`, String.raw`\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|ca|co|io|ly|me|info|biz|xyz|shop|store|site|online|link|top|cn|hk|tw|uk|us|au|app)\/\S*`,
      String.raw`\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|cutt\.ly|rb\.gy|t\.me|wa\.me)\b`,
      String.raw`\b\d+\s*k?\s+(?:followers|likes|subscribers)\b`, String.raw`\b(?:cheap|buy|get|gain|grow|boost|real|instant|free|more|organic|targeted|guaranteed|thousands\s+of|tons\s+of)\s+(?:\w+\s+)?(?:followers|likes|subscribers|views)\b`,
      String.raw`\b(?:want|need)\s+(?:\w+\s+)?(?:followers|subscribers)\b`, String.raw`\b(?:grow|boost|promote)\s+(?:your|ur)\s+(?:page|account|instagram|ig|followers|audience|channel)\b`, String.raw`\b(?:f4f|sub4sub|follow4follow|follow\s+back)\b`,
      /* l4l 只认标签 / 和 f4f、follow 连写的用法：L4L 8B2 是 Vaughan 的邮编 */
      String.raw`#l4l\b`, String.raw`\bl4l\b(?=\s*(?:[#,/&+]\s*)?(?:and\s+)?(?:f4f|follow|like|sub))`, String.raw`\b(?:f4f|follow\w*|like\w*)\s*(?:[#,/&+]\s*)?(?:and\s+)?l4l\b`,
      "涨粉|刷粉|买粉|刷单|刷赞|互粉|互关|互赞|加粉",
      /* 冲着店的脏话（sh*t service 归一化后是 shit service） */
      String.raw`\b(?:shit|shitty|crap|crappy|fucking|fuckin|fking|bullshit)\s+(?:service|customer\s+service|staff|team|support|products?|quality|work|job|shop|store|company|business|people|guys|bot)\b`,
      /* 骗子 / 骗人 / 呃人：指着店说才拦；「小心骗子」「是不是骗人的」是提醒或提问，交给店主 */
      "^(?:大|死|臭)?(?:骗子|骗人|骗钱|呃人|呃钱)(?:啊|呀|吧|嚟㗎|嚟|来的|㗎)?[\\s!！。.~…]*$",
      "(?<!冒充|假冒|冒认|假扮|扮|说|讲|话|以为|怕|担心|担心会|唔系|不是|冇|没有|唔好|不要)(?:你们?|你哋|你地|佢哋|这家|这间|呢间|呢家|此店|贵店|这店|这个店|你们店|你哋间铺)(?:都|就|真|全|根本|就系|就是)?(?:是|系|真是|真系)?(?:一群|一班|班|群|个|啲)?(?:骗子|骗人|骗钱|呃人|呃钱)",
      "(?:骗人|骗钱|呃人|呃钱)(?:的|嘅)?(?:店|公司|商家|铺头|平台|东西|玩意)", "专门(?:骗|呃)(?:人|钱|客)",
      "^(?:大|死|臭)?(?:骗人|骗钱|呃人|呃钱)(?:的|嘅)(?:吧|啊|呀|咯|嚟㗎|㗎)?[\\s!！。.~…]*$", "(?:你们?|你哋|你地|佢哋)(?:系咪|系唔系|是不是)(?:骗人|骗钱|呃人|呃钱)(?:嘅)?㗎",
      /* 粤语 / 网络骂人话：冚家铲（含家铲）、痴线（单独成句或冲着店）、屌、傻X、SB */
      "冚家铲|冚家剷|含家铲|咸家铲|冚家拎", "^(?:痴线|黐线|神经病|白痴|傻逼|傻b|sb)(?:㗎|嘅|啊|呀|咩|吗|嚟|喎)?[\\s!！。.~…]*$", "(?:痴线|黐线)(?:嘅|的)?(?:店|公司|铺头|商家|嘢|人|老板)",
      "(?<![好很超太几])屌(?!爆)", "傻[xX×叉屄]", String.raw`(?:^|[^a-z])sb(?:店|公司|商家|客服|老板|东西|嘢)`, String.raw`你(?:们|哋|地)?(?:是|系|真|真是|真系|个|好|就系|就是)?\s*sb(?![a-z])`, String.raw`(?:真|太|好|超)\s*sb(?![a-z])`,
      /* 兼职 / 副业 / 招代理 / 月入过万 / 炒币理财 / 代运营 / SEO / 卖线索 / 推广 */
      "(?:招|聘|诚招|急招|招募)兼职", "兼职(?:日结|刷单|打字|赚钱|轻松|月入|日入|日赚|时薪|招聘|招人|可做|宝妈|学生|在家|手机|私聊|加我|联系|项目|看这里)", "^兼职",
      "副业(?:赚钱|月入|推荐|项目|招人|加盟|日结|轻松|收入|私聊)", "(?:招|做|带你做|推荐|找)副业", "^副业",
      String.raw`\bpart[- ]?time\s+(?:jobs?|work|income)\b`, String.raw`\bearn\s+(?:money|cash|income)\s+(?:daily|fast|online|from\s+home|weekly|every\s+day)\b`, String.raw`\bmanage\s+(?:your|ur)\s+(?:social\s+media|instagram|ig|facebook|tiktok|accounts?|page)\b`,
      String.raw`\bcrypto\s+(?:signals?|groups?|trading|investments?|profits?)\b`, String.raw`\bsignals?\s+groups?\b`, String.raw`\b(?:instagram|ig|facebook|fb|tiktok|social\s+media)\s+growth\b`, String.raw`\bgrowth\s+services?\b`, String.raw`\bwe\s+(?:build|design|make|create)\s+(?:\w+\s+)?websites?\b`,
      /* 「招代理」是刷屏广告；「你们招代理吗」是经销商在问，交给店主 */
      "诚招代理|(?<!你们?|你哋|贵店|贵司|你们公司)招代理(?!吗|嗎|不|么|嘛|呢|唔)|招募代理|代理加盟|招商加盟|全国招商|诚邀加盟",
      "月入(?:过|上)?[\\d一二三四五六七八九十几]+万|月入过万|日入[\\d一二三四五六七八九十几百千]+|月赚|周赚|轻松赚|在家赚",
      /* USDT：理财 / 投资广告才拦；「Can I pay with USDT?」「收唔收USDT」是付款方式，交给店主 */
      String.raw`(?<!\b(?:pay|paying|paid|accept|accepts|accepted|take|takes|use|using)\s+(?:with\s+|in\s+|by\s+|via\s+)?|(?:用|收|收不收|收唔收|接受|接唔接受|可以用|能用)\s*)\busdt\b(?!\s*(?:支付|付款|付钱|结账|买单|payments?\b|付\b))`, "炒币|币圈|稳赚|理财(?:产品|项目|平台|群|老师|高收益|赚)|带单|高回报|保本高息|投资(?:群|平台|项目|老师|回报)",
      "账号代运营|运营托管|推广服务|帮你推广|(?:增加|提高|提升)曝光|涨流量",
      String.raw`\bseo\b`, String.raw`\bgoogle\s+(?:page\s*(?:1|one)|first\s+page|ranking|rankings)\b`, String.raw`\b(?:first|1st|top)\s+page\s+(?:of|on)\s+google\b`, String.raw`\bpage\s+(?:1|one)\s+(?:of|on)\s+google\b`, String.raw`\brank\s+(?:#\s?1|first|higher|on\s+google)\b`,
      String.raw`\b(?:buy|sell|selling|purchase)\s+(?:\w+\s+)?(?:leads|lists|email\s+lists?|contact\s+lists?|databases?)\b`, String.raw`\blead\s+generation\b`, String.raw`\bbacklinks?\b`, String.raw`\bdigital\s+marketing\b`, String.raw`\bsocial\s+media\s+(?:marketing|management|growth)\b`,
      String.raw`(?<!\b(?:your|ur)\s)\bfollowers\b`, String.raw`\bpromot\w*\s+(?:your|ur)\s+(?:business|shop|store|brand|company|page|products?|services?)\b`,
    ]),
    privateCh: rx([
      String.raw`加我?\s?(?:个)?\s?微信`, "我的微信", "微信", "wechat", "weixin", String.raw`\bwx\b`, "wxid", String.raw`\bvx\b`, String.raw`加\s?v(?![a-z])`, "v我", "whatsapp",
      /* 拆开 / 谐音的微信（微 信、薇信、威信、V信、wei xin） */
      String.raw`[微薇威徽胃][\s　]*信(?!息|用|心|任|号码)`, String.raw`(?<![a-z])v[\s　]*信`, String.raw`\bwei\s*xin\b`,
      String.raw`来电(?!显示)`,
      String.raw`(?<!\b(?:your|ur|their|his|her)\s+)\b(?:ig|insta|instagram|wechat|telegram|snap(?:chat)?|tiktok|kakao|skype)(?:\s+(?:id|handle|username|account))?\s*(?:\bis\b|[:=：])\s*@?(?!(?:great|good|nice|awesome|amazing|beautiful|cool|lovely|so|very|really|super|down|not|private|public)\b)[A-Za-z][\w.]{2,}`,
      /* 拆开写的邮箱：lucas @ gmail . com */
      String.raw`[\w.+-]+\s*@\s*[\w-]+\s*\.\s*(?:com|ca|net|org|cn|hk|tw|co|io|me|uk|au)\b`, String.raw`[\w.+-]+\s*(?:\(at\)|\[at\]|\s+at\s+)\s*[\w-]+\s*(?:\(dot\)|\[dot\]|\s+dot\s+)\s*(?:com|ca|net|org|cn|hk|tw|co|io|me|uk|au)\b`,
      String.raw`\bline\s*(?:id|号|上|我|联络|联系)`, String.raw`加\s*(?:我\s*)?line\b`, "加赖",
      String.raw`\b(?:text|call|dm|pm|message|msg|inbox|email|e-mail|ring|contact|facetime)\s+me\b`, String.raw`\breach\s+(?:me|out\s+to\s+me)\b`, String.raw`\bget\s+in\s+touch\s+with\s+me\b`,
      String.raw`\bgive\s+(?:me|us)\s+a\s+(?:call|ring|text|shout)\b`, String.raw`\b(?:send|shoot)\s+(?:me|us)\s+(?:a\s+|an\s+)?(?:dm|pm|message|text|email|e-mail|msg)\b`,
      String.raw`\bcall\s+or\s+text\b`, String.raw`\btext\s+or\s+call\b`, String.raw`\bfacetime\b`, String.raw`\bvideo\s+call\b`, String.raw`\bzoom\s+call\b`,
      String.raw`\byour\s+(?:phone\s+|cell\s+|mobile\s+|contact\s+|whatsapp\s+|wechat\s+)?(?:number|email)\b`, String.raw`\bphone\s+number\b`,
      /* 「my phone / my cell」只在联系语境里算私联：call / text / reach me on my phone、my cell is…；「control the lights from my phone」是智能控制 */
      String.raw`\bmy\s+(?:number|email|e-mail|whatsapp|wechat|(?:cell|phone|mobile)\s+(?:number|#|no\.?))\b`, String.raw`\bmy\s+(?:cell|phone|mobile)\s*(?:is\b|[:：#])`, String.raw`\b(?:here'?s|here\s+is)\s+my\s+(?:cell|phone|mobile)\b`,
      String.raw`\b(?:call|text|ring|reach|contact|message|msg|whatsapp|sms|dm|phone)\s+(?:me\s+|us\s+)?(?:on|at|via|through|thru)\s+(?:my\s+)?(?:cell|phone|mobile|number)\b`,
      String.raw`\b(?:can|could|may|should|shall)\s+(?:i|we)\s+(?:call|text|phone|ring|email|e-mail|message|dm|pm|contact|reach)\s+(?:you|u)\b`, String.raw`\b(?:on|over)\s+the\s+phone\b`, String.raw`\bphone\s+call\b`,
      /* 「搵我啦 / 找我吧 / 联系我」：想店主直接找他，算私联（同行引流的组合在 block 里拦） */
      SOL_CONTACT, "私聊", "私信", "私讯", "私下(?:联系|聊|倾)", "电话联系", "(?:打|给我|留|俾|畀)(?:我)?(?:个)?电话", "留(?:低|下)电话", "打(?:俾|畀|给|比)我", String.raw`call\s*我`, String.raw`pm\s*我`, String.raw`inbox\s*我`,
      "电话(?:号码|多少)", "手机号", String.raw`我(?:的|嘅)?(?:电话|手机)(?:号码?|系|是)?\s*[:：]?\s*[\d+(]`, String.raw`我(?:的|嘅)?\s*(?:email|e-mail|邮箱|电邮|whatsapp|ig|line)`, String.raw`[\w.+-]+@[\w-]+\.[a-z]{2,}`, String.raw`(?:电话|手机|\btel\b|\bphone\b|\bcell\b)\s*[:：]?\s*[\d+(]`,
    ]),
    price: rx([
      /* how much fabric / time / space：问的是用量或长度，不是价格 */
      String.raw`how much(?!\s+(?:fabric|material|yardage|space|room|light|time|longer|wider|bigger|smaller|weight|sun|sunlight|noise|wood|flooring|tile|paint|paper|gap|clearance|overlap|of\s+(?:a|an|the)\s+(?:gap|difference|overlap)|lead\s+time|(?:does|do)\s+(?:it|they|the\s+\w+)\s+weigh|can\s+(?:it|they|the\s+\w+)\s+(?:hold|take|handle|support))\b)`, "price", "pricing", String.raw`\bcosts?\b`, "quote", "quotation", "estimate", "budget", "ballpark", String.raw`\$`, String.raw`\bcad\b`, String.raw`\busd\b`, String.raw`\bhkd\b`, String.raw`\brmb\b`,
      "cheap", "expensive", "discount", String.raw`\bdeals?\b`, "promo", "coupon", "lowest", String.raw`\bsale\b`, String.raw`\bbogo\b`, String.raw`buy one,?\s*get one`, String.raw`\b\d+\s*%\s*off\b`, String.raw`\bpercent off\b`, String.raw`\bhalf off\b`, String.raw`\bmoney off\b`,
      String.raw`\b(?:anything|something|any|a\s+(?:little|bit)|bucks?|dollars?)\s+off\b(?![\s-]*white)`, String.raw`\boff\s+(?:the\s+|your\s+)?(?:price|total|bill|invoice|quote|retail|msrp|list\s+price|regular\s+price)\b`, String.raw`\bknock\s+(?:\w+\s+){0,2}off\b`,
      String.raw`(?<![-\w])free\b`, "for free", "no charge", "at no cost", "complimentary", String.raw`\bincluded\b`, String.raw`\binclude[sd]?\s+(?:the\s+)?(?:install|installation|delivery|measure|measuring|setup|shipping|removal|haul)`,
      String.raw`(?<!\b(?:in|to|battery|batteries|full|one|single|per|each|fast|quick)\s)\bcharg(?:e|es|ed)\b(?!\s+(?:the\s+|my\s+|your\s+)?(?:battery|batteries|motor|motors|it\b|them\b|up\b|via\b|with\b|by\b|using\b|through\b|from\b|overnight\b|fully\b|quickly\b|fast\b|wirelessly\b))`, String.raw`\bfees?\b`,
      String.raw`\bextra(?=\s*[?？.!！]|\s*$|\s+(?:charge|cost|fee|money|for|\$))`, String.raw`\b(?:cost|costs|charge|pay)\s+extra\b`, String.raw`\brates?\b`, String.raw`\bper\s+(?:sq\b|sq\.|square\s+(?:foot|feet|met(?:re|er)s?)|sf\b|sqft)`,
      String.raw`\bdeposit`, String.raw`\bpay(?:ment|ing)?\b`, "financing", String.raw`\btax(?:es)?\b`,
      /* 付款方式、分期、谁出钱 / 含不含（on the house / on you guys / comes with it / part of the purchase） */
      String.raw`\binstal{1,2}ments?\b`, String.raw`\bcredit\s*cards?\b`, String.raw`\bdebit\b`, String.raw`\bvisa\b`, String.raw`\bmastercard\b`, String.raw`\bamex\b`, String.raw`\bpaypal\b`, String.raw`\be-?transfers?\b`, String.raw`\binterac\b`, String.raw`\bcash\b`,
      String.raw`\bmoney\b`, String.raw`\bdollars?\b`, String.raw`\bbucks\b`, String.raw`\bgratis\b`, String.raw`\bowe\b`, String.raw`\bbill(?:ed|ing)?\s+(?:me|us|for)\b`, String.raw`\binvoic\w*`, String.raw`\bno[- ]?obligation\b`, String.raw`\bobligation\b`,
      String.raw`\btip(?:s|ping)?\s+(?:the|your|an?|our)\s+(?:\w+\s+)?(?:installers?|drivers?|guys?|crew|delivery|technicians?|movers?)\b`, String.raw`\bon\s+the\s+house\b`,
      String.raw`\b(?:is|are|it'?s|that'?s)\s+(?:the\s+|that\s+|this\s+)?(?:[\w-]+\s+){0,3}on\s+(?:you|u|ya)(?:\s+guys)?\b`,
      String.raw`\b(?:does|do|is|are|will|would)\s+(?:the\s+)?(?:delivery|install\w*|setup|set[- ]up|assembly|removal|haul[- ]?away|shipping|measur\w*|consult\w*|visit|swatch(?:es)?|samples?)\s+(?:come|comes|included|part)\b`,
      String.raw`\b(?:come|comes|coming)\s+with\s+(?:it|that|this|the\s+(?:purchase|order|price|job|deal|package)|(?:free\s+)?(?:install\w*|delivery|setup|set-?up|assembly|removal|haul[- ]?away|shipping|measur\w*))\b`, String.raw`\bpart\s+of\s+(?:the|my|your|our)\s+(?:purchase|order|price|job|deal|package|service|install\w*|quote|bill)\b`,
      String.raw`\bwhat'?s\s+included\b`, String.raw`\b(?:does|do|will)\s+(?:that|it|this|they|the\s+price|the\s+quote)\s+include\b`,
      "多少钱", "多少元", String.raw`多少块(?=钱|一|每|$|[\s？?。，,！!])`, "价格", "分期", "刷卡", "信用卡", "现金", "转账", "报价", "报(?:个|下|一下)价", "价位", "价目", "费用", "价钱", "怎么卖", "一平(?!方|米)", "每平", "收费", String.raw`几块(?=钱|一|每|$|[\s？?。，,！!])`, "啥价", "咩价", "乜价", "什么价", "预算", "优惠",
      "打.{0,2}折", "几折", "折扣", "折头", "有(?:冇|没有?|无)折", "减价", "特价", "便宜", "最低(?=价|多少|几多|几钱|能给|可以给|折|报|收)", "(?:太|好|很|有点)贵", "贵不贵", "贵唔贵", "贵吗", "免费",
      /* 「包X」问的是含不含、免不免费 */
      "包(?:上门|量尺|量|测量|测|安装|送|运|拆|邮|清运|搬|上楼|配送|物流|维修|埋)", "包不包", "包唔包", "一条龙", "含不含", "连唔连", "定唔连", "连埋",
      /* 「要多少时间 / 多少天 / 多少布 / 多少块地板」是工期、用量，不是价格 */
      String.raw`要多少(?!\s*(?:时间|天|日|周|星期|礼拜|个?月|年|小时|钟|分钟|个?工作日|布|面料|米|码|尺|块|片|扇|卷|平|方|张|条|个|件|套|根|盒|箱|久|人))`, "运费", "安装费", "人工费", "(?:上门|量尺|测量|送货|服务|设计|咨询|拆旧|清运|人工|材料|加急|快递|物流|配送|搬运|上楼|出车|路|远程)费", "费(?:多少|几多|怎么算|点计|贵|吗|呢)",
      /* 钱、费（浪费 / 消费 / 费心不是价格；钱塘、钱江是地名）、免运 */
      "(?<!值)钱(?!塘|江|庄|湾)", "(?<![浪消花经])费(?![心劲事时神力解])", "免运", "免邮",
      "加钱", "另收", "另外收", "额外收", "另计", "另外计", "另外算", "另算", "计钱", "点计", "算钱", "要钱", "收钱", "俾钱", "畀钱", "要不要钱", "收不收钱", "不收钱", "要唔要钱", "收唔收钱", String.raw`使唔使\s*(?:钱|俾|畀|收|charge)`,
      "定金", "订金", "付款", "支付", "几多钱", "点卖", "平啲", String.raw`平d\b`, "可唔可以平", "几钱", "几蚊", "几多蚊", "几银", "几旧水",
      String.raw`[一每](?:米|平|平方|方|码|呎|尺|才|只|个|件|套|扇)\s*(?:几多|多少)`,
      /* 句尾「几多」：问价；「尺寸係幾多 / 闊度幾多」问的是尺寸 */
      String.raw`(?<!(?:尺寸|尺码|阔度|宽度|长度|高度|深度|厚度|大小|面积|重量|呎数|尺数|数量|件数|个数|扇数|米数|度数)(?:系|是|有|大概|大约|约|会)?\s*)几多(?=\s*[？?。！!]*$)`,
    ]),
    time: rx([
      "how soon", String.raw`\bwhat\s+time\b`, String.raw`how\s+(?:fast|quickly)\s+(?:can|could|will|would|do|does|is\s+(?:the\s+)?(?:install|installation|delivery|turnaround))\b`,
      /* how long is the cord / are the curtains：问长度，不是工期 */
      String.raw`how long(?!\s+(?:is|are)\s+(?:the|it|this|that|these|those|your|my|a|an)\b(?!\s+(?:wait|waiting|lead|install|installation|delivery|process|turnaround|backlog|queue|production)))`,
      String.raw`\bwhen (?:can|could|will|would|do|is|are)\b`, "lead time", String.raw`turn[- ]?around`, String.raw`\beta\b`, String.raw`same[- ]day`, "install date", "delivery date", String.raw`move[- ]in`,
      String.raw`\b(?:this|next)\s+(?:week|wk|weekend|month|mo|year|mon|tue|wed|thu|fri|sat|sun)\w*(?!['’]s)`,
      String.raw`\b(?:in|by|before|during|until|till|early|late|mid|end of)[-\s]+(?:january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b`, String.raw`\bend of (?:the )?(?:week|month|year|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*`,
      String.raw`\btomorrow\b`, String.raw`\basap\b`, String.raw`\bweekends?\b`,
      String.raw`\bin (?:a|one|two|three|four|five|six|a few|few|a couple of|\d+) (?:days?|weeks?|months?)`, String.raw`\bwithin (?:a |one |two |\d+ )?(?:days?|weeks?|months?)`,
      String.raw`\b(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b`, String.raw`finish(?:ed)? (?:by|before)`, "be finished", String.raw`\bready (?:by|before|in time)`,
      String.raw`\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b`, String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b`,
      String.raw`\b(?:on|by|before|until|till|after|for)\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b(?!\s*(?:floor|fl\b|storey|story|level|window|room|unit|row))`,
      /* 节日：Christmas lights / Halloween decor 是产品，不是日期 */
      String.raw`\b(?:christmas|xmas|thanksgiving|easter|halloween|boxing day|canada day|victoria day|labou?r day|family day|remembrance day|good friday|civic holiday|new year'?s?|lunar new year|diwali|memorial day)\b(?!\s*(?:lights?|lighting|trees?|decor\w*|garlands?|ornaments?|wreaths?|themed?|colou?rs?|patterns?|prints?|fabrics?|curtains?|sales?|specials?|promos?|deals?|collection|edition|gifts?))`,
      /* are you free / free唔free = 有没有空 */
      String.raw`\b(?:are|r)\s+(?:you|u|ya)(?:\s+guys)?\s+free\b`, "free唔free",
      "多久", String.raw`多少(?:个)?(?:天|日|工作日|时间|小时|周|星期|礼拜|月)`, String.raw`几多(?:个)?(?:日|天|工作日|星期|礼拜|月|耐)`, String.raw`\bhow\s+much\s+(?:time|longer)\b`, String.raw`\bhow\s+many\s+(?:days|weeks|months|business\s+days)\b`, "什么时候", "啥时候", "何时", "什么时间", "哪个时间", "工期", "几天", "下周", "这周", "本周", "明天", "后天", "尽快", "多长时间", "周末", "周[一二三四五六日天]", "星期", "礼拜", "几号", "哪天",
      "月底", "月初", "月中", "中旬", "上旬", "下旬", "月尾", "年底", "年前", "年后", "年内", "出年", "明年", "来得及", "到货", "发货", "货期", "几时", "几耐", "边日", "边一日", "过年", "春节", "国庆", "圣诞", "元旦", "中秋", "端午", "感恩节", "复活节",
      "(?:十一|五一|双十一)(?:前|之前|以前|后|之后|期间|假期|长假|能|可以|左右)", "下个?月", "这个?月", "本月", "今个月", "这两天", "过两天", "这几天", "这几日", "呢几日", "呢两日", "过几日", "听日", "听朝", "后日", "几日", "几快", "多快",
      "有空(?!间|位|调|隙|白|格)", "有没有空(?!间|位|调|隙|白|格)", "有冇空", "得闲", "得唔得闲",
      String.raw`[一二两三四五六七八九十\d]+(?:个)?(?:天|周|星期|礼拜|月|日)(?:内|之内|以内|后|之后|以后)`, String.raw`\d{1,2}\s*月\s*\d{1,2}\s*[日号]?`,
      String.raw`\d{1,2}\s*月(?=份|前|之前|以前|中|底|初|尾|能|可以|左右|上门|装|送|到|$|[，,。？?！!])`, "[一二三四五六七八九十]{1,2}月(?:[一二三四五六七八九十]{1,3}[日号])?(?=份|前|之前|以前|中|底|初|尾|能|可以|左右|上门|装|送|到|$|[，,。？?！!])",
      String.raw`(?<![\d楼栋座室层])\d{1,2}\s*[号日](?=\s*(?:能|可以|可唔可以|前|之前|以前|左右|上门|来|嚟|装|送|到|吗|呢|得|行|ok|$|[，,。？?！!]))`,
      "(?:马上|现在|而家|宜家|即刻|即时|立刻|立即)(?:就)?(?:能|可以|可唔可以|有冇得)?(?:过来|来|嚟|上门|装|安装|送|量|到|发货)",
      /* 截止（before the wedding / before winter / before my reno starts）、加急、当天、工期（a one day job / in a day）、时段（at night / 7am / after 9pm）、日期写法（11/3、2025-11-03、Nov third） */
      String.raw`\bbefore\s+(?:the|my|our|his|her|their|we|i|you|it|school|winter|summer|spring|fall|autumn|christmas|xmas|thanksgiving|easter|halloween|new\s+year|holidays|closing|guests)\b`,
      String.raw`\bright\s+(?:away|now)\b`, String.raw`\bimmediately\b`, String.raw`\bstraight\s+away\b`, String.raw`\bfirst\s+thing\b`, String.raw`\b(?:rush|rushed|urgent\w*|expedit\w*)\b`, String.raw`\bexpress\s+(?:delivery|shipping|install\w*|service)\b`,
      String.raw`\b(?:one|1|a|single|half|two|2)[- ]day\b(?!\s+(?:old|sale|sales))`, String.raw`\bin\s+(?:a|one|half\s+a)\s+day\b`, String.raw`\bat\s+night\b`, String.raw`\bovernight\b`, String.raw`\blate\s+(?:at\s+)?night\b`,
      String.raw`\bafter\s+(?:hours|work|dark|dinner|school|\d)`, String.raw`\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)(?![a-z])`, String.raw`\b\d{1,2}\s+at\s+night\b`,
      String.raw`\bwhile\s+(?:i'?m|we'?re|i\s+am|we\s+are|i'?ll\s+be|we'?ll\s+be|nobody'?s?|no\s+one'?s?)\b`, String.raw`\b(?:on|during|over)\s+(?:a\s+|the\s+)?(?:holidays?|stat(?:utory)?\s+holidays?|long\s+weekend)\b`,
      String.raw`\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b(?!\s*(?:"|''|in\b|inch|inches|ft|feet|cm|mm))`, String.raw`\b\d{4}-\d{1,2}-\d{1,2}\b`,
      String.raw`\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty[- ]\w+|thirtieth|thirty[- ]first)\b`,
      "加急", "急单", "特急", "赶工", "赶得上", "赶不上", "赶得切", "赶唔赶得切", "赶唔切", "来不来得及", "(?:马上|立刻|即刻|立即)(?:就)?(?:可以|能|得|行|ok|做|开始)",
      "[一二三四五六七八九十]{1,3}\\s*[号日](?=\\s*(?:能|可以|可唔可以|前|之前|以前|左右|上门|来|嚟|装|送|到|吗|呢|得|行|ok|$|[，,。？?！!]))", "(?:拆|装|安装|送|搞|弄)(?:要|需要)?(?:拆|装|搞|弄)?多长(?:时间)?",
    ]),
    /* 早上 / 下午 / 今天：多半在描述光照或现状；和上门、安装、送货一起出现才算问时间 */
    timeSoft: /(早上|上午|中午|下午|晚上|傍晚|今天|今日|今晚|白天|夜里|夜晚|夜间|晚间|半夜|深夜|凌晨|放假|假期|假日|节假日|长假|公众假期|红日|黄金周|当天|当日|即日|半天|一天|马上|立刻|立即|即刻|急|赶|\btoday\b|\btonight\b|\bmornings?\b|\bafternoons?\b|\bevenings?\b|\bnights?\b|\bearly\b|\blater\b|\bholidays?\b|\b(?:fast|faster|speedy|rapid(?:ly)?)\b|\bquick(?:ly|er)?\b(?!\s+(?:question|q\b|one|note|thing|query)))/i,
    /* 起来 / 回来 / 进来 的「来」、the sun is coming through 的 coming、开灯方便 的「方便」都不是约时间 */
    sched: /(安装|装(?!修|饰|潢|了)|过来|上门|拆|清运|(?<![起回进出下上看原本后将未从向])来(?!自|的)|嚟|量|测|到货|有冇货|有没有货|有货|现货|送|发货|有空|得闲|(?:(?:早上|上午|中午|下午|晚上|傍晚|今天|今日|今晚|白天|明天|你们?|您|师傅|几点|什么时候|哪天)(?:都|也|会|比较)?方便|方便(?=上门|过来|来|嚟|量|装|的话))|约|开工|施工|完工|做好|装好|\b(?:come(?!\s+(?:through|into|in(?!\s+(?:the\s+)?(?:morning|afternoon|evening))))|coming(?!\s+(?:through|into|in|from|out|off|up))|visit|install\w*|deliver\w*|measure|book|appointment|available|availability|drop by|stop by|swing by|pick up|ship|ready)\b)/i,
    /* 营业时间：交给店主，不当成约上门的时间 */
    hours: rx([
      String.raw`\b(?:are|r)\s+(?:you|u)(?:\s+guys)?\s+open\b`, String.raw`\bopen\s+(?:on\s+)?(?:sundays?|saturdays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|weekends?|holidays?|today|tomorrow|tonight|late|now|christmas|boxing day)\b`,
      String.raw`\b(?:opening|business|store|shop|showroom|office|your)\s+hours\b`, String.raw`\bwhat\s+time\s+(?:do|does|are)\s+(?:you|u|the\s+\w+)\s+(?:open|close)`, String.raw`\bwhen\s+(?:do|are|does|is)\s+(?:you|u|the\s+\w+)\s+(?:open|close)`,
      "几点(?:钟)?(?:开门|关门|下班|收工|打烊|营业|关|开|放工)", "营业时间", "上班时间", "开门时间", "开(?:不开)?门(?:吗|没|未|不|呢)", "开唔开门", "几时(?:开门|关门|收工|放工)",
    ]),
    bot: rx([
      String.raw`\bbot\b`, "robot", "chatgpt", String.raw`\bgpt\b`, String.raw`\bai\b`, "real person", "a human", String.raw`\bhuman\b`, String.raw`are you (?:a )?person`, String.raw`\bmachine\b(?![\s-]*wash)`,
      String.raw`automated (?:reply|replies|response|message|answer)`, "is this automated", String.raw`auto[- ]?(?:reply|replies|response)`,
      "机器人", "机械人", "真人", "转人工", "找人工", "要人工", "人工(?:回复|回覆|服务|客服)", "人工客服", "你是人", "是人吗", "是人还是", "人还是机器", "人定机器", "系唔系人", "系咪人", "你系人", "你本人", "是本人", "本人吗", "店主本人", "老板本人",
      "自动回[复覆]", "机器(?:回[复覆]|自动|在回|答)", "(?:是|系|定|还是)机器(?!洗|做|织|绣|缝|加工|制|生产|压|切|打)", "客服", "是不是ai", "是ai吗", "ai吗", "系咪(?:机械人|机器人|真人|ai|人|bot)", "系唔系(?:机械人|机器人|真人|ai|bot)",
    ]),
    area: rx([
      "near me", "service area", String.raw`areas? (?:do )?you (?:serve|cover|service)`, String.raw`which (?:areas|cities|towns|neighbou?rhoods)`, String.raw`what (?:areas|cities|towns|neighbou?rhoods)`,
      String.raw`do you (?:serve|service|cover) (?:my|our|the|this) (?:area|city|town|neighbou?rhood|region)`, String.raw`come (?:out )?to (?:my|our) (?:house|home|place|condo|area)`, "come to you",
      String.raw`(?:do|can|will|would) you (?:come|travel|drive|go) (?:out|over|up|down)\b`, "in your area", "coverage area", "delivery area",
      /* 「Do you cover / serve X?」：问服务区（cover the cost / the whole window 不算） */
      String.raw`\b(?:do|does|can|could|will|would)\s+(?:you|u|ya)(?:\s+guys)?\s+(?:also\s+|still\s+)?(?:serve|cover)\b(?!\s+(?:it|them|that|this|the\s+(?:cost|price|fee|bill|install\w*|delivery|whole|entire|window|windows|wall|walls|floor|glass|frame|gap|top|bottom|sides?)))`,
      String.raw`\b(?:serving|covering)\s+(?:the\s+|my\s+|our\s+)?(?:area|region|city|town|neighbou?rhood)`,
      "上门", "到府", "可以来(?!自|电|点|个|份|一份|一个|杯)", "可以过来", "可唔可以嚟", "可以嚟", "能嚟", "服务范围", "服务区", "服务地区", "能到(?!货|手|位|期|齐)", "到不到(?!货)", "去不去", "送不送", "来不来", "能来", "能过来", "过来吗", "附近", "一带", "哪些地方", "哪些区", "送到", "送去", "嚟唔嚟", "去唔去", "送唔送",
    ]),
    /* 问「能不能装 / 装不装」：只有和地点一起出现才算服务区问题，单独出现由店主回答（不替店主承诺服务范围） */
    install: rx(["能装(?!好)", "装吗", "安装吗", "可以装", "装不装", "能安装", "可以安装", "装唔装", String.raw`\binstall(?:s|ation|ing)?\b`, String.raw`\bdeliver(?:y|ies|s|ing)?\b`, String.raw`\bship(?:s|ping)?\b`, String.raw`\bservice\b`, String.raw`\bserve\b`, String.raw`\bcome\b(?!\s+(?:in|with|apart|off|through|into|from|loose|undone|standard|together|as)\b)`, String.raw`\btravel\b`]),
    visit: /(come (?:out |back |over |by )?(?:and |to )?measure|measure (my|our|the)|\b(?:someone|somebody|anyone|you|u|guys)\s+(?:to\s+)?(?:come\s+(?:out\s+|back\s+|over\s+|by\s+)?(?:and\s+|to\s+)?)?measure|in-home|home visit|book (a|an) (measure|visit|appointment|consultation)|appointment|\bconsult(?:ation|ations|s|ing)?\b|\bswatch\s+visit|上门量|量尺|测量|丈量|度尺|预约|约个时间|约时间|(?:设计|灯光|灯光方案|灯光设计|方案|上门)咨询|约(?:个|一次|一个)?(?:设计|灯光|上门|方案)|上门看布|看布样)/i,
    /* 资质、保险、保修、担保、耐用年限：示例资料里没有，交给店主 */
    cred: rx([
      String.raw`licen[cs]`, "insured", "insurance", "bonded", "certif", "qualified", "qualification", "accredit", "warrant", "guarantee", String.raw`\bwsib\b`, String.raw`\besa\b`, "liability", String.raw`\bcoverage\b(?!\s+area)`, String.raw`\belectricians?\b`, String.raw`\bpermits?\b`,
      String.raw`\b100\s*%`, "100 percent", "百分百", "百分之百", "完全防水",
      /* 绝对化的性能问题（fully / totally / really waterproof、block all the light、绝对 / 真的防水）和真材实料（real wood）：等于要店主作保证 */
      String.raw`\b(?:fully|totally|completely|entirely|absolutely|really|truly|perfectly|actually|genuinely|properly)\s+(?:water\s*-?\s*proof|waterproof|water\s*-?\s*tight|blackout|black\s*-?\s*out|light\s*-?\s*(?:tight|proof)|sound\s*-?\s*proof|soundproof|fire\s*-?\s*proof|fireproof|scratch\s*-?\s*(?:proof|resistant)|stain\s*-?\s*(?:proof|resistant)|pet\s*-?\s*proof|child\s*-?\s*safe|kid\s*-?\s*safe|dark|black|sealed|silent|quiet|safe|block\w*|opaque|private|non[- ]?toxic|eco)\b`,
      String.raw`\bblock(?:s|ing)?\s+(?:out\s+)?(?:all|every|100|any|each)\b`, String.raw`\b(?:no|zero|any)\s+light\s+(?:at\s+all|gets?\s+(?:in|through)|leak\w*|comes?\s+(?:in|through))\b`, String.raw`\bpitch[- ]black\b`,
      String.raw`\b(?:real|genuine|authentic|actual|pure|true)\s+(?:wood|hardwood|oak|walnut|maple|teak|leather|silk|linen|wool|marble|stone|brass|metal|cotton|bamboo)\b`,
      "(?:做到|达到|做得到|保证)(?:全黑|漆黑)", "(?:全黑|漆黑)(?:吗|嗎|么|嘛|不|呢|㗎)", "一点光都(?:没有|不透|唔透)", "(?:绝对|完全|彻底|真的|真正|百分百|一点(?:都|也)不|丝毫不)(?:是|会|能|可以)?(?:防水|防潮|遮光|全遮光|不透光|不透|不漏|不褪色|不变形|不发霉|静音|隔音|无甲醛|零甲醛|环保|实木|真皮|纯棉|阻燃|防火|耐磨|不会坏|不会漏|不起翘|黑)", "滴水不漏",
      String.raw`how long (?:does|do|will|would|can|should)\b[^,?.!]{0,30}\blast\b`, String.raw`\blasts? (?:for )?(?:how long|long)\b`, String.raw`\blife\s?span\b`, String.raw`\bbattery life\b`, String.raw`\bdurab\w*`, String.raw`\blong[- ]lasting\b`,
      "资质", "执照", "牌照", "证书", "持证", "有证", "有(?:冇|没有?)牌", "电工牌", "承建商", "保险(?!丝)", "保修", "质保", "保固", "保用", "保养期", "售后", "认证", "合格证", "电工证",
      "能用多久", "可以用多久", "用多久", "能用几年", "可以用几年", "用几年", "用得几耐", "用几耐", "可以用几耐", "能撑多久", "寿命", "耐用", "耐唔耐用", "续航",
      /* 保修换个说法：How long are the vanities covered for / covered for 5 years / good for 10 years / 管几年 / 保几年 / 保几耐 */
      String.raw`\bhow\s+long\s+(?:is|are|will|would|does|do)\s+(?:[\w'’-]+\s+){1,5}?(?:be\s+|get\s+|stay\s+)?covered\b`,
      String.raw`\bcovered\s+for\s+(?:how\s+(?:long|many)|\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|a\s+(?:year|lifetime)|life|lifetime)\b`,
      String.raw`\b(?:good|covered|protected)\s+for\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|a\s+few|many|several|how\s+many)\s+(?:more\s+)?years?\b`, String.raw`\bhow\s+many\s+years\s+(?:of\s+)?(?:coverage|cover|protection)\b`,
      "(?<![灯水钢铜软油气胶吸血])(?:管|保)(?:得)?(?:几|多少)(?:年|耐|个月)", "(?<![灯水钢铜软油气胶吸血])(?:管|保)(?:得)?多久",
    ]),
    /* 示例资料没覆盖的服务（改水管、翻新、维修、自带面料、衬里）：别拿一条无关的资料搪塞，交给店主 */
    scope: rx([
      "plumbing", "plumber", String.raw`\breface`, "refacing", "refinish", "reupholster", String.raw`\brepair`, String.raw`\bfix(?:ing)?\s+(?:my|our|the|a|an|broken|it|them)\b`, String.raw`\bhem(?:ming|med)?\b`, String.raw`\balterations?\b`, String.raw`\btailor`, String.raw`\bpainting\b`, "drywall", String.raw`\btiling\b`, "tile work", "demolition", "electrical panel",
      String.raw`\bmove (?:the|my) (?:plumbing|outlets?|wiring|pipes?|drains?|lights?|switch(?:es)?)`, String.raw`\brelocat\w* (?:the |my )?(?:plumbing|outlets?|pipes?|drains?|lights?|wiring)`,
      String.raw`\bown (?:fabric|material|blinds|curtains|hardware|fixtures?|lights?|tiles?|flooring|vanity|cabinets?)`, String.raw`\b(?:bring|supply|provide|use) (?:my|our) own\b`, String.raw`\blined\b`, String.raw`\blining\b`, String.raw`\bliners?\b`,
      "改水管", "移水管", "改水电", "水电改造",
      /* 改一下水电 / 水电也帮我改 / 做水电：水电改造（「电动」「自动」里的动不是这个） */
      "(?<![电自手启联])(?:改|移|挪|重走|重新走|重新布|重布)(?:一下|一改|改|下|吓|一些|些|个|埋|好)?(?:水电|水管|水路|电路|线路|电线|水位|电位|下水道|下水(?!器)|去水位?|排水管?|上水)", "(?:水电|水管|水路|电路|线路|下水道|下水(?!器)|去水位?|排水管?|上水)(?:也|都|要|要不要|需不需要|需要|用不用|使唔使|使不使|顺便|一起|一并|能|可以|可唔可以|可不可以|能不能|帮(?:我|忙)?|麻烦|再)*(?:改|移|挪|重走)", "(?:做|搞|弄|包|接|整)(?:一下|下|埋)?水电", "翻新(?:吗|不|么|服务|橱柜|柜子|柜门)", "做(?:不做)?翻新", "能翻新", "可以翻新", "维修", "修理", "返修", "补漆", "自带(?:面料|布|材料|窗帘|灯|地板|柜)", "自己(?:的|买的)(?:面料|布|材料|窗帘|灯|地板|柜|东西)", "用我自己的", "我自己买",
      /* 别家买的货、第三方商品：组装 / 送货 / 安装由店主决定 */
      String.raw`\b(?:from|at|on|off|via)\s+(?:ikea|costco|wayfair|amazon|walmart|structube|home\s*depot|lowe'?s|kijiji|craigslist|temu|shein|aliexpress|alibaba|taobao|best\s*buy|canadian\s+tire|the\s+brick|leon'?s|ashley|facebook\s+marketplace)\b`,
      String.raw`\b(?:ikea|costco|wayfair|amazon|walmart|structube|home\s*depot|lowe'?s)\s+(?:[\w'-]+\s+)?(?:furniture|blinds?|shades?|curtains?|drapes?|sofas?|couch(?:es)?|beds?|mattress(?:es)?|dressers?|cabinets?|vanit(?:y|ies)|lights?|lamps?|fixtures?|chandeliers?|floors?|flooring|stuff|items?|products?|order|purchase|pieces?)\b`,
      String.raw`\b(?:another|other|a\s+different|different)\s+(?:stores?|shops?|retailers?|compan(?:y|ies)|sellers?|brands?|websites?)\b`,
      String.raw`\b(?:outdoor|outside|exterior|underground|garden|yard|landscape|extra|additional)\s+(?:wiring|wires|circuits?)\b`, String.raw`\b(?:redo|gut|overhaul)\s+(?:my|our|the|a)\s+(?:whole\s+|entire\s+)?(?:kitchen|bathroom|basement|house|home|condo)\b`,
      String.raw`\bmov(?:e|ing)\s+(?:house|homes|out|(?:my|our)\s+(?:stuff|furniture|things|belongings))\b`, String.raw`\bmovers?\b`, String.raw`\bmoving\s+(?:company|service|truck)\b`, String.raw`\bfrom\s+(?:my|our)\s+(?:old|current)\s+(?:place|house|home|condo|apartment|unit)\b`, String.raw`\bbought\s+(?:it\s+|them\s+|this\s+|one\s+)?(?:elsewhere|online|somewhere\s+else|from\s+(?:another|a\s+different|someone|somewhere))`,
      String.raw`\b(?:i|we)\s+(?:already\s+|just\s+)?(?:bought|purchased|ordered)(?:\s+(?:it|them|this|these|those|one))?\s*(?:elsewhere|online|from(?!\s+(?:you|u|ya|your|ur|here|this\s+(?:store|shop)))|at(?!\s+(?:your|ur)\s+(?:store|shop|showroom))|off|on\s+(?:amazon|wayfair|sale|line)|somewhere|myself|ourselves|already|[?.!,]|$)`,
      String.raw`\balready\s+(?:have|own|bought|purchased|got)\b`, String.raw`\b(?:i|we)\s+(?:already\s+)?(?:have|own)\s*(?:[?.!,]|$)`,
      /* 不是本店品类的东西：家电、门锁、网关、吊扇、墙纸、电视上墙 */
      String.raw`\b(?:air\s+condition\w*|a\/c\b|hvac|furnace|water\s+heater|washers?|dryers?|fridges?|refrigerators?|dishwashers?|range\s+hoods?|smart\s+locks?|door\s*locks?|deadbolts?|door\s*bells?|security\s+cameras?|thermostats?|routers?|ceiling\s+fans?(?!\s+lights?)|wall\s*papers?|garage\s+doors?)\b`, String.raw`\bmount\w*\s+(?:my|our|the|a)\s+(?:tv|television)\b`,
      /* 装修 / 水电 / 防水 / 地下室装修：不是这几类产品的服务 */
      String.raw`\b(?:do|offer|handle|provide|take\s+on|specialize\s+in)\s+(?:[\w-]+\s+){0,2}?(?:renovations?|renos?|remodel\w*|waterproofing|electrical(?:\s+work)?|rewiring|construction|contracting|handyman|basement\s+finishing)\b`,
      String.raw`\b(?:renovate|remodel|waterproof|finish)\s+(?:my|our|the|a|your)?\s*(?:[\w-]+\s+)?(?:basements?|kitchens?|bathrooms?|house|home|condo|rooms?)\b`, String.raw`\bfinish(?:es|ed|ing)?\s+basements?\b`, String.raw`\bbasement\s+(?:finishing|renovations?|renos?|waterproofing)\b`,
      String.raw`\belectrical\s+(?:work|jobs?|repairs?|services?|upgrades?|panels?)\b`, String.raw`\brewir\w*`, String.raw`\bwiring\s+for\s+(?:my|our|the|a)\s+(?:[\w-]+\s+)?(?:reno\w*|kitchen|basement|house|home|addition|garage|remodel)\b`, String.raw`\bknob\s+and\s+tube\b`,
      String.raw`\bset\s*up\s+(?:my|our|the|a|an)\s+(?:home\s+office|office|room|bedroom|space|house|home|place|apartment|condo|basement|nursery|studio|tv|computer|wifi|network|smart\s+home|home\s+theat(?:er|re)|alexa)\b`,
      /* 维修 / 坏了 / 给旧的配零件 */
      String.raw`\bwater\s+damage`, String.raw`\bfix(?:ing)?\s+(?:[\w-]+\s+){0,2}?(?:damage|damaged|leaks?|cracks?|scratch(?:es)?|squeak\w*|gaps?|motors?)\b`, String.raw`\bbroken\b`, String.raw`\bnot\s+working\b`, String.raw`\bstopped\s+working\b`, String.raw`\b(?:doesn'?t|does\s+not|won'?t|will\s+not)\s+(?:work|open|close|move|turn|go\s+(?:up|down)|charge|respond)\b`,
      String.raw`\b(?:for|on|to)\s+(?:my|our)\s+(?:old|existing|current)\s+(?:blinds|shades|shutters|curtains|drapes|lights?|fixtures?|vanity|cabinets?|floors?|flooring|sofa|couch|furniture|motors?)\b`, String.raw`\bmotori[sz]e\s+(?:my|our)\s+(?:existing|old|current)\b`, String.raw`\breplacement\s+(?:motors?|remotes?|parts?|cords?|slats?|batter(?:y|ies)|brackets?)\b`,
      "坏了", "坏咗", "烂了", "烂咗", "不转了", "不动了", "没反应", "冇反应", "失灵", "故障", String.raw`换(?:个|一个)?(?:电机|马达)`, String.raw`电机(?:坏|能换|可以换|换)`, String.raw`配(?:个|一个|多个)?遥控`, String.raw`(?:旧|原来|现有|已有)的?(?:窗帘|百叶|卷帘|帘子|灯)(?:配|加|装电机|改电动|改成电动)`,
      String.raw`(?:网上|网购|别家|别处|外面|其他店|其它店|淘宝|京东|拼多多|宜家|闲鱼)(?:买|购|订|淘)(?:的|来的|咗|嘅|了|回来)`, "已经买了", "买好了",
      "空调", "热水器", "洗衣机", "烘干机", "冰箱", "洗碗机", "油烟机", "燃气灶", String.raw`电视(?!柜|墙|背景)`, "智能门锁", "门锁", "指纹锁", "密码锁", "网关", "摄像头", "监控", "路由器", "吊扇(?!灯)", "壁纸", "墙纸",
      /* 做防水（防水工程）、售后故障（丢了 / 掉了 / 卡住 / 不亮 / 漏水 / lost the remote / stuck）、能修吗 */
      "(?:做|搞|包|接)(?:不做)?防水", "防水(?:层|涂料|涂层|卷材)",
      "丢了|丢咗|唔见咗|不见了|找不到了|掉了|掉咗|断了|断咗|裂了|裂咗|松了|松咗|卡住|卡死|卡了|不亮|唔亮|闪烁|一闪一闪|漏水|渗水|异响|生锈|变形了|发黄|脱落|起翘|起拱|开裂|鼓包|不好用了|唔好用|用不了|坏掉|不灵了|唔灵|失效",
      "(?:多|再|另外|补)(?:配|买|要)(?:一个|个|多个|一只|只)?(?:遥控|电机|马达|电池|充电器)", "(?:遥控器?|电机|马达|电池|充电器)(?:能|可以|可唔可以)?(?:多|再|另外|补)(?:配|买|要)",
      String.raw`(?:能|可以|可唔可以|会|帮(?:我|忙)?|上门|来)修(?!改|饰|边|身)`,
      String.raw`\b(?:i|we)\s+(?:have\s+|'ve\s+)?lost\s+(?:the|my|our)\b`, String.raw`\blost\s+(?:the|my|our)\s+(?:remote|charger|key|keys|parts?|hardware|instructions?|manual)\b`,
      String.raw`\b(?:is|are|was|were|went|got|it'?s)\s+missing\b`, String.raw`\bmissing\s+(?:parts?|pieces?|screws?|remote|hardware|slats?)\b`, String.raw`\b(?:is|are|got|gets|getting|came|come|feels?)\s+loose\b`,
      String.raw`\b(?:stuck|jammed|leaking|leaks|cracked|cracking|warped|warping|peeling|flickering|squeaking|squeaky|buzzing)\b`,
      String.raw`(?:地下室|屋顶|楼顶|天台|卫生间|厨房|阳台|外墙|墙面|墙体)(?:做)?防水`, String.raw`防水(?:工程|施工|处理|补漏)`, "补漏", "堵漏", "水电(?:改造|施工|工程|活)", "电工活", "改电路", "改线路", "装修布线", "布线改造",
      String.raw`(?:做|接|包)(?:不做|不接)?\s*(?:厨房|卫生间|浴室|全屋|地下室|整屋|房子|室内|局部|旧房)?装修`, String.raw`(?:厨房|卫生间|浴室|全屋|地下室|整屋|房子|室内|局部|旧房)装修(?:吗|么|你们|能|可以|做|接|也|都)`, String.raw`装修(?:你们|也|都)?(?:做|接)(?:吗|不|么)`,
      /* 商业工程（酒店、写字楼、商场、店铺、学校、教堂、Airbnb、几十间房 / 几十层）：交给店主判断，不当普通家装答 */
      String.raw`(?<!\b(?:near|by|beside|behind|next\s+to|close\s+to|across\s+from|opposite|around|past|off|from|walking\s+distance\s+to)\s+(?:the\s+)?(?:[\w'-]+\s+){0,3})\b(?:office\s+(?:building|tower|space|suite|block|park)s?|commercial|restaurants?|caf[eé]s?|church(?:es)?|(?<!\b(?:before|after|from|to|for)\s+)schools?(?!-|\s+(?:starts?|year|run|holidays?|break|age|uniforms?|bus|days?|nights?))|hotels?|motels?|hospitals?|malls?|warehouses?|factor(?:y|ies)|gyms?|salons?|daycares?|airbnbs?|highrises?|high-rises?)\b`,
      String.raw`\b(?:my|our|his|her|their|the|an?|for|in|do|does|serve|service)\s+(?!home\s)(?:[\w-]+\s+)?(?:offices|office(?!\s+(?:chairs?|desks?|hours?))|business(?:es)?|clinics?|studios?|spas?|retail\s+(?:stores?|spaces?|units?))\b(?<!\b(?:your|ur)\s+(?:[\w-]+\s+)?(?:offices?|business(?:es)?))`,
      String.raw`\b(?:my|our|his|her|their)\s+(?:[\w-]+\s+)?(?:stores?|shops?)\b`, String.raw`\b\d{2,}\s+(?:[\w-]+\s+)?(?:rooms|units|suites|floors|storeys|stories|buildings|properties|homes|houses|condos|apartments|locations|stores|offices)\b`, String.raw`\b(?:dozens|hundreds)\s+of\b`,
      "酒店", "宾馆", "旅馆", "民宿", "写字楼", "办公楼", "办公室", "商场", "商铺", "店铺", "铺面", "餐馆", "饭店", "餐饮", "学校(?!宿舍)", "幼儿园", "医院", "诊所", "工厂", "厂房", "会所", "健身房", "美容院", "工程",
      "(?:我|我们|我哋|我地|自己)(?:的|嘅)(?:公司|店|铺头?|餐厅)", "(?:我|我们|我哋|我地|自己)(?:新|刚|准备|想|要)?开(?:了|咗)?(?:间|家|个|一间|一家)?(?:新)?(?:餐厅|饭店|餐馆|店|铺头?|公司|工厂|酒店|民宿|咖啡店|奶茶店|健身房|美容院)",
      String.raw`(?:\d{2,}|[一二两三四五六七八九]?[百千]|几十|[二三四五六七八九]十)\s*(?:多)?\s*(?:间|个|套|层|栋)(?:房|房间|客房|单位|楼)?`,
      /* 户外 / 外墙 / 车船：不是这几类产品的常规活 */
      String.raw`\boutdoors?\b`, String.raw`\bexterior\b`, String.raw`\boutside\s*(?=[?.!,]|$)`, String.raw`\b(?:install|put|hang|mount)\w*\s+(?:[\w'-]+\s+){0,3}?outside\b`,
      String.raw`\b(?:on|around)\s+(?:(?:the|my|our)\s+(?:roof|porch|deck|fence|garage|balcony|pergola|gazebo|yard|backyard|garden|patio|driveway|pool|shed)|(?:my|our)\s+(?:house|home))\b(?!\s+(?:doors?|windows?|ceiling|walls?))`,
      String.raw`\b(?:in|for)\s+(?:the|my|our)\s+(?:yard|backyard|front\s+yard|garden|porch|pergola|gazebo|driveway|pool\s+area|shed)\b`, String.raw`\b(?:landscape|garden|yard|porch|patio|deck|pathway|soffit|pool)\s+(?:lights?|lighting|shades?|blinds?|curtains?|drapes?)\b`,
      "户外", "室外", "露天", "庭院", "花园", "院子", "外墙", "屋外", "天台", "围墙", "车上", "船上",
      /* 别人的货：别人送的 / 二手 / the chandelier my mom gave me / the pendant I got / deliver my old sofa */
      String.raw`\b(?:sofas?|couch(?:es)?|sectionals?|beds?|dressers?|tables?|chairs?|desks?|cabinets?|vanit(?:y|ies)|lights?|lamps?|pendants?|chandeliers?|fixtures?|sconces?|dimmers?|blinds?|shades?|curtains?|drapes?|rugs?|floors?|flooring|tiles?|furniture|mattress(?:es)?|wardrobes?|bookcases?)\s+(?:that\s+|which\s+)?(?:i|we|my\s+\w+|our\s+\w+|someone|somebody|a\s+friend|they)\s+(?:just\s+|already\s+|recently\s+|have\s+|had\s+)?(?:got|bought|have|own|ordered|purchased|picked\s+up|found|gave|gifted|inherited|left|brought)\b(?!\s+(?:from|at|off|through|with)\s+(?:you|u|ya|your|ur|here|this\s+(?:store|shop)|the\s+(?:store|shop|showroom)))`,
      String.raw`\b(?:second[- ]?hand|pre-?owned|thrift(?:ed)?|hand-?me-?down|used|refurbished|antique)\s+(?:[\w-]+\s+)?(?:sofas?|couch(?:es)?|sectionals?|beds?|dressers?|tables?|chairs?|desks?|cabinets?|vanit(?:y|ies)|lights?|lamps?|pendants?|chandeliers?|fixtures?|blinds?|shades?|curtains?|furniture|mattress(?:es)?)\b`,
      String.raw`\b(?:gave|given|gifted)\s+(?:to\s+)?(?:me|us)\b`, String.raw`\bwas\s+given\b`, String.raw`\binherited\b`,
      String.raw`\b(?:deliver|move|assemble|install|set\s*up|bring|carry|transport|relocate|ship|hang|mount|reinstall)\w*\s+(?:my|our|his|her|their)\s+(?:old|existing|current|used|own|other|previous)\b`,
      String.raw`\b(?:jysk|structube|wayfair|ikea|costco|amazon|leon'?s|ashley|homesense|bouclair|kijiji|craigslist|marketplace|lumens|article\.com)\s+(?:[\w'-]+\s+)?(?:sofas?|couch(?:es)?|beds?|dressers?|tables?|chairs?|desks?|cabinets?|lights?|lamps?|pendants?|chandeliers?|blinds?|shades?|curtains?|furniture|mattress(?:es)?)\b`,
      "(?:朋友|别人|亲戚|我妈|妈妈|我爸|爸爸|家人|人家|同事|邻居|老公|老婆)(?:送|给|俾|畀)(?:我|我们|我哋)?(?:的|嘅)", "二手", "(?:旧的|以前的|原来的|之前的)(?:沙发|床|家具|柜|桌|椅|灯|窗帘)(?:能|可以|可唔可以)?(?:送|搬|装|组装|安装)",
      "(?:宜家|林氏|顾家|全友|芝华仕|索菲亚|欧派|尚品宅配|红星美凯龙|居然之家|淘宝|京东|拼多多|闲鱼)(?:的|嘅|买的|买嘅)?(?:沙发|床|柜|家具|桌|椅|灯|吊灯|窗帘|地板|浴室柜|马桶|东西)",
      /* 拆的是整间厨房 / 阳台 / 墙（拆除工程），不是本品类的旧件 */
      String.raw`\b(?:remov\w*|rip\w*\s+out|tear\w*\s+out|tak\w*\s+out|demo(?:lish\w*)?|gut\w*|knock\w*\s+(?:down|out))\s+(?:the\s+|my\s+|our\s+|a\s+|an\s+|this\s+|that\s+)?(?:old\s+|whole\s+|entire\s+|existing\s+)*(?:kitchen|bathroom|washroom|basement|balcony|deck|patio|room|house|garage|shed|wall|walls|ceiling|ceilings|closet|stairs|staircase|fireplace|fence|porch)\b(?!\s+(?:cabinets?|vanit\w*|sinks?|faucets?|tiles?|floors?|flooring|carpet|counter\w*|fixtures?|lights?|blinds?|shades?|curtains?|toilet|tub|mirror))`,
      "拆(?:掉|除|走|了|埋|咗)?(?:旧|老)?(?:的)?(?:整个|整间|整套)?(?:厨房|卫生间|浴室|洗手间|厕所|阳台|露台|飘窗|窗台石|窗台|地台|墙|墙面|墙体|房子|房间|屋|车库|天花|吊顶|楼梯|地下室|隔断|壁炉|围墙)(?![柜缸台盆镜门砖地的嘅里内])",
      /* 宾语提前的拆除：阳台能拆吗 / 能把阳台拆了吗 / 露台可唔可以拆 / Can the balcony be removed?（后面紧跟旧件时是拆旧：卫生间能拆旧马桶吗） */
      "(?:厨房|卫生间|浴室|洗手间|厕所|阳台|露台|飘窗|窗台石|窗台|地台|墙|墙面|墙体|房子|房间|车库|天花|吊顶|楼梯|地下室|隔断|壁炉|围墙)(?:的话)?(?:也|都|还)?(?:能|可以|可不可以|可唔可以|能不能|能否|可否|会不会|要|想)?(?:帮(?:我|忙)?)?(?:拆(?:掉|除|走|咗|了|埋)?|(?:打|砸|敲)(?:掉|咗|烂|穿)|推(?:掉|倒|咗|了))(?![旧老]|[^，,。！!？?]{0,3}?(?:马桶|坐厕|柜|镜|台盆|面盆|洗手盆|洗脸盆|浴缸|龙头|花洒|水槽|洗手台|淋浴))",
      "把(?:整个|整间|旧的?|老的?|原来的?)?(?:厨房|卫生间|浴室|洗手间|厕所|阳台|露台|飘窗|窗台石|窗台|地台|墙|墙面|墙体|房子|房间|车库|天花|吊顶|楼梯|地下室|隔断|壁炉|围墙)(?:也|都|给)?(?:拆|打掉|砸掉|敲掉|推掉|推倒)",
      String.raw`(?<!\b(?:in|from|of|inside|at|on|under|behind|near|for)\s+)\b(?:the|my|our|this|that)\s+(?:old\s+|whole\s+|entire\s+|existing\s+)*(?:kitchen|bathroom|washroom|basement|balcony|deck|patio|room|house|garage|shed|wall|walls|ceiling|ceilings|closet|stairs|staircase|fireplace|fence|porch)\s+(?:be\s+|get\s+|being\s+)?(?:removed|torn\s+(?:down|out)|demolished|knocked\s+(?:down|out)|taken\s+(?:down|out)|ripped\s+out|gutted)\b`,
      /* 接水的活（装水槽 / 马桶 / 龙头 / 花洒）：要水电资质，交给店主 */
      String.raw`\b(?:install|hook\w*\s+up|connect|plumb|put\s+in|replace)\w*\s+(?:the\s+|a\s+|an\s+|my\s+|our\s+|new\s+|old\s+)*(?:[\w-]+\s+)?(?:sinks?|faucets?|taps?|toilets?|tubs?|bathtubs?|showers?|shower\s*heads?|basins?|dishwashers?|bidets?)\b`,
      "(?:装|安装|接)(?:新的?|个|一个)?(?:马桶|坐厕|水槽|龙头|水龙头|台盆|面盆|洗手盆|洗脸盆|花洒|淋浴|浴缸|莲蓬头|智能马桶)",
      /* 搬家 / 刷漆 / 盖东西：别的行当 */
      String.raw`\bmov(?:e|es|ing)\s+(?:[\w'-]+\s+){0,2}?(?:furniture|stuff|things|belongings|boxes|items|pieces|sofas?|couch(?:es)?|beds?|pianos?|fridges?|appliances?|dressers?)\b`,
      String.raw`\b(?:do|does|can|could|will|would)\s+(?:you|u)(?:\s+guys)?\s+(?:also\s+)?(?:move|paint|plumb|weld|landscape|roof|pave|drywall|frame|demolish|renovate|remodel|construct)\b`, String.raw`\bpaint(?:s|ing)?\b`, "刷漆", "油漆", "粉刷", "刷墙", "涂料",
      /* 智能家居整套 / 全屋智能：不是窗饰、灯具的单品 */
      String.raw`\bsmart\s+home\s+(?:setup|set-?up|system|installation|automation|stuff)\b`, String.raw`\b(?:set\s*up|install|do)\s+(?:[\w-]+\s+){0,2}smart\s+home\b`, String.raw`\bhome\s+automation\b`,
      String.raw`\bmake\s+(?:the|my|our)\s+(?:whole\s+|entire\s+)?(?:house|home|place|condo)\s+smart\b`, String.raw`\bwhole[- ](?:house|home)\s+(?:smart|automation)\b`, String.raw`\bsmart\s+(?:plugs?|speakers?|displays?|watch(?:es)?|outlets?)\b`,
      "智能家居(?:系统|方案)?(?:能|可以|可唔可以)?(?:做|装|接|搞)", "全屋智能", "整屋智能", "智能化",
      String.raw`\b(?:install|hang|mount|put\s+up|do)\w*\s+(?:my\s+|the\s+|some\s+|a\s+|an\s+|our\s+)?(?:pictures?|photos?|art(?:work)?|paintings?|posters?|wall\s+art)\b`, "挂画", "装画",
      String.raw`\b(?:hot\s+tubs?|solar\s+panels?|screen\s+doors?|storm\s+(?:windows?|doors?)|security\s+(?:systems?|cameras?)|alarm\s+systems?|swimming\s+pools?|pools?)\b`,
      /* 改装修工程：kitchen renovation / for my reno */
      String.raw`\b(?:kitchen|bathroom|washroom|basement|home|house|condo|full|whole[- ]house|gut)\s+(?:renovations?|renos?|remodel\w*|makeovers?|overhauls?)\b`, String.raw`\bfor\s+(?:the|my|our|a)\s+(?:[\w-]+\s+)?(?:renovation|reno|remodel)\b`,
    ]),
    /* 退换货、隐私政策、条款：交给店主表态，不拿产品资料回答 */
    policy: rx([
      String.raw`\breturn(?:s|ed|ing|able)?\b(?!\s+(?:my|the|a|your|our)?\s*(?:call|calls|trip|visit|message|email|text|customers?|clients?|buyers?)s?\b)`, String.raw`\brefund\w*`, String.raw`\bexchang\w*`, String.raw`\brestocking\b`, String.raw`\bmoney[- ]back\b`, String.raw`\bcancel(?:lation)?\s+(?:policy|fee)`,
      String.raw`\bprivacy\s+polic`, String.raw`\b(?:terms\s+(?:and|&)\s+conditions|t\s*&\s*c)\b`, String.raw`\bpersonal\s+(?:info|information|data|details)\b`, String.raw`\b(?:my|our)\s+(?:data|information|info|details)\s+(?:safe|secure|private|protected|shared|sold)\b`, String.raw`\bdata\s+(?:privacy|protection)\b`,
      String.raw`\b(?:will|would|do|does|can)\s+(?:you|u|your\s+(?:shop|store|company|team))\s+(?:\w+\s+)?(?:protect|keep|respect|share|sell)\s+(?:my|our)\s+(?:privacy|data|info\w*|details|personal)`,
      "退货", "退款", "退换", "换货", "调换", "退钱", "退单", "包退", "包换", "无理由", String.raw`(?:可以|能|能不能|可不可以|可唔可以|会|给|唔可以|可否|让)退`, String.raw`退(?:吗|嗎|不退|唔退|得|唔得|嘅)`, "不合适.{0,4}(?:换|退)",
      /* 单独的「换」：可以换吗 / 换唔换得 / swap / exchange */
      String.raw`(?:可以|能|能不能|可不可以|可唔可以|可否|让|给|会|包|唔可以|俾)\s*换(?=吗|嗎|不|唔|么|嘛|呢|啊|吧|$|[\s？?。，,！!])`, String.raw`换(?:吗|嗎|不换|唔换|得(?:吗|嗎|唔|到|不)|唔得)(?=$|[\s？?。，,！!])`, String.raw`\bswap\w*`, String.raw`\bexchange\b`,
      /* 做好 / 装好之后改色、重做、不合适退回：都是退换政策 */
      String.raw`\b(?:re-?do|re-?make)\b(?!\s+(?:my|our|the|a)\s+(?:whole\s+|entire\s+)?(?:kitchen|bathroom|basement|house|home|condo))`, String.raw`\b(?:replace|redo|remake|fix|change)\s+(?:it|them|that|those)\s+(?:for\s+free|if|when|after)\b`,
      String.raw`\btake\s+(?:it|them|that|those|the\s+\w+)\s+back\b`, String.raw`\b(?:then\s+what|what\s+(?:if|happens\s+(?:if|when)))\b`, String.raw`\bchange\s+my\s+mind\b`,
      String.raw`\bif\s+(?:it|they|the\s+[\w\s]{1,24}?|this|that|these|those)\s+(?:does\s*n[o']?t|do\s*n[o']?t|did\s*n[o']?t|is\s*n[o']?t|are\s*n[o']?t|was\s*n[o']?t|were\s*n[o']?t|is|are|was|were|turns?\s+out|comes?\s+out|looks?|ends?\s+up|gets?)\s+(?:not\s+)?(?:fit|work|match|right|wrong|off|too|the\s+wrong|different|bad|damaged|defective|broken|scratched|faded|short|long|small|big|ugly|what\s+i)\w*`,
      String.raw`\bafter\s+(?:it'?s|they'?re|it\s+is|they\s+are|it\s+has\s+been|they'?ve\s+been|it\s+was|they\s+were)\s+(?:been\s+)?(?:made|installed|delivered|cut|sewn|done|finished|built|hung|put\s+up)\b`,
      "重做", "返工", "重新做", "再做一(?:次|个|套|张|条)",
      "(?:做好|做出来|做完|装好|装完|安装好|做咗|装咗|整好|整咗|送到|收货|收到货|到货|装上|挂上)(?:了|咗)?(?:之后|以后|后)?[^，,。？?！!]{0,10}(?:换|改|退|重做|唔要|不要)",
      "(?:不合适|唔合适|不合身|不合|唔啱|唔合|不对|唔对|色差|不满意|唔满意)[^，,。？?！!]{0,8}(?:怎么办|怎么处理|如何处理|点算|点处理|点搞|怎么搞|可以|能|改|换|重做|退|赔|负责|包)", "(?:不喜欢|唔钟意|唔中意)[^，,。？?！!]{0,6}(?:换|改|退|重做)",
      "隐私政策", "隐私条款", "隐私保护", String.raw`你们?(?:会|能|可以)?(?:不会)?(?:保护|保密|泄露|泄漏|保管)(?:好)?(?:我的?|我们的?|客户的?)?(?:个人)?(?:隐私|信息|资料|数据)`, String.raw`(?:信息|资料|数据|隐私)(?:会|会不会)?(?:被)?(?:泄露|泄漏|外泄)`, "个人信息", "个人资料", "用户协议", "服务条款", "合同条款",
    ]),
  };
  /* 留言在问的属性 / 功能：示例资料没讲到就不拿它搪塞（「Is the vinyl formaldehyde free?」≠ 有防水 SPC；
     「西晒用什么窗帘」在家纺店 ≠ 窗帘可以定做）。每个属性都要有一条资料讲到，否则整条交给店主 */
  const TOPIC = rx([
    String.raw`\bmotori[sz]\w*`, String.raw`\bsmart\b`, String.raw`\bremote\b`, String.raw`\bblackout\b`, String.raw`\broom[- ]?darken\w*`, String.raw`\blight[- ]?filter\w*`, String.raw`\bprivacy\b`,
    String.raw`\bwater[- ]?(?:proof|resistant)\b`, String.raw`\bmoist\w*`, String.raw`\bhumid\w*`, String.raw`\bdamp\w*`, String.raw`\bwet\b`, String.raw`\bmou?ld(?:y)?\b`, String.raw`\bmildew\w*`,
    String.raw`\bwash(?:able|ing|es)?\b`, String.raw`\bdry[- ]?clean\w*`, String.raw`\biron(?:ing|ed)?\b`, String.raw`\bshrink\w*`, String.raw`\bfad(?:e|es|ing)\b`, String.raw`\bcolou?r[- ]?fast\w*`, String.raw`\bwrinkl\w*`, String.raw`\bpilling\b`, String.raw`\bstain\w*`,
    String.raw`\bformaldehyde\b`, String.raw`\btoxi[cn]\w*`, String.raw`\bnon[- ]?toxic\b`, String.raw`\bvocs?\b`, String.raw`\bchemicals?\b`, String.raw`\bsmell\w*`, String.raw`\bodou?r\w*`, String.raw`\ballerg\w*`, String.raw`\bhypoallergenic\b`,
    String.raw`\bfire(?:proof|[- ]?(?:retardant|resistant|rated|safe))?\b`, String.raw`\bflame\w*`, String.raw`\bretardant\b`, String.raw`\bpets?\b`, String.raw`\bdogs?\b`, String.raw`\bcats?\b`, String.raw`\bscratch\w*`,
    /* 「kids' room」是房间；问的是儿童 / 宠物安全才算属性 */
    String.raw`\b(?:child|kid|baby|toddler|pet)[- ]?(?:safe|safety|proof|friendly)\b`, String.raw`\bsafe\s+(?:for|with|around)\s+(?:kids|children|babies|toddlers|pets)\b`, String.raw`\bcordless\b`, String.raw`\bcords?\b`, String.raw`\bsafe(?:ty)?\b`, String.raw`\beco\b`,
    String.raw`\bthermal\b`, String.raw`\binsulat\w*`, String.raw`\benergy\b`, String.raw`\bnoise\b`, String.raw`\bnoisy\b`, String.raw`\bsoundproof\w*`, String.raw`\bquiet\b`, String.raw`\bsilent\b`,
    /* 颜色、材质：「grey vinyl」「linen curtains」「白色浴室柜」不拿尺寸 / 材质资料搪塞；warm white 是色温，Red Deer / White Rock 是地名 */
    String.raw`(?<!\b(?:warm|cool|cold|soft|bright|natural|pure|daylight)[\s-])\b(?:grey|gray|white|black|beige|ivory|navy|cream|charcoal|taupe|blue|green|red|pink|yellow|brown|orange|purple)\b(?!\s+(?:deer|rock|bay|coast|river|lake|hills?|mountains?|point|wood|friday))`,
    String.raw`\b(?:linen|cotton|polyester|velvet|silk|wool|leather|bamboo|jute|chenille|boucle|suede|acrylic|nylon|microfib(?:er|re))\b`,
    "[红橙黄绿青蓝紫灰白黑棕粉米咖驼杏啡浅深]色", "[浅深](?:一点|啲|些|灰|蓝|啡|棕)", "米白", "奶白", "棉麻", "纯棉", "亚麻", "涤纶", "丝绒", "真丝", "羊毛", "真皮", "皮质", "皮革", "雪尼尔",
    String.raw`\bsunlight\b`, String.raw`\bglare\b`, String.raw`\buv\b`, String.raw`\b(?:west|south)[- ]facing\b`, String.raw`\bthick\w*`, String.raw`\bthin\b`, String.raw`\bheavy\b`, String.raw`\bclean(?:ing|able)?\b`, String.raw`\bin stock\b`,
    "电动", "遥控", "智能", "智慧", "遮光", "透光", "隐私", "防水", "防潮", "防霉", "发霉", "潮湿", "能洗", "可以洗", "可洗", "水洗", "机洗", "干洗", "手洗", "洗衣机", "清洗", "好洗", "熨",
    "缩水", "褪色", "掉色", "起球", "起皱", "甲醛", "环保", "无毒", "有毒", "异味", "味道", "气味", "过敏", "阻燃", "防火", "宠物", "猫", "狗", "防抓", "耐抓", "抓坏",
    "防夹", "安全", "无绳", "拉绳", "隔热", "保温", "保暖", "隔音", "噪音", "静音", "声音", "西晒", "防晒", "晒", "阳光", "太阳", "刺眼", "紫外线", "透气",
    "厚", "薄(?!纱)", "重量", "清洁", "打理", "耐脏", "防尘", "现货", "有货", "库存",
    /* 通用的颜色 / 材质 / 保养 / 防滑 / 智能家居联动：没有资料讲到就交给店主（colour temperature 是色温，不算） */
    String.raw`\bcolou?rs?\b(?!\s*temp)`, String.raw`\bcolou?r\s+options\b`, "颜色", String.raw`\bmaterials?\b`, String.raw`\bmade\s+(?:of|from)\b`, String.raw`\bwood(?:en)?\b`, String.raw`\bsolid\s+wood\b`, String.raw`\bmdf\b`, String.raw`\bplywood\b`, String.raw`\bparticle\s*board\b`,
    "材质", "材料", "什么材", "啥材", "咩材", "什么布", "啥布", "用料", "实木", "木质", "木纹", "木制", "板材",
    /* 「What's the curtain fabric? / What is the sofa made of」问的是用什么料：示例资料只讲有布样，不算答到 */
    String.raw`\bwhat(?:['’]s|\s+is|\s+are)(?=\s+(?:the|your|this|that|these|those)\s+(?:[\w-]+\s+)?(?:fabrics?|materials?)\b(?!\s+(?:options?|choices?|colou?rs?|samples?|swatches)))`, "(?<=布料|面料)(?:是|系)(?:什么|咩|啥|乜)",
    String.raw`\bmaintenance\b`, String.raw`\bmaintain\w*`, String.raw`\bcare\s+(?:for|instructions)\b`, "保养", "打蜡", "上蜡", "护理", "养护", "怎么洗", "怎样洗", "如何洗", "洗一次", "多久洗",
    String.raw`\bslip\w*`, String.raw`\bnon[- ]?slip\b`, String.raw`\bslippery\b`, "防滑", "打滑", "滑不滑", "会滑",
    String.raw`\bhubs?\b`, String.raw`\bgateways?\b`, String.raw`\bsmart\s+home\b`, String.raw`\balexa\b`, String.raw`\bgoogle\s+home\b`, String.raw`\bhome\s*kit\b`, "智能家居", "小爱", "天猫精灵",
    /* 可拆卸 / 自己拆 / 拆开搬：不是拆旧服务；用量（how much fabric / 要多少块）：示例资料没讲到 */
    String.raw`(?<=\btak(?:e|ing)\s+(?:\w+\s+){0,3})apart\b`, String.raw`\bdisassembl\w*`, String.raw`\bremovable\b`, String.raw`\bdetachable\b`, String.raw`\b(?:can|could|should|may)\s+(?:i|we)\s+remove\b`, String.raw`\bremov\w*\s+(?:[\w'-]+\s+){0,4}?(?:myself|ourselves)\b`, "拆开", "拆卸", "可拆", "自己拆",
    String.raw`\bhow\s+(?:much|many)(?=\s+(?:fabric|material|yards?|met(?:re|er)s?|boxes|planks|rolls|panels|tiles|sq(?:uare)?\s*(?:ft|feet))\b)`, String.raw`(?:需要|要)多少(?=布|面料|米|码|块|片|卷|箱|平|方)`,
  ], "gi");
  const TOPIC1 = new RegExp(TOPIC.source, "i");
  /* 示例资料一概没讲到的属性：品牌 / 产地 / 具体参数（遮光率、瓦数）/ 兼容联动 / 标准床尺寸。问到就交给店主，哪条资料都不拿来答 */
  const BRAND_EN = new Set("somfy lutron levolor graber bali norman philips hue nest ecobee kohler moen grohe toto shaw mohawk pergo armstrong mannington tarkett jysk structube ashley sealy tempur simmons lumens kichler feiss hinkley tesla article brick leons ikea wayfair costco amazon homesense bouclair rona lowes hunter silhouette".split(" "));
  const INSTALL_VERB = /\b(?:install\w*|hang|hangs|hanging|hung|mount\w*|put\s+up)\b|安装|(?<!中山|服|包|假|西|时|套|盒|袋|瓶|罐|童|女|男|洋|古|正|便|军)装(?!修|饰|潢|扮)|挂(?!钩)/i;
  /* 铺地毯 / 铺地垫 / lay a rug：铺设是安装类服务（地毯满铺是地板行的活），示例资料没讲到；被铺 / 床铺 / 店铺 / 铺头 / 铺盖不是动词 */
  /* 「上门铺 / 进门铺」的门不是「门铺」；「铺张浪费」的张不是量词（铺张地毯 / 鋪張地氈 是铺一张） */
  const LAY_VERB = /(?<![床被店商地旺卧睡老当药])铺(?![头位面子盖])(?!张(?:浪费|奢|扬|声势|$|[了啦吧呀啊，,。！!？?\s]))|\b(?:lay|lays|laying|laid)\s+(?:down\s+)?(?:(?:the|a|an|my|our|new|some|wall[- ]to[- ]wall)\s+)*(?:carpets?|carpeting|rugs?|runners?|mats?)\b|\bwall[- ]to[- ]wall\b|\bput\s+down\s+(?:(?:the|a|an|my|our|this|that|new|some)\s+)?(?:[\w-]+\s+)?(?:carpets?|carpeting|rugs?|runners?|mats?)\b|\bput\s+(?:(?:the|a|an|my|our|this|that|these|those|new|some)\s+)?(?:[\w-]+\s+)?(?:carpets?|carpeting|rugs?|runners?|mats?)\s+down\b/i;
  const ASK_UNCOVERED = rx([
    String.raw`\bbrands?\b`, String.raw`\bmanufacturer\w*`, String.raw`\bwho\s+makes\b`, String.raw`\b(?:made|manufactured|produced)\s+in\s+(?:china|canada|usa|the\s+us|the\s+usa|america|italy|germany|vietnam|india|turkey|mexico|europe|asia|japan|korea|taiwan|malaysia|indonesia|poland|spain|portugal)\b`, String.raw`\bwhere\s+(?:are|is)\s+(?:they|it|these|those|the\s+\w+)\s+(?:made|manufactured|from)\b`,
    String.raw`\b(?:somfy|lutron|levolor|graber|bali|norman|philips|hue|nest|ecobee|kohler|moen|grohe|toto|shaw|mohawk|pergo|armstrong|mannington|tarkett|sealy|tempur|simmons|kichler|feiss|hinkley|hunter\s+douglas)\b`,
    String.raw`\b(?:percent(?:age)?|ratings?|specs?|specifications?|opacity|openness|r-?value|cri|watts?|wattage|lumens?|ip\s?\d\d)\b`, String.raw`\bhow\s+(?:much|many)\s+(?:light|lumens?|watts?)\b`,
    String.raw`\b(?:compatib\w*|integrat\w*)\b`, String.raw`\b(?:work|works|pair|pairs|sync|syncs|connect|connects)\s+(?:with|to)\s+(?:alexa|google|siri|apple|home\s*kit|smart\s*things|my\s+(?:system|hub|existing|current|smart\s+home|home\s+system|alarm))\b`,
    "品牌", "牌子", "哪个牌", "什么牌", "咩牌", "边个牌", "产地", "哪里产", "哪里生产", "边度产", "进口", "国产", "遮光率", "遮光度", "透光率", "百分之几", "开孔率", "功率", "瓦数", "流明", "显色", "参数", "兼容", "联动", "对接",
  ]);
  /* 标准床尺寸（queen / king / 1.8 米床）问的是有没有现成款；带「定做 / make」时才是定制尺寸，资料讲到了 */
  const BED_SIZE = /\b(?:twin|queen|king|cal(?:ifornia)?\s+king|full|double|single)[- ]?(?:size[ds]?|beds?|mattress(?:es)?|frames?|headboards?|sheets?|duvets?|bedding)\b|\bin\s+(?:a\s+)?(?:twin|queen|king)\b/i;
  const SIZE_PRED = /\bcustom\w*|\bmade\s+to\b|\bbespoke\b|\b(?:make|makes|making|build|builds)\b|定做|定制|订做|订造|订制|客制|度身|做成|加长|加宽|加大/i;
  /* 店主没说过的东西：别人家品牌的货（my Article sofa / our Lutron dimmer）。只认大写的品牌名（小写 my jysk bed 走没读懂） */
  const OWNED_BRAND = /\b(?:[Mm]y|[Oo]ur|[Hh]is|[Hh]er|[Tt]heir)\s+(?:(?:new|old)\s+)?(?:[A-Z][\w'&.-]*\s+){1,2}(?=(?:sofas?|couch(?:es)?|sectionals?|beds?|dressers?|tables?|chairs?|desks?|cabinets?|vanit(?:y|ies)|lights?|lamps?|pendants?|chandeliers?|fixtures?|sconces?|dimmers?|blinds?|shades?|curtains?|drapes?|rugs?|floors?|flooring|tiles?|furniture|mattress(?:es)?|chargers?|motors?|remotes?)\b)/;
  /* 改造整间（做厨房 / do my basement / 厨房能做吗）：留言里没有本品类产品时，是装修工程，交给店主 */
  const JOB_RX = rx([
    String.raw`\b(?:do|doing|make|making|build|building|install|installing|design|designing|finish|finishing|redo|update|upgrade)\s+(?:the\s+|my\s+|our\s+|a\s+|an\s+|your\s+)?(?:whole\s+|entire\s+|custom\s+|new\s+)*(?:kitchens?|bathrooms?|washrooms?|basements?|garages?|attics?|house|home|condo|patio|balcony|decks?)\b`,
    "(?:做|整|搞|弄)(?:个|一个|一下|整个|全)?(?:厨房|卫生间|浴室|洗手间|地下室|车库|阁楼|全屋|整屋|房子|阳台|露台)", "(?:厨房|卫生间|浴室|洗手间|地下室|车库|阁楼|全屋|整屋|房子|阳台|露台)(?:也|都)?(?:能|可以|可唔可以)?(?:做|整|搞)(?=吗|嗎|不|唔|么|嘛|$|[\s？?。！!，,])",
  ]);
  /* 泛泛的范围：downtown / the city / bay area / 全国 / 大湾区：问服务范围时按地点待确认处理 */
  const VAGUE_AREA = /\b(?:downtown|uptown|midtown|the\s+city|city\s+(?:centre|center|core)|the\s+core|(?:the\s+)?suburbs|(?:the\s+)?bay\s+area|lower\s+mainland|tri-?state|everywhere|anywhere|nationwide|nationally|province[- ]wide|countrywide|across\s+(?:canada|the\s+country|ontario|the\s+province|the\s+gta|the\s+us|america)|all\s+(?:of|over|across)\s+(?:canada|ontario|the\s+gta|the\s+province|the\s+country|the\s+city|the\s+us)|(?:the\s+)?whole\s+(?:gta|city|province|country)|up\s+north|out\s+west|out\s+east|down\s+south)\b|全国|全省|省内|省外|大湾区|珠三角|长三角|各地|各个城市|哪里都|到处|全港|全台|全加|全美|港九新界|九龙新界/i;
  const VAGUE_IN_CITY = /downtown|uptown|midtown|city\s+(?:centre|center|core)|the\s+core|全省|省内/i;
  const VAGUE_GO = /\b(?:go|goes|going|travel|drive|ship|ships|shipping)\b|去|到|送|装|上门|服务|做/i;
  /* 冲着店 / 人的贬损（老板人很差、你们真的很烂）：不拦截（投诉交给店主），但不算读懂、不上大屏 */
  const NEG_TONE = /(?:你们?|你哋|你地|老板|老细|店主|客服|师傅|服务|态度|这家|这间|呢间|呢家|贵店|人)[^，,。！!？?]{0,4}(?:很|好|太|超|真|勁|劲|极|非常|特别|咁)(?:烂|差劲|差|渣|废|坑人|黑心|无良|恶心|核突|垃圾|屎)/;
  /* 问门店 / 展厅 / 地址：店主回答，不当成服务区问题 */
  const SHOWROOM = rx([
    String.raw`\bshowrooms?\b`, String.raw`\b(?:physical|retail|brick[- ]and[- ]mortar)\s+(?:store|shop|location)`, String.raw`\bwhere\s+(?:are\s+you|r\s+u|is\s+(?:your|the)\s+(?:store|shop|office|location))`,
    String.raw`\byour\s+(?:store\s+|shop\s+)?(?:address|location)\b`, String.raw`\b(?:visit|come\s+(?:in|by)\s+(?:to\s+)?|drop\s+by|stop\s+by)\s*(?:your|the)\s+(?:store|shop)\b`,
    "门店", "展厅", "实体店", "店面", "到店", "进店", "店里", "店内", "门市", "地址", String.raw`(?:你们?|贵店|店|你哋|铺头?)(?:的|嘅)?(?:位置)?(?:在|喺)(?:哪|边度|边)`,
  ]);
  /* 不是在问价的 free：are you free（有空吗）、PVC free / toll free（属性）、feel free */
  const NOT_PRICE = rx([
    String.raw`\b(?:are|r)\s+(?:you|u|ya)(?:\s+guys)?\s+free\b`, "free唔free", String.raw`\bfeel\s+free\b`,
    String.raw`\b(?:toll|pvc|formaldehyde|lead|toxin|toxic|chemicals?|voc|bpa|phthalates?|latex|cord|gluten|odou?r|smoke|maintenance|hassle|worry|stress|dust|glare|fade|wrinkle|iron|tangle|tool|tools|hands|pet|child|scratch|mou?ld|allergen|allergy|cruelty|plastic|emissions?|carbon|cfc|halogen|flicker|mercury)[\s-]+free\b`,
    String.raw`\bfree[\s-]+(?:standing|hanging|flow|form)\b`,
  ], "gi");
  /* 电话号码（北美 416.555.0123 / (416) 555-0123、+区号、内地手机、中文数字串）：客户在留私人联系方式 */
  const PHONE_RX = /(?:\+\s?\d[\d\s.\-()]{6,}\d|(?<!\d)(?:\d[\s.\-]){9,}\d(?!\d)|\(?\b\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b|(?<!\d)1[3-9]\d{9}(?!\d)|[零〇一二三四五六七八九幺两](?:[\s.\-　]*[\d零〇一二三四五六七八九幺两]){6,}|\d{2,}[\s.\-　]*[零〇一二三四五六七八九幺两](?:[\s.\-　]*[\d零〇一二三四五六七八九幺两]){4,}|\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)(?:[\s,.\-]+(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b){6,})/i;
  /* 混写的电话：阿拉伯数字、中文数字、英文数字词（four one six、fifty five、sixteen）、夹在数字里的 o / oh 按位数连起来数，
     中间只隔空格 / 点 / 横线 / 括号 / 逗号（中文数字之间还可以隔 十百千万）；7 位以上就是电话。日期（2025-11-03）、金额（1,500,000）、年份区间不算 */
  const DIGIT_UNIT = /(\d)|([零〇一二三四五六七八九幺两])|\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b|\boh(?=\d)|\b(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b|\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine)\b)?|(?<=\d)[oO](?=[\d\s.\-]|$)|\b[oO](?=\d|\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|zero)\b)/gi;
  const NOT_PHONE = /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4}\s*[-–]\s*\d{4})$/;
  function phoneSpans(s0) {
    const s = String(s0 || "");
    const out = [];
    let run = null;
    const flush = () => { if (run && run.d >= 7 && !NOT_PHONE.test(s.slice(run.i, run.j).trim())) out.push([run.i, run.j]); run = null; };
    for (const m of s.matchAll(DIGIT_UNIT)) {
      const d = m[4] || m[5] ? 2 : 1;
      const i = m.index, j = i + m[0].length;
      if (run) {
        const sep = s.slice(run.j, i);
        if (/^[\s.\-()·,，、/_]*$/.test(sep) || (m[2] && /[零〇一二三四五六七八九幺两]$/.test(s.slice(run.i, run.j)) && /^[十百千万萬]$/.test(sep))) { run.j = j; run.d += d; continue; }
        flush();
      }
      run = { i, j, d };
    }
    flush();
    return out;
  }
  const hasPhone = (s) => phoneSpans(s).length > 0;
  /* 保修期 / 耐用年限：不是工期 */
  const WARRANTY = /(保修|质保|保固|保用|保养期|warrant|guarantee|(?<![灯水钢铜软油气胶吸血])(?:管|保)(?:得)?(?:几|多少|多久)|\bcovered\s+for\b|\bhow\s+long\s+(?:is|are|will|would|does|do)\s+(?:[\w'’-]+\s+){1,5}?(?:be\s+|get\s+|stay\s+)?covered\b|\bgood\s+for\s+\S+\s+(?:more\s+)?years?\b)/i;
  const LIFE = rx([String.raw`how long (?:does|do|will|would|can|should)\b[^,?.!]{0,30}\blast\b`, String.raw`\blife\s?span\b`, String.raw`\bbattery life\b`, "能用多久", "可以用多久", "用多久", "能用几年", "可以用几年", "用几年", "用得几耐", "用几耐", "可以用几耐", "能撑多久", "寿命", "续航"]);
  /* 按分句判断：「今天刚装修完，想做窗帘」「保修多久？下周能装吗」各算各的 */
  /* 「how long do the blinds need to be / how long can the shades be」问长度；「how long do I wait before walking on it」问养护；
     「多久洗一次 / 多久打一次蜡 / how often」问频率：都不是工期 */
  const NOT_TIME = rx([
    String.raw`how\s+long\s+(?:do|does|can|could|should|must|may|might)\s+(?:the|it|they|these|those|this|that|my|your|our|a|an|i|we|you)\b(?:\s+[\w'’-]+){0,3}?\s+(?:(?:need|have|got)\s+to\s+)?be\b`,
    String.raw`how\s+long\s+(?:do|does|should|must|can|would)\s+(?:i|we|you)\s+(?:have\s+to\s+|need\s+to\s+)?(?:wait|leave|let|keep|stay)\b[^?.!]*\b(?:before|after)\b`,
    String.raw`\bhow\s+often\b`,
    /* 「电池充一次电要多久 / 能亮多久 / 灯泡多久变亮」问的是产品本身的时长，不是工期 */
    String.raw`how\s+long\s+(?:do|does|will|would|can|should)\s+(?:the|it|they|a|an|my|your|these|those|one)\b[^?.!]{0,30}?\b(?:take\s+to\s+(?:charge|recharge|warm\s+up|heat\s+up|cool\s+down|dry|cure|open|close|turn\s+on)|run|stay\s+(?:on|lit|charged)|charge)\b`,
    String.raw`how\s+long\s+(?:can|could)\s+(?:you|u)\s+make\b`, String.raw`多久(?:要|需要|得|该|应该)?(?:洗|清洗|清洁|保养|充电|充一次电)`,
    String.raw`(?:多久|多长时间|几(?:天|周|个月|年)|几耐)(?:[^，,。？?！!]{0,4})一次`,
  ], "gi");
  const timeHit = (n) => n.split(/[，,。！!？?;；\n]+/).some((c0) => { const c = c0.replace(NOT_TIME, " "); return c.trim() && !WARRANTY.test(c) && !LIFE.test(c) && (RX.time.test(c) || (RX.timeSoft.test(c) && RX.sched.test(c))); });
  /* 中文辱骂：要求明确谓词，且在句尾或独立成句；「垃圾桶 / 垃圾处理器 / 清运垃圾」之类不拦 */
  const ZH_TRASH_PRED = /(?:(?:你们?|你哋|你地|佢哋)(?:是|系|真是?|真系|就是|就系)?(?:个|一)?群?|真(?:是|系)?|太|简直|好|很|超|巨|非常|特别|什么(?=垃圾(?:店|公司|商家|玩意)))垃圾(?:店|公司|东西|玩意儿?|服务|商家|铺头|铺)?(?:啊|呀|吧|了|啦|嚟|㗎|喎)?(?=$|[\s，。！!？?、,.;；~…])/;
  const ZH_TRASH_ALONE = /(?:^|[\s，。！!？?、,.;；~…])垃圾(?:服务|店|公司|商家|东西|玩意儿?|铺头)?(?:啊|呀|吧|了|啦)?[\s!！。.…~]*$/;
  /* 「服务垃圾」「态度垃圾」「质量也垃圾」：主语在前；「装修垃圾」「东西垃圾」是废料，不拦 */
  const ZH_TRASH_SUBJ = /(?:服务|产品|质量|态度|售后|客服|做工|手艺|老板|老细|店主|师傅|员工|店员|窗帘|沙发|家具|地板|灯)(?:都|也|就|实在|简直)?(?:是|系)?垃圾(?:啊|呀|吧|了|啦|嚟|㗎|喎|死了|透了|得很|到极|到爆|到死|透顶)?(?=$|[\s，。！!？?、,.;；~…])/;
  /* 拦截前归一化：全角转半角；拆掉字母之间的分隔（s.t.u.p.i.d、s h i t、f-u-c-k）；$ ! 1 夹在字母里还原（a$$hole、sh!t、b1tch）；
     星号 / 井号当通配符对照脏话表（sh*t、f*ck、fu*k、a**hole）；汉字之间的空格 / 点也去掉。只用于拦截判断，邮箱的 @ 不动 */
  const PROFANE = ["fuck", "fucking", "fucker", "fucked", "shit", "shitty", "bullshit", "bitch", "bitches", "asshole", "assholes", "cunt", "dick", "dickhead", "bastard", "crap", "crappy", "piss", "stupid", "idiot", "idiots", "moron", "morons", "scammer", "scammers", "loser", "losers", "retard", "retarded", "wanker", "motherfucker", "dumbass", "jerk"];
  const foldAll = (s) => String(s || "").replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, " ");
  function deob(s0) {
    let s = foldAll(s0).toLowerCase();
    s = s.replace(/(?<=[a-z])\$+(?=[a-z]|\b)|(?<![\w$])\$+(?=[a-z]{2})/g, (m) => "s".repeat(m.length)).replace(/(?<=[a-z])[!1|](?=[a-z])/g, "i");
    s = s.replace(/(?<![a-z])[a-z](?:[\s.\-_*·•,'"+~]+[a-z](?![a-z])){2,}/g, (m) => m.replace(/[^a-z]/g, ""));
    /* cheap blinds . ca / cheapblinds dot ca / blindsdirect。com（邮箱的 at … dot 不动） */
    s = s.replace(/(?<!\b(?:at|@)\s*[\w-]+)\s*(?:\.|。|．|\(dot\)|\[dot\]|\s+dot\s+)\s*(com|net|org|ca|co|io|ly|me|info|biz|xyz|shop|store|site|online|link|top|cn|hk|tw|uk|us|au|app)\b/g, ".$1");
    s = s.replace(/[a-z]*[*#]+[a-z*#]*/g, (tok) => {
      if (!/[a-z]/.test(tok)) return tok;
      const re = new RegExp(`^${tok.replace(/[*#]+/g, "[a-z]{1,4}")}$`);
      return PROFANE.find((w) => re.test(w)) || tok;
    });
    return s.replace(/(?<=[㐀-鿿])[\s.\-_*·•,，、~]+(?=[㐀-鿿])/g, "");
  }
  const blockedRaw = (n) => RX.block.test(n) || ZH_TRASH_PRED.test(n) || ZH_TRASH_ALONE.test(n) || ZH_TRASH_SUBJ.test(n);
  const isBlocked = (n) => blockedRaw(n) || blockedRaw(deob(n));

  /* ───────── 离线草稿库：地点 ─────────
     中文：只认带 市/区/县/镇 后缀的词，或下表里的常见地名（繁体先转简再查）。
     英文：区分大小写的专有名词要有地点介词或服务动词；下表里的地名在任何位置都认，小写的只算「拿不准」。 */
  const PLACES_CN = [
    ["广州", "Guangzhou"], ["深圳", "Shenzhen"], ["佛山", "Foshan"], ["东莞", "Dongguan"], ["中山", "Zhongshan"], ["珠海", "Zhuhai"], ["江门", "Jiangmen"], ["惠州", "Huizhou"], ["肇庆", "Zhaoqing"], ["清远", "Qingyuan"], ["汕头", "Shantou"], ["湛江", "Zhanjiang"],
    ["番禺", "Panyu"], ["顺德", "Shunde"], ["南海", "Nanhai"], ["禅城", "Chancheng"], ["三水", "Sanshui"], ["天河", "Tianhe"], ["越秀", "Yuexiu"], ["海珠", "Haizhu"], ["荔湾", "Liwan"], ["花都", "Huadu"], ["增城", "Zengcheng"], ["从化", "Conghua"], ["南沙", "Nansha"], ["黄埔", "Huangpu"],
    ["福田", "Futian"], ["罗湖", "Luohu"], ["南山", "Nanshan"], ["宝安", "Bao'an"], ["龙岗", "Longgang"], ["龙华", "Longhua"],
    ["上海", "Shanghai"], ["北京", "Beijing"], ["天津", "Tianjin"], ["重庆", "Chongqing"], ["杭州", "Hangzhou"], ["苏州", "Suzhou"], ["南京", "Nanjing"], ["无锡", "Wuxi"], ["宁波", "Ningbo"], ["成都", "Chengdu"], ["武汉", "Wuhan"], ["长沙", "Changsha"],
    ["厦门", "Xiamen"], ["福州", "Fuzhou"], ["泉州", "Quanzhou"], ["青岛", "Qingdao"], ["济南", "Jinan"], ["郑州", "Zhengzhou"], ["西安", "Xi'an"], ["合肥", "Hefei"], ["南宁", "Nanning"], ["海口", "Haikou"], ["三亚", "Sanya"], ["昆明", "Kunming"],
    ["贵阳", "Guiyang"], ["沈阳", "Shenyang"], ["大连", "Dalian"], ["哈尔滨", "Harbin"], ["长春", "Changchun"],
    /* 和常用词同形的城市不收：开封、大同、三明、北海、大理（大理石）、日照、长治、包头 */
    ["湖州", "Huzhou"], ["嘉兴", "Jiaxing"], ["绍兴", "Shaoxing"], ["温州", "Wenzhou"], ["金华", "Jinhua"], ["台州", "Taizhou"], ["义乌", "Yiwu"], ["舟山", "Zhoushan"], ["丽水", "Lishui"], ["衢州", "Quzhou"],
    ["常州", "Changzhou"], ["南通", "Nantong"], ["扬州", "Yangzhou"], ["徐州", "Xuzhou"], ["昆山", "Kunshan"], ["镇江", "Zhenjiang"], ["泰州", "Taizhou"], ["盐城", "Yancheng"], ["淮安", "Huai'an"], ["连云港", "Lianyungang"],
    ["石家庄", "Shijiazhuang"], ["太原", "Taiyuan"], ["南昌", "Nanchang"], ["兰州", "Lanzhou"], ["洛阳", "Luoyang"], ["烟台", "Yantai"], ["潍坊", "Weifang"], ["临沂", "Linyi"], ["威海", "Weihai"], ["芜湖", "Wuhu"],
    ["桂林", "Guilin"], ["柳州", "Liuzhou"], ["漳州", "Zhangzhou"], ["莆田", "Putian"], ["晋江", "Jinjiang"], ["潮州", "Chaozhou"], ["揭阳", "Jieyang"], ["梅州", "Meizhou"], ["韶关", "Shaoguan"], ["阳江", "Yangjiang"],
    ["茂名", "Maoming"], ["河源", "Heyuan"], ["汕尾", "Shanwei"], ["云浮", "Yunfu"], ["绵阳", "Mianyang"], ["宜昌", "Yichang"], ["襄阳", "Xiangyang"], ["株洲", "Zhuzhou"], ["岳阳", "Yueyang"], ["遵义", "Zunyi"],
    ["广东", "Guangdong"], ["广西", "Guangxi"], ["福建", "Fujian"], ["浙江", "Zhejiang"], ["江苏", "Jiangsu"], ["湖南", "Hunan"], ["湖北", "Hubei"], ["四川", "Sichuan"], ["海南", "Hainan"],
    ["山东", "Shandong"], ["河南", "Henan"], ["河北", "Hebei"], ["安徽", "Anhui"], ["江西", "Jiangxi"], ["云南", "Yunnan"], ["贵州", "Guizhou"], ["陕西", "Shaanxi"], ["辽宁", "Liaoning"], ["黑龙江", "Heilongjiang"],
  ];
  const PLACES_INTL = [
    ["香港", "Hong Kong"], ["澳门", "Macau"], ["九龙塘", "Kowloon Tong"], ["九龙", "Kowloon"], ["新界", "New Territories"], ["沙田", "Sha Tin"], ["荃湾", "Tsuen Wan"], ["将军澳", "Tseung Kwan O"], ["屯门", "Tuen Mun"], ["元朗", "Yuen Long"], ["大埔", "Tai Po"], ["西贡", "Sai Kung"], ["观塘", "Kwun Tong"], ["铜锣湾", "Causeway Bay"], ["湾仔", "Wan Chai"], ["尖沙咀", "Tsim Sha Tsui"], ["葵涌", "Kwai Chung"],
    ["台北", "Taipei"], ["新北", "New Taipei"], ["桃园", "Taoyuan"], ["台中", "Taichung"], ["台南", "Tainan"], ["高雄", "Kaohsiung"], ["新竹", "Hsinchu"], ["台湾", "Taiwan"],
    ["多伦多|多市", "Toronto"], ["万锦|麦咸", "Markham"], ["旺市|宛市", "Vaughan"], ["列治文山|烈治文山", "Richmond Hill"], ["密西沙加|米西沙加|密市", "Mississauga"], ["宾顿|布兰普顿", "Brampton"], ["奥克维尔", "Oakville"], ["士嘉堡", "Scarborough"], ["北约克", "North York"],
    ["怡陶碧谷", "Etobicoke"], ["汉密尔顿|咸美顿", "Hamilton"], ["渥太华", "Ottawa"], ["蒙特利尔|满地可|蒙特娄", "Montreal"], ["温哥华|温市", "Vancouver"], ["本拿比", "Burnaby"], ["列治文|烈治文", "Richmond"], ["素里", "Surrey"], ["高贵林", "Coquitlam"],
    ["卡尔加里|卡加利", "Calgary"], ["埃德蒙顿|爱民顿", "Edmonton"], ["温尼伯", "Winnipeg"], ["安大略", "Ontario"], ["卑诗", "British Columbia"], ["魁北克", "Quebec"],
    ["纽约", "New York"], ["洛杉矶", "Los Angeles"], ["旧金山|三藩市", "San Francisco"], ["西雅图", "Seattle"], ["波士顿", "Boston"], ["芝加哥", "Chicago"], ["休斯顿", "Houston"], ["法拉盛", "Flushing"], ["尔湾", "Irvine"], ["加州", "California"],
    ["布鲁克林", "Brooklyn"], ["曼哈顿", "Manhattan"], ["新泽西", "New Jersey"], ["波特兰", "Portland"], ["水牛城", "Buffalo"],
    ["悉尼", "Sydney"], ["墨尔本", "Melbourne"], ["布里斯班", "Brisbane"], ["珀斯", "Perth"], ["黄金海岸", "Gold Coast"], ["奥克兰", "Auckland"], ["伦敦", "London"], ["曼彻斯特", "Manchester"], ["新加坡", "Singapore"], ["吉隆坡", "Kuala Lumpur"],
    ["加拿大", "Canada"], ["美国", "USA"], ["英国", "UK"], ["澳洲|澳大利亚", "Australia"], ["新西兰|纽西兰", "New Zealand"],
  ];
  /* 港澳台：留言没有区分字时，店在这里就回繁体 */
  const HANT_REGION = new Set(["Hong Kong", "Macau", "Kowloon Tong", "Kowloon", "New Territories", "Sha Tin", "Tsuen Wan", "Tseung Kwan O", "Tuen Mun", "Yuen Long", "Tai Po", "Sai Kung", "Kwun Tong", "Causeway Bay", "Wan Chai", "Tsim Sha Tsui", "Kwai Chung",
    "Taipei", "New Taipei", "Taoyuan", "Taichung", "Tainan", "Kaohsiung", "Hsinchu", "Taiwan"]);
  const PLACES = [...PLACES_CN.map(([zh, en]) => ({ zh: zh.split("|"), en, cn: true })), ...PLACES_INTL.map(([zh, en]) => ({ zh: zh.split("|"), en, cn: false, hant: HANT_REGION.has(en) }))];
  const EN_ONLY_PLACES = ["Burlington", "Pickering", "Ajax", "Whitby", "Oshawa", "Newmarket", "Aurora", "Barrie", "Milton", "Stouffville", "Thornhill", "Woodbridge", "Kleinburg", "Kitchener", "Waterloo", "Guelph", "Niagara Falls", "St. Catharines", "Victoria", "Halifax", "GTA",
    "Uxbridge", "Bolton", "King City", "Concord", "Nobleton", "Caledon", "Georgina", "Keswick", "Unionville", "East Gwillimbury", "Bradford", "Innisfil", "Orangeville", "Georgetown", "Halton Hills", "Streetsville", "Port Credit", "East York", "York Region", "Durham", "Halton",
    "Kingston", "Peterborough", "Windsor", "Sudbury", "Cambridge", "Brantford", "Welland", "Grimsby", "Red Deer", "Kelowna", "Saskatoon", "Regina",
    "Rochester", "Detroit", "Jersey City", "Bronx", "Long Island", "Staten Island", "Sunshine Coast", "Parramatta", "Chatswood", "Canberra", "Adelaide", "Wellington", "Christchurch", "Birmingham", "Leeds", "Glasgow", "Edinburgh", "England"];
  const ZH2P = new Map();
  const EN2P = new Map();
  for (const e of PLACES) { e.zh.forEach((z) => ZH2P.set(z, e)); EN2P.set(e.en.toLowerCase(), e); }
  for (const en of EN_ONLY_PLACES) EN2P.set(en.toLowerCase(), { zh: [], en, cn: false });
  const EN_ALIAS = { us: "USA", "u.s.": "USA", "u.s.a.": "USA", "united states": "USA", america: "USA", "u.k.": "UK", "united kingdom": "UK", "greater toronto area": "GTA", nyc: "New York", hk: "Hong Kong" };
  for (const [a, en] of Object.entries(EN_ALIAS)) { const e = EN2P.get(en.toLowerCase()); if (e) EN2P.set(a, e); }
  /* 和常用词同形的缩写只认大写：us（我们）≠ US */
  const EN_CS = { us: ["US", "U.S."], hk: ["HK"] };
  const enEntry = (name) => { const low = String(name || "").toLowerCase(); const e = EN2P.get(low); if (!e) return null; const cs = EN_CS[low]; return cs && !cs.includes(name) ? null : e; };
  const ZH_NAMES = [...ZH2P.keys()].sort((a, b) => b.length - a.length);
  /* 地名同时是常用词的一部分：长沙发、中山装、完成都、北京时间、很多市场、美国进口… */
  const COUNTRY_GUARD = (b, a) => /^(?:进口|产|制|货|品牌|标准|牌|式|风|的(?:产品|品牌|货|标准|面料))/.test(a);
  const PLACE_GUARD = {
    长沙: (b, a) => /^发/.test(a),
    /* 「中山装」作名词才跳过；「中山装窗帘」「去中山装」的「装」是安装；「有 / 卖 / 买 / 穿 / 一件中山装吗」是衣服 */
    中山: (b, a) => /^装/.test(a) && !/(?:去|在|到|来|喺|嚟|住)$/.test(b)
      && (/^装(?!窗|帘|百叶|卷|修|灯|地板|柜|门|浴|马桶|上门|吗|嗎|不|唔|得|好|一下|个|[，,。？?！!\s])/.test(a) || /(?:有|冇|卖|买|穿|件|套|做|定做|订做|款)$/.test(b)),
    成都: (b) => /[完变做形达组构合生改分换长造养练写]$/.test(b), 北京: (b, a) => /^时间/.test(a), 海口: (b) => /下$/.test(b), 台中: (b, a) => /^间/.test(a), 南山: (b) => /[江爬上]$/.test(b),
    多市: (b, a) => /[很好许太更最诸众]$/.test(b) || /^[场民面值政区长]/.test(a), 密市: (b, a) => /^场/.test(a), 沙田: (b, a) => /^柚/.test(a),
    美国: COUNTRY_GUARD, 英国: COUNTRY_GUARD, 加拿大: COUNTRY_GUARD, 澳洲: COUNTRY_GUARD, 澳大利亚: COUNTRY_GUARD, 新西兰: COUNTRY_GUARD, 台湾: COUNTRY_GUARD, 香港: COUNTRY_GUARD,
  };
  const SUFFIX_CH = new Set("市区县镇");
  const SUFFIX_NEXT_SKIP = { 市: /^(场|面|值|民|价|政|长|委|内|中心)/, 区: /^(别|分|域|间|块|号|长)/, 县: /^(长|委)/, 镇: /^(定|静|压|痛)/ };
  /* 「服务区 / 服务地区 / 小区 / 山区」是泛称，不当成「X区」地名回显 */
  const SUFFIX_SKIP = /(这|那|哪|什么|怎么|每|各|本|该|此|全|整|外|附近|周边|老城|主城|新城|开发|商业|住宅|别墅|工业|风景|旅游|居民|中心|核心|大城|小城|小县|窗帘|百叶|沙发|桌|椅|床|柜|家具|灯|地板|瓷砖|地毯|马桶|浴缸|垃圾|面料|布料|服务|服務|上门|送货|配送|安装|覆盖|地区|小区|山区|郊区|景区|园区|校区|社区|片区|学区|城区|偏远|高档|豪华|普通|老旧)/;
  const STOP = new Set("在喺到去住送来嚟我你他她它们的是系能和跟与或及还也就都要想从离近靠以为对给帮请问吗呢吧啊有没不可会说那这哪个些么着了过等家边于至往向由被把让用搬回买卖装啦呀哦嘛噢喔唔咩又再很太好嘅◇◆");
  /* 「在X能装吗」「能来X这边吗」「X可以上门吗」「…，我家在X」「服务范围包括X」里的 X 认不出是地名时：交给店主，不替他默认答应。
     这几种句式本身就是在问服务区或报住址；X 前面可以是店主城市（杭州下沙 → 遮掉杭州后还剩下沙） */
  const ZH_DEIX = "(?:这边|那边|那里|这里|附近一带|附近|一带|周边|周围|旁边|隔壁|对面|边上|那块|这块|那片|这片|那一带|这一带|嗰边|嗰度|呢边|呢度|嗰头|呢头|嗰便|呢便|嗰块|嗰附近)";
  /* 地名后面的推测语气（肇庆应该也能送吧 / 清远估计都可以送 / 肇庆也送吗）照样是在问能不能到 */
  const ZH_SOFT = "(?:应该|应当|估计|大概|可能|也许|或许|是不是|是否|会不会|总该|肯定|一定)";
  /* X：汉字地名（小区 + 楼盘、地铁站名可以到 10 个字），或中文句子里的拼音 / 英文小写地名（我住kanata、能来xiasha量尺吗） */
  const ZX = String.raw`\s*◇*\s*([㐀-鿿]{2,10}?|[A-Za-z][A-Za-z'’.-]*[A-Za-z](?:\s+[a-z][a-z'’.-]*[a-z])?)`;
  const ZH_HEAD = String.raw`(?:^|[，,。！!？?；;\s])(?:请问|你好|您好|想问下?|想问一下|请教一下|问下|问一下|麻烦问下|唔该|唔該)?[，,\s]*(?:你们?|贵店|你哋)?(?:那么|那|如果是|如果|要是|假如|若是)?◇*`;
  /* strong：X 在明确的地点位置（在 / 住 / 来 / 送到 / 服务范围包括）：X 里只要还剩两个以上认不出的字就算地名（万象城旁边、海景公寓、佛山隔壁的鹤山）；
     weak：X 在分句开头，常常是产品或房间（飘窗能装吗、电动的呢）：X 里出现任何「不是地名」的词就放过 */
  const ZP = (src, mode, gate) => ({ re: new RegExp(src, "g"), mode, gate });
  const ZH_LOC_PATTERNS = [
    /* 在X能… / 喺X可唔可以… */
    ZP(`(?<![现正还实存所好内自])(?:在|喺)${ZX}${ZH_DEIX}?(?:的话)?(?:能|可以|可不可以|能不能|有没有|有冇|上门|安装|装|送|嚟|来|量|测|也|都)`, "strong"),
    /* 能到X / 去不去X / 可唔可以嚟X / 上门X / 你们来X吗 / 能来X这边吗 */
    ZP(`(?:能到|能去|可以到|可以去|去不去|到不到|送不送|来不来|送到|送去|嚟唔嚟|去唔去|能来|可以来|可唔可以嚟|可唔可以来|可唔可以去|可唔可以到|可以嚟|能嚟|嚟到|过嚟|能过来|可以过来|上门到|上门去|上门|送货到|送货去|来到|去到|有冇得嚟|有冇得去|有冇得到|能不能来|能不能到|能不能去|可不可以来|可不可以到|可不可以去|会不会来|会唔会嚟|(?:你们?|你哋|贵店|师傅)(?:能|可以|会)?(?:到|去|来|嚟))${ZX}${ZH_DEIX}?(?:量|测|装|安装|上门|送|看|帮|度|做|拿|吗|嘛|么|不|呢|啊|吧|呀|嘅|㗎|啦|咩|的话|$|[\\s，,。！!？?])`, "strong"),
    /* （分句开头）X能上门吗 / 那X能上门吗 / X的话能上门吗 / X有冇得上門 */
    ZP(`${ZH_HEAD}([㐀-鿿]{2,8}?)${ZH_DEIX}?(?:的话|呢)?[，,\\s]*${ZH_SOFT}?(?:也|都)?(?:能装(?!好)|能上门|能送|去不去|送不送|可以装|装不装|能到|可以上门|可以送|可以安装|能安装|能量|可以量|上门吗|送货吗|安装吗|能不能(?:上门|到|送|装|来)|可不可以(?:上门|到|送|装|来)|可唔可以(?:上门|到|送|装|嚟|量)|有冇得(?:上门|到|送|装|量)|上唔上门|送唔送|装唔装|嚟唔嚟|去唔去)`, "weak"),
    /* X也可以吗 / X都送吗：拿 X 和前面说的地方比 */
    ZP(`${ZH_HEAD}([㐀-鿿]{2,8}?)${ZH_DEIX}?${ZH_SOFT}?(?:也|都)(?:可以|能|行|得|送|上门|装|去|到|来|嚟)`, "weak"),
    /* 分句开头只报一个地方再问：X呢？ / X可以吗？ / X的话… / X这边，（只在问上门、服务区时看） */
    ZP(`${ZH_HEAD}([㐀-鿿]{2,8}?)(?:${ZH_DEIX}(?=[，,。！!？?；;\\s]|$)|${ZH_DEIX}?(?:呢|的话|可以吗|可以嘛|可以不|可不可以|行吗|行不行|[oO][kK]吗|[oO][kK]不|得唔得|可唔可以|得吗)(?=[，,。！!？?；;\\s]|$)`
      + `|${ZH_DEIX}?${ZH_SOFT}?(?:也|都|还)?(?:可以吧|行吧|没问题吧|冇问题啩|没问题|冇问题|得啩|得挂)(?=[，,。！!？?；;\\s]|$))`, "weak", "intent"),
    /* X有上门服务吗 / X有冇送货 */
    ZP(`${ZH_HEAD}([㐀-鿿]{2,8}?)${ZH_DEIX}?(?:有没有|有冇|有)(?:上门|送货|安装|配送|量尺)(?:服务)?(?:吗|嘛|么|不|呢|$|[\\s，,。！!？?])`, "weak"),
    /* 我家在X / 本人在X / 我喺X / （分句开头）住X、住喺X */
    ZP(`(?:(?:我家|我们家|我屋企|屋企|我|我们|我哋|家|本人|人|地址|住址|房子|新房|新屋|新居)(?:在|喺|住在|住喺|住)|(?:^|[，,。！!？?；;\\s])(?:住在|住喺|住))${ZX}(?=$|[\\s，,。！!？?、；;]|${ZH_DEIX}|能|可以|可唔可以|可不可以|上门|有冇|有没有|的话|嘅|要|想|需要|准备|打算|请问|麻烦)`, "strong"),
    /* 坐标X / 地址：X */
    ZP(`(?:坐标|定位|地址|住址)(?:在|喺|是|系)?[:：]?${ZX}(?=$|[\\s，,。！!？?、；;]|${ZH_DEIX}|能|可以|上门|有冇|的话|嘅)`, "strong"),
    /* 服务范围包括X / 服务范围有没有到X */
    ZP(`(?:服务|上门|送货|配送|安装)(?:范围|区域|区|地区)(?:内)?(?:包括|包含|包不包括|包唔包括|包唔包|有没有|有冇|含|涵盖|覆盖|能到|到|去到)(?:到)?${ZX}(?=${ZH_DEIX}|吗|嘛|么|不|呢|啊|吧|嘅|$|[\\s，,。！!？?])`, "strong"),
    /* X在服务范围内吗 / X算唔算你哋服务范围 / X属于服务区吗 */
    ZP(`${ZH_HEAD}([㐀-鿿]{2,10}?|[A-Za-z][A-Za-z'’.-]*[A-Za-z])${ZH_DEIX}?(?:也|都|是不是|是否)?(?:在|喺|属于|属唔属于|属不属于|算|算不算|算唔算|在不在|喺唔喺|有没有在|有冇喺)(?:你们?|你哋|贵店)?(?:的|嘅)?(?:服务|上门|送货|配送|安装)(?:范围|区域|区|地区|范畴)`, "strong"),
  ];
  /* 我系天水围嘅 / 我们是下沙这边的：在问价、问上门时也算报住址 */
  const ZH_FROM_PATTERN = ZP(`(?:我|我们|我哋|本人)(?:系|是)(?:住)?${ZX}${ZH_DEIX}?(?:嘅|的|人)(?=$|[\\s，,。！!？?]|人|居民|街坊)`, "strong");
  /* 店主城市后面跟「附近 / 隔壁 / 以外 / 周边」，或者留言自己说在外地、镇上、郊区：不算城市里面，交给店主 */
  const ZH_NEAR_CITY = /◇+(?:的)?(?:附近|周边|周围|隔壁|旁边|边上|以外|之外|外面|外围|郊区|郊外|乡下|下面|下辖|下属|旁)|(?:离|距离|距|近)◇+(?:市|区)?(?:很|好|挺|蛮|比较|都|也|还|就|唔|不|没|冇)?(?:近|远|几远|多远|唔远|不远|没多远|冇几远|不算远|唔算远|几公里|几分钟)/;
  const ZH_OUTSIDE = /外地|外省|外市|郊区|郊外|乡下|农村|镇上|村里|山区|偏远|县城|远郊|隔壁(?:市|县|城|镇|区)|周边(?:城市|县|镇|地区|区域)|市外|城外|省外|公里外|开车.{0,4}(?:小时|分钟)|(?:半|一|两|二|三|四|五|几|十|二十|三十|\d+)(?:个)?(?:多)?(?:小时|分钟)车程/;
  /* 候选里出现这些才算「确定不是地名」（语法字、时间、产品、房间、方位泛称、渠道、人、动作）；其余认不出的一律交给店主。
     天 上 下 门 店 内 里 边 外 东 西 南 北 都 太 会 回 来 布 安 修 国 房 家 楼 周 月 是地名常用字（天水围、上水、下沙、门头沟、新店、内湖、
     里水、布吉、房山、鼓楼、周庄、回龙观、来宾、太原、新会、成都），只按整词排除，不按单字 */
  const NOT_PLACE_ZH_PARTS = [
    "[你我他她您们吗嘛呢吧啊呀哦么的了是系也就还又再很请问谁咩嘅啲哋佢冇唔喺嚟咗乜怎哪这那啥几得想要能可没不有去到送装量测尺看拿取帮做拆换洗搬等找趟次遍刚今早晚午夜时点款种样件套色货窗帘桌椅床柜灯墙厨浴厅室层杆枕盆架铝钢米宽亲选挑逛忙睇吓嘢搞]",
    /* 时间（「天后」是地名，「后天」才是时间） */
    "现在|天天|聊天|天气|[今明后昨前这那哪半一两三四五六七八九十几每当白春夏秋冬雨晴]天|周末|周[一二三四五六日天]|[上下这本每一两几]周|上午|下午|中午|傍晚|马上|最近|以后|之后|以前|之前|星期|礼拜|个月|[上下这本]个?月|月[底初中尾]|年[底前后内]|[今明去]年|节[前后]|假期|交房|交楼|收楼|入伙|入住|下单|到时",
    /* 数量、尺寸：三米宽、两扇、一套 */
    "[\\d一二两三四五六七八九十几半百]+\\s*(?:米|厘米|公分|寸|尺|扇|张|条|樘|幅|平|个|件|套|片|块|对|层|楼|间|面|次|趟)",
    /* 产品、房间、结构（含粤语：梳化 = 沙发、牀褥、餐檯、光管、企缸、被鋪） */
    "百叶|沙发|梳化|家具|家私|傢俬|家居|家纺|地板|瓷砖|地砖|地毯|马桶|花洒|龙头|面盆|洗手盆|垃圾|布料|布样|布艺|面料|被子|被套|被铺|床垫|床褥|坐垫|地垫|垫子|电动|遥控|电机|电池|东西(?!湖)|产品|材料|五金|轨道|电线|插座|开关|样品",
    "茶几|餐台|餐桌|饭台|饭桌|书台|书桌|书柜|衣柜|鞋柜|电视柜|梳妆台|床头柜|光管|吊灯|台灯|落地灯|筒灯|射灯|灯带|吸顶灯|浴室柜|镜柜|企缸|淋浴房|浴缸|踢脚线|地脚线|扣条|收边条|防潮垫|窗纱|纱窗|卷帘|罗马帘|百折帘|蜂巢帘|斑马帘|柔纱帘|梦幻帘|天棚帘",
    "房[间子屋]|[新旧书客卧楼平手坯厨库样板租婚梯电厂民整全童儿]房|[主次客]卧|整栋|整层|整套|全套|别墅|公寓|阁楼|阳台|露台|平台|天井|卫生间|洗手间|厕所|车库|地下室|天花|天窗|天台|天面|屋顶|吊顶|顶棚|斜顶|全屋|整屋|整面|拐角|转角|角落|电梯|走廊|楼道|过道|玄关",
    "落地|飘窗|推拉|平开|内开|外开|铝合金|合金|塑钢|断桥|弧形|异形|八角|老式|新式|欧式|中式|美式|现代|简约|北欧|日式|法式|复古|高档|豪华|普通|老旧|新建|二手|毛坯|精装|简装|复式|跃层|平层|洋房|叠拼|联排|独栋|排屋|高层|低层|多层|小高层|大户型|小户型|户型",
    "门窗|门帘|门口|门外|门内|门上|门框|[木铁璃盗推拉移房大户卧厨浴厕柜衣]门|窗户|楼上|楼下|楼梯|[一二三四五六七八九十\\d几高低顶]楼|写字楼|商铺|铺面|铺头|酒店|宾馆|医院|仓库|餐馆|饭店",
    "玻璃|石膏|木板|板材|水泥|混凝土|瓷砖|地暖|地热|暖气|空调|热水器|电器|家电|建材|宜家|居然之家|美凯龙|百安居|银行|美团|点评|饿了么|得物|唯品会|苏宁|国美",
    /* 方位、泛称、渠道、场所 */
    "附近|周边|周围|旁边|隔壁|对面|边上|本地|当地|外面|里面|上面|下面|前面|后面|[外里上下东西南北海江河湖路]边|这儿|那儿|呢度|嗰度|边度|家里|家中|屋里|屋企|店里|店内|店面|门店|本店|分店|小店|实体店|专卖店|店铺",
    "室内|室外|户外|国内|国外|海外|外国|全国|中国(?!城)|境内|境外|市内|市里|市区|城区|市中心|本市|全市|同城|城里|区内|区里|小区|楼盘|社区|现场|网上|网店|线上|线下|官网|淘宝|天猫|京东|拼多多|抖音|小红书|微信|闲鱼|小程序|公众号|朋友圈|直播|视频|商场|展厅|展会|展台|展位|广交会|交易会|博览会|会展|工地|公司|单位|学校|工厂|厂里|地方|路上|车上|一下|一起",
    /* 人、动作 */
    "老板|师傅|店主|客服|朋友|老公|老婆|妈|爸|父母|亲戚|孩子|小孩|家人|邻居|同事|客户|客人|业主|房东|自己|老人|长辈|设计师|专人|工人|员工|店员|销售|业务员|贵店|南方|北方",
    "服务|新来|刚来|本来|原来|后来|认真|真心|诚心|开玩笑|说真|第一次|新手|学生|返工|放工|收工|开工|做嘢|食饭|瞓觉|揸车|上班|下班|工作|开会|出差|上学|放假|休假|度假|旅游|旅行|出门|外出|吃饭|睡觉|开车|休息|犹豫|纠结|考虑|比较|对比|比价|研究|了解|咨询|准备|规划|计划|功课|装修|搬家|看房|买房|租房|维修|修理|上门|过来|过去|回来|回去|出来|什么|多少|多久|如何|是否|回复|消息|信息|通知|电话|检查|检测|查看|评估|设计|讲解|演示|调试|指导|报价|估价|交流|沟通|聊聊|签约|验收|复尺|复测|帮忙|处理|清理|安排|确认|预约|包括|包含|覆盖|涵盖|范围|区域|地区|到府|府上|丈量|度尺|宿舍|寝室|办公|民宿|出租屋|出租房|门面|厂房|会所|幼儿园|诊所|工作室|样板间|售楼处|物业|快递柜|驿站",
  ];
  /* 第一段是单字类，只给「不是地名」判断用；覆盖率闸门只取后面的整词（逐字删除会把千灯湖的「灯」删掉） */
  const NOT_PLACE_ZH = new RegExp(NOT_PLACE_ZH_PARTS.join("|"));
  const notPlaceZh = (x) => NOT_PLACE_ZH.test(x) || RX.time.test(x) || RX.timeSoft.test(x) || RX.price.test(x) || factHit(x);
  /* strong 位置：把「不是地名」的词都抠掉，还剩两个以上的字才算地名；动词、代词开头的（我在等你们回复、我在那个小区）不算 */
  const PLACE_LEX = [NOT_PLACE_ZH, RX.time, RX.timeSoft, RX.price, ...Object.values(CATS).flatMap((c) => c.facts.map((f) => f.key))].map((r) => new RegExp(r.source, "gi"));
  const ZH_VERB0 = /^[等找看做想要帮拿取选挑逛忙去到送装量测度拆换洗搬请问是有没不能可也就还又再很刚你我他她您们这那哪啥什怎几每各府丈睇]/;
  /* weak 位置：「在家能装吗」「去公司能送吗」的 X 是介词短语，不是地名 */
  const notPlaceWeak = (x) => /^[在喺住于]/.test(x) || ZH_VERB0.test(x) || notPlaceZh(x);
  const notPlaceStrong = (x) => ZH_VERB0.test(x) || !/[㐀-鿿]{2,}/.test(PLACE_LEX.reduce((s, r) => s.replace(r, " "), x));
  const ZH_LOC_MARK_L = /(?:在|喺|到|去|住|送|来|嚟|于|近|靠近|\bin|\bto|\bnear|\baround|\bat|\bfrom)\s*$/i;
  /* 地名后面的推测 / 距离说法（肇庆估计没问题吧 / 肇庆离你们不远 / 清远很近 / 新竹就在旁边）同样是在问能不能到 */
  const ZH_LOC_MARK_R = new RegExp(`^\\s*(?:这边|那边|那里|附近|一带|吗|呢|的话|${ZH_SOFT}?(?:也|都|还)?(?:能|可以|可不可以|能不能|有没有|上门|去不去|送不送|装不装|可唔可以|得唔得|有冇|上唔上门|送唔送|装唔装|送货|送到|送去|配送|安装)|${ZH_SOFT}?(?:也|都)(?:送|装|行|得|来|去|到|嚟)`
    + `|${ZH_SOFT}?(?:也|都|还)?(?:没问题|冇问题|没有问题|无问题|可以吧|行吧|得啩|得挂|[oO][kK]吧)|(?:的话)?[，,\\s]*(?:离|距离|距)|(?:很|好|挺|蛮|超|都|也|还|就)?(?:近|不远|唔远|不算远|没多远|冇几远)|(?:就)?在(?:旁边|隔壁)|开车)`);
  /* 留言里的距离说法：表外地名（开平应该可以吧，不远）在这种句子里同样按地点待确认 */
  const ZH_DIST = /(?:离|距离|距)(?:你们?|你哋|你地|◇+|贵店|你家|你那边?|这边|那边)?[^，,。！!？?]{0,3}?(?:近|远)|(?:很|好|挺|蛮|超)近|不远|唔远|不算远|没多远|冇几远|就在(?:旁边|隔壁|附近)|开车[^，,。！!？?]{0,4}(?:分钟|小时)/;
  /* 送货 / 安装 / 上门意图（找地名用；「送不送窗帘杆」这类赠品在 giftStrip 里已经抹掉） */
  const ZH_SVC_Q = /送(?:货|到|去|上门|过去|过来|唔送|不送)|(?:能|可以|可唔可以|可不可以|能不能|也|都|会)送|送(?:吗|嗎|不|唔|吧|呢|么|嘛|啩|挂|得)|配送|上门|安装|(?:能|可以|也|都|会)装|装(?:吗|嗎|不|唔|吧|呢|么)|(?:能|可以|可唔可以|能不能|也|都|会)(?:来|嚟|过来|过去|到)(?:吗|嗎|不|唔|吧|呢|么|啩|挂)?/;
  const EN_SPAN = /\b(?:St\.\s+)?[A-Z][A-Za-z'’-]*[A-Za-z](?:\s+[A-Z][A-Za-z'’-]*[A-Za-z]){0,2}/g;
  const EN_STRONG_L = /(?:\b(?:install|deliver|serve|service|ship|cover|travel|drive|work|move|moving|visit)(?:s|es|ed|d|ing|ping|ped)?\s+(?:out\s+|over\s+|up\s+|down\s+)?(?:in|to|near|around|into|across|throughout|all\s+over|within)|\b(?:come|comes|coming|go|goes|going)\s+(?:out\s+|over\s+|up\s+|down\s+)?(?:to|near|around|across)|\b(?:am|are|is|i'?m|we'?re|live|lives|living|located|based|reside|residing|stay|staying)\s+(?:(?:right|just|actually|currently|now|also|really|pretty|very|literally)\s+)*(?:out\s+|up\s+|down\s+|over\s+)?(?:in|near|around|at|by|on|off|beside|behind|opposite|next\s+to|close\s+to|across\s+from|outside(?:\s+of)?)|\b(?:i'?m|i\s+am|we'?re|we\s+are)\s+(?:(?:originally|actually|just)\s+)?from|\b(?:greetings|hello|hi|hey|writing|messaging|calling|texting|commenting|homeowners?|neighbou?rs?|residents?|someone|family|folks)\s+(?:here\s+)?from|\b(?:serve|serving|service|servicing|cover|covering|reach|visit|include|includes|including|across|throughout|all\s+over)|在|喺|到|去|住|送到|来|嚟)\s*(?:the\s+)?$/i;
  /* 「X is it in your area」「Is X too far」「come out X way」「X area」：右边的话说明 X 是地点 */
  const EN_STRONG_R = /^(?:\s*,)?\s*(?:(?:is|are)\s+(?:it|that|this|they|we)?\s*|are\s+(?:you|u)\s+)?(?:in|within|inside|part\s+of|covered\s+by)\s+(?:your|ur|the)\s+(?:service\s+|delivery\s+|install(?:ation)?\s+|coverage\s+)?(?:area|zone|range|radius|region|map)\b|^\s+(?:area|region|way)\b|^\s+(?:is\s+|are\s+)?(?:too\s+far|that\s+far|far\s+(?:for|from)|out\s+of\s+(?:your|the)\s+(?:way|range|area))|^\s*(?:这边|那边|附近|一带|(?:能|可以|可唔可以|有冇得|能不能)?(?:上门|到|送(?!货)|过来)|上唔上门|送唔送)/i;
  const EN_WEAK_L = /\b(?:in|to|near|around|into|across|throughout|from|at|by|on|off|beside|behind|opposite|next\s+to|close\s+to|across\s+from|outside(?:\s+of)?|past|beyond)\s+(?:the\s+)?$/i;
  const EN_PREP_L = /\b(?:in|to|near|around|across|throughout|from|at|into|over|out|by|off|beside|behind)\s+(?:the\s+)?$/i;
  /* 「made by Hunter Douglas」「referred by Jane」：by 后面是人或品牌，不是地点 */
  const EN_BY_NOT = /\b(?:made|designed|built|installed|sold|done|manufactured|referred|recommended|sent|told|posted|shared|written|run|owned|operated|reviewed|powered|controlled|inspired|approved|certified)\s+by\s+(?:the\s+)?$/i;
  /* 只报一个名字再问（Leslieville? / Bolton here / What about X?）：可能是地点也可能是人，表里的地名才回显 */
  const EN_FRAG_L = /(?:^|[.!?;:]\s*)$/;
  const EN_FRAG_R = /^\s*(?:\?|here\b(?!\s+(?:is|are|was|were)\b)|-\s|–|—)/i;
  const EN_ABOUT_L = /\b(?:what|how)\s+about\s+(?:the\s+)?$/i;
  /* 句首只报一个地方来问（Is Markham OK? / What about Markham? / Stouffville too? / And Bolton?）：表里的地名不要求另有服务动词 */
  const EN_ASK_L = /(?:^|[.!?;:,]\s*)(?:(?:and|so|but|also|then|ok|okay|hmm|oh)\s*,?\s+)?(?:is|are|and|or|also|even|maybe|perhaps|plus|what\s+about|how\s+about)\s+(?:the\s+)?$/i;
  const EN_ASK_R = /^\s*(?:,\s*)?(?:(?:ok|okay|fine|good|alright|covered|included|possible|doable|too|also|as\s+well|then|though|either|maybe|perhaps)\s*)*(?:\?|$)/i;
  /* 推测语气里的地名（Barrie should be covered too / Alliston should be fine right? / Bolton too I assume? / Nobleton is just next door）：同样待店主确认 */
  const EN_SPEC_L = /(?:^|[.!?;:,]\s*)(?:(?:and|so|but|also|then|ok|okay|i\s+(?:guess|assume|think|suppose|hope|figure)|(?:i'?m|i\s+am)\s+(?:guessing|assuming|hoping)|probably|surely|hopefully|presumably)\s*,?\s+)*(?:that\s+)?$/i;
  const EN_SPEC_R = /^\s+(?:(?:should|would|will|must|ought\s+to)\s+be\s+(?:(?:also|too|probably|surely)\s+)?(?:fine|ok|okay|good|alright|covered|included|doable)\b|(?:is|are)\s+(?:(?:also|probably|surely|still|just|right|pretty|really|very|so)\s+)*(?:fine|ok|okay|good|alright|covered|included|next\s+door|nearby|close\s+by|not\s+(?:that\s+|too\s+|very\s+)?far)\b|too\s*(?:,?\s*(?:i\s+(?:assume|guess|hope|think|suppose)|right|then))?\s*[?.!]*\s*$|(?:as\s+well|also)\s*[?.!]*\s*$)/i;
  /* 推测 / 距离说法（should be covered / fine too / next door / it's close / not far）：表里的地名在这类留言里任何位置都算 */
  const EN_SVC_SPEC = /\bcovered\b|\b(?:fine|ok|okay|good|alright)\s+too\b|\bshould\s+be\s+(?:fine|ok|okay|good|alright|covered)\b|\bnext\s+door\b|\bnot\s+(?:that\s+|too\s+|very\s+|so\s+)?far\b|\bclose\s+(?:by|to\s+(?:you|u|your|ur))\b|\b(?:it'?s|is)\s+(?:really\s+|pretty\s+|very\s+|so\s+|super\s+)?close\b|\btoo\s*,?\s*i\s+(?:assume|guess|suppose|hope|think)\b|\bi\s+(?:assume|guess|suppose)\b/i;
  /* 推测句里认不出的词：这些是泛指，不是地名（Everything should be fine） */
  const EN_SPEC_SKIP = new Set("everything anything something nothing everyone anyone it this that which mine ours yours theirs one ones both all either neither each size colour color price timing measurement measurements install installation delivery quality fabric material finish width height length depth".split(" "));
  /* 每个词首字母都大写的留言（Hi, I'm In Markham / Do You Go To Markham）：大写的虚词、常用动词按小写看，和普通写法一致；表里的地名（Richmond Hill / King City）不动 */
  const TC_FOLD = new Set(("in to at on by of for from into onto near around about over up out off with within inside outside past beyond the a an and or but so if "
    + "is are was were be am do does did can could will would should shall may might must have has had go goes going come comes coming install installs installing deliver delivers delivering delivery "
    + "service services serve serves cover covers covered travel live lives living located based stay staying reside you your ur u we our us they their them it its i'm im i've i'd i'll we're we've you're "
    + "my me he she his her this that these those there here where what when which who why how hi hello hey dear please pls thanks thank ok okay too also as well very really pretty quite just only still even "
    + "almost like kinda right next far nearby area region team guys company not any chance").split(" "));
  function titleFold(s) {
    const keep = [...s.matchAll(EN_TABLE_RX)].map((m) => [m.index, m.index + m[0].length]);
    /* 句首的词不动（Do / Is / Service 在句首本来就大写，由 stripLead 处理） */
    return s.replace(/\b[A-Z][a-z'’]*\b|\bOK\b/g, (w, i) => (keep.some(([x, y]) => i >= x && i < y) || /(?:^|[.!?;:]\s*)$/.test(s.slice(0, i)) || !TC_FOLD.has(w.toLowerCase().replace(/’/g, "'")) ? w : w.toLowerCase()));
  }
  /* 「Yonge and Steeles」「Bayview/Sheppard」「Bathurst & Steeles」：十字路口只算一个地点，不回显半个 */
  const EN_CROSS_L = /\b(?:at|by|off|near|around|on|beside|behind|close\s+to|next\s+to|across\s+from|corner(?:\s+of)?|intersection(?:\s+of)?)\s+(?:the\s+)?$/i;
  const EN_CROSS_R = /^\s*(?:&|\/|\+|@|\band\b|\bat\b)\s*(?:(?:[A-Z][A-Za-z'’.-]*[A-Za-z])(?:\s+[A-Z][A-Za-z'’.-]*[A-Za-z])?|\d+(?:st|nd|rd|th)\b|(?:hwy|highway)\s*\d+)/i;
  /* 中文句子里英文名接「同 / 和 / 交界」：路口（央街同Finch），不回显半个 */
  const ZH_CROSS = /(?:同|和|与|跟|及|交界|路口|十字路口|交汇)\s*$/;
  const ZH_CROSS_R = /^\s*(?:同|和|与|跟|及|交界|路口|十字路口|交汇)/;
  /* 店主城市前面是 close to / just outside / north of / 30 min from：不算城市里面 */
  const EN_NEAR_L = /\b(?:close\s+to|near(?:\s+to)?|nearby|outside(?:\s+of)?|just\s+(?:outside|past|beyond|north|south|east|west)(?:\s+of)?|(?:north|south|east|west)\s+of|past|beyond|(?:minutes?|mins?|hours?|hrs?|km|kms|miles?)\s+(?:\w+\s+)?(?:from|outside|out\s+of|away\s+from|of|north\s+of|south\s+of|east\s+of|west\s+of)|away\s+from|far\s+from|out\s+of|surrounding|around|bordering|border\s+of|edge\s+of|outskirts\s+of|adjacent\s+to|neighbou?ring)\s+(?:the\s+)?$/i;
  const EN_OUTSIDE = /\b(?:outside(?:\s+of)?\s+(?:the\s+)?(?:city|town|gta|area|region|downtown|core)|out\s+of\s+(?:town|the\s+city|the\s+area|your\s+area)|(?:north|south|east|west)\s+of\s+(?:the\s+)?(?:city|town|here|you|downtown)|(?:\d+|an?|one|two|three|four|five|half\s+an?|a\s+few|few|a\s+couple(?:\s+of)?)\s*[- ]?(?:min(?:ute)?s?|hours?|hrs?|km|kms|kilomet(?:re|er)s?|miles?|mi)\s+(?:\w+\s+){0,2}?(?:north|south|east|west|away|outside|out\s+of|from\s+(?:you|u|your|here|there|the\s+(?:city|shop|store|showroom))|drive|past)\b|the\s+(?:boonies|countryside)\b|rural\b|cottage\s+country\b)/i;
  /* 街道地址、公路、邮编：认不出具体在哪，交给店主，不回显 */
  const EN_ADDR = /\b\d{1,6}[A-Za-z]?\s+(?:[A-Z][A-Za-z'’.-]*\s+){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Cres|Crescent|Blvd|Boulevard|Ct|Court|Cir|Circle|Way|Lane|Ln|Pl|Place|Terr?|Terrace|Trail|Trl|Pkwy|Parkway|Hwy|Highway|Gate|Gdns|Gardens|Sq|Square|Line|Sideroad|Concession|Heights|Hts|Grove|Close|Row|Path|Walk|Mews)\b\.?(?:\s*,?\s*(?:(?:Unit|Apt|Suite|#)\s*\w+\s*,?\s*)?[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*){0,2})?/g;
  const EN_ROAD = /\b(?:hwy|highway|route|rte|regional\s+road|county\s+road)\.?\s*#?\d+[a-z]?\b(?:\s*(?:&|and|\/|at)\s*[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)?)?/gi;
  const EN_POSTAL = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z](?:[ -]?\d[ABCEGHJ-NPRSTV-Z]\d)?\b|\b[abceghj-nprstvxy]\d[abceghj-nprstv-z][ -]?\d[abceghj-nprstv-z]\d\b|\b(?:zip|postal)(?:\s*code)?\s*(?:is|:|#)?\s*\d{5}(?:-\d{4})?\b|\b(?:in|at|near)\s+\d{5}\b(?!\s*(?:sq|square|ft|feet|dollars|\$))/gi;
  /* 「comes in Sage」「have it in Walnut」「made in Italy」「ships from China」：说的是款式或产地，不是地点 */
  const EN_NOT_LOC_L = /\b(?:come|comes|coming|available|offered|made|have (?:it|them|this|that|these|those|one)|get (?:it|them|one)|it|them|one|ones)\s+in\s+(?:the\s+)?$/i;
  const EN_FROM_L = /(?:\b(?:imported|manufactured|produced|built|designed|sourced|shipped|ships|ship)\s+(?:in|from)\s+|(?<!\b(?:i'?m|i\s+am|we'?re|we\s+are|greetings|hello|hi|hey|writing|messaging|calling|texting|commenting|homeowners?|neighbou?rs?|residents?|someone|family|folks|here|originally|actually|just|far|away|minutes?|mins?|hours?|hrs?|kms?|miles?)\s+)\bfrom\s+)(?:the\s+)?$/i;
  /* 「deliver the Aspen sofa in X」「install the shades in X」：the + 产品 + in 后面多半是颜色 / 房间 */
  const EN_ATTR_L = /\bthe\s+(?:[\w'’-]+\s+){1,3}in\s+$/i;
  /* 「the Manhattan sofa」「Windsor chair」：地名后面紧跟产品名，是款式名 */
  const EN_PRODUCT_R = /^\s+(?:sofas?|sectionals?|couch(?:es)?|beds?|chairs?|tables?|desks?|dressers?|cabinets?|vanit(?:y|ies)|lamps?|pendants?|chandeliers?|sconces?|collection|series|line|model|style|blinds?|shades?|shutters?|curtains?|drapes?|rugs?|tiles?|planks?|floors?|flooring|fabrics?|finish|frames?|grey|gray|blue|white|black|oak|walnut|check|checks|plaid|print|prints|pattern)\b/i;
  const EN_CHAIN = /^\s*(?:,|\/|&|\+|\bor\b|\band\b)\s*(?:(?:or|and|maybe|possibly|perhaps|also|even|probably|then)\s+)*$/i;
  /* 「Vaughan or also barrie / Vaughan + stittsville」：连写在已认出的地点后面的小写词 */
  const EN_CHAIN_WORD = /^\s*(?:,|\/|&|\+|\bor\b|\band\b)\s*(?:(?:or|and|maybe|possibly|perhaps|also|even|probably|then|nearby|near|around|like|somewhere|places|areas|such|as|e\.?g\.?|including)\s+)*([a-z][a-z'’.-]*(?:\s+[a-z][a-z'’.-]*)?)(?=\s*(?:[?.!,;)]|$)|\s+(?:area|region|city|town|too|also|as\s+well|please|pls)\b)/;
  /* Gold Coast / King City / White Rock：首词撞颜色或常用词，但整体是地名 */
  const PLACE_TAIL = /\s(?:City|Coast|Hill|Hills|Beach|Bay|Falls|Heights|Park|Village|Valley|Island|Islands|Springs|Lake|Lakes|Point|Harbour|Harbor|Creek|Ridge|Ridges|Rock|County|Township|Mills|Grove|Gardens|Junction|Landing|Shore|Shores|Station|Square|Town|Region|Peninsula|Corners|Crossing|Glen|Woods|Meadows|Estates)$/;
  const EN_LEAD = new Set(("do does did can could will would should shall is are was were am how what where when which who why hi hello hey dear please pls and but so also just any anyone anybody "
    + "thanks thank yes no ok okay sorry well oh wow asking looking need want got get have has had if then there here let tell quick question i'm im we're i'd i'll we'll").split(" "));
  const EN_NOT = new Set(("the a an my our your his her their its this that these those i we you he she they it me us them "
    + "january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec "
    + "monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun "
    + "winter summer spring fall autumn christmas xmas easter thanksgiving halloween english chinese mandarin cantonese french spanish "
    + "black white grey gray beige ivory navy cream linen charcoal walnut oak espresso natural silver gold bronze brass chrome "
    + "sage matte matt satin gloss glossy brushed nickel taupe sand slate graphite pewter oatmeal mocha olive teal blush ebony teak mahogany cherry birch hickory ash "
    + "snow pearl smoke fog mist dove bone sky ocean moss rose coral terracotta rust copper champagne platinum gunmetal onyx midnight indigo denim emerald jade mint "
    + "lavender lilac plum burgundy wine mustard ochre camel tan khaki truffle chocolate caramel honey light dark pale warm cool bright soft deep red blue green yellow orange pink purple brown "
    + "kitchen kitchens bedroom bedrooms bathroom bathrooms washroom washrooms basement basements attic garage garages office offices living dining family master guest nursery den foyer "
    + "hallway hall stairs staircase studio loft lobby patio sunroom condo condos apartment apartments townhouse townhouses house houses home homes cottage cottages unit units suite "
    + "store stores showroom warehouse building buildings tower towers penthouse room rooms window windows door doors downtown "
    + "service services servicing delivery deliveries shipping installation installations install installer installers coverage "
    + "king queen twin full double single stock time ai am pm asap ok hi hello hey thanks thank please yes no sorry "
    + "instagram facebook whatsapp wechat google amazon costco ikea wayfair walmart hunter silhouette zebra roller roman levolor graber lutron somfy bali "
    /* 人（Mom's house / Grandma's place）、房型和场所（Apt 5 / RVs / Airbnbs / Bay Windows / Canton Fair）、平台、快递、零售商、节日 */
    + "mom mum mommy mother dad daddy father parents grandma grandmother grandpa grandfather granny nana nanna papa aunt auntie uncle sister brother son daughter cousin niece nephew wife husband boyfriend girlfriend partner friend friends neighbour neighbor neighbours neighbors "
    + "apt apts floor floors lot bldg rv rvs airbnb airbnbs boat boats yacht trailer trailers motorhome cabin cabins bay rental rentals restaurant restaurants school schools church churches hotel hotels clinic clinics salon salons gym gyms daycare highrise highrises "
    + "fair expo booth exhibition show showhome model "
    + "etsy tiktok youtube houzz pinterest kijiji craigslist xiaohongshu douyin weibo reddit yelp fedex ups dhl purolator canpar intelcom usps lowes rona structube sears homesense winners marshalls target bestbuy ashley leons bouclair simons temu shein aliexpress alibaba taobao "
    + "noon midnight tonight eve diwali eid hanukkah ramadan").split(" "));
  const EN_NOT_SPAN = new Set(["new year", "new years", "chinese new year", "boxing day", "black friday", "cyber monday", "labour day", "labor day", "victoria day", "canada day", "family day", "home depot", "canton fair", "canada post", "good friday", "remembrance day", "civic holiday", "simcoe day", "heritage day", "christmas eve", "new year's eve", "new years eve", "st patrick's day", "valentine's day", "trade show", "home show", "best buy", "canadian tire", "the brick", "pottery barn", "west elm", "crate and barrel", "bed bath", "facebook marketplace", "google maps"]);
  const EN_NOT_SPAN_RX = new RegExp(`\\b(?:${[...EN_NOT_SPAN].map((s) => s.replace(/\s+/g, "\\s+")).join("|")})\\b`, "gi");
  /* 「install in X / deliver to X」后面的小写词：认不出、又不是常用名词时，算拿不准 */
  const EN_SLOT = /\b(?:(?:install|deliver|serve|service|work|measure)(?:s|es|ed|d|ing)?\s+(?:out\s+)?in|(?:install|deliver|serve|service|ship|cover|travel|drive|come|go|move|work|visit)(?:s|es|ed|d|ing|ping|ped)?\s+(?:out\s+|over\s+|up\s+|down\s+)?(?:to|into|across|throughout|all\s+over|around|near)|\b(?:across|throughout|all\s+over))\s+([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*)?)(?=\s*(?:[?.!,;)]|$)|\s+(?:area|region|city|town|too|also|as\s+well|please|pls|and|or|for|on|next|this|tomorrow|today|by|before|asap)\b)/gi;
  const EN_SLOT_SKIP = new Set(("some any every each all both either another other one two three four five six seven eight nine ten few couple "
    + "bulk person stock advance time place batches parts pieces sections pairs stages phases sets total general addition order line season "
    + "measure see check install deliver help look do quote give show talk meet discuss bring pick drop take make fix get set put hang mount assemble be have come go "
    + "area areas town city cities region neighbourhood neighborhood community there here where "
    + "inch inches feet foot ft cm mm metre metres meter meters millimetres millimeters centimetres centimeters yards "
    + "love between touch charge business construction renovation renovations middle process hurry rush trouble luck need search market").split(" "));
  /* 「i'm in stittsville / we live in kanata」：报住址的小写词，认不出时同样算拿不准（只在问价 / 约上门 / 问服务区时看） */
  const EN_RES = new RegExp(String.raw`\b(?:i'?m|im|i\s+am|we'?re|we\s+are|(?:we|i)\s+(?:live|stay|reside)|live|living|located|based|staying|residing|(?:house|home|condo|place|address|property|build|unit|cottage|project|job|reno|site|townhouse|apartment)\s+is)\s+(?:(?:actually|just|currently|now|also|really|right|out|up|down|over)\s+)*(?:in|near|around|by|at|off|beside|behind)\s+`
    + String.raw`([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*)?)(?=\s*(?:[?.!,;)]|$)|\s+(?:area|region|city|town|too|also|as\s+well|please|pls|and|or|for|on|next|this|tomorrow|today|by|before|asap|can|could|do|would|will|how|what|when)\b)`, "gi");
  /* 地名表里和普通英文词同形的小写词：只有带介词或问服务区时才算地点（dual flushing、buffalo check、aurora grey） */
  const EN_HOMOGRAPH = new Set("flushing buffalo concord aurora victoria wellington regina ajax durham halton bolton milton georgina richmond surrey perth portland london cambridge windsor kingston welland grimsby".split(" "));
  /* 介词后面常见的小写词（in the morning / at least / by phone / in stock / in velvet / near the window）：不是地点 */
  const EN_LOW_SKIP = new Set(("on in at to for of with about up down out over off by from into onto upon "
    + "morning mornings afternoon afternoons evening evenings night nights noon midnight tonight lunch dinner breakfast weekday weekdays weekend weekends week weeks month months year years day days hour hours minute minutes moment meantime future past end beginning start now then once least most first last times "
    + "cash credit debit installments installment usd cad rmb hkd dollars bucks budget metric imperial size sizes colour colours color colors mind case fact particular progress production transit "
    + "commercial residential business businesses retail wood vinyl laminate hardwood engineered tile tiles stone marble granite quartz concrete brick plaster drywall glass metal aluminum aluminium steel stucco siding fabric fabrics leather velvet cotton polyester wool silk "
    + "bed beds sofa sofas couch couches sectional sectionals table tables chair chairs desk desks dresser dressers cabinet cabinets vanity vanities lamp lamps lights lighting fixture fixtures chandelier chandeliers pendant pendants curtain curtains drape drapes blind blinds shade shades shutter shutters rug rugs carpet carpets flooring plank planks wall walls ceiling ceilings stair step steps track tracks rod rods hardware motor motors remote remotes battery batteries swatch swatches sample samples "
    + "photo photos picture pictures pic pics video videos post posts ad ads reel reels story stories link bio profile page dm dms comments comment "
    + "new old older newer big bigger small smaller large larger tall taller high higher low lower wide wider narrow long longer short tiny huge modern existing current different same similar main front back side top bottom corner left right inside outside upstairs downstairs "
    + "myself yourself ourselves themselves himself herself hand phone email text call work school line available interested "
    + "after before during since until till between like about approx approximately roughly maybe probably lunchtime dinnertime bedtime daytime nighttime anytime sometime"
    + " batches batch phases stages real estate").split(" "));
  /* 小写地名的位置：介词后（my windows in stittsville / i'm in holland landing near the lake）、服务动词后（do you serve maple）、
     运送动词 + 东西 + to（deliver a sectional to stittsville）、out X way */
  const LOW_FILL = String.raw`([a-z][a-z'’.-]*[a-z](?:\s+[a-z][a-z'’.-]*[a-z])?)`;
  const LOW_LA = String.raw`(?=\s*(?:[?.!,;:)]|$)|\s+(?:area|region|city|town|way|side|too|also|as\s+well|please|pls|and|or|for|on|near|next|by|before|asap|actually|now|can|could|do|does|would|will|how|what|when|where|is|are|but|so|if|thanks|thx|ty|lol|right|just|close|nearby|which|that|who|we|i|my|our|want|wanna|need|looking)\b)`;
  const EN_LOW = new RegExp(String.raw`(?:^|[\s,.;:!?(])(?:in|near|around|at|by|into|outside(?:\s+of)?|beside|behind|off|next\s+to|close\s+to|across\s+from|nearby(?:\s+like)?|(?:places|areas|cities|towns|somewhere)\s+like|such\s+as)\s+(?:the\s+)?${LOW_FILL}${LOW_LA}`, "g");
  const EN_SERVE = new RegExp(String.raw`\b(?:serve|serves|serving|service|services|servicing|cover|covers|covering)\s+(?:the\s+)?${LOW_FILL}${LOW_LA}`, "g");
  const EN_MOVE_TO = new RegExp(String.raw`\b(?:deliver|ship|bring|send|move|take|haul|drive|come|travel|go)(?:s|es|ed|d|ing|ping|ped)?\b(?:\s+(?!to\b|in\b|and\b|or\b)[a-z'’]+){1,3}?\s+to\s+(?:the\s+)?${LOW_FILL}${LOW_LA}`, "g");
  const EN_WAY = /\b(?:out|over|up|down|around)\s+(?:the\s+)?([a-z][a-z'’.-]*[a-z])(?=\s+way\b)/g;
  /* 所有格后面是住处：Mom's house / Jane's place 是人，不是地点 */
  const EN_PERSON_R = /^['’]s\s+(?:new\s+|old\s+)?(?:house|home|place|condo|apartment|apt|unit|cottage|office|room|basement|bedroom|kitchen|store|shop|business|restaurant|salon|clinic|studio|townhouse|property|rental|airbnb|cabin|farm)\b/i;
  const EN_TABLE_RX = new RegExp(`(?<![A-Za-z])(?:${[...EN2P.keys()].sort((a, b) => b.length - a.length).map((k) => escRe(k).replace(/\s+/g, "\\s+")).join("|")})(?![A-Za-z])`, "gi");
  /* 省 / 州：「Vaughan, ON」「Buffalo NY」「Toronto, Ontario」是前面地名的限定，不是第二个地点 */
  const QUAL_ABBR = new Set("ON BC AB QC SK MB NS NB PE PEI NL YT NT NU NY NJ CA OR WA TX FL IL MA PA MI OH GA NC VA AZ CO MN WI MD CT NV UT NSW VIC QLD TAS ACT UK".split(" "));
  const QUAL_FULL_SRC = String.raw`ontario|ont\.?|british columbia|alberta|quebec|québec|nova scotia|new brunswick|manitoba|saskatchewan|newfoundland|new jersey|california|oregon|texas|florida|illinois|massachusetts|pennsylvania|michigan|ohio|new south wales|queensland|canada|usa|u\.s\.a?\.?|united states|australia|united kingdom|great britain|britain|england|scotland|wales`;
  const QUAL_FULL = new RegExp(`^(?:${QUAL_FULL_SRC})$`, "i");
  const QUAL_R_ABBR = /^(\s*,?\s*)([A-Z]{2,3})(?![A-Za-z])/;
  const QUAL_R_FULL = new RegExp(`^(\\s*,\\s*)(${QUAL_FULL_SRC})(?![A-Za-z])`, "i");
  const isQual = (w) => QUAL_ABBR.has(w) || QUAL_FULL.test(w);
  /* 店主城市后面的省 / 州 / 国家和留言里的对不上（London, ON 的店 vs London, UK）：不是同一个城市 */
  const QUAL_CODE = { ontario: "on", ont: "on", "british columbia": "bc", alberta: "ab", quebec: "qc", "québec": "qc", "nova scotia": "ns", "new brunswick": "nb", manitoba: "mb", saskatchewan: "sk", newfoundland: "nl",
    "new jersey": "nj", california: "ca", oregon: "or", texas: "tx", florida: "fl", illinois: "il", massachusetts: "ma", pennsylvania: "pa", michigan: "mi", ohio: "oh", "new south wales": "nsw", queensland: "qld",
    us: "usa", usa: "usa", "u.s": "usa", "u.s.a": "usa", "united states": "usa", uk: "uk", "united kingdom": "uk", "great britain": "uk", britain: "uk", england: "uk", scotland: "uk", wales: "uk", canada: "canada", australia: "australia" };
  const qualCode = (q) => { const k = String(q || "").toLowerCase().replace(/\.+$/, "").trim(); return QUAL_CODE[k] || k; };
  const qualCountry = (c) => (/^(?:on|bc|ab|qc|sk|mb|ns|nb|pe|pei|nl|yt|nt|nu|canada)$/.test(c) ? "canada" : /^(?:nsw|vic|qld|tas|act|australia)$/.test(c) ? "australia" : c === "uk" ? "uk" : /^(?:ny|nj|ca|or|wa|tx|fl|il|ma|pa|mi|oh|ga|nc|va|az|co|mn|wi|md|ct|nv|ut|usa)$/.test(c) ? "usa" : c);
  const qualOk = (shopQuals, q) => {
    if (!q || !shopQuals || !shopQuals.length) return true;
    const m = qualCode(q);
    return shopQuals.some((s) => { const c = qualCode(s); return c === m || qualCountry(c) === m || (c === qualCountry(c) && qualCountry(m) === c); });
  };

  const ZH_PROV = /^(?:广东|广西|福建|浙江|江苏|湖南|湖北|四川|海南|河北|河南|山东|山西|安徽|江西|云南|贵州|陕西|甘肃|辽宁|吉林|黑龙江|内蒙古|新疆|西藏|宁夏|青海)(?:省|壮族自治区|自治区)?/;
  /* 店主自己的城市：城市框是自由输入。去掉省 / 州和括号，拆开「Markham & Toronto」，切开「佛山市顺德区」，去掉「广东」前缀；
     parts 用来匹配，show 用来显示（英文回复不夹汉字：广东佛山 → Foshan） */
  const cityCache = new Map();
  function cityInfo(raw) {
    const ci = String(raw || "").trim();
    if (cityCache.has(ci)) return cityCache.get(ci);
    const parts = [], zh = [], zhTyped = [], en = [], alias = [], quals = [];
    const main = ci.replace(/[（(]([^）)]*)[）)]/g, (_, x) => { alias.push(x); return " "; });
    const split = (s) => s.split(/\s*(?:[&\/、,，;；+]|\band\b|和|及)\s*/i).map((x) => x.trim()).filter(Boolean);
    /* 省 / 州在后（Vaughan ON）或在前（ON Vaughan、Ontario Vaughan、British Columbia Burnaby）都去掉 */
    const dropQ = (x) => {
      const w = x.split(/\s+/);
      for (;;) {
        if (w.length > 2 && isQual(w.slice(-2).join(" "))) quals.push(w.splice(-2).join(" "));
        else if (w.length > 1 && isQual(w[w.length - 1])) quals.push(w.pop());
        else if (w.length > 2 && isQual(w.slice(0, 2).join(" "))) quals.push(w.splice(0, 2).join(" "));
        else if (w.length > 1 && isQual(w[0])) quals.push(w.shift());
        else break;
      }
      return w.join(" ");
    };
    const clean = (s) => { const l = split(s).map(dropQ); if (!l.some((x) => !isQual(x))) return l; quals.push(...l.filter(isQual)); return l.filter((x) => !isQual(x)); };
    const addPart = (x, shown) => {
      const nx = norm(x);
      if (!isHan(nx)) {
        parts.push({ n: x, base: x, low: x.toLowerCase(), han: false, entry: enEntry(x) });
        if (shown) { zh.push(x); zhTyped.push(x); en.push(x); }
        return;
      }
      const p = nx.match(ZH_PROV);
      const cut = p && nx.length - p[0].length >= 2 ? p[0].length : 0;
      const y = nx.slice(cut);
      const hits = [];
      let rest = "";
      for (let k = 0; k < y.length;) { const nm = ZH_NAMES.find((z) => y.startsWith(z, k)); if (nm) { hits.push(nm); k += nm.length; } else { if (!SUFFIX_CH.has(y[k])) rest += y[k]; k++; } }
      const bases = hits.length ? hits.concat(rest.length >= 2 ? [rest] : []) : [zhBase(y)];
      for (const b of bases) parts.push({ n: b, base: b, han: true, entry: ZH2P.get(b) || null });
      /* 英文名：地名表里有才写（佛山市顺德区 → Shunde, Foshan）；认不出的中文城市在英文里不夹汉字，交给 render 写 our area */
      if (shown) { zh.push(y); zhTyped.push(x.slice(cut)); if (hits.length && rest.length < 2) en.push(hits.map((h) => ZH2P.get(h).en).reverse().join(", ")); }
    };
    for (const x of clean(main)) addPart(x, true);
    for (const a of alias) for (const x of clean(a)) addPart(x, false);
    const res = {
      ci, parts, quals, raws: [ci, ...split(main), ...alias],
      show: { zh: zh.join("、"), zhTyped: zhTyped.join("、"), en: en.join(" & ") },
      /* 店在内地：粤语留言没有区分字时回简体；店在港澳台、或城市本身用繁体写：回繁体 */
      cn: parts.some((P) => (P.entry ? P.entry.cn : P.han)),
      hant: parts.some((P) => P.entry && P.entry.hant) || [...ci].some((ch) => own(H2S, ch)),
    };
    if (cityCache.size > 200) cityCache.clear();
    cityCache.set(ci, res);
    return res;
  }

  /* 句首的 Do / Is / Hi 之类不算地名的一部分：「Is Markham in your area」 */
  /* 句首 / 句中大写的常用词（Not far from Toronto / Thats Vaughan area / Maybe Woodbridge / Niagara Falls or Not）：不是地名，不进回显；
     专有名词前面的这些词一并剥掉，剩下的才按地名认 */
  const EN_CAP_COMMON = new Set(("not thats that's whats what's hows how's heres here's theres there's its it's ive i've id lets let's youre you're theyre they're were "
    + "only maybe perhaps probably possibly likely near nearby close closer around about approx approximately roughly almost right pretty very really actually basically honestly "
    + "anyway anyways still even now today tonight tomorrow yeah yep yup nope sure cool great nice awesome hmm um uh btw fyi lol kinda sorta definitely def totally too again "
    + "though although because cause since unless until while far somewhere anywhere everywhere elsewhere nowhere else other another same this that these those it").split(" "));
  const leadWord = (w) => { const x = w.toLowerCase().replace(/’/g, "'"); return EN_LEAD.has(x) || EN_CAP_COMMON.has(x); };
  function stripLead(sp, i) {
    const ws = sp.split(/(\s+)/);
    let k = 0, off = 0;
    while (k < ws.length - 1 && leadWord(ws[k])) { off += ws[k].length + ws[k + 1].length; k += 2; }
    if (leadWord(ws[k])) return { sp: "", i };
    /* 尾巴上的常用词（Markham Too / Woodbridge Maybe）也不算地名的一部分 */
    let e = ws.length;
    while (e - 2 > k && leadWord(ws[e - 1])) e -= 2;
    if (e < ws.length) return { sp: ws.slice(k, e).join(""), i: i + off };
    return { sp: sp.slice(off), i: i + off };
  }

  function findPlace(raw, n, city) {
    const C = cityInfo(String(city || "").trim());
    const out = { places: [], cityHit: false, covered: false, unsure: false, vague: false };
    /* 留言里出现店主自己的城市：先把它（连同 市/区 后缀）从文本里遮掉，再找别的地点 */
    let nx = n;
    /* 整串城市（广东佛山 / 佛山市顺德区）先遮，再遮各段 */
    for (const r of C.raws) { const x = norm(r); if (x.length >= 2 && isHan(x)) nx = nx.split(x).join("◇".repeat(x.length)); }
    if (nx !== n) out.cityHit = true;
    for (const P of C.parts) {
      if (P.han) nx = nx.replace(new RegExp(`${escRe(P.base)}[市区县镇]?`, "g"), (s) => { out.cityHit = true; return "◇".repeat(s.length); });
      else if (new RegExp(`(^|[^A-Za-z])${escRe(P.n)}(?![A-Za-z])`, "i").test(raw)) out.cityHit = true;
    }
    const intent = RX.area.test(n) || RX.install.test(n);
    /* 送货 / 上门 / 安装 / 约上门意图：地名表里认得的地点在这类留言里任何位置都算（肇庆离你们不远，应该能送吧） */
    const svcQ = intent || RX.visit.test(n) || DELIVER.test(n) || ZH_SVC_Q.test(n);
    const isCity = (e, txt) => C.parts.some((P) => (e && P.entry && e === P.entry) || (txt && (String(txt).toLowerCase() === P.low || (P.han && zhBase(norm(txt)) === P.base))));
    /* known：地名表里认出来的（不是靠大小写 / 后缀猜的）；只有 known 的地点才算「读懂」，大屏才显示原话 */
    const add = (zh, en, rawForm, known) => { if (!out.places.some((p) => p.zh === zh)) out.places.push({ zh, en, raw: rawForm, known: !!known }); };

    /* 中文：地名表 + 带后缀的词，相邻的合并（佛山市南海区） */
    const spans = [];
    for (const name of ZH_NAMES) {
      let from = 0, i;
      while ((i = nx.indexOf(name, from)) >= 0) {
        from = i + 1;
        const j = i + name.length;
        const g = PLACE_GUARD[name];
        if (g && g(nx.slice(0, i), nx.slice(j))) continue;
        if (spans.some((s) => i < s.j && j > s.i)) continue;
        spans.push({ i, j, e: ZH2P.get(name) });
      }
    }
    for (const m of nx.matchAll(/[市区县镇]/g)) {
      const k = m.index;
      const skip = SUFFIX_NEXT_SKIP[nx[k]];
      if (skip && skip.test(nx.slice(k + 1))) continue;
      let s = k;
      while (s > 0 && isHan(nx[s - 1]) && !STOP.has(nx[s - 1]) && !SUFFIX_CH.has(nx[s - 1])) s--;
      const name = nx.slice(s, k);
      if (name.length < 2 || name.length > 4) continue;
      const cand = nx.slice(s, k + 1);
      if (SUFFIX_SKIP.test(cand) || RX.time.test(cand) || factHit(cand)) continue;
      spans.push({ i: s, j: k + 1, e: null });
    }
    spans.sort((a, b) => a.i - b.i || b.j - a.j);
    const merged = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s.i <= last.j) { last.j = Math.max(last.j, s.j); last.es.push(s.e); } else merged.push({ i: s.i, j: s.j, es: [s.e] });
    }
    for (const s of merged) {
      const zh = nx.slice(s.i, s.j);
      /* 店主城市前面的省名（店在佛山，留言写「广东佛山」）：是城市的限定词，不是另一个地点 */
      { const pm = zh.match(ZH_PROV); if (pm && pm[0].length === zh.length && nx[s.j] === "◇") continue; }
      if (RX.time.test(zh) || factHit(zh)) continue;
      const ctx = svcQ || ZH_LOC_MARK_L.test(raw.slice(Math.max(0, s.i - 8), s.i)) || ZH_LOC_MARK_R.test(nx.slice(s.j));
      if (!ctx) continue;
      const es = s.es.filter(Boolean);
      const one = es.length === 1 && zhBase(zh) === zhBase(es[0].zh.find((z) => zh.startsWith(z)) || "") ? es[0] : null;
      if (isCity(one, zh)) { out.covered = true; continue; }
      add(zh, one ? one.en : raw.slice(s.i, s.j), raw.slice(s.i, s.j), es.length > 0);
    }
    const visitQ = RX.visit.test(n);
    const zhGate = intent || visitQ;
    /* 小写拉丁词（中文句子里的拼音 / 英文地名、英文句子里的 stittsville）：不是常用词、也不是店主城市，就算拿不准的地点 */
    const lowPlace = (fill0) => {
      const fill = String(fill0).replace(/\s+(?:area|region|city|town|way|side|neighbou?rhood)$/i, "");
      const w = fill.toLowerCase().split(/\s+/);
      /* 常用词（含复数）：in sunrooms / at lunchtime / by text */
      const common = (x) => !!x && [x, x.replace(/s$/, ""), x.replace(/es$/, "")].some((y) => EN_NOT.has(y) || EN_LOW_SKIP.has(y) || EN_SLOT_SKIP.has(y));
      return !(common(w[0]) || common(w[1]) || EN_LEAD.has(w[0]) || /(?:ing|ly|ed)$/.test(w[0])
        || isCity(null, w[0]) || isCity(null, w.join(" ")) || RX.price.test(fill) || RX.time.test(fill) || RX.timeSoft.test(fill) || factHit(fill) || TOPIC1.test(fill)
        || RX.visit.test(fill) || RX.bot.test(fill) || RX.cred.test(fill) || RX.scope.test(fill) || RX.policy.test(fill) || RX.hours.test(fill));
    };
    const zhPats = intent || RX.price.test(n) || visitQ ? [...ZH_LOC_PATTERNS, ZH_FROM_PATTERN] : ZH_LOC_PATTERNS;
    for (const P of zhPats) {
      if (P.gate && !(zhGate || svcQ || ZH_DIST.test(nx))) continue;
      for (const m of nx.matchAll(P.re)) {
        if (!m[1]) continue;
        const x = m[1], at = m.index + m[0].lastIndexOf(x);
        if (/[◇◆]/.test(x) || merged.some((s) => at < s.j && at + x.length > s.i)) continue;
        /* 大写的英文名交给下面的英文分支 */
        if (/^[A-Za-z]/.test(x)) { if (!/^[A-Z]/.test(x) && lowPlace(x)) out.unsure = true; continue; }
        /* strong 位置还要整词看一遍：「千灯湖」逐字删掉「灯」后只剩单字，但它是一个含生字的词 */
        if (P.mode === "strong" ? ZH_VERB0.test(x) || (notPlaceStrong(x) && !zhUnknownWord(x)) : notPlaceWeak(x) || zhCommonWords(x)) continue;
        out.unsure = true;
      }
    }
    /* 「我家离佛山很近，能送吗」「镇上也送吗」：问送货时同样看「在城外 / 城附近」 */
    const sendQ = /送(?:货|到|去|上门|过去|过来|唔送|不送)|(?:能|可以|可唔可以|可不可以|能不能|也|都|会)送|送(?:吗|嗎|不|唔|吧|呢|么|嘛)/.test(n);
    if ((zhGate || RX.price.test(n) || sendQ) && (ZH_NEAR_CITY.test(nx) || ZH_OUTSIDE.test(nx))) out.unsure = true;

    /* 英文 · A：区分大小写的专有名词，可多词（Richmond Hill）；A or B 连写时一起认；全大写留言按小写处理 */
    const caps = /[A-Z]{2}/.test(raw) && !/[a-z]/.test(raw);
    const rawP = caps ? raw.toLowerCase() : titleFold(raw.replace(/\b(OR|AND|Or|And)(?=\s+[A-Z])/g, (s) => s.toLowerCase()));
    const enSpec = EN_SVC_SPEC.test(rawP);
    const enIntent = intent || RX.price.test(n) || visitQ;
    const used = [];
    const taken = (i, j) => used.some(([a, b]) => i < b && j > a);
    const theAcr = (sp, left) => (/^[A-Z]{2,3}$/.test(sp) && /\bthe\s+$/i.test(left) ? `the ${sp}` : sp);
    /* 店主城市：前面是 close to / just outside / 30 min from，或者后面的省 / 国家对不上（London, UK ≠ London, ON）：不算城市里面 */
    const cityOk = (left, qual) => !EN_NEAR_L.test(left) && qualOk(C.quals, qual);
    /* 街道地址、公路、邮编、「外地 / 一小时车程」：认不出具体在哪，交给店主，不回显 */
    for (const R of [EN_ADDR, EN_ROAD, EN_POSTAL]) for (const m of rawP.matchAll(R)) {
      const after = rawP.slice(m.index + m[0].length);
      if (EN_PRODUCT_R.test(after) || /^\s*(?:motors?|remotes?|kits?|models?|version|batter(?:y|ies)|chargers?|hubs?|controllers?|switch(?:es)?|bulbs?)\b/i.test(after) || /\b(?:model|sku|item|part|no\.?|#)\s*$/i.test(rawP.slice(Math.max(0, m.index - 8), m.index))) continue;
      /* 邮编（L4L 8B2 / M3J 1P3 / M2N）本身就是在报住址：不管有没有问上门都交给店主；B2B / B2C 不是邮编 */
      if (R === EN_POSTAL && /^b2[bc]$/i.test(m[0])) continue;
      used.push([m.index, m.index + m[0].length]);
      if (enIntent || zhGate || (R === EN_POSTAL && /^[a-z]\d[a-z]/i.test(m[0]))) out.unsure = true;
    }
    if ((enIntent || zhGate) && EN_OUTSIDE.test(rawP)) out.unsure = true;
    let chainEnd = -1, chainStrong = false, skipTo = -1;
    for (const m of rawP.matchAll(EN_SPAN)) {
      if (m.index < skipTo) continue;
      let { sp, i } = stripLead(m[0], m.index);
      if (!sp) { chainEnd = -1; continue; }
      /* 所有格：Sydney's north shore → Sydney；Mom's house / Jane's place 是人 */
      const pos = sp.search(/['’]s\b/);
      if (pos > 0) {
        if (EN_PERSON_R.test(rawP.slice(i + pos))) { chainEnd = -1; continue; }
        sp = sp.slice(0, pos);
      }
      sp = sp.replace(/['’-]+$/, "");
      /* 省 / 州在前（ON Vaughan、Ontario Vaughan、British Columbia Burnaby）：只认后面的城市，前缀一并算作这段地名 */
      const i0 = i;
      { const w = sp.split(/\s+/); for (const k of [2, 1]) if (w.length > k && isQual(w.slice(0, k).join(" "))) { const cut = sp.match(new RegExp(`^(?:\\S+\\s+){${k}}`))[0].length; sp = sp.slice(cut); i += cut; break; } }
      let j = i + sp.length, end = j, qual = "";
      const ws = sp.split(/\s+/);
      if (ws.length > 1 && isQual(ws[ws.length - 1])) { qual = ws.pop(); sp = ws.join(" "); j = i + sp.length; }
      else {
        const q = rawP.slice(j).match(QUAL_R_ABBR);
        const qa = q && QUAL_ABBR.has(q[2]) ? q : rawP.slice(j).match(QUAL_R_FULL);
        if (qa) { qual = qa[2]; end = j + qa[0].length; skipTo = end; }
      }
      if (taken(i0, end)) { chainEnd = -1; continue; }
      const low = sp.toLowerCase();
      const left = rawP.slice(Math.max(0, i0 - 48), i0);
      const right = rawP.slice(end);
      const e = enEntry(sp);
      const chained = chainEnd >= 0 && EN_CHAIN.test(rawP.slice(chainEnd, i0));
      const strong = EN_STRONG_L.test(left) || EN_STRONG_R.test(right) || (chained && chainStrong);
      const attr = !strong && EN_ATTR_L.test(left);
      const weak = strong || chained || (EN_WEAK_L.test(left) && !EN_NOT_LOC_L.test(left) && !EN_FROM_L.test(left) && !EN_BY_NOT.test(left) && !attr);
      const frag = !strong && enIntent && ((EN_FRAG_L.test(left) && EN_FRAG_R.test(right)) || EN_ABOUT_L.test(left)) && (!!e || lowPlace(low));
      const askKnown = !strong && !!e && ((EN_ASK_L.test(left) && EN_ASK_R.test(right)) || (EN_FRAG_L.test(left) && (EN_FRAG_R.test(right) || EN_ASK_R.test(right))) || EN_ABOUT_L.test(left));
      const spec = !strong && EN_SPEC_L.test(left) && EN_SPEC_R.test(right) && (!!e || (lowPlace(low) && !EN_SPEC_SKIP.has(low)));
      const first = low.split(/\s+/)[0], last = low.split(/\s+/).pop();
      if (EN_PRODUCT_R.test(right) || (!e && (EN_NOT_SPAN.has(low) || ((EN_NOT.has(first) || (ws.length > 1 && EN_NOT.has(last))) && !(ws.length > 1 && PLACE_TAIL.test(sp)))))) { chainEnd = -1; continue; }
      /* 十字路口（at Yonge and Steeles / Bayview/Sheppard area / 央街同Finch）：整段算一个认不出的地点，不回显半个 */
      const crossR = rawP.slice(end).match(EN_CROSS_R);
      const slash = !!crossR && /^\s*\//.test(crossR[0]);
      const zhCross = ZH_CROSS.test(rawP.slice(Math.max(0, i0 - 6), i0)) || ZH_CROSS_R.test(right);
      const cross = zhCross || (!!crossR && (slash || EN_CROSS_L.test(left) || /^\s+area\b/i.test(rawP.slice(end + crossR[0].length))));
      if (cross && (enIntent || strong) && (strong || weak || zhCross || slash)) {
        const stop = end + (crossR ? crossR[0].length : 0);
        out.unsure = true; used.push([i0, stop]); skipTo = Math.max(skipTo, stop); chainEnd = -1;
        continue;
      }
      if (strong || (weak && (enIntent || e)) || (attr && e && enIntent) || (frag && e) || askKnown || (spec && e)) {
        used.push([i0, end]);
        chainEnd = end; chainStrong = strong;
        if (isCity(e, sp)) { if (cityOk(left, qual)) out.covered = true; else if (qual) add(`${sp}, ${qual}`, `${sp}, ${qual}`, sp, true); else out.unsure = true; continue; }
        const show = qual ? `${sp}, ${qual}` : theAcr(sp, left);
        add(show, show, sp, !!e);
        continue;
      }
      /* 只报一个名字（Leslieville? / Mike here）：可能是人，交给店主但不回显 */
      if (frag || spec) { out.unsure = true; used.push([i0, end]); chainEnd = -1; continue; }
      /* the + 产品 + in + 认不出的专有名词：可能是颜色，也可能是地点，交给店主 */
      if (attr && intent) { out.unsure = true; used.push([i0, end]); }
      chainEnd = -1;
    }
    /* 英文 · B：表里的地名在任何位置都认（Is Markham in your service area? / Markham可以上门吗）；小写的只算拿不准 */
    const notSpan = [...rawP.matchAll(EN_NOT_SPAN_RX)].map((m) => [m.index, m.index + m[0].length]);
    for (const m of rawP.matchAll(EN_TABLE_RX)) {
      const name = m[0], i = m.index, j = i + name.length;
      if (taken(i, j) || notSpan.some(([a, b]) => i < b && j > a)) continue;
      const e = enEntry(name.replace(/\s+/g, " "));
      if (!e) continue;
      const left = rawP.slice(Math.max(0, i - 48), i);
      if (EN_NOT_LOC_L.test(left) || EN_FROM_L.test(left) || EN_PRODUCT_R.test(rawP.slice(j))) continue;
      used.push([i, j]);
      if (isCity(e, name)) { if (cityOk(left, "")) out.covered = true; else out.unsure = true; continue; }
      /* 只问价格时，表里的地名要带介词才算（How much is the Milton sofa ≠ 问 Milton）；约上门时句首报的地名也算（Bolton, can you come measure?） */
      if (caps || /^[A-Z]/.test(name)) { if (intent || visitQ || enSpec || out.cityHit || out.covered || (enIntent && EN_PREP_L.test(left))) add(theAcr(e.en, left), theAcr(e.en, left), name, true); }
      /* 小写：连写在已认出的地点后面（Vaughan or also barrie）就是地点；其余在服务区意图下算拿不准 */
      else if (used.some(([a, b]) => b <= i && EN_CHAIN.test(rawP.slice(b, i)))) add(theAcr(e.en, left), theAcr(e.en, left), name, true);
      else if (EN_PREP_L.test(left) || RX.area.test(n) || (intent && !EN_HOMOGRAPH.has(name.toLowerCase())) || (enIntent && !EN_HOMOGRAPH.has(name.toLowerCase()) && EN_WEAK_L.test(left))) out.unsure = true;
    }
    /* 英文 · C：介词 / 服务动词后面跟着认不出的小写词（do you guys deliver to stittsville / my windows in stittsville / do you serve maple / out tottenham way）；
       问价 / 约上门 / 问服务区时才看 */
    for (const R of enIntent ? [EN_SLOT, EN_RES, EN_LOW, EN_SERVE, EN_MOVE_TO, EN_WAY] : [EN_SLOT]) for (const m of rawP.matchAll(R)) {
      const fill = m[1], i = m.index + m[0].length - fill.length;
      if (taken(i, i + fill.length) || (!caps && /^[A-Z]/.test(fill))) continue;
      if (!lowPlace(fill)) continue;
      const w = fill.toLowerCase().split(/\s+/);
      const e = enEntry(w.join(" ")) || enEntry(w[0]);
      /* 表里的同形词（concord / aurora）：只有在明确的地点位置才算 */
      if (e && EN_HOMOGRAPH.has(e.en.toLowerCase()) && R !== EN_SERVE && R !== EN_SLOT && R !== EN_RES) continue;
      out.vague = true;
    }
    /* 泛泛的范围（downtown / the city / bay area / 全国 / 大湾区）加上服务动词：认不出具体在哪，交给店主；downtown Vaughan、佛山全市 在城市里面 */
    { const v = n.match(VAGUE_AREA) || raw.match(VAGUE_AREA); if (v && (intent || visitQ || VAGUE_GO.test(n)) && !((out.cityHit || out.covered) && VAGUE_IN_CITY.test(v[0]))) out.vague = true; }
    /* 英文 · D：连写在已认出的地点后面、认不出的小写词（Do you serve Vaughan or also stittsville?） */
    if (enIntent) for (const [, b] of used) {
      const m = rawP.slice(b).match(EN_CHAIN_WORD);
      if (!m) continue;
      const i = b + m[0].length - m[1].length;
      const w = m[1].toLowerCase().split(/\s+/);
      if (taken(i, i + m[1].length) || EN_SLOT_SKIP.has(w[0]) || EN_NOT.has(w[0]) || leadWord(w[0]) || /^(?:not|nope|no|yes|so|too|more|less|much|many|other|others|else|etc\.?)$/.test(w[0])
        || /(?:ing|ly)$/.test(w[0]) || isCity(null, w[0]) || isCity(null, w.join(" ")) || RX.price.test(m[1]) || RX.time.test(m[1])
        || RX.scope.test(m[1]) || RX.install.test(m[1]) || RX.visit.test(m[1]) || RX.cred.test(m[1]) || factHit(m[1]) || /^(?:repairs?|replace\w*|remov\w*|clean\w*|sell|supply|order)$/.test(w[0])) continue;
      out.vague = true;
    }
    return out;
  }

  /* 「送不送窗帘杆」「送个茶几」「是送的吗」：这里的「送」是赠品，问的是免不免费；从地点 / 送货判断里拿掉 */
  const GIFT_WORDS = /(赠送|赠品|附送|白送|搭送|加送|多送|送礼品?|送(?:的|嘅)(?=吗|么|不|呢|啊|$|[\s？?。，,！!])|(?:送|送埋)(?:个|一个|一张|一件|一套|一把|一条|一对|一副|两个|几个|啲)(?!货)|(?<=(?:抱枕|靠垫|靠枕|枕头|挂钩|钩子|窗帘杆|罗马杆|杆子|轨道|配件|五金|窗帘扣|绑带|绑绳|礼品|地垫|坐垫|灯泡|电池|遥控器?|充电器|布样|小样|样品|踢脚线|地脚线|脚线|扣条|收边条|压条|防潮垫|地膜|螺丝|安装配件|角阀|软管|下水器|毛巾架|毛巾杆|置物架|皂盒|挂件|光源|灯管|拉珠|支架|窗帘带|布带|铅坠)(?:也|都|有|系咪|是不是|会不会|会唔会)?)送(?:唔送|不送|吗|嗎|么|不|唔|嘛|呢|$)(?:㗎|架|嘅|呀|啊|啦|嘛)?)/g;
  const GIFT_BUY = /买[^，,。？?！!\s]{1,8}?(送(?:不送|唔送)?)([㐀-鿿]{0,4})/g;
  const GIFT_ASK = /(送(?:不送|唔送))([㐀-鿿]{1,4})/g;
  const NOT_GIFT_OBJ = /^(?:货|到|上门|去|过|来|嚟|安装|装|吗|么|呢|啊|吧)/;
  /* 地名先遮掉再找赠品：「多伦多送货」里的「多送」不是加送 */
  const PLACE_MASK_RX = new RegExp(ZH_NAMES.map(escRe).join("|"), "g");
  function giftStrip(n0) {
    let gift = false;
    const hide = (s) => "◆".repeat(s.length);
    const n = String(n0).replace(PLACE_MASK_RX, (s) => "◇".repeat(s.length));
    let t = n.replace(GIFT_WORDS, (s) => { gift = true; return hide(s); });
    /* 「送不送X」：X 是产品 / 配件 / 礼品（白名单）才是赠品；X 认不出（下沙、千灯湖）按地点处理，交给地点规则 */
    t = t.replace(GIFT_BUY, (s, v, x) => { if (NOT_GIFT_OBJ.test(x) || (x && !GIFT_OBJ.test(x))) return s; gift = true; return s.replace(v, hide(v)); });
    t = t.replace(GIFT_ASK, (s, v, x) => { if (NOT_GIFT_OBJ.test(x) || !GIFT_OBJ.test(x)) return s; gift = true; return hide(v) + x; });
    /* 「有冇送X / 有没有送X」：X 是产品 / 配件才是问赠品 */
    t = t.replace(/有(?:冇|没有?|无)送(?=(.{1,6}))/g, (s, x) => { if (!GIFT_OBJ.test(x)) return s; gift = true; return hide(s); });
    /* 只把赠品位置换成 ◆，其余还原（地名留给地点规则） */
    let out = "";
    for (let k = 0; k < t.length; k++) out += t[k] === "◆" && n[k] !== "◆" ? "◆" : String(n0)[k];
    return { gift, text: out };
  }

  /* ───────── 离线草稿库：覆盖率闸门 ─────────
     草稿要成为 L2，留言必须「基本被解释」：把认出的意图词（价格 / 时间 / 上门 / 服务区 / 资质 / 范围 / 退换 / 私聊 / AI）、
     产品 / 品类词与事实 key、属性词、时间词、地名（含没带限定词的店主城市）、礼貌 / 虚词 / 代词 / 常见动词、数字与量词、标点
     都按「整词」抹掉，剩下的就是没读懂的内容（residue）。有 residue 就不能 L2：改成 L3、不引用资料；带服务区 / 上门 / 送货意图的走 hold。
     中文：多字词整词抹掉；单字分两类——虚字（我 在 的 能 吗 看 买 …：不和旁边的字粘连）与实字（灯 布 窗 千 大 上 天 …：
     会和旁边认不出的字粘成一个词）。所以「千灯湖」是一个含生字的词，整串没读懂；「有灯吗」的灯两边是虚字，算读懂。
     阈值：中文一个含生字、两字以上的词；或单个生字做谓语（能修吗、遥控器丢了）。英文：一个认不出的实词（两个字母以上）。
     两边都是「一个认不出的词」：英文按词、中文按两字一词。 */
  const wl = (s) => s.split(/\s+/).filter(Boolean);
  /* 各品类的产品 / 配件名词（白名单）。work：这一品类的活儿本来就落在上面（窗饰的窗户、灯的墙 / 天花、地板的楼梯），只有做「装 / 换 / 做 / 卖」的宾语时才算外品类；
     ctx：场景（家具店的门 / 楼梯、灯具店的餐桌 / 镜子、家纺店的床 / 沙发），只有跟在介词后面、或留言里另有本品类产品时才算场景，否则就是外品类对象 */
  const PROD = {
    blinds: {
      zh: "窗帘 窗饰 百叶 百叶窗 百叶帘 卷帘 罗马帘 斑马帘 柔纱帘 梦幻帘 蜂巢帘 百折帘 天棚帘 竹帘 滚帘 卷闸帘 木百叶 铝百叶 遮阳帘 遮光帘 帘子 纱帘 窗纱 布帘 垂直帘 香格里拉帘 电动窗帘 智能窗帘 电动帘 门帘 电机 马达 遥控器 遥控 轨道 路轨 窗帘杆 罗马杆 拉绳 窗帘盒 充电器 电池 叶片 帘 帘头 布 面料 布料 布样",
      en: "blind blinds shade shades shutter shutters curtain curtains drape drapes drapery draperies roller rollers roman zebra cellular honeycomb venetian vertical verticals sheer sheers valance valances cassette motor motors remote remotes wand wands cord cords slat slats louver louvers louvre louvres vane vanes headrail track tracks rod rods bracket brackets charger chargers battery batteries treatment treatments panel panels fabric fabrics swatch swatches",
      /* work：活儿本来就落在这里（窗户），只有做「装 / 换 / 做」的宾语时才算外品类（装窗户 = 换窗）；ctx：介词后面、或留言里另有本品类产品时才算场景 */
      work: { zh: "窗 窗户 天窗", en: "window windows skylight skylights" }, ctx: { zh: "门", en: "door doors" },
    },
    furniture: {
      zh: "沙发 梳化 茶几 餐桌 餐台 饭桌 饭台 餐椅 椅子 凳子 床 床架 床头 床头柜 床垫 床褥 衣柜 衣橱 书桌 书台 书柜 书架 电视柜 鞋柜 斗柜 边柜 酒柜 展示柜 储物柜 柜子 桌子 茶台 办公桌 梳妆台 家具 家俱 家私 家俬 沙发床 躺椅 贵妃椅 单人床 双人床 儿童床 上下床 桌 椅 凳 柜 布 面料 布料 抱枕 靠垫",
      en: "sofa sofas couch couches sectional sectionals loveseat loveseats chair chairs armchair armchairs recliner recliners ottoman ottomans table tables desk desks bed beds frame frames headboard headboards mattress mattresses dresser dressers nightstand nightstands wardrobe wardrobes bookcase bookcases bookshelf bookshelves shelf shelves shelving cabinet cabinets sideboard sideboards buffet buffets console consoles bench benches stool stools stand stands furniture bunk crib cribs futon futons daybed daybeds hutch stool stools barstool barstools chaise chaises credenza credenzas vanity cushion cushions pillow pillows fabric fabrics",
      work: { zh: "电梯", en: "elevator elevators" }, ctx: { zh: "墙 门 楼梯 窗户 窗 地面 地板", en: "wall walls door doors stairs staircase steps stair window windows floor floors" },
    },
    lighting: {
      zh: "灯 灯具 吊灯 吸顶灯 筒灯 射灯 台灯 落地灯 壁灯 灯带 灯条 灯泡 灯管 光管 轨道灯 线性灯 磁吸灯 无主灯 水晶灯 吊扇灯 镜前灯 灯饰 光源 调光器 智能灯 灯光 遥控 遥控器",
      en: "light lights lighting lamp lamps pendant pendants chandelier chandeliers sconce sconces fixture fixtures bulb bulbs led leds strip strips pot potlight potlights downlight downlights spotlight spotlights track tracks dimmer dimmers lantern lanterns remote remotes",
      work: { zh: "墙 墙面 墙壁 天花 天花板 吊顶", en: "wall walls ceiling ceilings" },
      ctx: { zh: "楼梯 台阶 镜子 餐桌 桌子 桌 台面 柜 柜子 床 沙发 镜柜 浴室柜 橱柜 茶几 窗 窗户", en: "stairs staircase steps stair table tables desk desks mirror mirrors vanity vanities cabinet cabinets bed beds sofa sofas couch counter counters countertop countertops window windows" },
    },
    bath: {
      zh: "浴室柜 橱柜 吊柜 地柜 台面 镜柜 镜子 马桶 坐厕 浴缸 花洒 莲蓬头 淋浴 淋浴房 淋浴间 淋浴屏 企缸 台盆 面盆 洗手盆 洗脸盆 洗手台 洗脸台 洗漱台 盥洗台 洗脸盆柜 脸盆柜 洗手盆柜 台盆柜 面盆柜 水槽 龙头 水龙头 地漏 卫浴 洁具 厨卫 柜 柜子 系统柜",
      en: "vanity vanities cabinet cabinets countertop countertops counter counters sink sinks basin basins faucet faucets tap taps toilet toilets tub tubs bathtub bathtubs shower showers mirror mirrors fixture fixtures backsplash cupboard cupboards",
      ctx: { zh: "墙 地面 窗户 窗", en: "wall walls floor floors window windows" },
    },
    flooring: {
      zh: "地板 木地板 实木地板 复合地板 多层实木 强化地板 石塑地板 海岛型 瓷砖 磁砖 地砖 地毯 踢脚线 地脚线 扣条 收边条 防潮垫 地垫 旧地板 旧地毯 地毡 旧地毡",
      en: "floor floors flooring vinyl laminate hardwood engineered tile tiles plank planks carpet carpets rug rugs baseboard baseboards trim underlay underlayment subfloor lvp lvt spc wpc",
      work: { zh: "楼梯 台阶 地面", en: "stairs staircase steps stair" }, ctx: { zh: "墙 地暖 地热", en: "wall walls" },
    },
    textiles: {
      zh: "窗帘 布艺 床品 床单 床笠 被套 被子 被铺 枕头 枕套 抱枕 靠垫 咕𠱸 毛巾 浴巾 地毯 地毡 桌布 沙发套 窗纱 纱帘 遮光布 布 面料 挂钩 窗帘杆 罗马杆 轨道 路轨 家纺 四件套 帘子 布样 门帘",
      en: "curtain curtains drape drapes drapery draperies sheer sheers fabric fabrics bedding duvet duvets sheet sheets pillow pillows pillowcase pillowcases cushion cushions throw throws blanket blankets towel towels rug rugs tablecloth tablecloths hook hooks rod rods track tracks ring rings grommet grommets swatch swatches linen linens comforter comforters quilt quilts valance valances panel panels slipcover slipcovers",
      work: { zh: "窗 窗户", en: "window windows" },
      ctx: { zh: "门 床 沙发 桌 椅 桌子 椅子", en: "door doors bed beds sofa sofas couch couches table tables chair chairs" },
    },
  };
  /* 认得、但不是任何一类产品的「对象」：墙、门、窗户、插座、开关、家电、搬家……服务类资料遇到它们一律不引用 */
  const OBJ_OTHER = {
    zh: "墙 墙面 墙壁 天花 天花板 吊顶 屋顶 屋面 门 门窗 窗 窗户 窗框 门框 推拉门 移门 木门 实木门 铁门 防盗门 玻璃门 房门 大门 入户门 铝合金门 卧室门 厨房门 卫生间门 浴室门 铁窗 纱窗 防盗窗 窗花 防盗网 防护栏 护栏 晾衣架 玻璃 隔断 屏风 石膏线 水管 管道 插座 开关 楼梯 台阶 地面 电线 线路 电路 家电 电器 冷气 搬家 搬屋 车位 院子 花园 围栏 栏杆 篱笆 凉亭 油漆 涂料 车窗 汽车 船 游艇 房车 天窗 电梯 地暖 地热 暖气 太阳能板 太阳能 光伏 衣帽间",
    en: "wall walls ceiling ceilings roof roofs roofing door doors window windows pipe pipes plumbing outlet outlets socket sockets switch switches stairs staircase steps stair fence fences deck decks fireplace fireplaces appliance appliances tv tvs television televisions piano pianos moving movers mover paint paints gutter gutters siding skylight skylights elevator elevators closet closets glass molding moldings moulding mouldings shed sheds pergola pergolas gazebo gazebos railing railings boat boats yacht yachts car cars truck trucks van vans rv rvs trailer trailers motorhome motorhomes camper campers",
  };
  const PROD_SET = {}, WORK_SET = {}, CTX_SET = {}, OWN_ALT = {};
  const both = (x) => [...wl((x && x.zh) || ""), ...wl((x && x.en) || "")];
  /* 房子的结构面（墙 / 天花 / 地面 / 窗 / 门 / 楼梯）对每个品类都可以是场景（curtains for high ceilings、灯装在楼梯上） */
  const STRUCT = wl("墙 墙面 墙壁 天花 天花板 地面 窗 窗户 门 楼梯 台阶 衣帽间 wall walls ceiling ceilings floor floors window windows door doors stairs staircase steps stair closet closets");
  for (const [k, v] of Object.entries(PROD)) { PROD_SET[k] = new Set([...wl(v.zh), ...wl(v.en)]); WORK_SET[k] = new Set(both(v.work)); CTX_SET[k] = new Set([...both(v.ctx), ...STRUCT]); OWN_ALT[k] = [...PROD_SET[k]].sort((a, b) => b.length - a.length).map((w) => (isHan(w) ? escRe(w) : `\\b${escRe(w)}\\b`)).join("|"); }
  const OBJ_ZH = new Set([...Object.values(PROD).flatMap((v) => wl(v.zh)), ...wl(OBJ_OTHER.zh)]);
  const OBJ_EN = new Set([...Object.values(PROD).flatMap((v) => wl(v.en)), ...wl(OBJ_OTHER.en)]);
  /* 做宾语：装 / 换 / 做 / 卖 / 拆 + X、do you have / sell X（中间可以隔两三个词，遇到介词就断）。work 类里只有窗户 / 楼梯做 do 的宾语不算（DO_OK：do my windows 就是做窗饰） */
  const HEAD_VERB_EN = String.raw`(?:install|installs|installing|installed|replace|replacing|build|builds|building|make|makes|making|fix|fixing|repair|repairing|put\s+in|paint|painting|sell|sells|selling|carry|carrying|supply|supplying|stock|deliver|delivers|delivering|remove|removing|move|moving|mount|mounting|hang|hanging|assemble|assembling|haul|tear\s+out|rip\s+out|take\s+out|demo\w*|offer|offering|(?:do|does)\s+(?:you|u)(?:\s+guys)?\s+(?:have|carry|sell|stock|offer))`;
  const HEAD_FILL_EN = String.raw`(?:\s+(?!(?:for|on|in|at|to|over|under|with|by|from|into|onto|above|below|near|beside|behind|through|of|around|across|between|against)\b)[\w'’-]+){0,3}\s+$`;
  const HEAD_EN = new RegExp(String.raw`\b(?:${HEAD_VERB_EN}|do|does|doing)${HEAD_FILL_EN}`, "i");
  const HEAD_EN_WORK = new RegExp(String.raw`\b${HEAD_VERB_EN}${HEAD_FILL_EN}`, "i");
  const HEAD_ZH = /(?:装|安装|做|换|修|卖|拆|送|整|造|订做|定做|定制|铺|搭|建|砌|刷|漆|搬|有冇|有没有|有无)(?:唔装|不装|唔做|不做|唔整|不整|唔卖|不卖)?(?:个|一个|一扇|一套|几扇|新的?|些|下|埋|啲|好|完|晒|一下)?$/;
  const PREP_EN = /\b(?:for|on|over|under|above|below|in|into|onto|of|with|beside|behind|around|near|through|across|by|at|to|between|against|from|along)\s+(?:[\w'’-]+\s+){0,3}$/i;
  /* 家具店里的柜子 / vanity 一和厨房、卫生间连用，就是厨卫的柜子（kitchen cabinets / 浴室柜），不是家具 */
  const KB_CTX = /\b(?:kitchen|bath(?:room)?s?|washrooms?|powder\s+room|ensuite)\b|厨房|卫生间|浴室|洗手间|厕所|卫浴/i;
  const KB_OBJ = new Set("cabinet cabinets cupboard cupboards vanity vanities 柜 柜子 橱柜".split(" "));
  /* 本品类产品前面的修饰词：前面是这些词时它是动词（can you refurbish chairs）或别人的货（my jysk bed / a Tesla charger），不当款式 */
  const VERB_SLOT = /^(?:you|u|i|we|they|to|please|pls|plz|can|could|will|would|should|may|might|must|me|us|them|it)$/;
  const OWNER_W = /^(?:my|our|his|her|their|a|an)$|['’]s$/;
  /* 「do my windows / do the stairs」就是做本行（窗饰、地板）；其余 work 类做 do 的宾语照样算外品类（do elevators） */
  const DO_OK = new Set("window windows skylight skylights stairs staircase steps stair 窗 窗户 楼梯 台阶".split(" "));
  const DESC_TOPIC = /^(?:grey|gray|white|black|beige|ivory|navy|cream|charcoal|taupe|blue|green|red|pink|yellow|brown|orange|purple|linen|cotton|polyester|velvet|silk|wool|leather|bamboo|jute|chenille|boucle|suede|acrylic|nylon|microfib(?:er|re)|wood|wooden|solid\s+wood|[红橙黄绿青蓝紫灰白黑棕粉米咖驼杏啡浅深]色|米白|奶白|棉麻|纯棉|亚麻|涤纶|丝绒|真丝|羊毛|真皮|皮质|皮革|实木|木质)$/i;
  const MOD_MID = new Set("style styled look type wood wooden blackout motorized motorised smart cordless custom roller roman zebra cellular sheer dining coffee accent kitchen bathroom living bedroom kids patio sliding french bay round square oval".split(" "));
  const NOT_LIGHT_NEXT = /^(?:\s+(?:filter\w*|block\w*|control\w*|gaps?|leak\w*|comes?|coming|gets?|getting|levels?|through|in|out|from|into|grey|gray|blue|green|brown|beige|pink|wood|oak|walnut|colou?r\w*|weight\w*|tones?|shades?|enough)\b|-)/i;
  /* 「送不送X」的 X 是产品 / 配件 / 礼品：赠品；否则多半是地点 */
  const GIFT_OBJ = new RegExp(`^(?:${[...new Set(Object.values(PROD).flatMap((v) => wl(v.zh)))].filter((w) => w.length > 1 || /[床柜桌椅凳灯布帘]/.test(w)).concat("礼品", "礼物", "赠品", "小样", "样品", "配件", "五金", "安装包", "灯泡", "电池", "坐垫", "地垫", "窗帘扣", "绑带", "绑绳", "钩子", "杆子", "挂钩", "窗帘杆", "罗马杆", "轨道", "踢脚线", "地脚线", "扣条", "收边条", "压条", "防潮垫", "螺丝", "角阀", "软管", "下水器", "毛巾架", "光源", "灯管").sort((a, b) => b.length - a.length).join("|")})`);

  /* 中文虚字：语法字、代词、语气词、情态、最常见的动词；不和旁边认不出的字粘成词 */
  const ZH_XU = new Set([..."我你您他她它们咱的地得了着过吗嘛呢吧啊呀哦喔噢哈啦么是也就还又再很都才只请问谁啥咩嘅啲哋佢冇唔喺嚟咗乜怎哪这那有没不可能会要想在从给把被让对和跟与或及但并若向往为以用比更最太挺蛮超好些该此其呗咯嗯哎诶嘿喂哇呃系咁噉嗰啱俾畀睇嘢喎啰咧吖㗎嘞喇噃咪呐添先吓揾搵攞埋同识使唷耶欸哟嗨离",
    ..."看买卖装送量测做拆换洗搬帮找等拿取选挑来去到住说讲聊试订改加挂拉推铺贴刷擦配带收发寄算报知懂叫需整弄搞多少几用让给请问挡照遮按调度拣"]);
  /* 中文实字：数字、量词、产品、颜色、方位、房屋结构等能单独成词、也常是地名一部分的字 */
  const ZH_SHI = new Set([..."一二两三四五六七八九十百千万零半个扇米张条套件块片对层楼间面次趟寸尺码平方卷盒箱根组款种样号型细靓",
    ..."灯窗帘布床柜桌椅凳门墙板砖杆轨架盆镜台梯杯碗纱绒棉麻丝皮木竹藤铁钢铝铜石玻璃漆胶",
    ..."大小新旧长短宽窄高低厚薄深浅亮暗白黑灰红黄蓝绿粉棕金银紫橙青咖驼杏色光电水火风",
    ..."家房屋厅室厨卫浴院上下左右前后里外内边旁头底顶角口中东西南北全热冷防",
    ..."点分钟天日月年周早晚午夜今明昨货价钱费人"]);
  /* 单个生字做谓语：前面是情态，后面是体貌 / 疑问 */
  const ZH_PRED_L = new Set([..."能可会要想得帮请别"]);
  const ZH_PRED_R = new Set([..."了咗过掉着吗嘛么唔"]);
  /* 中文常用多字词（礼貌、代词、疑问、情态、动词、形容、房屋、通用名词）。产品名、地名、意图词另有来源 */
  const ZH_WORDS = `请问 你好 您好 想问 问下 问问 问一下 请教 麻烦 谢谢 感谢 多谢 唔该 老板 老板娘 师傅 美女 帅哥 亲爱 哈喽 打扰 不好意思 劳驾 拜托 早上好 下午好 晚上好 大家好 你好呀
    我们 你们 他们 她们 咱们 大家 自己 本人 这个 那个 哪个 这些 那些 哪些 这款 那款 哪款 这种 那种 哪种 这样 那样 怎样 怎么 怎么样 怎么办 如何 什么 为什么 为啥 甚么 啥样 多少 几个 几种 几款 几样 哪里 哪儿 这里 那里 这边 那边 这儿 那儿
    呢个 嗰个 边个 边款 边种 乜嘢 咩嘢 点样 点解 几时 边度 呢度 嗰度 呢款 嗰款 呢啲 嗰啲 你哋 我哋 佢哋 咁样 噉样 而家 宜家 呢排 成日 一齐 边间 琴日 有冇得 冇问题 唔使 使唔使 识唔识 得唔得 啱唔啱 好唔好 系咪 系唔系 系不系 同埋 帮手 睇下 睇吓 睇睇 搞掂 唔该晒 多谢晒
    可以 能够 能不能 可不可以 可唔可以 是不是 是否 有没有 有冇 有无 有木有 会不会 要不要 需不需要 行不行 能否 可否 应该 应当 估计 也许 或许 可能 肯定 一定 总该 需要 想要 希望 打算 准备 考虑 喜欢 推荐 介绍 建议 了解 知道 确认 告诉 请问下 一下 一点 一点点 一些 有点 有些 一起 还有 另外 其他 其它 别的 或者 还是 而且 但是 不过 因为 所以 如果 的话 然后 现在 目前 平时 一般 通常 大概 大约 左右 比较 非常 特别 真的 最好 更加 已经 刚刚 刚好 正好 主要 一直 总是 经常 还是说 顺便 另外问下
    看看 看下 瞧瞧 了解下 购买 订购 下单 定做 订做 定制 订制 订造 定造 做成 做到 装上 装好 安装 选择 挑选 搭配 使用 用来 适合 合适 适用 控制 操控 调节 调整 遥控 清洗 清洁 打理 更换 换成 改成 处理 帮忙 咨询 联系 提供 包括 支持 区别 不同 对比 差别 分别 种类 类型 品种 选项 拆旧 拆除 拆掉 拆走 带走 清走 拉走 收走 上墙 挂墙 落地 吸顶 嵌入 明装 暗装
    产品 商品 东西 款式 尺寸 大小 尺码 规格 型号 颜色 色系 材质 材料 面料 布料 样品 样板 小样 图片 照片 效果 效果图 方案 设计 风格 品牌 质量 做工 工艺 功能 配件 五金 系列 新款 新品 爆款 热卖 款 现货 库存 手机 遥控 开关 语音 定时 电池 充电 插电 电源 电线 线 宽度 高度 长度 深度 厚度 重量 面积 平方 平米 米 厘米 公分 毫米 寸 英寸 尺 码
    简约 现代 北欧 美式 中式 欧式 日式 法式 轻奢 复古 好看 漂亮 结实 方便 实用 舒服 舒适 柔软 高级 大气 时尚 简单 普通 常见 标准 定制款 成品 半成品 遮光 透光 半遮光 全遮光 电动 手动 智能 静音 无线 有线 隐形 加厚 加宽 加长 加高 超长 超宽 超大 小号 大号 中号 落地 半高 全高
    窗户 窗口 窗台 窗框 飘窗 落地窗 转角窗 天窗 阳台 客厅 卧室 主卧 次卧 书房 儿童房 婴儿房 厨房 餐厅 卫生间 浴室 洗手间 厕所 玄关 走廊 楼梯 地下室 阁楼 房间 房子 新房 新家 家里 家中 公寓 别墅 楼上 楼下 电梯 门口 屋企 办公室 公司 店里 楼层 一楼 二楼 三楼 顶楼 墙上 天花上 地上 窗上 门上 整屋 全屋 整套 全套
    老公 老婆 家人 朋友 小孩 孩子 宝宝 老人 父母 爸妈 客户 设计师 装修 新装修 刚装修 交房 交楼 入伙 收楼 装修中 毛坯 精装 二手房 老房子 老房 新楼 出租屋
    全黑 漆黑 黑暗 很黑 太黑 太亮 很亮 刺眼 分别 区别 厉害 严重 挡住 遮挡 挡光 挡太阳 照进 照进来 照射 晒进来 很热 太热 很冷 保护 防止 避免 减少 隔绝 好用 耐看 用什么 什么好 好不好 哪种好 哪个好 选哪个 求推荐 推荐下 怎么选 效果好 效果怎么样 质量好 质量怎么样
    客制 客制化 智慧 拣 揀 揀选 现成 成品 现货 推介 度身 度身订造 啡色 刚买 新买 打算买 想买 准备买 在看 看中 看上 喜欢的 心水
    睡房 房间里 负责 按照 根据 照着 跟住 一套 一张 一对 这套 那套 呢套 嗰套 呢张 嗰张 小户型 大户型 户型 放得下 放不下 尺寸合适 帮手 帮忙装 自己装 安装方式 怎么装 点样装
    时候 的时候 那时候 到时候 之前 之后 以前 以后 同时 犀利 厉害 冷气房 岩板 科技布 抽屉 收纳 储物 暖黄光 暖白光 暖光 黄光 白光 冷白光 钟意 中意 好睇 靓 心水 细单位 单位 摆得下 摆得落 西斜 晒入嚟 照入嚟 挡阳光 挡猛光 系统柜 一字型 L型 转角 带抽屉`;
  /* 英文通用词：虚词、代词、情态与缩写、常见动词、形容词、通用名词、房屋与人。产品名、地名、意图词另有来源 */
  const EN_WORDS = `a an the this that these those there here it its they them their theirs we us our ours you your yours yourself yourselves i me my mine myself he him his she her hers one ones some any all both each every either neither no not none nothing something anything everything someone anyone somebody anybody everyone everybody
    who whom whose which what whatever whichever when where why how whether if then than so as at by for from in into of off on onto out over to up down with without about above below under underneath between through throughout during before after since until till upon via per across against along among around behind beside besides beyond inside outside near nearby far within
    and or but nor yet also too very really quite just only even still already again ever never always often sometimes usually maybe perhaps probably actually basically generally typically normally especially exactly approximately roughly about almost nearly fairly pretty rather somewhat enough instead otherwise anyway anyways though although because cause since unless while whereas however plus btw lol haha hmm um oh ah wow
    please pls plz thanks thank thx ty tnx cheers hi hello hey hiya dear yes yeah yep yup no nope ok okay sure sorry excuse kindly wondering wonder wondered curious question questions quick asking ask asked info information details detail more most less least much many few lot lots bit little such same other others another else own way ways kind kinds sort sorts type types like etc vs versus fyi
    am is are was were be been being do does did done doing have has had having can could will would shall should may might must need needs needed ought don't doesn't didn't isn't aren't wasn't weren't can't cannot couldn't won't wouldn't shouldn't haven't hasn't hadn't
    i'm i've i'd i'll you're you've you'd you'll we're we've we'd we'll they're they've they'd they'll it's that's there's what's how's where's who's let's he's she's here's im ive id youre dont doesnt didnt isnt arent cant couldnt wont wouldnt shouldnt whats thats theres lets u ur r ya yall y'all gonna wanna gotta hav thru tho w/
    get got gotten give gave given make made take took taken go went gone going come came see saw seen look looks looking want like love prefer think thought know knew known tell told show shown send sent help find found buy bought purchase order ordered offer carry sell sold stock stocked provide supply recommend suggest choose chose chosen pick select use work fit match suit
    install deliver assemble set setup measure book schedule visit check try change replace open close control operate adjust raise lower lift pull push turn run hang hung mount cover block reduce keep let put add include cost pay wash clean care last customize customise tailor cut remove haul bring call text email contact reach live stay move build finish start plan consider search shop hope interest mean say said ask answer reply wait sound seem seems feel compare decide arrange handle manage protect hide filter darken brighten dim connect link sync pair program automate charge plug power wire paint stain upgrade update redo decorate furnish design style picture imagine expect worry matter happen sit sleep cook store hold holds support supports fold extend recline swivel rotate tilt slide glide roll operate hear heard saw seen noticed love loved liked fits fitted matches needs wants
    good great nice best better beautiful pretty lovely gorgeous cute cool modern contemporary classic traditional simple elegant stylish basic standard regular normal special custom customized customised bespoke big bigger biggest large larger largest small smaller smallest tiny huge wide wider narrow narrower long longer short shorter tall taller high higher low lower deep shallow thick thin heavy light lighter dark darker bright brighter soft hard new newer old older existing current different same similar available possible easy easier difficult popular common typical quality premium luxury durable sturdy strong solid quiet smart automatic automated manual electric electronic wireless cordless rechargeable powered motorised motorized outdoor indoor exterior interior full half double single whole entire extra main front back side top bottom left right upper lower inner outer middle centre center built-in matching neutral natural warm cool cold hot dry wet humid sunny shady clear frosted opaque sheer translucent private ideal perfect suitable compatible adjustable flexible removable modular foldable extendable expandable reclining tufted upholstered padded comfy comfortable cozy cosy minimal minimalist rustic industrial scandinavian farmhouse coastal boho vintage retro midcentury mid century transitional glam fancy plain textured patterned striped floral geometric freestanding floating recessed flush semi stupid silly dumb random weird odd real actual whole
    size sizes sizing dimension dimensions measurement measurements width height length depth inch inches ft feet foot cm mm metre metres meter meters yard yards color colour colors colours style styles option options choice choices model models design designs finish finishes texture textures pattern patterns look looks material materials sample samples swatch swatches catalog catalogue brochure photo photos picture pictures pic pics video videos range collection collections selection variety brand brands product products item items piece pieces set sets pair pairs version versions feature features function functions control controls app apps phone phones smartphone voice timer timers schedule sensor sensors power cord cords chain chains wand wands mount mounting installation lining liner layer layers privacy sunlight sun heat glare view views noise warmth insulation energy temperature brightness lumen lumens watt watts wattage kelvin
    wood wooden oak walnut maple pine teak bamboo metal aluminum aluminium steel brass chrome glass marble quartz granite stone ceramic porcelain leather velvet linen cotton polyester wool silk jute plastic resin fabric fabrics frame frames leg legs arm arms seat seats drawer drawers shelf shelves handle handles knob knobs base bases cushion cushions
    room rooms bedroom bedrooms kitchen kitchens bathroom bathrooms washroom washrooms powder ensuite basement attic loft garage patio deck balcony sunroom porch hallway hall foyer entryway entrance stairs staircase stairwell landing closet closets pantry laundry mudroom den office study nursery playroom living dining family great house houses home homes condo condos apartment apartments flat unit units townhouse townhome cottage cabin place space spaces area areas window windows door doors wall walls ceiling ceilings floor floors corner corners skylight skylights bay bow casement sliding slider french trim sill sills opening openings upstairs downstairs storey story level
    wife husband kids kid children child baby babies mom dad parents friend friends neighbour neighbor customer customers client clients designer designers contractor contractors builder builders landlord tenant tenants owner owners team staff installer installers guy guys people person sales salesperson rep someone
    morning mornings afternoon afternoons evening evenings night nights day days week weeks month months year years time times weekend weekends weekday weekdays today tonight now soon later moment while
    number numbers dozen couple few several hundred hundreds thousand first second third fourth fifth last next one two three four five six seven eight nine ten eleven twelve fifteen twenty thirty forty fifty single pair
    fast faster quick quickly slow slowly easily simply properly fully completely totally away back forward together apart alone ahead anywhere everywhere somewhere elsewhere storage
    invest investing investor referral referred recommended return returning renovate renovating renovation reno remodel remodeling remodelling refresh moved purchased deciding thinking planning shopping browsing interested keen excited happy glad pleased worried concerned unsure confused canton
    idea ideas advice opinion opinions recommendation recommendations problem issue issues concern concerns difference differences benefit benefits pros cons project projects job jobs process step steps plans timeline thing things stuff machine machines hand
    super extremely absolutely definitely certainly possibly hopefully currently recently lately nowadays eventually slightly tad bit able unable borrow lend rent keep bring brought taking leave left plenty tons neat newly brand rid wk wks mo mos yr yrs hr hrs min mins
    postal code codes zip address street avenue road drive crescent court lane boulevard apt suite intersection plaza mall station cell mobile
    dual triple multi multiple various varied mixed combo combination flush flushing standard deluxe basic
    lmk tbh imo idk np nvm jk omg asap fyi hmu
    coffee accent oval rectangular rectangle chaise shaped shape faux pleat pleated pleats plantation wifi wi fi bluetooth panel panels mail mailed pinch eyelet eyelets lvp lvt spc wpc click rip shaker medicine consult consultation consultations consulting dimmable damp moist storey storeys foyer nook bench`;
  const ZH_LEX_RX = new RegExp([...new Set([...wl(ZH_WORDS), ...OBJ_ZH])].filter((w) => w.length > 1).sort((a, b) => b.length - a.length).map(escRe).join("|"), "g");
  const EN_LEX = new Set([...wl(EN_WORDS), ...OBJ_EN, ...EN_NOT, ...EN_LOW_SKIP, ...EN_SLOT_SKIP, ...EN_LEAD, ...EN2P.keys()]);
  /* 简单词形还原：复数、过去式、进行时、比较级、副词、缩写 */
  const enStems = (w) => {
    const out = [w];
    const add = (x) => { if (x && x.length >= 2) out.push(x); };
    if (/['’]s$/.test(w)) add(w.slice(0, -2));
    if (/s$/.test(w)) add(w.slice(0, -1));
    if (/es$/.test(w)) add(w.slice(0, -2));
    if (/ies$/.test(w)) add(`${w.slice(0, -3)}y`);
    if (/ied$/.test(w)) add(`${w.slice(0, -3)}y`);
    if (/ed$/.test(w)) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (/(.)\1ed$/.test(w)) add(w.slice(0, -3)); }
    if (/ing$/.test(w)) { add(w.slice(0, -3)); add(`${w.slice(0, -3)}e`); if (/(.)\1ing$/.test(w)) add(w.slice(0, -4)); }
    if (/er$/.test(w)) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (/(.)\1er$/.test(w)) add(w.slice(0, -3)); }
    if (/est$/.test(w)) { add(w.slice(0, -3)); add(w.slice(0, -2)); }
    if (/ly$/.test(w)) add(w.slice(0, -2));
    if (/(?:a|i)ble$/.test(w)) { add(w.slice(0, -4)); add(`${w.slice(0, -4)}e`); if (/(.)\1able$/.test(w)) add(w.slice(0, -5)); }
    if (/ily$/.test(w)) add(`${w.slice(0, -3)}y`);
    if (/n['’]t$/.test(w)) add(w.slice(0, -3));
    return out;
  };
  /* 拉长的字母（hiii / pleaseee / sooo）先收成一个或两个再查 */
  const enHas = (set, w) => [w, w.replace(/([a-z])\1{2,}/g, "$1"), w.replace(/([a-z])\1{2,}/g, "$1$1")].some((v) => enStems(v).some((x) => set.has(x)));
  /* 数字、尺寸、序数、时间：3x5、10ft、2nd、72"、5pm */
  const NUM_TOK = /^\d+(?:[.,/:-]\d+)*(?:[x×]\d+(?:[.,]\d+)?)*(?:st|nd|rd|th|s|ft|in|inch|inches|cm|mm|m|k|kg|lb|lbs|pcs|pc|pm|am|x|"|'|’|'')?$/i;
  const G = (r) => new RegExp(r.source, r.flags.includes("g") ? r.flags : `${r.flags}g`);
  /* 能「解释」字的规则：所有意图规则、属性、门店、营业时间、不算价格 / 工期的写法、地名表、邮编 */
  /* 只在搭配里认的词：kitchen island、home theatre、breakfast bar、come round（the island / the bar 单独出现可能是地点或商铺） */
  const EN_PHRASES = /\b(?:kitchen\s+islands?|home\s+theat(?:re|er)s?|media\s+rooms?|breakfast\s+(?:bar|nook)s?|come\s+round|round\s+(?:tables?|mirrors?|rugs?)|square\s+(?:tables?|feet|foot|metres?|meters?))\b/gi;
  const GATE_RX = [RX.price, RX.time, RX.timeSoft, RX.sched, RX.hours, RX.bot, RX.area, RX.install, RX.visit, RX.cred, RX.scope, RX.policy, RX.privateCh,
    SHOWROOM, TOPIC, ASK_UNCOVERED, BED_SIZE, JOB_RX, VAGUE_AREA, EN_PHRASES, NOT_PRICE, NOT_TIME, LIFE, WARRANTY, GIFT_WORDS, EN_POSTAL, EN_ADDR, EN_ROAD, EN_TABLE_RX,
    new RegExp(ZH_NAMES.map(escRe).join("|"), "g"), new RegExp(NOT_PLACE_ZH_PARTS.slice(1).join("|"), "g"),
    ...Object.values(CATS).flatMap((c) => c.facts.map((f) => f.key))].map(G);
  const EN_TOK = /[A-Za-z][A-Za-z'’]*|\d[\w'’".\/×]*/g;
  const PERSON_OBJ = /\b(?:deliver|install|assemble|set\s*up|remove|haul|bring|move|carry|take|pick\s+up|drop\s+off)\s+(?:(?:my|our|the|your|his|her|their|a|an)\s+)?(kids?|children|child|bab(?:y|ies)|mom|mum|dad|wife|husband|friends?|family|parents?|sons?|daughters?|grandma|grandpa|dogs?|cats?|pets?)\b|(?:送|载|接|搬)(?:我|我们|我哋)?(?:的|嘅)?(孩子|小孩|仔女|老婆|老公|朋友|家人|爸妈|父母|老人|宠物|狗|猫)/gi;
  const FLOOR_DEST = /\b(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|top|upper|main|ground|lower|same|next|other)\s+floors?\b/gi;
  const NAME_L = /(?:^|[\s,.!?])(?:hi|hello|hey|hiya|dear|thanks|thank\s+you|thx|cheers|regards|referred\s+by|recommended\s+by|sent\s+by|told\s+by|my\s+name\s+is|this\s+is|name['’]?s|i\s+am|i['’]?m)[\s,]+$/i;
  /* 送货 / 上门：留言没读懂时，这类意图一律按地点待确认处理（不邀约、条件式结尾） */
  const DELIVER = /\bdeliver\w*|\bship(?:s|ped|ping)?\b|送货|送到|送去|配送|送上门|上门/i;
  /* 泛泛的服务动词（服务吗 / 去吗 / 有冇做 / come out / nearby / ok for an install）：留言里没有对象名词时，没读懂的多半是地点 */
  const SVC_VERB = /服务|过来|(?:你们?|你哋|贵店|师傅)(?:会|能|可以)?(?:去|到|来|嚟)|去(?:吗|嗎|唔去|不去|不)|到(?:吗|嗎|唔到|不到)|有(?:冇|没有?)(?:去|到|做)|做(?:唔做|不做)|\b(?:nearby|near\s+(?:you|u)|too\s+far|go\s+to|come\s+(?:out|to|up|down|over))\b|\b(?:ok|okay)\s+for\s+(?:an?\s+|the\s+)?(?:install\w*|deliver\w*|visit|measure\w*|appointment|consult\w*)\b/i;

  /* 覆盖率：返回没读懂的片段（residue）、留言里的对象名词（objs）和其中不属于本品类的（foreign） */
  function coverage(s, cat, city, loc) {
    const C = cityInfo(city);
    let t = String(s || "");
    const blank = (re, ch) => { t = t.replace(re, (m) => ch.repeat(m.length)); };
    /* 店主城市（不带限定词时）、已认出的地点：算读懂（是不是本地由地点规则判断） */
    for (const r of C.raws) { const x = norm(r); if (x.length >= 2 && isHan(x)) t = t.split(x).join("◇".repeat(x.length)); }
    for (const P of C.parts) {
      if (P.han) blank(new RegExp(`${escRe(P.base)}[市区县镇]?`, "g"), "◇");
      else if (P.n) blank(new RegExp(`(?<![A-Za-z])${escRe(P.n)}(?![A-Za-z])`, "gi"), " ");
    }
    for (const q of C.quals) if (q) blank(new RegExp(`(?<![A-Za-z])${escRe(q)}(?![A-Za-z])`, "gi"), " ");
    for (const p of (loc && loc.places) || []) for (const x of new Set([p.raw, p.zh, p.en].filter((y) => y && y.length >= 2))) blank(new RegExp(`(?<![A-Za-z])${escRe(norm(x))}(?![A-Za-z])`, "gi"), isHan(x[0]) ? "◇" : " ");
    /* 「third floor / 2nd floor / top floor」是楼层（送到几楼），不是地板这个对象 */
    const floorDest = [...t.matchAll(FLOOR_DEST)].map((m) => [m.index, m.index + m[0].length]);
    const n = t.length;
    const own = PROD_SET[cat] || PROD_SET.blinds, work = WORK_SET[cat] || new Set(), ctx = CTX_SET[cat] || new Set();
    const ownZh = [...own].filter(isHan).sort((a, b) => b.length - a.length);
    /* 0 没读懂；1 实字（会和生字粘连）；2 读懂 */
    const st = new Uint8Array(n);
    /* multi：被两字以上的词 / 规则整词盖住的位置（「上门」里的门不是对象） */
    const multi = new Uint8Array(n);
    for (const re of [...GATE_RX, ZH_LEX_RX]) {
      re.lastIndex = 0;
      for (const m of t.matchAll(re)) {
        const w = m[0];
        if (!w) continue;
        const one = w.length === 1 && isHan(w);
        const lv = one ? (ZH_XU.has(w) ? 2 : 1) : 2;
        for (let k = m.index; k < m.index + w.length; k++) { if (st[k] < lv) st[k] = lv; if (!one) multi[k] = 1; }
      }
    }
    for (let k = 0; k < n; k++) if (!st[k] && isHan(t[k])) st[k] = ZH_XU.has(t[k]) ? 2 : ZH_SHI.has(t[k]) ? 1 : 0;
    const residue = [];
    /* 中文：实字和生字连成的词，只要含生字就整词算没读懂；
       例外：两字以上、紧跟本品类产品的（岩板餐桌、科技布沙发）是款式 / 材质名，不算没读懂（前面是「我的 / 朋友的」时是别人的货，照算） */
    const ownZhAt = (j) => { const k = /^[的嘅款式型风]/.test(t.slice(j)) ? j + 1 : j; return ownZh.find((w) => t.startsWith(w, k)) || null; };
    /* mods：当款式名放过的修饰词和它修饰的产品；资料只靠这个产品名触发时（universal remotes → 电动款资料）不算读懂，由 plan 复核 */
    const mods = [];
    for (let k = 0; k < n;) {
      if (!isHan(t[k]) || st[k] === 2) { k++; continue; }
      let j = k, unk = false;
      while (j < n && isHan(t[j]) && st[j] < 2) { if (!st[j]) unk = true; j++; }
      const mod = j - k >= 2 && ownZhAt(j) && !/(?:我|我们|我哋|朋友|别人|人家|亲戚|佢|他|她)(?:的|嘅)?$/.test(t.slice(Math.max(0, k - 4), k));
      if (unk && mod) mods.push({ w: t.slice(k, j), prod: ownZhAt(j) });
      if (unk && !mod && (j - k >= 2 || ZH_PRED_L.has(t[k - 1] || "") || ZH_PRED_R.has(t[j] || ""))) residue.push(t.slice(k, j));
      k = j;
    }
    /* 英文：按词查；「the Aspen sofa」大写词紧跟产品名是款式名（前面是 a / my / 某人的、或是已知品牌时不算：那是别人的货） */
    const toks = [...t.matchAll(EN_TOK)];
    const occ = [];
    const gap = (a, b) => t.slice(toks[a].index + toks[a][0].length, toks[b].index);
    /* 本品类产品前面的修饰词（coffee table、solar shades、pinch pleat curtains、faux wood blinds）：中间只隔认不出的词、材质 / 颜色词或少数款式词 */
    const modBefore = (i) => {
      for (let j = i + 1; j <= i + 3 && j < toks.length; j++) {
        if (!/^[\s-]+$/.test(gap(j - 1, j))) return false;
        const x = toks[j][0].toLowerCase();
        if (enHas(own, x)) return toks[j][0];
        if (/^\d/.test(x) || enHas(OBJ_EN, x) || !(!enHas(EN_LEX, x) || MOD_MID.has(x) || TOPIC1.test(x))) return null;
      }
      return null;
    };
    toks.forEach((m, i) => {
      const w = m[0];
      let all = true;
      for (let k = m.index; k < m.index + w.length; k++) if (st[k] < 2) { all = false; break; }
      const low = w.toLowerCase().replace(/’/g, "'");
      /* 修饰名词：后面紧跟本品类产品（TV stand、piano bench、wall sconce）、或连字符（wall-mounted、floor-standing）时不算对象 */
      const nxt = toks[i + 1] && toks[i + 1][0].toLowerCase();
      const after = t.slice(m.index + w.length);
      /* 单数的 light 是「光」（light filtering、morning light、block the light、light grey），只有 a / my / this light、install the light 才是灯 */
      const before = t.slice(Math.max(0, m.index - 40), m.index);
      const lightOk = low !== "light" || (/\b(?:a|an|my|our|this|that|new|one|another|the|each|every)\s+$/i.test(before) && !/\b(?:block\w*|filter\w*|let\w*|keep\w*|reduce\w*|cut\w*|stop\w*|control\w*|dim\w*|darken\w*|more|less|much|enough|no|any|all|the\s+sun|natural)\s+(?:the\s+)?$/i.test(before) && !NOT_LIGHT_NEXT.test(after));
      /* 材质词做修饰（glass door、玻璃窗）：中心词是后面的门 / 窗 */
      const matMod = low === "glass" && nxt && enHas(OBJ_EN, nxt) && /^\s+$/.test(gap(i, i + 1));
      if (!/^\d/.test(w) && lightOk && !matMod && enHas(OBJ_EN, low) && !floorDest.some(([a, b]) => m.index >= a && m.index < b) && !(nxt && enHas(own, nxt) && /^\s+$/.test(gap(i, i + 1))) && !/^-[A-Za-z]/.test(after)) occ.push({ w: low, i: m.index });
      if (all) return;
      if (/^\d/.test(w)) { if (!NUM_TOK.test(w)) residue.push(w); return; }
      if (low.length < 2 || enHas(EN_LEX, low)) return;
      const nx = toks[i + 1];
      const prevW = i > 0 ? toks[i - 1][0].toLowerCase() : "";
      const owned = OWNER_W.test(prevW);
      if (/^[A-Z][a-z]{2,}/.test(w) && nx && enHas(OBJ_EN, nx[0].toLowerCase()) && !owned && !BRAND_EN.has(low)) return;
      if (/^[a-z]/.test(w) && !owned && !VERB_SLOT.test(prevW) && !BRAND_EN.has(low)) { const prod = modBefore(i); if (prod) { mods.push({ w, prod }); return; } }
      /* 人名：打招呼 / 署名 / referred by 之后、所有格接住处（Hi Lucas、referred by Mike、Jane's place、— Amy） */
      const base = w.replace(/['’]s$/, "");
      if (/^[A-Z][a-z]+$/.test(base) && (NAME_L.test(t.slice(Math.max(0, m.index - 24), m.index)) || EN_PERSON_R.test(t.slice(m.index + base.length)) || (!nx && /[-–—~]\s*$/.test(t.slice(0, m.index))))) return;
      residue.push(w);
    });
    /* 中文对象：按最长词切（「上门」「门店」先切走，剩下的「门」「墙」才算对象；实木门 / 推拉门 整词是对象） */
    for (const m of t.matchAll(ZH_LEX_RX)) if (OBJ_ZH.has(m[0]) && !(own.has(m[0]) ? false : ownZhAt(m.index + m[0].length)) && !(m[0] === "玻璃" && /^[窗门]/.test(t.slice(m.index + 2)))) occ.push({ w: m[0], i: m.index });
    /* 人或宠物直接做服务动词的宾语（deliver my kids / 送我孩子）：对象不是产品 */
    for (const m of t.matchAll(PERSON_OBJ)) occ.push({ w: m[1] || m[2], i: m.index, person: true });
    for (let k = 0; k < n; k++) if (!multi[k] && OBJ_ZH.has(t[k])) occ.push({ w: t[k], i: k });
    /* 分类：本品类产品；work（窗饰的窗户）不做「装 / 换 / 卖」的宾语时算数；ctx（场景）要跟在介词后、或留言里另有本品类产品；其余都是外品类对象 */
    const inSet = (S, w) => (isHan(w[0]) ? S.has(w) : enHas(S, w));
    const kb = cat === "furniture" && KB_CTX.test(t);
    const isOwn = (o) => !o.person && inSet(own, o.w) && !(kb && KB_OBJ.has(o.w));
    const ownObjs = occ.filter(isOwn).map((o) => o.w);
    const head = (o, workItem) => (isHan(o.w[0]) ? HEAD_ZH.test(t.slice(Math.max(0, o.i - 6), o.i)) : (workItem ? HEAD_EN_WORK : HEAD_EN).test(t.slice(Math.max(0, o.i - 60), o.i)));
    const ok = (o) => isOwn(o)
      || (!o.person && inSet(work, o.w) && !head(o, DO_OK.has(o.w)))
      || (!o.person && inSet(ctx, o.w) && !head(o, false) && (ownObjs.length > 0 || (!isHan(o.w[0]) && PREP_EN.test(t.slice(Math.max(0, o.i - 40), o.i)))));
    const objs = occ.map((o) => o.w);
    const foreign = occ.filter((o) => !ok(o)).map((o) => o.w);
    return { residue, objs, foreign, ownObjs, mods };
  }
  /* strong 地点位置上的候选（我在X…）：X 整词看，含生字的词就算地名 */
  const zhUnknownWord = (x) => coverage(x, "blinds", "", null).residue.some((r) => isHan(r[0]) && r.length >= 2);
  /* weak 位置上的候选（分句开头的 X能装吗）：整段都是常用多字词（负责、小户型、睡房）就不是地名 */
  const zhCommonWords = (x) => { const cov = new Uint8Array(x.length); for (const m of x.matchAll(ZH_LEX_RX)) for (let k = m.index; k < m.index + m[0].length; k++) cov[k] = 1; return [...x].every((ch, k) => cov[k] || !isHan(ch)); };

  /* ───────── 离线草稿库：语言 ───────── */
  const ZH_FUNC = /(吗|嗎|呢|吧|嘛|么|麼|有没有|有沒有|你们|你們|我们|我們|可以|能不能|是不是|多少|什么|甚麼|什麼|怎么|怎麼|冇|係|系|唔|咩|嘅|喺|啲|乜|幾時|几时|想问|想問|几钱|幾錢|几多|幾多|几耐|幾耐|你哋|佢|咗|嚟|俾|畀|点解|點解|点样|點樣|边度|邊度)/;
  /* 英文虚词：中文留言里夹几个英文品名（motorized zebra blinds）不算英文句子 */
  const EN_FUNC = /\b(?:i|i'm|im|we|you|u|your|my|our|do|does|did|can|could|would|will|should|is|are|was|am|have|has|how|what|when|where|which|who|why|the|a|an|to|in|on|for|of|and|or|with|please|pls|hi|hello|hey|thanks|any|need|want|looking|get|there|it|this|that|these|those|me|us|if|at|from|by)\b/i;
  /* 微信号、邮箱、拼音 ID（含 _ 数字 @ .）和联系方式关键词不当英文单词计 */
  const CONTACT_TOKEN = /[\w.+-]+@[\w-]+\.[\w.]+|@\w[\w.]*|https?:\/\/\S+|www\.\S+|\b(?=[A-Za-z.]*[\d_.])[A-Za-z][\w.-]*|\b(?:vx|wx|wechat|weixin|whatsapp|line|ig|instagram|id|email|e-mail|tel|wa|pm|dm|inbox|ok|okay|v)\b/gi;
  function detectLang(text, city) {
    const probe = norm(stripCity(String(text || ""), city));
    const han = (probe.match(/[㐀-鿿]/g) || []).length;
    if (!han) return "en";
    if (ZH_FUNC.test(probe)) return "zh";
    const latin = probe.replace(CONTACT_TOKEN, " ");
    if (!EN_FUNC.test(latin)) return "zh";
    /* 拉丁字母按单词计、汉字两字约一词：「Can you do 遮光 blinds?」仍是英文 */
    const words = (latin.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length;
    return Math.ceil(han / 2) >= words ? "zh" : "en";
  }

  /* ───────── 离线草稿库：计划与渲染（同一份计划按语言渲染，对照 = 换语言渲染） ───────── */
  /* 「顺便 / 顺手 / 顺埋」+ 外品类的活（顺便把墙砖换了 / 顺便刷个墙 / 顺手改下水 / 顺便装个热水器）：示例资料没讲到，交给店主、不邀约；
     顺便拆的是本品类的旧件（顺便把旧马桶拆了）照常 */
  const SIDE_MARK = /(?:顺便|顺带|顺手|顺埋|顺路|一并|同时)([^，,。！!？?；;]{1,16})/g;
  const SIDE_WORK = /换|刷|改|贴|铺|做|装|接|移|挪|拆|砌|补|修|走|拉|加|打|弄|搞|整|包|通|挖|封|翻新|粉刷/;
  const SIDE_CONSTR = /墙砖|墙面|墙壁|墙(?![上边角里下])|地砖|瓷砖|吊顶|天花|下水(?!器)|上水|水电|水管|水路|水喉|电线|电路|线路|插座|插苏|开关|燃气|煤气|热水器|防水/;
  function sideJob(n, cat, city) {
    for (const m of n.matchAll(SIDE_MARK)) {
      const t = m[1];
      if (SIDE_WORK.test(t) && (SIDE_CONSTR.test(t) || coverage(t, cat, city, null).foreign.length)) return true;
    }
    return false;
  }
  function plan({ text, cat, city } = {}) {
    const raw = String(text || "").trim().slice(0, 280);
    if (!raw) return null;
    const lang = detectLang(raw, city);
    const script = detectScript(raw, city);
    const n = norm(raw);
    if (isBlocked(n)) return { lang, script, blocked: true, flags: { block: true }, cites: [], explained: false, residue: [] };
    const c = catOf(cat);
    /* 联系方式（微信号 / IG 账号 / 邮箱 / 电话）只用来判断「想私聊」，不参与别的意图：「my ig is blinds.deals」不是问折扣 */
    const nM = maskContact(n);
    const g = giftStrip(nM);
    const nF = g.text;
    const hours = RX.hours.test(n);
    /* 想私聊：私聊说法、电话（含混写的数字串）、或者大屏要打码的任何联系方式（IG 账号、Signal、拼音 ID）——打码和标记永远一致 */
    const flags = { price: RX.price.test(nM.replace(NOT_PRICE, " ")) || g.gift, time: !hours && timeHit(nM), bot: RX.bot.test(n), private: RX.privateCh.test(n) || PHONE_RX.test(n) || contactHit(raw) };
    const cred = RX.cred.test(nM), policy = RX.policy.test(nM);
    let scope = RX.scope.test(nM) || OWNED_BRAND.test(foldW(raw));
    /* 资质 / 示例资料没覆盖的服务：不拿产品资料搪塞 */
    const ci = String(city || "").trim();
    const loc = findPlace(raw, nF, ci);
    const held = loc.places.length || loc.unsure || loc.vague || (!ci && (loc.cityHit || loc.covered || RX.area.test(nF)));
    /* 覆盖率闸门：留言没被基本读懂（residue）就不拿任何资料回答；服务类资料（svc）还要求对象都是本品类的产品（白名单），
       对象认不出或不属于本品类（EV charger、light switch、拆墙、搬家…）一律交给店主 */
    const cov = coverage(nF, cat, ci, loc);
    /* 放过的修饰词要有别的谓语撑着：coffee table + sizes、solar shades + glare、岩板餐桌 + 定做；只有「universal remotes」这种产品名本身，修饰词照算没读懂 */
    if (cov.mods.length) {
      const bare = cov.mods.reduce((x, m) => x.split(m.prod).join(" ".repeat(m.prod.length)), nF);
      const backed = c.facts.some((f) => f.key.test(bare) && !(f.not && f.not.test(nF))) || RX.price.test(bare) || RX.visit.test(bare) || RX.area.test(bare) || timeHit(bare);
      if (!backed) cov.residue.push(...cov.mods.map((m) => m.w));
    }
    const gateOk = !cov.residue.length;
    /* 整间改造（做厨房 / do my basement）而留言里没有本品类产品：是装修工程 */
    if (!cov.ownObjs.length && JOB_RX.test(nF)) scope = true;
    /* 家纺店：装 / 挂 + 本品类产品、或任何「铺」（铺地毯 / 鋪地氈 / 能铺吗）都是资料没讲到的安装活 */
    if (c.noInstall && ((cov.ownObjs.length && INSTALL_VERB.test(nF)) || LAY_VERB.test(nF))) scope = true;
    if (sideJob(nF, cat, ci)) scope = true;
    /* 对象白名单对所有资料、服务区、上门一律生效：留言里有外品类对象（门、橱柜、屋顶、船…），哪条资料都不引用，也不回「我们在X服务」 */
    const objBad = gateOk && cov.foreign.length > 0;
    /* 资料只讲到它自己的产品（浴室柜 / 橱柜的尺寸 ≠ 浴缸、镜子的尺寸） */
    const objFit = (f) => !f.objs || cov.ownObjs.every((w) => f.objs.split(" ").includes(w) || (!isHan(w[0]) && enStems(w).some((x) => f.objs.split(" ").includes(x))));
    const askOff = ASK_UNCOVERED.test(nF) || (BED_SIZE.test(nF) && !SIZE_PRED.test(nF));
    const tone = NEG_TONE.test(nM);
    const cand = cred || scope || policy || askOff || tone || !gateOk || objBad ? [] : c.facts.filter((f) => f.key.test(nF) && !(f.not && f.not.test(nF)) && objFit(f) && !(f.svc && held));
    /* 留言问到的属性都要有资料讲到：有一个没讲到就整条不引用（不对题的资料不拿来答） */
    let topics = [...new Set(nF.match(TOPIC) || [])];
    /* 颜色 / 材质词直接修饰本品类产品（faux wood blinds、linen cabinets、白色浴室柜），而留言另有资料讲到的谓语（motorized、custom、定制尺寸）：
       它是款式描述，不是在问这个属性；只问「有没有 grey vinyl / linen curtains」时照旧交给店主 */
    const desc = topics.filter((w) => DESC_TOPIC.test(w) && new RegExp(`${escRe(w)}(?:\\s+|的|嘅)?(?:[A-Za-z-]+\\s+)?(?:${OWN_ALT[cat] || OWN_ALT.blinds})`, "i").test(nF));
    if (desc.length) {
      /* 谓语只算属性（motorized、blackout）和定制尺寸；for the bedroom 这类场景词不算 */
      const pred = topics.some((w) => !DESC_TOPIC.test(w) && cand.some((f) => f.key.test(w))) || (cand.length > 0 && (SIZE_PRED.test(nF) || /\bsizes?\b|尺寸/i.test(nF)));
      if (pred) topics = topics.filter((w) => !desc.includes(w));
    }
    const rel = topics.length ? cand.filter((f) => topics.some((w) => f.key.test(w))) : cand;
    const uncovered = topics.filter((w) => !rel.some((f) => f.key.test(w)));
    const prods = uncovered.length ? [] : rel.slice(0, 2);
    const showroom = SHOWROOM.test(nF);
    const places = loc.places.slice(0, 3);
    let area = !places.length && !showroom && !objBad && !scope && gateOk && (loc.cityHit || loc.covered || RX.area.test(nF));
    if (places.length) flags.place = true;
    else if (area && !ci) { area = false; flags.place = true; }
    /* 交给店主的原因：资质、服务范围外、营业时间、拿不准的地点、拿不准的小写地名、完全没认出意图 */
    const why = [];
    if (cred) why.push("cred");
    if (scope) why.push("scope");
    if (policy) why.push("policy");
    if (hours) why.push("hours");
    if (showroom) why.push("showroom");
    if (uncovered.length || askOff) why.push("topic");
    if (tone) why.push("tone");
    if (!gateOk) why.push("residue");
    if (objBad) why.push("object");
    if (loc.vague) why.push("vague");
    if (loc.unsure) why.push("unsure");
    if (!why.length && !area && !flags.place && !prods.length && !RX.visit.test(n) && !flags.price && !flags.time && !flags.bot && !flags.private) why.push("none");
    if (why.length) flags.unknown = true;
    /* 地点拿不准（不在名单 / 认不出 / 小写认不出）：一律不邀约。没读懂、又带服务区 / 上门 / 送货意图：同样按地点待确认处理 */
    /* 没读懂 + 留言里就是店主城市：认不出的是小写英文实词时多半不是地点，不按地点待确认写（中文、大写词仍可能是城里的小区） */
    const placeLike = cov.residue.some((r) => isHan(r[0]) || /^[A-Z]/.test(r)) || !(loc.cityHit || loc.covered);
    const resHold = !gateOk && placeLike && !scope && !cred && !policy && (RX.area.test(nF) || RX.visit.test(n) || DELIVER.test(nF) || ((RX.install.test(nF) || SVC_VERB.test(nF)) && !cov.foreign.length));
    const hold = !!(flags.place || loc.unsure || loc.vague || resHold);
    /* 没读懂 / 对象不对 / 服务范围外：不邀约，结尾条件式 */
    const quiet = !gateOk || objBad || scope;
    const visit = !hold && !quiet && (flags.price || flags.time || !flags.unknown);
    const cites = [area || hold ? "KF-AREA" : "", ...prods.map((f) => f.id), visit ? "KF-VISIT" : "", "KF-LINK"].filter(Boolean);
    const place = places.length ? places.map((x) => (lang === "zh" ? x.zh : x.en)).join(lang === "zh" ? "、" : " or ") : null;
    return {
      lang, script, blocked: false, flags, prodId: prods[0] ? prods[0].id : null, prodIds: prods.map((f) => f.id), area, place, places, cites,
      /* unsure：问的是服务区但地点拿不准 → 和 place 一样不邀约；ask=false：只因为地点拿不准才交给店主，不必再说「店主会亲自回复」 */
      unsure: loc.unsure || resHold, vague: loc.vague, ask: why.some((w) => w !== "unsure" && w !== "vague" && !(w === "residue" && (loc.unsure || loc.vague))),
      noInvite: hold || quiet,
      /* explained：闸门通过、没挂 private / unknown —— 大屏只在这时显示访客原话；residue：没读懂的片段（调试用） */
      explained: gateOk && !flags.unknown && !flags.private && places.every((x) => x.known), residue: cov.residue,
    };
  }
  function render(p, lang, { cat, city } = {}) {
    if (!p || p.blocked) return "";
    const c = catOf(cat);
    const L = lang === "zh";
    const f = p.flags || {};
    const C = cityInfo(city);
    /* 署名用城市名；正文里城市没有英文名（浙江安吉）时英文回复写 our local area，不夹汉字 */
    const cityName = L ? C.show.zh : C.show.en;
    const cityShow = cityName || (!L && C.show.zh ? "our local area" : "");
    const m = L ? c.measure.zh : c.measure.en;
    const mThe = c.measure.en.replace(/^an?\s+/, "the ");
    /* 地点待店主确认：不安排上门、不邀请预约 */
    const hold = !!(f.place || p.unsure || p.vague);
    /* calm：地点待确认，或留言没读懂 / 对象不对 —— 不安排上门、不邀约，结尾条件式 */
    const calm = hold || !!p.noInvite;
    const where = (p.places || []).map((x) => (L ? x.zh : x.en)).filter(Boolean).join(L ? "、" : " or ") || (typeof p.place === "string" && p.place) || (L ? "你那边" : "your area");
    const body = [L ? "你好！" : "Hi!"];
    if (f.bot) body.push(L ? "我是这家店的 AI 助理，每条回复都由店主看过、批准后才发出。" : "I'm the shop's AI assistant. The owner approves every reply before it's sent.");
    if (hold) body.push(cityShow
      ? (L ? `我们在${cityShow}服务，${where}能不能到，店主会跟你确认。` : `We serve ${cityShow}; the owner will confirm whether ${where} is covered.`)
      : (L ? `${where}能不能到，店主会跟你确认。` : `The owner will confirm whether ${where} is covered.`));
    else if (p.area && cityShow) body.push(L ? `我们在${cityShow}服务。` : `We serve ${cityShow}.`);
    for (const id of p.prodIds || (p.prodId ? [p.prodId] : [])) { const x = c.facts.find((y) => y.id === id); if (x) body.push(L ? x.zh : x.en); }
    if (f.price && f.time) body.push(calm
      ? (L ? "价格、优惠和具体时间要看具体情况，店主会亲自跟进。" : "Pricing, any discounts and timing depend on your project; the owner will follow up personally.")
      : (L ? `价格、优惠和具体时间要看具体情况，我们先安排一次${m}，店主会亲自跟进。` : `Pricing, any discounts and timing depend on your project, so we start with ${m} and the owner will follow up personally.`));
    else if (f.price) body.push(calm
      ? (L ? "价格和优惠要看具体情况，店主会亲自跟进。" : "Pricing and any discounts depend on your project; the owner will follow up personally.")
      : (L ? `价格和优惠要看具体情况，我们先安排一次${m}，店主会亲自跟进。` : `Pricing and any discounts depend on your project, so we start with ${m} and the owner will follow up personally.`));
    else if (f.time) body.push(calm
      ? (L ? "具体时间店主会跟你确认。" : "The owner will confirm timing with you.")
      : (L ? `具体时间我们在${m}时一起确认。` : `We'll confirm timing together at ${mThe}.`));
    if (f.private) body.push(L ? "店主会决定怎么跟你继续联系。" : "The owner will decide how best to continue with you.");
    if (f.unknown && p.ask !== false) body.push(L ? "谢谢留言，这一条由店主亲自回复你。" : "Thanks for asking — the owner will reply to this one personally.");
    else if (!f.unknown && !f.price && !f.time && !calm) body.push(L ? `可以先约一次${m}。` : `You can book ${m} first.`);
    const cta = calm
      ? (L ? "店主确认后，可以在这里选时间：[预约链接]" : "Once the owner confirms, you can pick a time here: [booking link]")
      : (L ? "在这里选个时间：[预约链接]" : "Pick a time here: [booking link]");
    const sign = L ? `——${shopLabel(cat, cityName, "zh")} AI 助理` : `— AI assistant, ${shopLabel(cat, cityName, "en")}`;
    const out = `${body.join(L ? "" : " ")}\n${cta}\n${sign}`;
    return L && p.script === "hant" ? toHant(out) : out;
  }
  function draft(args) {
    const a = args || {};
    const p = plan(a);
    if (!p) return null;
    const f = p.flags;
    const hand = f.price || f.unknown || f.private || f.place;
    return { ...p, level: p.blocked ? "blocked" : hand ? "L3" : "L2", text: render(p, p.lang, a) };
  }
  /* 店主界面语言 ≠ 回复语言时给对照：同一份计划换语言渲染 */
  function translateDraft(d, args, toLang) {
    if (!d || d.blocked || d.lang === toLang) return "";
    /* 对照是给店主看的：译成中文时用简体，与店主界面一致 */
    return render(toLang === "zh" ? { ...d, script: "hans" } : d, toLang, args);
  }
  function factLabel(id, cat, lang) {
    const c = catOf(cat);
    if (id === "KF-AREA") return lang === "zh" ? "服务区域" : "Service area";
    if (id === "KF-VISIT") return lang === "zh" ? c.measure.zh : c.measure.en.replace(/^an?\s+/, "");
    if (id === "KF-LINK") return lang === "zh" ? "预约链接" : "Booking link";
    const f = c.facts.find((x) => x.id === id);
    return f ? f.label[lang] : id;
  }
  /* 草稿的最后两行（预约链接 + 署名）单独显示，不被截断 */
  function splitDraft(text) {
    const lines = String(text || "").split("\n");
    if (lines.length < 3) return { body: text, tail: "" };
    return { body: lines.slice(0, -2).join("\n"), tail: lines.slice(-2).join("\n") };
  }

  /* ───────── 预约时段：存时间戳，各设备按自己的语言显示 ───────── */
  function slotLabel(at, lang) {
    const d = new Date(Number(at));
    if (Number.isNaN(d.getTime())) return "";
    return lang === "zh"
      ? `${d.getMonth() + 1}月${d.getDate()}日 ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()]} ${d.getHours()}:00`
      : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function slots() {
    const out = [];
    const next = new Date();
    while (out.length < 3) {
      next.setDate(next.getDate() + 1);
      if (next.getDay() === 0) continue;
      const at = (h) => { const x = new Date(next); x.setHours(h, 0, 0, 0); return x.getTime(); };
      if (out.length === 0) { out.push(at(10)); out.push(at(14)); } else out.push(at(11));
    }
    return out;
  }
  const mmss = (s) => { const v = Math.max(0, Math.round(Number(s) || 0)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`; };

  /* ───────── 设备总线 ───────── */
  function bus(room = "booth") {
    const me = Math.random().toString(36).slice(2, 10);
    const seen = new Set();
    const listeners = new Set();
    const modeListeners = new Set();
    let mode = "local";
    let bc = null;
    let es = null;
    let retrying = false;
    const outbox = [];
    const notify = (m) => modeListeners.forEach((fn) => fn(m));
    const setMode = (m) => { mode = m; notify(m); };
    const retry = () => { retrying = true; notify("relay-retry"); };
    /* 任何一次发送成功、且接收通道开着：角标从「重新连接中」回到「已配对」 */
    const recovered = () => { if (retrying && mode === "relay" && (!es || es.readyState === 1)) { retrying = false; notify("relay"); } };
    const deliver = (m) => {
      if (!m || typeof m !== "object" || typeof m.id !== "string" || seen.has(m.id)) return;
      seen.add(m.id); if (seen.size > 800) seen.delete(seen.values().next().value);
      listeners.forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } });
    };
    try { bc = new BroadcastChannel(`aivora-booth-${room}`); bc.onmessage = (e) => deliver(e.data); } catch { bc = null; }
    if (bc) mode = "device";
    const post = (m, tries = 0) => fetch(`/bus/send?room=${room}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m), signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); recovered(); })
      .catch(() => {
        if (tries < 2) setTimeout(() => post(m, tries + 1), 1000);
        else { outbox.push(m); if (outbox.length > 50) outbox.shift(); retry(); }
      });
    const flush = () => { outbox.splice(0).forEach((m) => post(m)); };
    const api = {
      me,
      get mode() { return mode; },
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      onMode(fn) { modeListeners.add(fn); fn(mode); return () => modeListeners.delete(fn); },
      send(type, data = {}) {
        const m = { type, ...data, id: `${me}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, from: me, at: Date.now() };
        deliver(m);
        if (bc) { try { bc.postMessage(m); } catch { /* ignore */ } }
        if (mode === "relay") post(m);
        return m;
      },
    };
    const canRelay = /^https?:$/.test(location.protocol) && !/[?&]norelay\b/.test(location.search);
    function probe() {
      fetch("/bus/ping", { cache: "no-store", signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j || j.relay !== "aivora-booth" || es) throw new Error("no relay");
          es = new EventSource(`/bus/events?room=${room}`);
          es.onmessage = (e) => { try { deliver(JSON.parse(e.data)); } catch { /* ignore */ } };
          es.onerror = () => { if (mode === "relay") retry(); };
          es.onopen = () => {
            const first = mode !== "relay";
            retrying = false;
            setMode("relay");
            flush();
            /* relay-open 只在第一次连通时发（各端据此补发 state:req） */
            if (first) notify("relay-open");
          };
        })
        .catch(() => { /* 继续每 10 秒探一次，直到中继出现 */ });
    }
    /* 每 10 秒：还没连上就再探一次；已连上但 outbox 有积压（POST 连续超时、SSE 没断）就补发 */
    if (canRelay) { probe(); setInterval(() => { if (mode !== "relay") { if (!es) probe(); } else if (outbox.length) flush(); }, 10000); }
    return api;
  }
  function connBadge(b, lang, { demo = false } = {}) {
    const el = document.createElement("span");
    el.className = "conn";
    el.setAttribute("role", "status");
    let cur = "local";
    let L = lang;
    const key = () => {
      if (cur === "relay" || cur === "relay-open") return "pairedRelay";
      if (cur === "relay-retry") return "reconnecting";
      if (cur === "device") return demo ? "pairedDevice" : "notOnBooth";
      return "thisScreen";
    };
    /* lang 可以是 "en" / "zh" / "both"（大屏：EN · 中文） */
    const label = () => (L === "both" ? `${esc(t("en", key()))} · <span lang="zh-CN">${esc(t("zh", key()))}</span>` : esc(t(L, key())));
    const paint = () => { el.dataset.mode = cur.startsWith("relay") && cur !== "relay-retry" ? "relay" : cur === "relay-retry" ? "retry" : cur; el.innerHTML = `<i aria-hidden="true"></i>${label()}`; };
    b.onMode((m) => { cur = m; paint(); });
    return { el, setLang(l) { L = l; paint(); } };
  }

  /* ───────── 诚实计数（本地日期；只记真实约好的） ───────── */
  const today = () => new Date().toLocaleDateString("sv");
  /* epoch：清零代次，单调递增。清零让 epoch+1；同步时先比 epoch，同 epoch 再比 ts（不怕设备挂钟快慢） */
  function stats() {
    const s = store.get("booth.stats", null);
    return s && typeof s === "object" && s.date === today() ? { ...s, epoch: Number.isInteger(s.epoch) ? s.epoch : 0 } : { date: today(), runs: 0, last: null, ts: 0, epoch: 0 };
  }
  function recordRun(secs) {
    const s = stats();
    s.runs += 1; s.last = Math.round(secs); s.ts = Date.now();
    store.set("booth.stats", s);
    return s;
  }
  function resetStats() {
    const s = { date: today(), runs: 0, last: null, ts: Date.now(), epoch: stats().epoch + 1 };
    store.set("booth.stats", s);
    return s;
  }
  const validStats = (s) => s && typeof s === "object" && s.date === today() && Number.isInteger(s.runs) && s.runs >= 0 && s.runs < 10000
    && (s.last == null || (Number.isFinite(s.last) && s.last >= 0 && s.last < 86400)) && Number.isFinite(s.ts) && s.ts <= Date.now() + 60000
    && (s.epoch == null || (Number.isInteger(s.epoch) && s.epoch >= 0 && s.epoch < 1e6));
  /* 多台设备之间：清零代次大的胜；同一代次以最新一次写入为准；缺 epoch 的旧数据视为 0；不合格的消息直接丢弃 */
  function adoptStats(s) {
    if (!validStats(s)) return stats();
    const cur = stats();
    const se = s.epoch ?? 0;
    const take = se > cur.epoch || (se === cur.epoch && s.ts >= (cur.ts || 0));
    const next = take ? { date: s.date, runs: s.runs, last: s.last ?? null, ts: s.ts, epoch: se } : cur;
    store.set("booth.stats", next);
    return next;
  }

  /* ───────── 结果页链接与二维码 ───────── */
  const b64u = {
    enc(obj) { const s = unescape(encodeURIComponent(JSON.stringify(obj))); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
    dec(str) { const s = atob(String(str).replace(/-/g, "+").replace(/_/g, "/")); return JSON.parse(decodeURIComponent(escape(s))); },
  };
  const resultBase = () => CONFIG.resultBase || new URL("result.html", location.href).href;
  const isPrivateHost = (url) => { try { const h = new URL(url).hostname; return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(h) || h.endsWith(".local"); } catch { return false; } };
  async function resultUrl(payload, b) {
    const base = resultBase();
    store.set("booth.lastResult", payload);
    const sameOrigin = (() => { try { return new URL(base, location.href).origin === location.origin; } catch { return false; } })();
    /* 中继会话只在结果页与中继同源时用；公网结果页一律用自包含链接 */
    if (b && b.mode === "relay" && sameOrigin) {
      try {
        const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined });
        if (r.ok) { const j = await r.json(); if (j && j.id) return `${base}?id=${encodeURIComponent(j.id)}`; }
      } catch { /* 回落到自包含链接 */ }
    }
    const slim = { ...payload };
    const cut = (k, n) => { if (slim[k] && String(slim[k]).length > n) { slim[k] = `${String(slim[k]).slice(0, n)}…`; slim.cut = 1; } };
    cut("q", 90); cut("r", 90);
    return `${base}?d=${b64u.enc(slim)}`;
  }
  function qrSvg(text, dark = "#16181b") {
    const plain = `<div style="color:#16181b;font:13px/1.4 system-ui;padding:8px;word-break:break-all">${esc(text)}</div>`;
    if (typeof window.qrcode !== "function") return plain;
    let q;
    try {
      if (window.qrcode.stringToBytesFuncs && window.qrcode.stringToBytesFuncs["UTF-8"]) window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs["UTF-8"];
      q = window.qrcode(0, text.length > 600 ? "L" : "M"); q.addData(text); q.make();
    } catch { return plain; }
    const n = q.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="${dark}"/></svg>`;
  }

  /* ───────── 图标 ───────── */
  const FALLBACK_ICON = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
  const icon = (name, cls = "ic") => (window.BoothIcons && window.BoothIcons.svg ? window.BoothIcons.svg(name, cls) : FALLBACK_ICON);
  const MARK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 12.5 6 8.2l2.6 2.4L13.5 4" stroke="#140801" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 4h3.5v3.5" stroke="#140801" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ───────── 成交链（六节点） ───────── */
  const STEPS = [["video", "clapperboard"], ["post", "badge-check"], ["comment", "message-circle"], ["draft", "bot"], ["approve", "check"], ["booked", "calendar-check"]];
  function chainHtml({ reached = 0, now = -1, times = {}, lang = "en", both = false, cls = "chain" }) {
    return `<div class="${cls}" role="list">${STEPS.map(([k, ic], i) => {
      const on = i < reached;
      const label = both ? `${esc(t("en", "step_" + k))}<small lang="zh-CN">${esc(t("zh", "step_" + k))}</small>` : esc(t(lang, "step_" + k));
      return `<div class="cl ${on ? "on" : ""} ${i === now ? "now" : ""} ${i === STEPS.length - 1 ? "goal" : ""}" role="listitem"><span class="nd ${i === now ? "beam" : ""}">${icon(ic)}</span><span class="nt">${label}</span><span class="ns num">${esc(times[k] || "")}</span></div>`;
    }).join("")}</div>`;
  }
  /* 大屏上隐去留言里的联系方式 */
  /* 「微信 / 微信號 / 微 信 / 薇信 / V信 / vx / WeChat (ID) is / LINE / IG is / 加v / V我」后面跟的 ID（可含 . _ -）：整段打码；IG post / product line 之类不算 */
  const ID_MASK = new RegExp(String.raw`(?<!\b(?:your|ur|their)\s+)(?:[微薇威徽胃][\s　]*信(?!息|用|心|任)(?:号|號)?|(?<![A-Za-z])v[\s　]*信|微信號|(?<![A-Za-z])(?:vx|wechat|weixin|wei\s*xin|wx|line|ig|insta|instagram|telegram|tg|kakao|skype|snap(?:chat)?|tiktok|signal|viber)(?![A-Za-z])|加\s?v(?![A-Za-z])|v(?=我))`
    + String.raw`(?:\s*(?:id|号码|號碼|号|號|帳號|账号|名字|名|handle|username|user\s*name|account|acct))?\s*[:：=]?\s*(?:is\s+|係咪|系咪|係唔係|系唔系|是不是|是|係|系|为|為|嘅|叫做|叫)?\s*[:：]?\s*(?:我\s*)?`
    + String.raw`(?!(?:post|posts|video|videos|page|account|story|stories|reel|reels|live|ad|ads|comment|comments|link|profile|feed|up|of|item|items|catalog|product|products|is|was|and|or|the|for|to|me|us|with|please|pls|a|an|my|your|our|not|so|too|here|there|great|good|nice|awesome|amazing|beautiful|cool|lovely|very|really|super)\b)`
    + String.raw`[A-Za-z](?:[\w-]|\.(?=\w)){3,29}`, "gi");
  const MASK_DIGIT = "[\\d零〇一二三四五六七八九幺两]";
  const maskPhones = (s) => phoneSpans(s).reverse().reduce((x, [i, j]) => `${x.slice(0, i)}•••${x.slice(j)}`, s);
  /* 留言里有联系方式：邮箱、@账号、「IG / WeChat / Signal / LINE + 账号」、电话（含混写）。大屏打码用 maskContact（更宽，型号也遮）；这里只认真正的联系方式 */
  const ID_MASK1 = new RegExp(ID_MASK.source, "i");
  const contactHit = (s0) => { const s = foldW(s0); return /[\w.+-]+@[\w-]+\.[\w.]+/.test(s) || /(?:^|[\s(])@\w(?:\w|\.(?=\w)){2,}/.test(s) || ID_MASK1.test(s) || hasPhone(s); };
  const maskContact = (s) => maskPhones(foldW(s))
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "•••")
    /* jane.doe at gmail dot com / lucas @ gmail . com */
    .replace(/[\w.+-]+\s*(?:\(at\)|\[at\]|\bat\b|@)\s*[\w-]+\s*(?:\(dot\)|\[dot\]|\bdot\b|\.)\s*(?:com|ca|net|org|cn|hk|tw|co|io|me|uk|au)\b/gi, "•••")
    .replace(/@\w(?:\w|\.(?=\w))*/g, "@•••")
    .replace(ID_MASK, "•••")
    /* 裸域名：cheap-blinds.ca */
    .replace(new RegExp(DOMAIN_SRC, "gi"), "•••")
    /* 字母开头、含数字或下划线、6–20 位的 token（lucas_888、wxid_ab12cd、chenwei2024） */
    .replace(/(?<![\w-])(?=[A-Za-z][\w-]{5,19}(?![\w-]))(?=[A-Za-z-]*[\d_])[A-Za-z][\w-]{5,19}(?![\w-])/g, "•••")
    /* 电话：空格 / 横线 / 点 / 括号分隔都算（416.555.0123、(416) 555-0123、+1 (905) 555-0199） */
    .replace(/\+?\(?\d(?:[\s.\-()]{0,3}\d){4,}\)?/g, (m) => (NOT_PHONE.test(m.trim()) ? m : "•••"))
    /* 中文数字写的手机号，可以夹空格、和阿拉伯数字混写（一三八 零零一二 三四五六、138 零零一二 3456） */
    .replace(new RegExp(`[零〇一二三四五六七八九幺两](?:[\\s.\\-\\u3000]*${MASK_DIGIT}){6,}|\\d{2,}[\\s.\\-\\u3000]*[零〇一二三四五六七八九幺两](?:[\\s.\\-\\u3000]*${MASK_DIGIT}){4,}|•••[\\s.\\-\\u3000]*[零〇一二三四五六七八九幺两](?:[\\s.\\-\\u3000]*${MASK_DIGIT}){3,}`, "g"), "•••")
    /* 英文拼读的号码（four one six, five five five…） */
    .replace(/\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)(?:[\s,.\-]+(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b){6,}/gi, "•••");

  window.Booth = {
    $, $$, esc, store, get reduce() { return reduce; }, T, LANGS, t, L10, uiLang, setUiLang, langToggle, CATS, catOf, shopName,
    draft, plan, render, detectLang, detectScript, toHant, toHans, hantResidue, translateDraft, factLabel, splitDraft, slots, slotLabel, mmss,
    bus, connBadge, stats, recordRun, resetStats, adoptStats, validStats, today,
    resultBase, resultUrl, isPrivateHost, qrSvg, b64u, icon, MARK, STEPS, chainHtml, maskContact, loadConfig,
    get config() { return CONFIG; },
  };
})();
