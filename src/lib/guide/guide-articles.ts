/**
 * 客户使用指南（2026-10-28，CEO 要的 user guide；版式学 LibTV「学院」：一张上手主卡 + 教程卡片墙）。
 *
 * 纯数据、无服务端依赖：服务端页面与客户端组件都能引用。用词与界面按钮逐字一致
 *（「生成 AI 故事板」「生成视频」「重拍整条」「换字幕 / BGM / 片尾落款」「下载成片」
 * 「换个开头」「用同样的素材再做一条」），
 * 界面改名时同步改这里。封面只用仓库里已公开的样片 / 故事板静帧，不放客户素材。
 */
import type { Locale } from "@/i18n/config";

export type GuideSlug = "quick-start" | "storyboard" | "templates" | "brand" | "library" | "billing" | "photo-tips";

type Localized<T> = Record<Locale, T>;

export interface GuideSection {
  heading: string;
  body?: string;
  steps?: string[];
  tip?: string;
}

export interface GuideArticle {
  slug: GuideSlug;
  minutes: number;
  cover: string;
  href: string;
  title: string;
  summary: string;
  features: string[];
  sections: GuideSection[];
  cta: string;
}

type ArticleSource = {
  slug: GuideSlug;
  minutes: number;
  cover: string;
  href: string;
  copy: Localized<Omit<GuideArticle, "slug" | "minutes" | "cover" | "href">>;
};

const LANDING = "https://jke9jtodu89xlpcy.public.blob.vercel-storage.com/renders/marketing/landing-1025";

