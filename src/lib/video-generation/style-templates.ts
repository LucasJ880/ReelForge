/**
 * 风格模版体系（Style Templates / "Skill" 模式）—— 2026-07 对齐同行。
 *
 * 同行的做法：前端只是展示界面，实际是后端固化了一批经过验证的「风格 skill」，
 * 客户傻瓜式选模版 → 后端把模版的视觉语言/镜头语言/一致性约束注入生成管线。
 *
 * 我们的等价实现：
 *  - StyleTemplate.scaffold 在 plan 阶段注入 consistency-bible 与 prompt-intelligence
 *    （bibleHints 引导角色/场景/光线，styleKeywords 直接锁风格底盘，
 *     cameraLanguage/shotPattern 引导分镜结构，dialogueStyle 引导台词口吻）。
 *  - ConsistencyLock 是可叠加的 prompt 约束片段（对齐同行「一致性锁」分类：
 *    产品锁形/手部完整性锁/口播对嘴锁/主体居中锁/光线连续锁）。
 *  - 纯静态数据模块：client（模版库页）与 server（generation-supervisor）共用。
 *
 * 注意：所有 scaffold 文案是英文（Seedance 语义遵从度最好），
 * 名称/描述是中文（UI 展示）。
 */

export type StyleTemplateCategory =
  | "爆款广告"
  | "电商产品"
  | "UGC达人"
  | "探店种草"
  | "宠物萌宠";

export interface StyleTemplateScaffold {
  /// 注入 consistency-bible 的引导（角色/场景/光线弧的风格约束）
  characterHint?: string;
  environmentHint?: string;
  lightingHint?: string;
  /// 直接并入每段 prompt 的 Style 行（逗号分隔关键词，模版的「底盘」）
  styleKeywords: string;
  /// 主导镜头语言（引导 LLM 出分镜时的 camera 词汇）
  cameraLanguage: string;
  /// 分镜结构提示（如 "macro droplet reveal → slow orbit → texture close-up"）
  shotPattern: string;
  /// 台词/口播风格；null = 该模版默认无口播（纯氛围）
  dialogueStyle: string | null;
  /// 是否允许 Seedance 原生渲染短字幕（仅个别模版开启；有文字畸变风险）
  nativeCaptions?: {
    enabled: boolean;
    /// 字幕视觉风格说明（位置/样式），内容由 LLM 按镜头生成，每条 ≤10 字
    styleHint: string;
  };
}

export interface StyleTemplate {
  id: string;
  name: string;
  category: StyleTemplateCategory;
  /// UI 卡片描述（中文）
  description: string;
  /// UI 卡片图标（emoji）
  icon: string;
  /// 「套用」时预填到创作页的中文需求描述（用户可改）
  samplePrompt: string;
  /// 推荐默认值
  defaults: {
    durationSec: 15 | 30;
    language: string;
  };
  scaffold: StyleTemplateScaffold;
  /// 是否在库中标注「推荐」
  featured?: boolean;
  /// 爆款标签：按平台爆款广告数据反推的结构模版，UI 置顶展示 + 优先推荐
  viral?: boolean;
}

export interface ConsistencyLock {
  id: string;
  name: string;
  description: string;
  icon: string;
  /// 追加到每段 prompt 的约束行（英文）
  promptFragment: string;
  /// 追加到 negativePrompt 的片段（可选）
  negativeFragment?: string;
}

// ---------------------------------------------------------------------------
// 一致性锁（对齐同行「一致性锁」分类，可多选叠加）
// ---------------------------------------------------------------------------

