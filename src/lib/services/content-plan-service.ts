import { chatJsonByTier, isLLMAvailable, isLLMForcedMock } from "@/lib/ai";
import {
  contentPlanSchema,
  missingRequiredFormats,
  MIN_POSTS_PER_WEEK,
  TARGET_POSTS_PER_WEEK,
  type ContentPlan,
  type ContentPost,
} from "@/lib/schemas/content-plan";
import { HOOK_TYPES } from "@/lib/video-generation/creative-recipe";
import {
  checkOriginality,
  flattenPlanText,
  type OriginalityReport,
} from "@/lib/services/originality-check";

/**
 * O1 · 从一句话生成一周多形态内容计划（PRD §3）。
 *
 * 与 creative-strategist 同一套路径：LLM 不可用 / 强制 mock 时走启发式，
 * 失败也回退启发式而不是抛错 —— 商家宁可拿到一份还需要改的计划，
 * 也不要拿到一个错误弹窗。
 */

export type ContentPlanInput = {
  /// 主入口：一句话业务描述
  sentence: string;
  /// 商家自述的行业 / 品类（可空，LLM 会自己判断）
  industry?: string | null;
  /// 目标平台，影响文案长度与标签风格
  platform?: string | null;
  /// 从商品链接或产品图抽到的补充事实。**只放事实，不放推断** ——
  /// 这里塞进去的东西会被当成真的写进文案。
  productFacts?: string[] | null;
  brandName?: string | null;
  /**
   * 同行广告的**结构骨架**（O4）。冷启动时没有自己的战绩，就先借同行
   * 已经验证过的结构。
   *
   * 只带结构，绝不带原文措辞 —— 由 ad-intel-service 的
   * `structuresToPromptLines` 产出，那一层已经把素材与原文剥干净了。
   */
  referenceStructures?: string[] | null;
  /**
   * 已被赛马判定为赢家的配方（R4）。给了就围绕它派生变体，
   * 而不是每周从零开始猜。
   */
  winningRecipe?: { hookType: string; format: string } | null;
};

const SYSTEM_PROMPT = `You plan a week of social content for a SMALL LOCAL BUSINESS owner.

Return JSON only:
{
  "theme": "one line: what this week is about",
  "targetAudience": "specific, not 'everyone'",
  "corePainPoint": "ONE concrete problem",
  "posts": [
    {
      "key": "p1",
      "dayOffset": 0,
      "format": "text" | "single_image" | "carousel" | "video",
      "hookType": "POV" | "Curiosity" | "Stat" | "Reveal" | "Pain" | "Demo",
      "copy": { "hook": "first line that stops the scroll", "body": "...", "cta": "... or null" },
      "hashtags": ["no # prefix", "..."],
      "imagePrompt": "for single_image only, else null",
      "slides": [{ "order": 0, "imagePrompt": "...", "overlayText": "... or null", "purpose": "..." }],
      "rationale": "why this post is worth publishing, in the owner's language"
    }
  ]
}

HARD RULES:
1. Produce ${TARGET_POSTS_PER_WEEK} posts spread across dayOffset 0-6. Never fewer than ${MIN_POSTS_PER_WEEK}.
2. MUST include at least one "text", one "single_image", and one "carousel" post.
3. "carousel" posts need 3-6 slides. Non-carousel posts have "slides": [].
4. "imagePrompt" is non-null ONLY for single_image; null for every other format.
5. Do NOT put readable words INTO imagePrompt as things the image model should render.
   Text is composited by us afterwards — put it in overlayText instead.
6. hookType must match what the hook actually does. Do not default everything to "Demo".
7. Never use filler adjectives: amazing, revolutionary, premium, next-level, perfect for everyone.
8. Write copy in the same language as the user's input.
9. Output JSON only — no markdown, no commentary.`;