const ARTICLES: readonly ArticleSource[] = [
  {
    slug: "quick-start",
    minutes: 5,
    cover: `${LANDING}/hero-blinds.jpg`,
    /// 带 guide=open：进创作页时重开页内的新手指引
    href: "/app/create?guide=open",
    copy: {
      "zh-CN": {
        title: "10 分钟做出第一条视频",
        summary: "从一张商品实拍图到一条能直接发的成片：上传、写一句话、确认开场画面和镜头脚本、生成、下载。",
        features: ["上传产品图", "生成 AI 故事板", "生成视频", "成品库"],
        sections: [
          {
            heading: "1. 上传商品实拍图",
            body: "在「创作」页放 1–9 张真实的商品照片（整件、细节、包装各来一张最好）。片子里的商品是照着这些图拍的，所以必须先有图。",
            tip: "照片越清楚、角度越多，成片里的商品越像真的。拍法见「拍好商品图」那一篇。",
          },
          {
            heading: "2. 用一句话说清楚你想拍什么",
            body: "像跟摄影师说话一样写：谁在用、在哪、想让客户记住哪一点。例如「宝宝吃辅食总漏一身，戴上口水巾，衣服干干净净」。不知道怎么写就点「帮我写」。",
            tip: "写好之后，下面会出现「换个开头」：痛点开场、结果前置、细节特写开场、前后对比开场，点一个就换一种开场方式。时长选 15 秒或 30 秒，「创意模板」里选风格，拿不准就留「自动匹配」。",
          },
          {
            heading: "3. 点「生成 AI 故事板」",
            body: "AI 导演会看你的商品图，写好一份镜头脚本（每个镜头拍什么、说哪句话），再出一张开场画面。写脚本约 1–3 分钟。",
            tip: "这一步不扣视频额度。开场画面不满意可以单独重出，脚本不对路就改描述重来一轮。",
          },
          {
            heading: "4. 确认后点「生成视频」",
            body: "确认了开场画面和脚本才会开拍，整条片一次拍完。一般 10–15 分钟出片，少数要半小时以上。不用守着页面：做好了页面上会提示你，成片也会出现在「成品库」。",
          },
          {
            heading: "5. 在「成品库」下载",
            body: "点开成片，「下载成片」拿到带字幕、配音和配乐的 MP4；需要单独的字幕文件就点「下载字幕（SRT）」。",
          },
        ],
        cta: "去做第一条",
      },
      "en-US": {
        title: "Your first video in 10 minutes",
        summary: "From one real product photo to a video you can post: upload, write one sentence, approve the opening frame and shot script, generate, download.",
        features: ["Upload product photos", "Generate AI storyboard", "Generate video", "Library"],
        sections: [
          {
            heading: "1. Upload real product photos",
            body: "On the Create page, add 1–9 real photos of your product (the whole item, a detail, the packaging). The product in the video is filmed from these, so photos come first.",
            tip: "Clearer photos and more angles make the product look more like the real thing. See the product photo guide.",
          },
          {
            heading: "2. Say what you want in one sentence",
            body: "Write it the way you'd brief a photographer: who uses it, where, and the one thing a customer should remember. Not sure how? Use \"Write it for me\".",
            tip: "Once it's written, Change the opening appears below: pick one to open the video a different way. Then choose 15s or 30s and a style under Creative template; if unsure, leave it on Auto match.",
          },
          {
            heading: "3. Choose Generate AI storyboard",
            body: "The AI director looks at your photos, writes a shot script (what each shot shows and which line is spoken) and renders one opening frame. Usually 1–3 minutes.",
            tip: "This step doesn't use a video credit. You can redo the opening frame on its own, or change the description and start a new round.",
          },
          {
            heading: "4. Approve, then Generate video",
            body: "Filming starts only after you approve the opening frame and script, and the whole video is filmed in one go. Usually 10–15 minutes, occasionally over half an hour. You don't need to keep the page open.",
          },
          {
            heading: "5. Download from the Library",
            body: "Open the finished video and choose Download video for the MP4 with captions, voice and music. Use Download captions (SRT) for a separate caption file.",
          },
        ],
        cta: "Make the first one",
      },
    },
  },
  {
    slug: "storyboard",
    minutes: 3,
    cover: `${LANDING}/hero-kitchen.jpg`,
    href: "/app/create",
    copy: {
      "zh-CN": {
        title: "看懂故事板：一张开场画面 + 一份镜头脚本",
        summary: "开拍之前最省钱的修改机会：先看 AI 打算怎么拍，不对就在这一步改，不扣视频额度。",
        features: ["生成 AI 故事板", "镜头脚本", "确认开场画面和脚本"],
        sections: [
          {
            heading: "故事板里有什么",
            body: "一张开场画面（片子从这个画面开始演），和一份镜头清单：每个镜头几秒、拍什么、说哪句话。成片就是照这份脚本一次拍完的。",
          },
          {
            heading: "开场画面不满意",
            steps: ["展开开场画面下面的「重做前补充要求」，写一句要怎么改（比如「商品放在画面正中」「光线再亮一点」）", "点「重做这一帧」", "只重出这一张，脚本不变"],
            tip: "开场画面里的商品要和你的实拍图一致；不一致就重出，别带着走样的画面开拍。",
          },
          {
            heading: "脚本不对路",
            body: "镜头拍的不是你想要的场景、卖点没讲到，就取消这一轮，把描述写具体一点（谁在用、在哪用、最想让人记住哪一点）再生成。想自己定台词，在「更多设置」里填「想让 AI 照着念的口播稿」。",
          },
        ],
        cta: "去创作",
      },
      "en-US": {
        title: "Reading the storyboard: one opening frame and a shot script",
        summary: "The cheapest moment to change things: see how the AI plans to film it and fix it here, before a video credit is used.",
        features: ["Generate AI storyboard", "Shot script", "Approve frame and script"],
        sections: [
          {
            heading: "What's in it",
            body: "One opening frame (the video starts from this picture) and a shot list: how long each shot is, what it shows and which line is spoken. The video is filmed from this script in one go.",
          },
          {
            heading: "If the opening frame is off",
            steps: ["Add one line about what to change under the opening frame (for example \"product centred\" or \"brighter light\")", "Choose Regenerate frame", "Only that frame is redone; the script stays"],
            tip: "The product in the frame should match your photos. If it doesn't, redo it before filming.",
          },
          {
            heading: "If the script misses the point",
            body: "Cancel the round, make the description more specific (who uses it, where, the one thing to remember) and generate again. To set the spoken lines yourself, fill in your own voiceover script under More settings.",
          },
        ],
        cta: "Go to Create",
      },
    },
  },
  {
    slug: "templates",
    minutes: 3,
    cover: "/template-previews/commerce-outdoor-rugged.jpg",
    href: "/app/create",
    copy: {
      "zh-CN": {
        title: "选风格：同一件商品，六种拍法",
        summary: "「创意模板」里的每一种风格都是一套拍法。拿不准就用「自动匹配」，让 AI 导演按商品来定。",
        features: ["创意模板", "自动匹配", "换个开头"],
        sections: [
          {
            heading: "六种风格分别适合什么",
            steps: [
              "电商快销：两秒钩子、一个卖点一个镜头、节奏快，适合讲得清卖点的日用品",
              "情绪种草：用的人笑起来最抓人，正脸表情镜头穿插商品特写，适合母婴、家居、礼品",
              "痛点解决：先拍最狼狈的那一下，再拍用了之后，适合解决具体麻烦的商品",
              "质感特写：慢一点、近一点，拍材质和做工，声音很轻，适合讲究用料的商品",
              "开箱上手：第一人称拆开、摸一摸、第一次用，像买家自己拍的",
              "探厂探店：带买家走一遍真实的厂房或门店，上传的是场地照片",
            ],
          },
          {
            heading: "风格之外还能换什么",
            body: "写好描述后点「换个开头」，同一件商品换一种开场方式（痛点开场、结果前置、细节特写、前后对比）。风格管整条片怎么拍，开头管前两秒怎么抓人。",
          },
          {
            heading: "同一件商品多拍几条",
            body: "成片详情里点「用同样的素材再做一条」，换一种风格或换个开头，就是一条新的变体。常拍的商品可以存进「商品」，下次点一下就带进创作页。",
          },
        ],
        cta: "去选风格",
      },
      "en-US": {
        title: "Styles: six ways to film the same product",
        summary: "Each option under Creative template is a way of filming. If unsure, use Auto match and let the AI director decide from the product.",
        features: ["Creative template", "Auto match", "Change the opening"],
        sections: [
          {
            heading: "What each style is for",
            steps: [
              "Fast e-commerce ad: two-second hook, one selling point per shot, quick pace; for everyday products with clear benefits",
              "Emotion-led story: the user's happy face sells it, with face-visible reactions between product close-ups; for baby, home and gift products",
              "Problem then fix: the worst moment first, then the same moment with the product",
              "Texture close-ups: slower and closer, materials and workmanship, very quiet sound",
              "Unboxing in hand: first-person opening, touching and first use, like a buyer's own clip",
              "Factory or store tour: walk the buyer through the real place; upload photos of the site",
            ],
          },
          {
            heading: "What else you can change",
            body: "After writing the description, use Change the opening to try another hook (pain point first, result first, detail close-up, before and after). The style decides how the whole video is filmed; the opening decides the first two seconds.",
          },
          {
            heading: "More videos of the same product",
            body: "In a finished video, choose Make another with the same assets and pick another style or opening. Save products you film often under Products to load them in one click.",
          },
        ],
        cta: "Pick a style",
      },
    },
  },
  {
    slug: "brand",
    minutes: 3,
    cover: `${LANDING}/hero-garden.jpg`,
    href: "/app/create",
    copy: {
      "zh-CN": {
        title: "品牌怎么进视频：右上角 Logo 和片尾落款",
        summary: "两种带品牌的方式，都在合成时加上去，不让 AI 去画，所以不会走样、不会错字。",
        features: ["品牌", "右上角 Logo", "片尾落款"],
        sections: [
          { heading: "先在「品牌」页放好 Logo", body: "上传一张 Logo（透明底 PNG 最好，白底线稿也可以），填品牌名和一句行动指引。存一次，以后每条片都能用。" },
          { heading: "右上角 Logo", body: "创作页「更多设置」里勾上「右上角 Logo」，成片全程在右上角挂一个半透明的图形角标，像水印一样，不抢画面。每条单独勾，默认不带。" },
          {
            heading: "片尾落款",
            steps: [
              "创作时在「更多设置」里勾上「片尾落款」，或者成片做好后在成片详情「换字幕 / BGM / 片尾落款」里加",
              "填品牌名和一句行动指引（比如「主页看更多」）",
              "成片最后两秒压上这两行字；事后加的话点「重拼成片」，一两分钟换好",
            ],
            tip: "落款不另加一帧，也不扣额度；随时可以关掉再重拼。",
          },
          { heading: "商品上本来就有的 Logo", body: "商品上印着的字和图形，照着你的实拍图拍。想让它清楚：Logo 正对镜头、光线均匀、多给一张特写。很小的字在成片里可能有细微变形，价格、促销这类字建议放在片尾落款或发布文案里。" },
        ],
        cta: "去创作",
      },
      "en-US": {
        title: "Getting your brand into the video: corner logo and sign-off",
        summary: "Two ways to carry your brand. Both are added when the video is assembled, not drawn by the AI, so they never come out distorted or misspelled.",
        features: ["Brand", "Corner logo", "Brand sign-off"],
        sections: [
          { heading: "Add your logo on the Brand page first", body: "Upload a logo (a transparent PNG is best; dark line art on white also works), your brand name and a short call to action. Save once and reuse it." },
          { heading: "Corner logo", body: "Under More settings, tick Corner logo. The finished video carries a semi-transparent mark in the top-right corner throughout, like a watermark. It's per video and off by default." },
          {
            heading: "Brand sign-off",
            steps: [
              "Tick Brand sign-off under More settings when creating, or add it later under Change captions / BGM / sign-off on the finished video",
              "Enter your brand name and a short call to action",
              "The last two seconds show those two lines; if added later, choose Re-assemble video and it is swapped in within a minute or two",
            ],
            tip: "The sign-off adds no extra frame and uses no credit. Turn it off and re-stitch at any time.",
          },
          { heading: "Logos already printed on the product", body: "Text and marks printed on the product are filmed from your photos. Keep the logo facing the camera, evenly lit, and add a close-up. Very small text can shift slightly; put prices and promotions in the sign-off or your post caption." },
        ],
        cta: "Go to Create",
      },
    },
  },
  {
    slug: "library",
    minutes: 3,
    cover: "/template-previews/commerce-beauty-texture.jpg",
    href: "/app/library",
    copy: {
      "zh-CN": {
        title: "成品库：下载、换字幕、再做一条",
        summary: "做好的片都在这里。字幕和落款可以免费换；画面不满意就整条重拍，或者换个开头、换种风格再做一条。",
        features: ["成品库", "换字幕 / BGM / 片尾落款", "整条重拍", "用同样的素材再做一条", "下载成片"],
        sections: [
          { heading: "下载", body: "「下载成片」拿 MP4；「下载字幕（SRT）」拿单独的字幕文件，方便发到不同平台。" },
          { heading: "只换字幕或片尾落款", body: "「换字幕 / BGM / 片尾落款」只重新合成，不重新生成画面，不计生成额度；没成功会自动回到旧成片。配音和配乐是随片子一起拍出来的，这里不能单独换。" },
          {
            heading: "画面不满意：整条重拍",
            steps: ["在成片详情里点「重拍整条」", "在「想让这一段怎么改」写一句（可不填）", "确认后按同一份镜头脚本重新拍一遍，扣 1 段额度"],
            tip: "新的一条做好之前，现在这条一直保留、照常可看可下载；没做成会退回额度。",
          },
          { heading: "同一件商品再拍一条", body: "点「用同样的素材再做一条」，商品图、描述、时长和画幅都会带回创作页，换一种风格或「换个开头」就是一条新的变体。" },
          { heading: "告诉我们这条怎么样", body: "成片详情里有「这条成片怎么样？」。不满意的话选一下哪里不对（商品不像、画面或动作不自然、没按我说的拍、口播或字幕有问题），页面会直接告诉你下一步怎么改最省事。评价只用来改进出片质量，随时可以改。" },
        ],
        cta: "打开成品库",
      },
      "en-US": {
        title: "Library: download, change captions, make another",
        summary: "Every finished video lives here. Captions and the sign-off can be changed for free; if the picture is off, re-film it, or make another with a different opening or style.",
        features: ["Library", "Change captions / BGM / sign-off", "Reshoot the whole video", "Make another with the same assets", "Download video"],
        sections: [
          { heading: "Download", body: "Download video gives you the MP4; Download captions (SRT) gives a separate caption file for other platforms." },
          { heading: "Change captions or the sign-off only", body: "Change captions / BGM / sign-off only re-assembles the video. Nothing is re-filmed and no credit is used; if it fails you keep the previous version. Voice and music are filmed with the video and can't be swapped here." },
          {
            heading: "If the picture is off: reshoot the whole video",
            steps: ["Choose Reshoot it on the video page", "Add one line about what to change (optional)", "It is filmed again from the same shot script and uses 1 segment credit"],
            tip: "Your current video stays available until the new one is ready; the credit is returned if it fails.",
          },
          { heading: "Another video of the same product", body: "Choose Make another with the same assets. Photos, description, length and aspect ratio come back to Create; pick another style or opening for a new variant." },
          { heading: "Tell us how it turned out", body: "The video page asks \"How is this video?\". If you're not happy, pick what's wrong (product looks wrong, unnatural visuals or motion, not what I described, voiceover or captions) and the page points you to the quickest fix. Ratings only improve quality and can be changed any time." },
        ],
        cta: "Open the Library",
      },
    },
  },
  {
    slug: "billing",
    minutes: 2,
    cover: `${LANDING}/hero-inquiry.jpg`,
    href: "/app/create",
    copy: {
      "zh-CN": {
        title: "额度、失败与取消",
        summary: "什么时候扣额度、失败怎么退、取消要不要钱——一页说清。",
        features: ["本月额度", "失败退回", "取消"],
        sections: [
          { heading: "什么时候扣额度", body: "点「生成视频」提交时预留额度；生成故事板、重出开场画面、换字幕 / BGM / 片尾落款都不扣视频额度。整条重拍扣 1 段。" },
          { heading: "失败自动退回", body: "生成失败（包括供应商那边出错）会自动把额度退回本月，不需要找客服。" },
          { heading: "取消永远免费", body: "任何一轮都可以取消；已经产出的图片和素材会保留在历史里，随时可以用同样的输入重新生成。" },
          { heading: "AI 生成标注", body: "成片画面由 AI 生成，发布时请按平台要求保留或添加 AI 生成标注。" },
        ],
        cta: "去创作",
      },
      "en-US": {
        title: "Credits, failures and cancelling",
        summary: "When credit is used, how failures are refunded, and whether cancelling costs anything.",
        features: ["Monthly credit", "Automatic refunds", "Cancel"],
        sections: [
          { heading: "When credit is used", body: "Credit is reserved when you click Generate video. Storyboards, redoing the opening frame, and changing captions or the sign-off don't use video credit. Re-filming uses 1 segment." },
          { heading: "Failures are refunded automatically", body: "If a generation fails, including provider errors, the credit goes back to this month on its own." },
          { heading: "Cancelling is always free", body: "You can cancel any round; images and assets already made stay in your history to reuse." },
          { heading: "AI-generated label", body: "Videos are AI-generated; keep or add an AI label where the platform requires it." },
        ],
        cta: "Open Create",
      },
    },
  },
  {
    slug: "photo-tips",
    minutes: 3,
    cover: "/template-previews/commerce-macro-texture-asmr.jpg",
    href: "/app/create",
    copy: {
      "zh-CN": {
        title: "拍好商品图：成片像不像，九成看这一步",
        summary: "模型只能照着你给的照片画商品。几条简单的拍法，能让成片里的商品少跑偏。",
        features: ["上传产品图", "商品一致"],
        sections: [
          {
            heading: "怎么拍",
            steps: ["正面、侧面、细节各一张，光线均匀", "商品占画面一半以上，背景干净", "带真实使用场景的照片再加一两张", "同一次上传只放同一款商品（颜色、配件一致）"],
          },
          { heading: "避免什么", body: "别用带大段文字、水印或拼图的图；不同款式混在一起上传，模型会把它们混成一个新商品。" },
        ],
        cta: "去上传",
      },
      "en-US": {
        title: "Product photos: most of the result depends on them",
        summary: "The model can only draw your product from the photos you give it. A few simple habits keep the product from drifting.",
        features: ["Upload product photos", "Product consistency"],
        sections: [
          {
            heading: "How to shoot",
            steps: ["Front, side and a detail shot, in even light", "Product fills at least half the frame, plain background", "Add one or two photos of it in real use", "Upload one product per video (same color and parts)"],
          },
          { heading: "Avoid", body: "Photos with large text, watermarks or collages, and mixing different variants in one upload, which blends them into a product that doesn't exist." },
        ],
        cta: "Upload photos",
      },
    },
  },
];

