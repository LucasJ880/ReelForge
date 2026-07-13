import type {
  BatchStyleTemplateSeed,
  BatchStyleLockedParams,
} from "@/lib/video-generation/batch-style-templates";

type Blueprint = {
  slug: string;
  name: string;
  nameZh: string;
  category: string;
  coverImage: string;
  direction: string;
  negativePrompt: string;
  lockedParams: BatchStyleLockedParams;
  imagesPerVideo: { min: number; max: number };
};

const FIDELITY_GUARD =
  "Use only the supplied product reference images as visual truth. Preserve exact product geometry, count, color, material, packaging, logos, label placement and proportions in every frame. Never invent an unseen side, feature, accessory, claim or text. Keep the product identity, scene layout, light direction and contact shadow continuous. Any hand interaction must be anatomically plausible and may not hide defining product features.";

const BLUEPRINTS: Blueprint[] = [
  {
    slug: "locked-hero-push", name: "Locked Hero Push-In", nameZh: "锁定主体缓推", category: "电商展示", coverImage: "/template-previews/white-studio-standard.jpg",
    direction: "Keep the product fixed on a grounded studio surface while the camera performs one slow centered push-in from medium shot to hero close-up. Use a large diffused key above camera, soft side fill and one stable contact shadow with neutral color rendering. Use a single continuous shot, constant focal length and a two-second final hold; never reveal an unreferenced side.",
    negativePrompt: "product rotation, geometry drift, scale change, floating object, sliding product, invented rear view, label mutation, logo mutation, focus pumping, camera shake, generated text",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "centered precision dolly-in", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 1, max: 2 },
  },
  {
    slug: "evidence-angle-triptych", name: "Evidence Angle Triptych", nameZh: "三视角证据展示", category: "电商展示", coverImage: "/template-previews/slow-360-orbit.jpg",
    direction: "Show exactly three reference-supported views: front three-quarter, side detail and top detail, each framed on the same pedestal without rotating beyond supplied evidence. Maintain identical softbox placement, white balance, lens height and product scale across the three shots. Use clean straight cuts, three-second holds and no transitional morphing.",
    negativePrompt: "invented angle, invented underside, product morphing, scale mismatch, moving pedestal, label mutation, duplicate product, discontinuous lighting, transition smear, generated text",
    lockedParams: { duration: 10, aspectRatio: "1:1", resolution: "1080p", cameraStyle: "locked three-view catalog camera", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 3, max: 4 },
  },
  {
    slug: "top-down-flatlay-proof", name: "Top-Down Flatlay Proof", nameZh: "俯拍平铺陈列", category: "电商展示", coverImage: "/template-previews/rhythmic-unboxing.jpg",
    direction: "Arrange only the referenced product and referenced accessories in a clean top-down flatlay; all items remain fixed while the camera makes a subtle vertical descent. Use broad overhead diffusion, restrained side fill and crisp soft contact shadows that preserve exact colors. Keep one stable composition for the full clip with a gentle detail move and return to the original frame.",
    negativePrompt: "invented accessories, duplicate pieces, teleporting objects, rearranged labels, warped packaging, incorrect count, floating items, perspective drift, motion smear, generated text",
    lockedParams: { duration: 10, aspectRatio: "1:1", resolution: "1080p", cameraStyle: "locked overhead micro-dolly", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "packaging-lineup", name: "Packaging Lineup", nameZh: "包装与产品列阵", category: "包装展示", coverImage: "/template-previews/white-studio-standard.jpg",
    direction: "Build a centered lineup using only packaging and product units explicitly present in the references, keeping relative scale and count exact. Use a low lateral slider move, even catalog softboxes and a narrow rim light that separates every silhouette without changing printed artwork. Move slowly from package to product and finish on the unchanged complete lineup.",
    negativePrompt: "invented box, incorrect count, duplicate unit, label rewrite, logo mutation, packaging deformation, scale mismatch, floating object, parallax warp, generated text",
    lockedParams: { duration: 10, aspectRatio: "16:9", resolution: "1080p", cameraStyle: "low catalog slider", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "feature-detail-triad", name: "Feature Detail Triad", nameZh: "三段细节证明", category: "质感特写", coverImage: "/template-previews/macro-material-study.jpg",
    direction: "Select three visible reference-backed details and film each with one controlled macro move: surface, construction and functional edge. Keep the same dark neutral set, grazing strip light and stable material response so the details read as one product. Use three deliberate cuts with no speed ramp, then resolve to the supplied hero view.",
    negativePrompt: "invented feature, fake seam, altered texture, waxy material, melted edge, changing color, focus pumping, label mutation, excessive bloom, generated text",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "three locked macro passes", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 3, max: 5 },
  },
  {
    slug: "one-action-proof", name: "One Action Proof", nameZh: "单动作功能证明", category: "使用演示", coverImage: "/template-previews/lifestyle-use-demo.jpg",
    direction: "Demonstrate exactly one visible and reference-supported use action from start to finish, with the product staying fully readable and the hand entering only when required. Use an eye-level locked camera, soft directional daylight and realistic contact forces with no object teleportation. Hold before, action and result as three clear beats; do not imply capabilities not visible in the references.",
    negativePrompt: "invented function, extra fingers, fused hand, impossible grip, hidden product, geometry drift, duplicate object, discontinuous action, liquid error, generated text",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "locked proof demonstration", stability: "high", humanInteraction: "controlled" }, imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "skincare-counter-ritual", name: "Skincare Counter Ritual", nameZh: "护肤台面仪式感", category: "美妆护理", coverImage: "/template-previews/dark-luxury-lighting.jpg",
    direction: "Place the referenced skincare product on a clean warm stone counter, begin with a still hero, let one hand lift and return it once, then finish on a macro package detail. Use diffused window light, soft warm bounce and controlled highlights that keep container color and label unchanged. Slow ritual pacing, no face, no application claim and no generated liquid unless supplied.",
    negativePrompt: "face transformation, skin claim, invented liquid, extra fingers, deformed hand, label mutation, container morphing, duplicate bottle, wet text, generated text",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "calm vanity slider", stability: "high", humanInteraction: "controlled" }, imagesPerVideo: { min: 2, max: 3 },
  },
  {
    slug: "jewelry-facet-light", name: "Jewelry Facet Light", nameZh: "珠宝切面光影", category: "奢品", coverImage: "/template-previews/dark-luxury-lighting.jpg",
    direction: "Keep the jewelry fixed on a dark matte stand while a narrow light source moves slowly to reveal only reference-visible facets, settings and engravings. Use a macro lens, black flags and restrained point highlights without adding stones or changing metal color. One continuous five-degree camera arc and a long final hold prioritize exact geometry over sparkle volume.",
    negativePrompt: "extra gemstone, missing gemstone, altered setting, melted metal, fake engraving, floating jewelry, excessive sparkle, chromatic flare, focus pumping, generated text",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "micro arc with moving light", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "apparel-fabric-motion", name: "Apparel Fabric Motion", nameZh: "服装面料动态", category: "服饰穿搭", coverImage: "/template-previews/macro-material-study.jpg",
    direction: "Show the garment on a neutral torso or hanger matching the supplied view, with one gentle side-to-side fabric movement and one close detail of weave or seam. Use broad soft fashion lighting, stable garment color and fixed camera height; preserve cut, hem, print placement and fasteners exactly. Keep motion slow with no body turn that reveals an unseen rear.",
    negativePrompt: "changed garment cut, invented rear, altered print, warped seam, extra sleeve, missing fastener, body deformation, color shift, cloth melting, generated text",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "locked fashion medium and detail", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "footwear-grounded-steps", name: "Footwear Grounded Steps", nameZh: "鞋履落地步态", category: "服饰穿搭", coverImage: "/template-previews/street-style-placement.jpg",
    direction: "Frame only the lower leg and referenced footwear for two slow grounded steps on a clean surface, followed by a static side-detail close-up supported by the references. Use soft outdoor shade, realistic sole contact and consistent shoe shape through each step. Track parallel at ankle height with no jump, turn or sole reveal unless that view is supplied.",
    negativePrompt: "extra foot, fused legs, altered sole, invented tread, shoe morphing, floating step, wrong pair count, label mutation, background wobble, generated text",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "ankle-height parallel gimbal", stability: "balanced", humanInteraction: "controlled" }, imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "furniture-room-anchor", name: "Furniture Room Anchor", nameZh: "家具空间定锚", category: "家居空间", coverImage: "/template-previews/before-after-reversal.jpg",
    direction: "Anchor the referenced furniture in one believable room position, starting from a wide view and making a slow straight push to a three-quarter detail without moving or resizing the product. Use directional window light, stable wall geometry and accurate floor contact shadows. Preserve room layout and perspective for the full shot; do not generate an unseen back or openable part.",
    negativePrompt: "room geometry drift, furniture morphing, wrong scale, floating legs, changing upholstery, invented drawer, duplicate furniture, warped walls, sliding object, generated text",
    lockedParams: { duration: 15, aspectRatio: "16:9", resolution: "1080p", cameraStyle: "straight architectural dolly", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "home-decor-daylight", name: "Home Decor Daylight", nameZh: "家饰自然光氛围", category: "家居空间", coverImage: "/template-previews/lifestyle-use-demo.jpg",
    direction: "Place the referenced decor item in a restrained shelf or tabletop vignette and keep every object fixed while daylight changes only slightly across the surface. Use a locked three-quarter frame, warm bounce and one slow rack focus from environment to product. Maintain exact product scale, texture and silhouette; no seasonal props or decorations unless supplied.",
    negativePrompt: "invented decor, product morphing, moving props, scale drift, color shift, fake texture, warped shelf, lighting flicker, excessive bokeh, generated text",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "locked vignette rack focus", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 1, max: 3 },
  },
  {
    slug: "food-table-hero", name: "Food Table Hero", nameZh: "食品餐桌主视觉", category: "食品饮料", coverImage: "/template-previews/white-studio-standard.jpg",
    direction: "Present only the referenced packaged food and visible serving suggestion on a clean tabletop, with a slow lateral move and one macro texture insert. Use warm side light, soft fill and realistic food color without changing quantity, package artwork or ingredient appearance. Keep the arrangement fixed and avoid generated steam, melting or cutting unless explicitly shown.",
    negativePrompt: "invented ingredient, changed serving size, fake steam, melting food, package mutation, label rewrite, duplicate portion, floating crumbs, color exaggeration, generated text",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "warm tabletop slider", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "beverage-cold-hero", name: "Beverage Cold Hero", nameZh: "饮品冰感主视觉", category: "食品饮料", coverImage: "/template-previews/dark-luxury-lighting.jpg",
    direction: "Keep the referenced beverage container upright and stationary while a narrow cold rim light traces its silhouette and the camera makes one slow low-angle push. Use controlled condensation only if visible in the references, stable label readability and a realistic grounded reflection. Finish on the supplied hero angle; no opening, pouring, splashing or flavor ingredients unless supplied.",
    negativePrompt: "invented condensation, pouring liquid, splash, flavor fruit, label mutation, can deformation, duplicate container, floating bottle, excessive reflection, generated text",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "low cold-light dolly", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 1, max: 3 },
  },
  {
    slug: "electronics-control-proof", name: "Electronics Control Proof", nameZh: "电子产品操作证明", category: "科技数码", coverImage: "/template-previews/macro-material-study.jpg",
    direction: "Start on a clean three-quarter electronics hero view, move to one reference-visible control, and show a single finger pressing or adjusting it once without inventing a screen result. Use cool softbox key, restrained rim light and stable display, port and button geometry. Keep the camera locked during interaction and end on the unchanged hero frame.",
    negativePrompt: "invented interface, screen text, extra port, missing button, extra finger, fused hand, product morphing, glowing logo, electrical spark, generated text",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "precision product and control insert", stability: "high", humanInteraction: "controlled" }, imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "tool-workbench-proof", name: "Tool Workbench Proof", nameZh: "工具台功能证明", category: "工具户外", coverImage: "/template-previews/lifestyle-use-demo.jpg",
    direction: "Place the referenced tool on a tidy workbench, show one supported grip and one low-risk functional movement, then return it to the original position. Use directional workshop soft light, realistic weight and contact, and stable tool geometry with no sparks, debris or performance claim. Film from a fixed side angle with one close detail cut and clear action continuity.",
    negativePrompt: "unsafe use, invented attachment, sparks, flying debris, extra fingers, impossible grip, tool morphing, duplicate tool, label mutation, generated text",
    lockedParams: { duration: 15, aspectRatio: "16:9", resolution: "1080p", cameraStyle: "fixed workbench proof camera", stability: "high", humanInteraction: "controlled" }, imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "travel-pack-sequence", name: "Travel Pack Sequence", nameZh: "旅行收纳步骤", category: "旅行收纳", coverImage: "/template-previews/rhythmic-unboxing.jpg",
    direction: "Show a three-step packing sequence using only the referenced bag, compartments and included items: empty view, one controlled placement, closed hero view. Use a locked top-down camera, broad daylight-balanced softbox and consistent item count and position between cuts. Keep hands at frame edges and never reveal an unreferenced compartment, capacity or hidden feature.",
    negativePrompt: "invented compartment, impossible capacity, duplicate item, disappearing object, extra fingers, zipper deformation, bag morphing, wrong count, jump discontinuity, generated text",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "locked overhead packing steps", stability: "high", humanInteraction: "controlled" }, imagesPerVideo: { min: 3, max: 5 },
  },
  {
    slug: "same-frame-comparison", name: "Same-Frame Comparison", nameZh: "同机位对比证明", category: "对比转化", coverImage: "/template-previews/before-after-reversal.jpg",
    direction: "Use one locked camera and one unchanged environment to show a reference-supported baseline, one product action and the resulting state; keep framing and object positions directly comparable. Use neutral light for baseline and slightly warmer fill for the result without altering geometry or adding effects. Make three straight cuts with no split-screen labels, generated claims or exaggerated transformation.",
    negativePrompt: "fake result, exaggerated transformation, camera drift, room geometry change, duplicate product, extra fingers, random text, split-screen label, glow effect, generated text",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "locked evidence comparison", stability: "high", humanInteraction: "controlled" }, imagesPerVideo: { min: 2, max: 4 },
  },
  {
    slug: "gift-ready-reveal", name: "Gift-Ready Reveal", nameZh: "礼赠包装揭示", category: "包装展示", coverImage: "/template-previews/rhythmic-unboxing.jpg",
    direction: "Show the reference-supplied gift packaging closed, one controlled opening action, and the exact product arrangement inside without adding ribbon, cards or accessories. Use warm overhead diffusion, subtle side sparkle and stable packaging artwork throughout. Keep the camera locked at three-quarter height, hands minimal and pacing calm with a long final reveal hold.",
    negativePrompt: "invented gift wrap, invented card, extra accessory, impossible box fold, extra fingers, package mutation, logo rewrite, duplicate product, teleporting lid, generated text",
    lockedParams: { duration: 15, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "locked gift reveal camera", stability: "high", humanInteraction: "controlled" }, imagesPerVideo: { min: 3, max: 5 },
  },
  {
    slug: "seamless-product-loop", name: "Seamless Product Loop", nameZh: "无缝循环主视觉", category: "社媒循环", coverImage: "/template-previews/slow-360-orbit.jpg",
    direction: "Create a seamless product loop using one reference-supported three-quarter view: the camera performs a very small arc and returns exactly to its starting position while the product remains fixed. Use stable soft studio lighting, constant exposure and an unchanged contact shadow so first and last frames match. No cuts, no hand interaction, no transformation and no reveal beyond supplied evidence.",
    negativePrompt: "loop jump, product rotation, geometry drift, changing shadow, exposure flicker, focus pumping, floating object, invented rear view, label mutation, generated text",
    lockedParams: { duration: 5, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "closed micro-arc loop", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 1, max: 2 },
  },
  {
    slug: "clean-color-block", name: "Clean Color Block", nameZh: "品牌色块陈列", category: "社媒循环", coverImage: "/template-previews/fast-commerce-beats.jpg",
    direction: "Place the fixed product against one simple warm color-block set derived from the product palette, using only two geometric planes and no text or logos in the environment. Make one slow lateral camera slide with consistent soft key and rim light while product color remains exact. End on the same scale and angle shown in the primary reference with no animated props.",
    negativePrompt: "generated slogan, random logo, changing background geometry, product recolor, floating object, duplicate product, label mutation, animated prop, harsh gradient, generated text",
    lockedParams: { duration: 10, aspectRatio: "9:16", resolution: "1080p", cameraStyle: "controlled color-set slider", stability: "high", humanInteraction: "none" }, imagesPerVideo: { min: 1, max: 3 },
  },
];

export const EXPANDED_BATCH_STYLE_TEMPLATE_SEEDS: BatchStyleTemplateSeed[] =
  BLUEPRINTS.map(({ direction, ...blueprint }) => ({
    ...blueprint,
    version: 1,
    promptSkeleton:
      `${FIDELITY_GUARD} Product: {PRODUCT_NAME}. References: {IMAGE_REFS}. ${direction} Keep every camera move inside the referenced viewing envelope. Use restrained pacing with readable holds; fidelity always overrides spectacle.`,
  }));