function buildUserPrompt(input: ContentPlanInput): string {
  const facts = input.productFacts?.filter(Boolean) ?? [];
  const structures = input.referenceStructures?.filter(Boolean) ?? [];

  /**
   * 参考结构与赢家配方是两种不同的输入：
   * - 参考结构来自同行（冷启动用），只给骨架，画面与文案必须全部原创；
   * - 赢家配方来自我方赛马（有战绩之后用），是「这种结构在替你赚钱」的证据。
   * 两者都只影响结构，都不提供可抄的措辞。
   */
  const referenceBlock = structures.length
    ? `\n\n# Proven structures from this industry (SKELETON ONLY)
${structures.map((line) => `  - ${line}`).join("\n")}

Use these as structural inspiration: hook type, pacing, order of claims, CTA form.
NEVER reuse their wording, taglines, or specific claims. All copy must be original
and must only assert facts from the section above.`
    : "";

  const winnerBlock = input.winningRecipe
    ? `\n\n# Winning structure from this account's own results
hook_type: ${input.winningRecipe.hookType}
format: ${input.winningRecipe.format}

At least 2 of the posts must use this hook type. Vary the angle and the visual,
not the structure — the structure is what is already working.`
    : "";

  return `# Business
one_liner: ${input.sentence}
industry: ${input.industry ?? "(infer it)"}
brand_name: ${input.brandName ?? "(none given)"}
target_platform: ${input.platform ?? "(general short-form social)"}

# Verified product facts (do not contradict these; do not invent more)
${facts.length ? facts.map((f) => `  - ${f}`).join("\n") : "  (none — rely only on the one-liner)"}${referenceBlock}${winnerBlock}`;
}

export async function buildContentPlan(input: ContentPlanInput): Promise<{
  plan: ContentPlan;
  source: "llm" | "heuristic";
  originality: OriginalityReport;
}> {
  const references = input.referenceStructures?.filter(Boolean) ?? [];

  if (isLLMForcedMock() || !isLLMAvailable()) {
    const plan = heuristicPlan(input);
    return {
      plan,
      source: "heuristic",
      originality: checkOriginality(flattenPlanText(plan), references),
    };
  }

  try {
    const plan = await generateOnce(input);
    const originality = checkOriginality(flattenPlanText(plan), references);
    if (originality.passed || references.length === 0) {
      return { plan, source: "llm", originality };
    }

    /**
     * 重复度不过 → **不把它交出去**。
     *
     * O4 验收 3 要求「由配方生成的内容是原创的，可通过重复度检查」，
     * 那是合规主张，不是质量分。所以这里不是记个分就放行，而是重生成：
     * 第二次**完全去掉参考结构** —— 没有可抄的东西，结果必然原创。
     * 代价是这一周的内容失去同行结构的加成，但合规边界不能拿它换。
     */
    console.warn(
      `[content-plan] 重复度 ${originality.containment.toFixed(3)} 超阈值，` +
        `去掉参考结构重生成。命中片段：${originality.longestOverlap ?? "(无)"}`,
    );
    const clean = await generateOnce({ ...input, referenceStructures: null });
    return {
      plan: clean,
      source: "llm",
      originality: checkOriginality(flattenPlanText(clean), references),
    };
  } catch (err) {
    console.warn(
      "[content-plan] LLM failed, falling back to heuristic:",
      (err as Error).message,
    );
    const plan = heuristicPlan(input);
    return {
      plan,
      source: "heuristic",
      originality: checkOriginality(flattenPlanText(plan), references),
    };
  }
}

async function generateOnce(input: ContentPlanInput): Promise<ContentPlan> {
  const { data } = await chatJsonByTier<unknown>({
    tier: "creative",
    stage: "content_plan_week",
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(input),
    temperature: 0.7,
    maxTokens: 4000,
  });
  return repairPlan(data, input);
}

/**
 * 模型输出不合规是常态，不是异常。
 *
 * 这里**修而不是拒**：缺形态就补、条数不够就补、字段错位就归位。
 * 直接 `schema.parse` 会把一次 4000 token 的生成整份丢掉，
 * 而商家看到的是「生成失败，请重试」——那正是 PRD 说的头号流失原因。
 */