export function guideArticles(locale: Locale): GuideArticle[] {
  return ARTICLES.map((article) => ({
    slug: article.slug,
    minutes: article.minutes,
    cover: article.cover,
    href: article.href,
    ...article.copy[locale],
  }));
}

export function guideArticle(slug: string, locale: Locale): GuideArticle | null {
  return guideArticles(locale).find((article) => article.slug === slug) ?? null;
}

export const GUIDE_PAGE_COPY: Localized<{
  title: string;
  subtitle: string;
  featured: string;
  all: string;
  read: string;
  minutes: string;
  features: string;
  back: string;
  next: string;
  contact: string;
}> = {
  "zh-CN": {
    title: "使用指南",
    subtitle: "10 分钟上手 Aivora：从一张商品图，到一条可以直接发的成片。",
    featured: "从这里开始",
    all: "全部教程",
    read: "开始阅读",
    minutes: "阅读 {n} 分钟",
    features: "涉及功能",
    back: "返回使用指南",
    next: "下一篇",
    contact: "还有问题？发邮件给我们：{email}",
  },
  "en-US": {
    title: "User guide",
    subtitle: "Get going with Aivora in 10 minutes: from one product photo to a video you can post.",
    featured: "Start here",
    all: "All guides",
    read: "Read",
    minutes: "{n} min read",
    features: "Covers",
    back: "Back to the guide",
    next: "Next",
    contact: "Still stuck? Email us at {email}.",
  },
};
