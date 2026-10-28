/**
 * 客户使用指南（2026-10-28，CEO 要的 user guide；版式学 LibTV「学院」：一张上手主卡 + 教程卡片墙）。
 *
 * 纯数据、无服务端依赖：服务端页面与客户端组件都能引用。用词与界面按钮逐字一致
 *（「上传产品图」「一致性故事板」「生成视频」「重做这一段」「换字幕样式 / BGM」「下载成片」），
 * 界面改名时同步改这里。封面只用仓库里已公开的样片 / 故事板静帧，不放客户素材。
 */
import type { Locale } from "@/i18n/config";

export type GuideSlug = "quick-start" | "storyboard" | "brand" | "library" | "batch" | "templates" | "billing" | "photo-tips";

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
        summary: "从一张商品图到一条能直接发的 15 秒成片：上传、写一句话、看故事板、生成、下载。",
        features: ["上传产品图", "一致性故事板", "生成视频", "成品库"],
        sections: [
          {
            heading: "1. 上传产品图",
            body: "在「创作」页点「上传产品图」，放 1–9 张真实的商品照片。照片越清楚、角度越多，成片里的商品越像真的。",
            tip: "没有商品图也能先写描述起稿，但商品外观就只能靠文字猜。",
          },
          {
            heading: "2. 用一句话说清楚你想拍什么",
            body: "像跟摄影师说话一样写：谁、在哪、做什么、想让客户记住哪一点。例如「午后客厅太刺眼，拉一下斑马帘，屋里马上柔和下来」。",
          },
          {
            heading: "3. 看「一致性故事板」",
            body: "Aivora 先给每个镜头写好焦段、机位和动作，再出 4 帧故事板。哪一帧不满意，只重抽那一帧，可以在「重做前补充要求」里写清楚要怎么改。",
          },
          {
            heading: "4. 确认后点「生成视频」",
            body: "故事板确认了才会开拍，视频按故事板一镜一镜拍。生成要几分钟到十几分钟，可以先去做别的，完成后会出现在「成品库」。",
          },
          {
            heading: "5. 在「成品库」下载",
            body: "点开成片，「下载成片」拿到带字幕和音乐的 MP4；需要单独的字幕文件就点「下载字幕（SRT）」。",
          },
        ],
        cta: "去做第一条",
      },
      "en-US": {
        title: "Your first video in 10 minutes",
        summary: "From one product photo to a 15-second ad you can post: upload, describe, check the storyboard, generate, download.",
        features: ["Upload product photos", "Storyboard", "Generate video", "Library"],
        sections: [
          {
            heading: "1. Upload product photos",
            body: "On the Create page, upload 1–9 real photos of your product. Sharper photos from more angles make the product look right in the video.",
            tip: "You can start from a description alone, but then the product's look is only guessed from your words.",
          },
          {
            heading: "2. Describe the video in one sentence",
            body: "Write it like you would brief a camera operator: who, where, what happens, and the one thing customers should remember.",
          },
          {
            heading: "3. Check the storyboard",
            body: "Aivora writes each shot (lens, camera position, action) and draws 4 storyboard frames. Redo only the frame you don't like, and say what to change before it redraws.",
          },
          {
            heading: "4. Approve, then Generate video",
            body: "Filming starts only after you approve the storyboard, and each shot follows its frame. It takes a few minutes; the result lands in the Library.",
          },
          {
            heading: "5. Download from the Library",
            body: "Open the video and download the MP4 with captions and music, or download the captions as an SRT file.",
          },
        ],
        cta: "Make your first video",
      },
    },
  },
  {
    slug: "storyboard",
    minutes: 4,
    cover: `${LANDING}/hero-kitchen.jpg`,
    href: "/app/create",
    copy: {
      "zh-CN": {
        title: "用好故事板：只改你想改的那一帧",
        summary: "故事板是开拍前最便宜的修改机会：镜头卡说明每一镜怎么拍，重抽一帧不影响其他帧。",
        features: ["一致性故事板", "镜头卡", "重做前补充要求"],
        sections: [
          {
            heading: "每一帧都有一张镜头卡",
            body: "镜头卡写着这一镜用什么焦段、相机在哪、画面里前中后景是什么、动作做到哪一步结束。视频会按镜头卡拍，所以先看卡、再看图。",
          },
          {
            heading: "只重抽不满意的那一帧",
            steps: ["在不满意的那一帧上点「重新生成」", "展开「重做前补充要求」，写一句要怎么改（如「产品放在画面正中」「不要出现文字」）", "需要的话换一张参考图，再提交"],
            tip: "其余帧保持不动；故事板确认之前不扣视频额度。",
          },
          {
            heading: "什么时候该改描述而不是重抽",
            body: "如果 4 帧都偏了（场景、人物、季节不对），回到描述把这几点写清楚再出故事板，比一帧帧重抽更快。",
          },
        ],
        cta: "去创作",
      },
      "en-US": {
        title: "Storyboards: change only the frame you want",
        summary: "The storyboard is the cheapest place to fix things. Shot cards say how each shot is filmed, and redoing one frame leaves the rest alone.",
        features: ["Storyboard", "Shot cards", "Adjust before regenerating"],
        sections: [
          {
            heading: "Every frame has a shot card",
            body: "The card names the lens, where the camera is, what sits in the foreground and background, and where the action ends. The video follows the card, so read the card before judging the picture.",
          },
          {
            heading: "Redo only the frame you don't like",
            steps: ["Click Regenerate on that frame", "Open “Adjust before regenerating” and say what to change", "Swap a reference photo if needed, then submit"],
            tip: "Other frames stay as they are, and nothing is charged until you approve and generate.",
          },
          {
            heading: "When to rewrite the description instead",
            body: "If all four frames miss (wrong place, people or season), fix the description and draw a new storyboard; it is faster than redoing frames one by one.",
          },
        ],
        cta: "Open Create",
      },
    },
  },
  {
    /// 2026-10-28 商品主体轮 P0：品牌尾卡下线，品牌跟着商品走——这篇从「设置品牌包」改成「怎么让商品上的 logo 进视频」
    slug: "brand",
    minutes: 3,
    cover: `${LANDING}/hero-garden.jpg`,
    href: "/app/create",
    copy: {
      "zh-CN": {
        title: "品牌怎么进视频：logo 跟着商品走",
        summary: "成片结尾不再贴品牌卡。你的品牌就印在商品上：把商品拍清楚，logo 会跟着商品出现在每个镜头里。",
        features: ["品牌", "上传产品图", "Logo"],
        sections: [
          { heading: "为什么不再加品牌尾卡", body: "结尾贴一帧联系卡，画风和前面对不上，看着像两条片子拼在一起；换了商品，卡还是同一张。现在商品上印着什么，成片里就是什么。" },
          { heading: "怎么拍，logo 才清楚", steps: ["让 logo 正对镜头，在画面里占一块明显的位置", "光线均匀，不反光，不被手或包装挡住", "多拍一两个角度（正面、45°），字和图形更容易对上"] },
          { heading: "生成时怎么处理", body: "生成时会要求保留商品上原有的 logo 和字样，不额外添加别的文字或 logo。个别镜头里小字可能有细微变形：在故事板阶段重抽那一帧最省钱，成片里不满意就用「重做这一段」。" },
        ],
        cta: "去创作",
      },
      "en-US": {
        title: "How your brand gets into the video: the logo travels with the product",
        summary: "Videos no longer end with a pasted brand card. Your brand is printed on your product: shoot the product clearly and the logo shows up with it in every shot.",
        features: ["Brand", "Upload product photos", "Logo"],
        sections: [
          { heading: "Why there is no brand end card", body: "A contact card pasted at the end never matches the look of the shots before it, and it stays the same whatever product you film. Now what is printed on the product is what appears in the video." },
          { heading: "Shoot so the logo reads", steps: ["Turn the logo toward the camera and give it a clear share of the frame", "Use even light with no glare, and keep hands and packaging off it", "Add one or two more angles (front, 45°) so lettering and marks line up"] },
          { heading: "What happens during generation", body: "Generation is told to keep the logo and lettering already on the product and to add no other text or logos. Small lettering can still drift slightly in a shot: redoing that storyboard frame is the cheapest fix, and in the Library you can redo just that segment." },
        ],
        cta: "Open Create",
      },
    },
  },
  {
    slug: "library",
    minutes: 4,
    cover: "/template-previews/commerce-beauty-texture.jpg",
    href: "/app/library",
    copy: {
      "zh-CN": {
        title: "成品库：下载、重做一段、换字幕和音乐",
        summary: "成片不满意不用整条重来：只重做有问题的那一段，或者只换字幕样式和背景音乐。",
        features: ["成品库", "重做这一段", "换字幕样式 / BGM", "下载成片"],
        sections: [
          { heading: "下载", body: "「下载成片」拿 MP4；「下载字幕（SRT）」拿单独的字幕文件，方便发到不同平台。" },
          {
            heading: "只重做一段",
            steps: ["在成片详情里选中有问题的那一段，点「重做这一段」", "在「想让这一段怎么改」写一句（可不填）", "点「确认重做（扣 1 段）」"],
            tip: "重做期间旧成片照常可看可下载；新的一段成功后才会替换进去。",
          },
          { heading: "只换字幕样式 / BGM", body: "「换字幕样式 / BGM」只重新合成，不重新生成画面，不计生成额度；没成功会自动回到旧成片。" },
        ],
        cta: "打开成品库",
      },
      "en-US": {
        title: "Library: download, redo one segment, change captions or music",
        summary: "No need to redo a whole video: redo only the segment that is off, or just change the caption style and music.",
        features: ["Library", "Redo this segment", "Captions / BGM", "Download"],
        sections: [
          { heading: "Download", body: "Download the MP4, or the captions as an SRT file for platforms that want them separately." },
          {
            heading: "Redo one segment",
            steps: ["Open the video, pick the segment that is off and choose Redo", "Optionally say how it should change", "Confirm (uses 1 segment)"],
            tip: "The old video stays viewable and downloadable; the new segment replaces it only once it succeeds.",
          },
          { heading: "Change captions or music only", body: "This re-assembles the video without filming anything new, so it does not use generation credit; if it fails you keep the old video." },
        ],
        cta: "Open the Library",
      },
    },
  },
  {
    slug: "batch",
    minutes: 4,
    cover: "/template-previews/commerce-food-sizzle.jpg",
    href: "/app/batches/new",
    copy: {
      "zh-CN": {
        title: "批量出片：一次做一周的量",
        summary: "选一个模板、放进多款商品，一次排出多条视频；每条都会先过故事板再开拍。",
        features: ["批量生产", "新建批次", "模板库"],
        sections: [
          { heading: "适合什么时候用", body: "同一种拍法要套在很多商品上（例如每款窗帘都拍一条「拉帘前后对比」）。" },
          { heading: "怎么建", steps: ["在「批量生产」点「新建批次」", "选模板、上传每款商品的实拍图", "确认条数后提交；进度在批次详情里看"] },
          { heading: "失败了怎么办", body: "某一条失败不会拖垮整批；失败的条目额度自动退回，可以在批次详情里单条重试。" },
        ],
        cta: "新建批次",
      },
      "en-US": {
        title: "Batches: a week of videos at once",
        summary: "Pick a template, add several products, and queue many videos in one go; each still goes through a storyboard first.",
        features: ["Batches", "New batch", "Templates"],
        sections: [
          { heading: "When to use it", body: "When the same style of video should run across many products (for example a before / after for every shade)." },
          { heading: "How to set it up", steps: ["Go to Batches and choose New batch", "Pick a template and upload real photos of each product", "Confirm the count and submit; follow progress on the batch page"] },
          { heading: "If something fails", body: "One failed video doesn't sink the batch; its credit is returned automatically and you can retry it on its own." },
        ],
        cta: "New batch",
      },
    },
  },
  {
    slug: "templates",
    minutes: 3,
    cover: "/template-previews/commerce-outdoor-rugged.jpg",
    href: "/app/templates",
    copy: {
      "zh-CN": {
        title: "模板库：先选拍法，再放商品",
        summary: "每个模板都定好了镜头结构和节奏，选一个最接近你想要的，成片更稳、更少跑偏。",
        features: ["模板库", "样片"],
        sections: [
          { heading: "怎么挑", body: "先看样片：节奏、景别、有没有人出镜。选最接近你想要的那个，比从零描述更不容易跑偏。" },
          { heading: "用模板做单条或批量", body: "模板详情里可以直接用它创作单条，或者「用此模板批量生产」。" },
        ],
        cta: "逛模板库",
      },
      "en-US": {
        title: "Templates: pick the style, then add your product",
        summary: "Each template fixes the shot structure and pace. Pick the closest one for steadier results.",
        features: ["Templates", "Samples"],
        sections: [
          { heading: "How to choose", body: "Watch the sample first: pace, shot sizes, whether a person is on camera. The closest template drifts less than a blank description." },
          { heading: "Single video or batch", body: "From a template you can make one video or use it for a batch." },
        ],
        cta: "Browse templates",
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
          { heading: "什么时候扣额度", body: "点「生成视频」提交时预留额度；故事板、重抽故事板帧、换字幕样式 / BGM 都不扣视频额度。重做一段扣 1 段。" },
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
          { heading: "When credit is used", body: "Credit is reserved when you click Generate video. Storyboards, redrawing a frame, and changing captions or music don't use video credit. Redoing a segment uses 1 segment." },
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