export function repairPlan(raw: unknown, input: ContentPlanInput): ContentPlan {
  const source = (raw ?? {}) as Record<string, unknown>;
  const rawPosts = Array.isArray(source.posts) ? source.posts : [];

  const posts: ContentPost[] = rawPosts
    .map((post, index) => repairPost(post, index))
    .filter((post): post is ContentPost => post !== null);

  const fallback = heuristicPlan(input);

  /// 补齐必需形态：缺哪个就从启发式计划里取同形态的一条顶上，
  /// 而不是把整份计划判死。
  for (const format of missingRequiredFormats({ ...fallback, posts })) {
    const donor = fallback.posts.find((post) => post.format === format);
    if (donor) posts.push({ ...donor, key: `fill-${format}` });
  }

  /// 条数不够就从启发式补到下限。一周少于 3 条达不到北极星指标。
  let cursor = 0;
  while (posts.length < MIN_POSTS_PER_WEEK && cursor < fallback.posts.length) {
    const donor = fallback.posts[cursor++];
    if (!posts.some((post) => post.key === donor.key)) posts.push(donor);
  }

  return contentPlanSchema.parse({
    theme: str(source.theme) ?? fallback.theme,
    targetAudience: str(source.targetAudience) ?? fallback.targetAudience,
    corePainPoint: str(source.corePainPoint) ?? fallback.corePainPoint,
    posts: posts.slice(0, 14).map((post, index) => ({
      ...post,
      /// key 必须唯一：下游按 key 做幂等与重排。
      key: post.key && posts.filter((p) => p.key === post.key).length === 1
        ? post.key
        : `p${index + 1}`,
    })),
  });
}