export const CONSISTENCY_LOCKS: ConsistencyLock[] = [
  {
    id: "lock_product_shape",
    name: "产品锁形",
    description: "同一产品的几何/比例/材质在所有特写镜头中全程稳定",
    icon: "🔒",
    promptFragment:
      "PRODUCT SHAPE LOCK: the product's geometry, proportions, materials and color must stay pixel-consistent in every shot; never redesign, restyle or recolor it between cuts.",
    negativeFragment: "product morphing, changing product design, inconsistent product color",
  },
  {
    id: "lock_hands",
    name: "手部完整性锁",
    description: "出镜手部保持五指解剖结构稳定，杜绝多指粘指",
    icon: "🖐️",
    promptFragment:
      "HAND INTEGRITY LOCK: all visible hands must have exactly five anatomically correct fingers with natural joints in every frame.",
    negativeFragment: "extra fingers, fused fingers, deformed hands, twisted wrists",
  },
  {
    id: "lock_lipsync",
    name: "口播对嘴锁",
    description: "说话人口型与台词自然同步，说话人身份全程稳定",
    icon: "🗣️",
    promptFragment:
      "LIP-SYNC LOCK: when dialogue is spoken, the speaker's lip movements must naturally match the words; the speaker's identity stays the same person throughout.",
    negativeFragment: "mismatched lip sync, mouth not moving while speaking",
  },
  {
    id: "lock_centered",
    name: "主体居中锁",
    description: "主体物体锁定画面中心，背景通过匹配剪辑切换",
    icon: "🎯",
    promptFragment:
      "SUBJECT CENTER LOCK: keep the hero subject locked at the center of frame across cuts; transition backgrounds behind it with match cuts.",
  },
  {
    id: "lock_lighting",
    name: "光线连续锁",
    description: "相邻镜头光源方向/色温连续，无跳变",
    icon: "💡",
    promptFragment:
      "LIGHTING CONTINUITY LOCK: light source direction and color temperature must stay continuous between adjacent shots, no sudden jumps.",
    negativeFragment: "flickering exposure, sudden lighting jumps between cuts",
  },
];

// ---------------------------------------------------------------------------
// 风格模版库
// ---------------------------------------------------------------------------

