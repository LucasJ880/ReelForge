import type { GenericShotMotion } from "@/lib/video-generation/generic-shot-policy";

export const COMMERCE_TEMPLATE_SLUGS = [
  "commerce-aesthetic-mood",
  "commerce-ugc-testimonial",
  "commerce-demo-first-reveal",
  "commerce-single-feature-proof",
  "commerce-unboxing-transform",
  "commerce-value-proof",
  "commerce-problem-solution",
  "commerce-hard-sell-presenter",
] as const;

export type CommerceTemplateSlug = (typeof COMMERCE_TEMPLATE_SLUGS)[number];

export type CommerceTemplateRecipe = {
  slug: CommerceTemplateSlug;
  name: string;
  nameZh: string;
  summary: string;
  summaryZh: string;
  hook: string;
  proof: string;
  cta: string;
  motion: GenericShotMotion;
  beats: readonly [string, string, string];
  coverImage: string;
  cameraStyle: string;
  humanInteraction: "none" | "controlled";
};

export const COMMERCE_TEMPLATE_RECIPES: readonly CommerceTemplateRecipe[] = [
  {
    slug: "commerce-aesthetic-mood",
    name: "Aesthetic Mood",
    nameZh: "氛围质感种草",
    summary: "Build desire through material, light, and a clean product hero.",
    summaryZh: "用材质、光线与干净产品英雄镜头建立购买欲。",
    hook: "An arresting texture, silhouette, or lifestyle mood in the first three seconds.",
    proof: "Reveal the exact referenced product through material detail and one stable hero angle.",
    cta: "Finish on an uncluttered product hold that gives the spoken CTA room.",
    motion: "static_product",
    beats: [
      "0-3s HOOK: lead with one premium material or lifestyle mood cue; product identity remains readable.",
      "3-10s PROOF: controlled light travels across the exact referenced surface while the camera makes one gentle push.",
      "10-15s CTA HOLD: clean product hero with strong negative space; no model-rendered text.",
    ],
    coverImage: "/template-previews/commerce-aesthetic-mood.jpg",
    cameraStyle: "slow controlled product dolly, macro-to-medium reveal, stable geometry",
    humanInteraction: "none",
  },
  {
    slug: "commerce-ugc-testimonial",
    name: "UGC Testimonial",
    nameZh: "UGC 真实口碑",
    summary: "A credible first-person reaction followed by visible product proof.",
    summaryZh: "用可信的第一人称体验衔接可见产品证据。",
    hook: "A direct, conversational problem statement or surprising reaction.",
    proof: "Presenter points to one benefit that is visibly supported by the supplied references.",
    cta: "Close with a natural recommendation, not a fabricated review claim.",
    motion: "presenter_point",
    beats: [
      "0-3s HOOK: presenter delivers a concise lived-experience problem beside the product.",
      "3-10s PROOF: presenter points without blocking or operating unverified mechanics; product stays large and consistent.",
      "10-15s CTA HOLD: honest recommendation energy, then product-forward closing frame.",
    ],
    coverImage: "/template-previews/commerce-ugc-testimonial.jpg",
    cameraStyle: "credible phone-camera UGC, restrained handheld texture, stable product framing",
    humanInteraction: "controlled",
  },
  {
    slug: "commerce-demo-first-reveal",
    name: "Demo-First Reveal",
    nameZh: "先演示后揭晓",
    summary: "Open with a verified use result, then reveal how the product delivers it.",
    summaryZh: "先展示可验证的使用结果，再揭示产品如何实现。",
    hook: "Show the outcome or use context immediately without inventing mechanics.",
    proof: "Demonstrate only a state or action visibly supported by the supplied references.",
    cta: "Return to the intact product and one clear reason to try it.",
    motion: "reveal_transition",
    beats: [
      "0-3s HOOK: start on the strongest visibly supported outcome or in-use state.",
      "3-10s PROOF: match cut to the exact referenced product; use only a reference-supported reveal or keep it static.",
      "10-15s CTA HOLD: product hero and concise spoken benefit, with no extra transformation.",
    ],
    coverImage: "/template-previews/commerce-demo-first-reveal.jpg",
    cameraStyle: "result-first match cut, medium proof framing, stable reveal",
    humanInteraction: "controlled",
  },
  {
    slug: "commerce-single-feature-proof",
    name: "Single-Feature Proof",
    nameZh: "单卖点硬证据",
    summary: "Spend the full ad proving one visible feature instead of listing many.",
    summaryZh: "整条广告只证明一个可见卖点，不堆砌功能清单。",
    hook: "A tight visual question focused on one feature.",
    proof: "Use two reference-consistent angles to prove that feature clearly.",
    cta: "End with the feature resolved into a simple buying reason.",
    motion: "static_product",
    beats: [
      "0-3s HOOK: frame one feature as the visual question; keep product identity immediately clear.",
      "3-10s PROOF: two controlled reference angles show the same feature without redesign or unsupported labels.",
      "10-15s CTA HOLD: stable hero shot connects the proof to one spoken buying reason.",
    ],
    coverImage: "/template-previews/commerce-single-feature-proof.jpg",
    cameraStyle: "controlled macro-to-medium proof, precise focus pull, tripod-stable",
    humanInteraction: "none",
  },
  {
    slug: "commerce-unboxing-transform",
    name: "Unboxing Transform",
    nameZh: "开箱场景转化",
    summary: "Turn a clean package reveal into an immediate product-use context.",
    summaryZh: "从干净开箱揭晓快速转入真实产品使用场景。",
    hook: "Package or closed-state anticipation, only when supported by references.",
    proof: "Reveal the exact product and cut to a truthful use context.",
    cta: "Close on the complete product, packaging, and spoken next step.",
    motion: "reveal_transition",
    beats: [
      "0-3s HOOK: supported package or closed-state anticipation; hands remain anatomically controlled.",
      "3-10s PROOF: one clean cut reveals the exact referenced product, followed by a truthful use-context angle.",
      "10-15s CTA HOLD: complete product and package remain consistent in a purchase-ready hero frame.",
    ],
    coverImage: "/template-previews/commerce-unboxing-transform.jpg",
    cameraStyle: "top-down package reveal into stable three-quarter product hero",
    humanInteraction: "controlled",
  },
  {
    slug: "commerce-value-proof",
    name: "Value Proof",
    nameZh: "价值感证明",
    summary: "Translate visible construction and utility into a confident value story.",
    summaryZh: "把可见做工与用途转化为可信的价值叙事。",
    hook: "Contrast a common compromise with the referenced product's visible quality.",
    proof: "Show construction, included parts, capacity, or finish only when visible.",
    cta: "Conclude with durable-value language without unsupported price claims.",
    motion: "static_product",
    beats: [
      "0-3s HOOK: visual contrast establishes the costly compromise without showing a fake competitor.",
      "3-10s PROOF: stable camera inspects visible construction, capacity, finish, or included parts from references.",
      "10-15s CTA HOLD: complete product hero supports a durable-value spoken CTA; no invented price.",
    ],
    coverImage: "/template-previews/commerce-value-proof.jpg",
    cameraStyle: "clean studio inspection, measured orbit, high-clarity value proof",
    humanInteraction: "none",
  },
  {
    slug: "commerce-problem-solution",
    name: "Problem / Solution",
    nameZh: "痛点解决方案",
    summary: "Make the pain legible, show the product as the answer, and hold the result.",
    summaryZh: "先让痛点清晰可感，再让产品作为答案出现并保持结果。",
    hook: "A relatable problem state grounded in the intended use context.",
    proof: "Transition to the product without fabricating a before/after result.",
    cta: "Return to a clear product-and-outcome frame with one next step.",
    motion: "reveal_transition",
    beats: [
      "0-3s HOOK: relatable use-context friction, filmed without a fake competitor or exaggerated failure.",
      "3-10s SOLUTION PROOF: cut to the exact referenced product in the same context; preserve scale and geometry.",
      "10-15s CTA HOLD: resolved context and product stay visible together for the spoken next step.",
    ],
    coverImage: "/template-previews/commerce-problem-solution.jpg",
    cameraStyle: "matched-angle problem/solution cut, stable context continuity",
    humanInteraction: "controlled",
  },
  {
    slug: "commerce-hard-sell-presenter",
    name: "Hard-Sell Presenter",
    nameZh: "高转化主持带货",
    summary: "High-energy direct response with strict product and claim control.",
    summaryZh: "高能直接转化表达，同时严格锁定产品与宣称边界。",
    hook: "Presenter calls out the buyer problem directly in the first beat.",
    proof: "Presenter points to one visible feature or supported use context.",
    cta: "Finish with urgent spoken action while the product owns the frame.",
    motion: "presenter_point",
    beats: [
      "0-3s HOOK: energetic presenter names the buyer problem directly beside the product.",
      "3-10s PROOF: presenter points to one visible feature; never obscures it or invents operation.",
      "10-15s CTA HOLD: presenter clears the center as the exact product fills frame for an urgent spoken action.",
    ],
    coverImage: "/template-previews/commerce-hard-sell-presenter.jpg",
    cameraStyle: "energetic sales gimbal, medium presenter framing, product-dominant close",
    humanInteraction: "controlled",
  },
] as const;

const BY_SLUG = new Map(
  COMMERCE_TEMPLATE_RECIPES.map((recipe) => [recipe.slug, recipe]),
);

export function getCommerceTemplateRecipe(
  slug: string,
): CommerceTemplateRecipe | null {
  return BY_SLUG.get(slug as CommerceTemplateSlug) ?? null;
}

export function commerceTemplateSummary(
  slug: string,
  locale: "zh-CN" | "en-US" = "en-US",
): string | null {
  const recipe = getCommerceTemplateRecipe(slug);
  if (!recipe) return null;
  return locale === "zh-CN" ? recipe.summaryZh : recipe.summary;
}