function repairPost(raw: unknown, index: number): ContentPost | null {
  if (!raw || typeof raw !== "object") return null;
  const post = raw as Record<string, unknown>;

  const copyRaw = (post.copy ?? {}) as Record<string, unknown>;
  const hook = str(copyRaw.hook);
  const body = str(copyRaw.body);
  /// hook 或 body 缺失的帖子没有救的必要 —— 补出来的等于我们自己写的，
  /// 不如让上面的补齐逻辑用启发式顶上，至少那份是有意为之的。
  if (!hook || !body) return null;

  const format = oneOf(post.format, [
    "text",
    "single_image",
    "carousel",
    "video",
  ] as const);
  const resolvedFormat = format ?? "text";

  const slides = Array.isArray(post.slides)
    ? post.slides
        .map((slide, order) => repairSlide(slide, order))
        .filter((slide): slide is NonNullable<typeof slide> => slide !== null)
    : [];

  return {
    key: str(post.key) ?? `p${index + 1}`,
    dayOffset: clampDay(post.dayOffset, index),
    format: resolvedFormat,
    hookType: oneOf(post.hookType, HOOK_TYPES) ?? "Demo",
    copy: { hook, body, cta: str(copyRaw.cta) ?? null },
    hashtags: Array.isArray(post.hashtags)
      ? post.hashtags
          .map((tag) => str(tag)?.replace(/^#+/, "").trim())
          .filter((tag): tag is string => Boolean(tag))
          .slice(0, 30)
      : [],
    /// 形态与视觉字段必须自洽：模型经常给 text 帖也塞 imagePrompt。
    imagePrompt:
      resolvedFormat === "single_image" ? str(post.imagePrompt) ?? null : null,
    slides: resolvedFormat === "carousel" ? slides : [],
    rationale: str(post.rationale) ?? "补齐本周内容节奏",
  };
}

function repairSlide(raw: unknown, order: number) {
  if (!raw || typeof raw !== "object") return null;
  const slide = raw as Record<string, unknown>;
  const imagePrompt = str(slide.imagePrompt);
  if (!imagePrompt) return null;
  return {
    order: typeof slide.order === "number" ? slide.order : order,
    imagePrompt,
    overlayText: str(slide.overlayText) ?? null,
    purpose: str(slide.purpose) ?? "轮播分屏",
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function oneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : null;
}

function clampDay(value: unknown, index: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(6, Math.max(0, Math.round(value)));
  }
  /// 没给天数就摊开到一周，不要全堆在第 0 天 —— 连续发布才是目标。
  return Math.min(6, index);
}

/**
 * 启发式计划：LLM 不可用时的兜底，也是 repairPlan 的补齐来源。
 *
 * 它刻意写得**具体但通用**：宁可让商家改文案，也不要给一份「敬请期待」式的空壳。
 */
export function heuristicPlan(input: ContentPlanInput): ContentPlan {
  const subject = input.sentence.trim() || "我们的产品";
  const brand = input.brandName?.trim() || "我们";
  const facts = input.productFacts?.filter(Boolean) ?? [];
  const factLine = facts.length ? facts.join("；") : subject;

  const posts: ContentPost[] = [
    {
      key: "p1",
      dayOffset: 0,
      format: "text",
      hookType: "Pain",
      copy: {
        hook: `很多人问我们：${subject}到底怎么挑？`,
        body: `先说最容易踩的坑，再说我们怎么做的。${factLine}`,
        cta: "有具体问题可以直接私信问我们",
      },
      hashtags: ["本地商家", "选购指南"],
      imagePrompt: null,
      slides: [],
      rationale: "先用一条纯文案把最常被问到的问题讲清楚，成本最低、最容易起量",
    },
    {
      key: "p2",
      dayOffset: 2,
      format: "single_image",
      hookType: "Reveal",
      copy: {
        hook: "实拍：装完之后是这个样子",
        body: `${brand}的实际交付效果。${factLine}`,
        cta: "想看你家的效果，把尺寸发给我们",
      },
      hashtags: ["实拍", "交付效果"],
      imagePrompt: `Clean realistic product photograph of ${subject}, natural daylight, real home interior, no text, no watermark`,
      slides: [],
      rationale: "单图帖是最快建立信任的形态：让人看到真东西，而不是听描述",
    },
    {
      key: "p3",
      dayOffset: 4,
      format: "carousel",
      hookType: "Curiosity",
      copy: {
        hook: "从量尺到装好，一共几步？",
        body: `拆开讲清楚每一步，心里有数再决定。${factLine}`,
        cta: "第一步是免费上门量尺，评论区约时间",
      },
      hashtags: ["流程拆解", "本地服务"],
      imagePrompt: null,
      slides: [
        {
          order: 0,
          imagePrompt: `Wide establishing shot of ${subject} in a real home, natural light, no text`,
          overlayText: "第 1 步 · 免费上门量尺",
          purpose: "开场建立场景",
        },
        {
          order: 1,
          imagePrompt: `Close-up detail of ${subject} material and finish, no text`,
          overlayText: "第 2 步 · 选材质与颜色",
          purpose: "展示细节与用料",
        },
        {
          order: 2,
          imagePrompt: `Installation moment for ${subject}, hands working, realistic, no text`,
          overlayText: "第 3 步 · 安装",
          purpose: "证明我们真的做这件事",
        },
        {
          order: 3,
          imagePrompt: `Finished result of ${subject} in the same room, warm light, no text`,
          overlayText: "第 4 步 · 完工",
          purpose: "收尾对比，落到结果",
        },
      ],
      rationale: "轮播能把流程讲完整，是把犹豫的人推向咨询的形态",
    },
    {
      key: "p4",
      dayOffset: 5,
      format: "text",
      hookType: "Stat",
      copy: {
        hook: "上个月最多人选的是这一款",
        body: `真实成交里最常被选的组合，以及为什么。${factLine}`,
        cta: "想知道适不适合你家，报一下窗型",
      },
      hashtags: ["真实数据", "热门选择"],
      imagePrompt: null,
      slides: [],
      rationale: "用真实偏好代替自夸，比形容词有效",
    },
    {
      key: "p5",
      dayOffset: 6,
      format: "video",
      hookType: "Demo",
      copy: {
        hook: "10 秒看完实际使用",
        body: `${subject}真实使用中的样子。`,
        cta: "预约免费上门量尺",
      },
      hashtags: ["实拍视频", "使用演示"],
      imagePrompt: null,
      slides: [],
      rationale: "视频是我们最强的一环，一周收尾用它拿转化",
    },
  ];

  return contentPlanSchema.parse({
    theme: `围绕「${subject}」的一周获客内容`,
    targetAudience: input.industry?.trim()
      ? `正在考虑${input.industry.trim()}的本地客户`
      : "正在比较方案、还没决定的本地客户",
    corePainPoint: "不知道怎么挑、怕挑错、也不知道找谁问",
    posts,
  });
}