export const STYLE_TEMPLATES: StyleTemplate[] = [
  // ---- 爆款广告（按 TikTok 家居/产品广告爆款数据反推的结构模版）----
  {
    id: "tpl_viral_result_first",
    name: "成果前置爆款",
    category: "爆款广告",
    icon: "🔥",
    description:
      "前 2 秒直接甩成品效果（TikTok 数据第一的钩子结构），再倒叙揭秘过程，完播率杀手",
    samplePrompt:
      "爆款结构产品广告：开头 2 秒先给最终效果的震撼镜头，再倒叙展示安装/使用过程，结尾回到成品全景。",
    defaults: { durationSec: 15, language: "zh-CN" },
    featured: true,
    viral: true,
    scaffold: {
      environmentHint:
        "ONE real aspirational living space that shows the product installed and styled at its absolute best; every shot stays inside this single space",
      lightingHint:
        "opening: golden-hour glow flattering the finished result; middle: honest neutral daylight during the process; closing: return to the warm glow",
      styleKeywords:
        "result-first reveal edit, cinematic hero opening shot, reverse-chronology storytelling, satisfying process montage, warm aspirational home tones, crisp product detail close-ups, high retention pacing with a cut every 2-3 seconds",
      cameraLanguage:
        "slow push-in hero shot, whip cut to handheld process shots, macro detail insert, final wide pull-back",
      shotPattern:
        "0-2s finished result hero shot (the wow moment, nothing else) → quick rewind transition → raw before state → fast process/installation montage → detail close-up of texture and craftsmanship → return to the hero result with styled space",
      dialogueStyle: null,
    },
  },
  {
    id: "tpl_viral_before_after_room",
    name: "空间焕新对比爆款",
    category: "爆款广告",
    icon: "🏠",
    description:
      "同机位空间 before/after 硬对比（家居类互动量 4 倍结构），换装瞬间强冲击",
    samplePrompt:
      "空间改造爆款：同一房间同一机位，产品安装前的平淡 vs 安装后的高级感，一刀切换的换装冲击。",
    defaults: { durationSec: 15, language: "zh-CN" },
    featured: true,
    viral: true,
    scaffold: {
      environmentHint:
        "one single real room shot from a locked-off camera position: identical framing for the before state and the after state, only the product changes",
      lightingHint:
        "before: flat dull overcast light making the room feel unfinished; after: the exact same room bathed in soft warm layered light that makes it feel expensive",
      styleKeywords:
        "locked-off before/after match cut, same-angle room transformation, instant makeover impact, expensive-look upgrade, soft layered home lighting, believable lived-in space, dramatic yet realistic contrast",
      cameraLanguage:
        "locked-off tripod matching frames, hard match cut on the transformation beat, slow orbit after the reveal, detail close-ups",
      shotPattern:
        "before: static wide of the plain room lingering on the bare problem area → tension beat close-up of the unfinished spot → HARD MATCH CUT to the identical framing fully transformed → slow orbit soaking in the upgraded space → macro of the product texture → final styled wide with cozy life details",
      dialogueStyle: null,
    },
  },
  {
    id: "tpl_viral_pain_solution",
    name: "痛点狙击爆款",
    category: "爆款广告",
    icon: "🎯",
    description:
      "首帧直击真实痛点（刺眼阳光/邻居视线/廉价感），产品一步到位解决，口播种草收尾",
    samplePrompt:
      "痛点解决爆款：开头演真实困扰场景（比如清晨阳光刺眼睡不好），产品出场一步解决，真人口播讲感受。",
    defaults: { durationSec: 15, language: "zh-CN" },
    featured: true,
    viral: true,
    scaffold: {
      characterHint:
        "one relatable everyday homeowner, natural imperfect look, genuinely annoyed at first and genuinely relieved at the end; the SAME person with identical face, hair and outfit performs every action on camera — never a disembodied hand or a second person",
      environmentHint:
        "ONE believable lived-in room where the pain point is physically visible and the product visibly fixes it; the whole video stays inside this single space",
      lightingHint:
        "pain phase: harsh uncomfortable light dramatizing the problem; solution phase: the light instantly turns soft and controlled the moment the product works",
      styleKeywords:
        "pain-point dramatization, authentic UGC realism, visible problem visibly solved, satisfying instant relief moment, natural handheld energy, true-to-life color, emotional expression close-ups",
      cameraLanguage:
        "handheld selfie reaction, POV of the problem, quick reframe cuts, slow push-in on the relief moment",
      shotPattern:
        "cold open on the character suffering the exact pain point mid-reaction → POV shot making the viewer feel the problem → product enters frame naturally → the one decisive action that solves it → visible relief reaction close-up → calm satisfied closing with the product quietly doing its job",
      dialogueStyle:
        "first-person venting then relieved testimonial, casual spoken language like complaining to a friend, never ad-copy; VOICE ONLY — absolutely no burned-in subtitles or on-screen text (captions are added in post)",
    },
  },
  {
    id: "tpl_viral_sensory_texture",
    name: "光影质感沉浸爆款",
    category: "爆款广告",
    icon: "🌅",
    description:
      "逆光织物/材质微距 + 光影流动的沉浸式氛围片，无口播纯质感，高级感拉满",
    samplePrompt:
      "光影质感爆款：逆光下材质纹理微距、光线在表面流动、织物随风轻摆的沉浸式氛围大片。",
    defaults: { durationSec: 15, language: "zh-CN" },
    featured: true,
    viral: true,
    scaffold: {
      environmentHint:
        "ONE serene sunlit interior where daylight interacts with the product's material — light pouring through, gliding across surfaces, casting soft moving shadows; every shot stays inside this single space",
      lightingHint:
        "backlit golden daylight as the main storyteller: rays diffusing through the material, slow-moving light patches, dusk-to-warm lamp glow in the closing shot",
      styleKeywords:
        "sensory macro texture film, backlit fabric translucency, light and shadow choreography, gentle fabric motion in a breeze, dreamy premium atmosphere, slow cinematic movement, tactile close-ups you can almost feel, muted elegant color grade",
      cameraLanguage:
        "macro glide along the texture, slow dolly through light rays, rack focus between material layers, static wide letting light move",
      shotPattern:
        "extreme macro of the material catching backlight → light rays diffuse through it in slow motion → the material sways gently in a breeze → rack focus revealing the full room bathed in filtered light → hand brushes the texture → tranquil closing wide at dusk with warm lamps",
      dialogueStyle: null,
    },
  },
  // ---- 电商产品 ----
  {
    id: "tpl_perfume_macro",
    name: "香水微距水珠",
    category: "电商产品",
    icon: "🧴",
    description: "黑色反光台面通身香水瓶，水珠坠落，奢华广告布光",
    samplePrompt: "奢华香水广告：黑色反光台面上的香水瓶，微距水珠坠落与飞溅，高级感布光。",
    defaults: { durationSec: 15, language: "zh-CN" },
    scaffold: {
      environmentHint:
        "luxury studio set: glossy black reflective tabletop, deep dark backdrop, faint mist",
      lightingHint:
        "dramatic rim lighting with a single warm key light, specular highlights gliding across glass",
      styleKeywords:
        "luxury commercial macro photography, glossy black reflective surface, slow-motion water droplets, crystal glass refraction, rich contrast, shallow depth of field, premium fragrance ad aesthetic",
      cameraLanguage: "macro slider, slow orbit, top-down droplet shot, rack focus",
      shotPattern:
        "droplet falls in slow motion onto surface → macro glide along bottle silhouette → slow orbit revealing label region (blank) → splash crown finale around the bottle base",
      dialogueStyle: null,
    },
  },
  {
    id: "tpl_watch_closeup",
    name: "腕表精密特写",
    category: "电商产品",
    icon: "⌚",
    description: "表冠旋转细节、金属高光，85mm 质感黑色高级背景",
    samplePrompt: "高端腕表广告：表冠旋转、指针跳动、金属拉丝高光，黑色高级背景微距特写。",
    defaults: { durationSec: 15, language: "zh-CN" },
    scaffold: {
      environmentHint: "pitch-black studio void with a single polished stone pedestal",
      lightingHint: "hard specular key light raking across brushed metal, slow light sweep",
      styleKeywords:
        "85mm macro lens look, brushed metal highlights, watch mechanism detail, obsidian black backdrop, cinematic product commercial, ultra sharp textures, slow deliberate motion",
      cameraLanguage: "macro rack focus, slow 30-degree orbit, extreme close-up pan",
      shotPattern:
        "crown rotates in extreme close-up → light sweep across the dial → strap texture glide → full watch hero orbit",
      dialogueStyle: null,
    },
  },
  {
    id: "tpl_sneaker_360",
    name: "球鞋360旋转",
    category: "电商产品",
    icon: "👟",
    description: "球鞋空中360度慢旋转，侧逆光轮廓，干净摄影棚地面",
    samplePrompt: "潮流球鞋广告：球鞋悬浮空中360度慢速旋转，侧逆光勾勒轮廓，鞋底纹理特写。",
    defaults: { durationSec: 15, language: "zh-CN" },
    scaffold: {
      environmentHint: "clean seamless studio floor with soft gradient backdrop",
      lightingHint: "side backlight tracing the silhouette, soft fill from below",
      styleKeywords:
        "floating sneaker 360 rotation, studio seamless backdrop, rim light silhouette, sole texture macro, dynamic particle dust, streetwear commercial energy, crisp product edges",
      cameraLanguage: "orbiting camera, whip pan between angles, low-angle hero shot",
      shotPattern:
        "sneaker floats and rotates 360 → macro pan across sole tread → lace and stitch close-up → hero low-angle landing pose",
      dialogueStyle: null,
    },
  },
  {
    id: "tpl_skincare_texture",
    name: "护肤质地微距",
    category: "电商产品",
    icon: "✨",
    description: "精华液半透明质地与玻璃瓶身微距，干净白棚高级感",
    samplePrompt: "护肤精华广告：半透明精华质地涂抹微距、玻璃瓶身光影，白棚干净高级感。",
    defaults: { durationSec: 15, language: "zh-CN" },
    scaffold: {
      environmentHint: "bright clean white studio with frosted acrylic props",
      lightingHint: "soft diffused daylight-balanced light, gentle gradient shadows",
      styleKeywords:
        "translucent serum texture macro, glass dropper bottle, soft white studio, water ripple surface, dewy highlights, clean beauty commercial, airy minimal aesthetic",
      cameraLanguage: "macro top-down, slow push-in, texture smear close-up",
      shotPattern:
        "dropper releases a drop in slow motion → serum spreads in macro swirl → bottle hero shot with caustic light → fingertip smears texture across glass",
      dialogueStyle: null,
    },
  },
  {
    id: "tpl_drink_condensation",
    name: "饮料冷凝爆点",
    category: "电商产品",
    icon: "🥤",
    description: "冷凝水珠饮料瓶，high 速水花飞溅，强冲击广告氛围",
    samplePrompt: "冰爽饮料广告：瓶身冷凝水珠滑落，冰块与水花高速飞溅，强冲击力。",
    defaults: { durationSec: 15, language: "zh-CN" },
    scaffold: {
      environmentHint: "cold blue-tinted studio with wet reflective surface and ice props",
      lightingHint: "crisp cool backlight with bright specular kicks on droplets",
      styleKeywords:
        "ice-cold condensation droplets, high-speed splash photography, frozen motion water crown, refreshing energy, saturated cool tones, carbonation bubbles macro, beverage commercial impact",
      cameraLanguage: "high-speed freeze frame, vertical crash zoom, macro droplet glide",
      shotPattern:
        "condensation rolls down the bottle in macro → ice cubes crash in slow motion → splash crown erupts around the bottle → hero shot with bubbles rising",
      dialogueStyle: null,
    },
  },
  {
    id: "tpl_3c_focus",
    name: "3C功能聚焦",
    category: "电商产品",
    icon: "📱",
    description: "现代桌面场景，功能点逐一特写，冷调科技感",
    samplePrompt: "数码产品广告：现代简约桌面，产品功能点逐一特写演示，冷调科技感。",
    defaults: { durationSec: 15, language: "zh-CN" },
    scaffold: {
      environmentHint: "modern minimal desk setup, dark gradient wall, subtle ambient LED",
      lightingHint: "cool-toned edge lighting with soft screen glow",
      styleKeywords:
        "sleek tech commercial, cool color grade, precise macro details, clean desk setup, floating UI-free product shots, premium materials, engineered minimalism",
      cameraLanguage: "linear slider move, precise rack focus, overhead functional shot",
      shotPattern:
        "hero reveal on desk → macro of key physical feature → hands interacting naturally → satisfying final placement shot",
      dialogueStyle: null,
    },
  },
  {
    id: "tpl_food_appetite",
    name: "食品包装食欲感",
    category: "电商产品",
    icon: "🍜",
    description: "热气蒸腾、酱汁流动微距，暖调美食广告布光",
    samplePrompt: "美食广告：热气蒸腾、酱汁缓慢流动的微距食欲镜头，暖调布光。",
    defaults: { durationSec: 15, language: "zh-CN" },
    scaffold: {
      environmentHint: "warm rustic kitchen table with dark moody backdrop",
      lightingHint: "warm golden backlight catching rising steam",
      styleKeywords:
        "appetizing food macro, rising steam backlit, glossy sauce drizzle slow motion, rich warm tones, shallow depth of field, food commercial craving aesthetic",
      cameraLanguage: "macro drizzle top shot, slow push through steam, texture pull-apart close-up",
      shotPattern:
        "steam rises through backlight → sauce drizzles in slow motion → pull-apart texture close-up → hero dish with package beside it",
      dialogueStyle: null,
    },
  },
  {
    id: "tpl_before_after",
    name: "前后对比叙事",
    category: "电商产品",
    icon: "🔄",
    description: "美容仪首尾颜值叙事，清晰的前后对比冲击",
    samplePrompt: "前后对比带货：使用前的困扰 vs 使用后的效果，同机位前后对比冲击。",
    defaults: { durationSec: 15, language: "zh-CN" },
    scaffold: {
      characterHint: "one relatable everyday person, natural look, expressive face",
      lightingHint:
        "before: flat dull light emphasizing the problem; after: bright flattering light emphasizing the result",
      styleKeywords:
        "before/after split narrative, matched framing comparison, authentic transformation, same camera position contrast, satisfying reveal, UGC realism",
      cameraLanguage: "locked-off matching frames, whip transition, split-screen feel via match cut",
      shotPattern:
        "before state with visible problem → product introduced to camera → quick usage montage → after state in the exact same framing, visible improvement",
      dialogueStyle: "first-person honest testimonial, casual and direct",
    },
  },
  // ---- UGC达人 ----
  {
    id: "tpl_ugc_talking",
    name: "UGC口播种草",
    category: "UGC达人",
    icon: "🎙️",
    description: "手机自拍口播 + 产品演示穿插，真实达人质感，转化最猛",
    samplePrompt: "真实达人口播种草：手机自拍讲需求痛点，穿插产品上手演示，口语化台词。",
    defaults: { durationSec: 15, language: "zh-CN" },
    featured: true,
    scaffold: {
      characterHint:
        "relatable content creator vibe, natural imperfect look, expressive reactions",
      environmentHint: "real lived-in home environment, natural clutter, daylight from window",
      styleKeywords:
        "authentic handheld iPhone selfie footage, realistic skin texture, natural motion blur, casual UGC energy, true-to-life color, no beauty filter, slight camera shake",
      cameraLanguage: "handheld selfie, phone propped on desk, quick reframe cuts",
      shotPattern:
        "hook: face to camera stating the pain point → product shown to camera → hands-on demonstration → payoff reaction → final recommendation to camera",
      dialogueStyle:
        "casual spoken language with contractions, like recommending to a close friend, never ad-copy",
    },
  },
  {
    id: "tpl_unboxing",
    name: "开箱测评",
    category: "UGC达人",
    icon: "📦",
    description: "第一视角开箱，细节上手把玩，真实测评节奏",
    samplePrompt: "第一视角开箱测评：拆包装、上手把玩细节、给出真实使用感受。",
    defaults: { durationSec: 15, language: "zh-CN" },
    scaffold: {
      characterHint: "hands-focused creator, only hands and product in most shots",
      environmentHint: "wooden desk surface with soft window light, minimal props",
      styleKeywords:
        "first-person unboxing POV, hands opening package, tactile close-ups, authentic desk setup, natural daylight, satisfying reveal pacing, honest review energy",
      cameraLanguage: "top-down POV, handheld close-up, slow reveal pan",
      shotPattern:
        "package on desk teaser → hands open the box → product lifted out and rotated → key detail close-ups → final verdict shot with product front and center",
      dialogueStyle: "curious honest reviewer tone, thinking out loud, spontaneous reactions",
    },
  },
  // ---- 探店种草 ----
  {
    id: "tpl_store_visit",
    name: "探店Vlog",
    category: "探店种草",
    icon: "🏪",
    description: "达人出镜探店，门头→内景→亮点→收尾种草，同人同店全程一致",
    samplePrompt: "达人探店视频：店门口开场介绍，进店逛亮点区域，特色细节特写，结尾种草召唤。",
    defaults: { durationSec: 30, language: "zh-CN" },
    featured: true,
    scaffold: {
      characterHint:
        "one friendly lifestyle vlogger, consistent outfit and hairstyle throughout the whole visit",
      environmentHint:
        "a single real retail store: storefront exterior, then interior zones that all share the same design language, materials and signage style",
      lightingHint:
        "natural daylight at the storefront, warm cozy interior lighting inside, consistent color temperature between adjacent shots",
      styleKeywords:
        "store-visit vlog realism, handheld walking camera, natural daylight to warm interior, consistent host across every shot, lifestyle exploration pacing, authentic retail environment detail",
      cameraLanguage:
        "handheld follow shot, selfie walk-and-talk, slow interior pan, detail close-up",
      shotPattern:
        "host in front of the storefront introduces the place → walks through the entrance → highlights zone one with genuine reaction → detail close-up of the signature offering → host shares a practical tip at the counter → cozy closing shot recommending the place",
      dialogueStyle:
        "enthusiastic but genuine vlogger narration, first-person discoveries, short punchy sentences",
    },
  },
  // ---- 宠物萌宠 ----
  {
    id: "tpl_pet_store",
    name: "萌宠探店",
    category: "宠物萌宠",
    icon: "🐱",
    description: "宠物店探店：达人 + 招牌猫双主角，治愈系暖调，全程一致",
    samplePrompt: "宠物店探店视频：女生达人探访猫咪店，透明猫舍、猫咪吃饭特写、撸猫收尾，治愈系。",
    defaults: { durationSec: 30, language: "zh-CN" },
    featured: true,
    scaffold: {
      characterHint:
        "one gentle young woman vlogger in a cream knit outfit, soft warm presence, PLUS one signature shop cat (same breed, same fur pattern in every cat shot) as the second recurring character; additional resident cats and one or two happy customers appear naturally in the background",
      environmentHint:
        "a cozy modern cat cafe / pet store buzzing with gentle life: light wood shelving, transparent acrylic cat cabins with several cats lounging inside, cream rugs, soft plush textures, big storefront windows, a couple of customers browsing quietly",
      lightingHint:
        "bright warm inviting light throughout: airy bright daylight feel inside, no dim or moody corners, gentle golden warmth in the closing cuddle shot",
      styleKeywords:
        "lively healing pet-store vlog, bright warm inviting color grade, multiple adorable cats, adorable cat close-ups, soft plush textures, consistent host and consistent hero cat across all shots, gentle handheld motion, wholesome bustling atmosphere",
      cameraLanguage:
        "handheld follow, selfie walk-and-talk, low-angle cat close-up, slow push-in on cute moments",
      shotPattern:
        "host introduces the store at the entrance → walks in past transparent cat cabins where several cats lounge and play → signature cat eating close-up (adorable) → cats playing on the cat tree / exercise wheel while a customer smiles nearby → host shares a practical tip → closing shot petting the hero cat on her lap",
      dialogueStyle:
        "soft healing vlogger tone, affectionate words for the cats, short warm sentences",
    },
  },
  {
    id: "tpl_pet_daily",
    name: "萌宠日常",
    category: "宠物萌宠",
    icon: "🐶",
    description: "家庭场景萌宠日常 + 宠物用品自然植入，治愈日常感",
    samplePrompt: "萌宠日常视频：家里的猫/狗日常high光时刻，自然植入宠物用品使用场景。",
    defaults: { durationSec: 15, language: "zh-CN" },
    scaffold: {
      characterHint:
        "one adorable pet (same breed, same fur pattern in every shot) as the hero; owner appears only as hands or partial presence",
      environmentHint:
        "a warm lived-in apartment: soft rugs, sunny window spot, pet bowls and toys naturally placed",
      lightingHint: "sunny afternoon window light, warm domestic glow",
      styleKeywords:
        "cozy pet daily-life vlog, adorable close-ups, warm domestic light, natural pet behavior, soft plush textures, wholesome healing mood, consistent pet identity across shots",
      cameraLanguage: "low pet-level handheld, slow push-in, overhead feeding shot",
      shotPattern:
        "pet's cute morning stretch → pet interacts with the product naturally → owner's hands refill/use the product → satisfied pet close-up payoff",
      dialogueStyle: null,
    },
  },
];

// ---------------------------------------------------------------------------
// 查询工具
// ---------------------------------------------------------------------------

export function getStyleTemplate(id: string | null | undefined): StyleTemplate | null {
  if (!id) return null;
  return STYLE_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function getConsistencyLocks(ids: string[] | null | undefined): ConsistencyLock[] {
  if (!ids || ids.length === 0) return [];
  return CONSISTENCY_LOCKS.filter((l) => ids.includes(l.id));
}

export const STYLE_TEMPLATE_CATEGORIES: StyleTemplateCategory[] = [
  "爆款广告",
  "电商产品",
  "UGC达人",
  "探店种草",
  "宠物萌宠",
];
