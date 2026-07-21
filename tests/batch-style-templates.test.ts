import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { StyleTemplateStatus } from "@prisma/client";
import {
  BATCH_STYLE_TEMPLATE_SEEDS,
  renderBatchTemplatePrompt,
} from "../src/lib/video-generation/batch-style-templates";
import {
  SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY,
  SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS,
} from "../src/lib/video-generation/sunnyshutter-commerce-template";
import {
  activateStyleTemplate,
  createStyleTemplateVersion,
  seedBatchStyleTemplates,
  updateStyleTemplateDraft,
} from "../src/lib/services/style-template-service";
import { db } from "../src/lib/db";

function patchStyleTemplate(
  t: TestContext,
  patches: Record<string, (...args: never[]) => unknown>,
) {
  const model = db.styleTemplate as unknown as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patches)) {
    originals[key] = model[key];
    model[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) model[key] = value;
  });
}

function patchTransaction(
  t: TestContext,
  implementation: (callback: (tx: typeof db) => unknown) => unknown,
) {
  const database = db as unknown as Record<string, unknown>;
  const original = database.$transaction;
  database.$transaction = implementation;
  t.after(() => {
    database.$transaction = original;
  });
}

test("批量风格库仅保留 SunnyShutter 客户模版", () => {
  assert.equal(
    BATCH_STYLE_TEMPLATE_SEEDS.length,
    SUNNYSHUTTER_COMMERCE_TEMPLATE_SEEDS.length,
  );
  assert.ok(BATCH_STYLE_TEMPLATE_SEEDS.length >= 10);
  assert.equal(
    new Set(BATCH_STYLE_TEMPLATE_SEEDS.map((template) => template.slug)).size,
    BATCH_STYLE_TEMPLATE_SEEDS.length,
  );
  assert.ok(
    BATCH_STYLE_TEMPLATE_SEEDS.every(
      (template) =>
        template.category === "SunnyShutter电商" &&
        template.slug.startsWith(`${SUNNYSHUTTER_COMMERCE_TEMPLATE_FAMILY}-`),
    ),
  );
  assert.ok(BATCH_STYLE_TEMPLATE_SEEDS.every((template) => template.version >= 1));
  assert.equal(
    new Set(BATCH_STYLE_TEMPLATE_SEEDS.map((template) => template.promptSkeleton)).size,
    BATCH_STYLE_TEMPLATE_SEEDS.length,
    "每个模板必须是独立镜头方案，不得只换名字",
  );
});

test("INV-B1：每个模板都含 IMAGE_REFS、具体镜头/布光/节奏和负面词", () => {
  const cameraWords = /camera|lens|views?|framed|orbit|glide|track|push|slider|zoom|tripod|handheld/i;
  const lightWords = /light|softbox|daylight|rim|fill|shadow/i;
  const rhythmWords = /pacing|rhythm|cuts?|beat|hold/i;

  for (const template of BATCH_STYLE_TEMPLATE_SEEDS) {
    assert.ok(
      template.promptSkeleton.includes("{IMAGE_REFS}"),
      `${template.slug} 缺 IMAGE_REFS`,
    );
    assert.match(template.promptSkeleton, cameraWords, `${template.slug} 缺镜头语言`);
    assert.match(template.promptSkeleton, lightWords, `${template.slug} 缺布光语言`);
    assert.match(template.promptSkeleton, rhythmWords, `${template.slug} 缺节奏语言`);
    assert.ok(
      template.negativePrompt.split(",").length >= 6,
      `${template.slug} 负面词不够具体`,
    );
    assert.ok(template.imagesPerVideo.min >= 1);
    assert.ok(template.imagesPerVideo.max >= template.imagesPerVideo.min);
    assert.match(template.coverImage, /^\/template-previews\/[a-z0-9-]+\.jpg$/);
    assert.ok(["high", "balanced"].includes(template.lockedParams.stability));
    assert.ok(["none", "controlled"].includes(template.lockedParams.humanInteraction));
    assert.match(template.promptSkeleton, /visual truth/i, `${template.slug} 缺参考图真实性锁`);
    assert.match(template.promptSkeleton, /Never invent/i, `${template.slug} 缺禁止脑补护栏`);
  }
});

test("INV-B1：prompt 只做确定性模板填空，不留占位符、不调用 LLM", () => {
  const template = BATCH_STYLE_TEMPLATE_SEEDS[0]!;
  const input = {
    promptSkeleton: template.promptSkeleton,
    imageUrls: ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"],
    productName: "Trail Shoe",
  };
  const first = renderBatchTemplatePrompt(input);
  const second = renderBatchTemplatePrompt(input);

  assert.equal(first, second);
  assert.match(first, /Trail Shoe/);
  // 参考图走 API input_images 字段；提示词只放位置标签，不放 URL
  // （URL 会把 SunnyShutter 骨架顶破合作方 5000 字符上限）。
  assert.match(first, /input_images\[1\], input_images\[2\]/);
  assert.doesNotMatch(first, /https:\/\/cdn\.test/);
  assert.doesNotMatch(first, /\{IMAGE_REFS\}|\{PRODUCT_NAME\}/);
});

test("SunnyShutter 模版 × 产品输入形成确定性质量锁定矩阵", () => {
  const representativeProducts = Array.from({ length: 20 }, (_, index) => ({
    name: `Reference Product ${String(index + 1).padStart(2, "0")}`,
    imageUrls: Array.from(
      { length: 5 },
      (_, imageIndex) =>
        `https://assets.example.test/products/${index + 1}/view-${imageIndex + 1}.jpg`,
    ),
  }));
  const rendered = new Set<string>();

  for (const template of BATCH_STYLE_TEMPLATE_SEEDS) {
    for (const product of representativeProducts) {
      const imageUrls = product.imageUrls.slice(0, template.imagesPerVideo.min);
      const input = {
        promptSkeleton: template.promptSkeleton,
        imageUrls,
        productName: product.name,
      };
      const first = renderBatchTemplatePrompt(input);
      const second = renderBatchTemplatePrompt(input);

      assert.equal(first, second, `${template.slug} 渲染必须确定性`);
      assert.doesNotMatch(first, /\{[A-Z_]+\}/, `${template.slug} 不得遗留占位符`);
      assert.match(first, /visual truth/i, `${template.slug} 必须保留真实性锁`);
      assert.match(first, /Never invent/i, `${template.slug} 必须保留禁止脑补护栏`);
      assert.match(first, new RegExp(product.name), `${template.slug} 必须绑定产品名`);
      assert.equal(
        (first.match(/input_images\[\d+\]/g) ?? []).length,
        imageUrls.length,
        `${template.slug} 必须逐张绑定参考图`,
      );
      // 合作方线路硬上限 5000；渲染后必须留有余量（参考图不再占用 URL 长度）。
      assert.ok(first.length >= 700 && first.length <= 5_000, `${template.slug} prompt 长度异常: ${first.length}`);
      rendered.add(first);
    }
  }

  assert.equal(
    rendered.size,
    BATCH_STYLE_TEMPLATE_SEEDS.length * representativeProducts.length,
    "模板 × 产品矩阵不得发生 prompt 碰撞",
  );
});

test("INV-B1：缺 IMAGE_REFS 的非法模板拒绝生成", () => {
  assert.throws(
    () =>
      renderBatchTemplatePrompt({
        promptSkeleton: "A product shot",
        imageUrls: ["https://cdn.test/a.jpg"],
      }),
    /IMAGE_REFS/,
  );
});

test("AC-B8：尝试修改 ACTIVE 模板被拒绝，未发生 update", async (t) => {
  let updateCalls = 0;
  patchStyleTemplate(t, {
    findUnique: (async () => ({
      id: "tpl_active",
      status: StyleTemplateStatus.ACTIVE,
    })) as never,
    update: (async () => {
      updateCalls++;
      return {};
    }) as never,
  });

  const template = BATCH_STYLE_TEMPLATE_SEEDS[0]!;
  await assert.rejects(
    () =>
      updateStyleTemplateDraft("tpl_active", {
        name: template.name,
        nameZh: "试图篡改",
        category: template.category,
        coverImage: template.coverImage,
        promptSkeleton: template.promptSkeleton,
        negativePrompt: template.negativePrompt,
        lockedParams: template.lockedParams,
        imagesPerVideo: template.imagesPerVideo,
      }),
    /ACTIVE_TEMPLATE_IMMUTABLE/,
  );
  assert.equal(updateCalls, 0);
});

test("AC-B8：发新版本创建 DRAFT，旧 ACTIVE 版本保持原值", async (t) => {
  const template = BATCH_STYLE_TEMPLATE_SEEDS[0]!;
  const source = {
    id: "tpl_v1",
    slug: template.slug,
    version: 2,
    name: template.name,
    nameZh: template.nameZh,
    category: template.category,
    coverImage: template.coverImage,
    promptSkeleton: template.promptSkeleton,
    negativePrompt: template.negativePrompt,
    lockedParams: template.lockedParams,
    imagesPerVideo: template.imagesPerVideo,
    status: StyleTemplateStatus.ACTIVE,
  };
  let createData: Record<string, unknown> | null = null;
  patchStyleTemplate(t, {
    findUnique: (async () => ({ ...source })) as never,
    findFirst: (async () => ({ version: 2 })) as never,
    create: (async (args: { data: Record<string, unknown> }) => {
      createData = args.data;
      return { id: "tpl_v2", ...args.data };
    }) as never,
  });

  const created = await createStyleTemplateVersion("tpl_v1", {
    nameZh: `${template.nameZh} v2`,
  });

  assert.equal(created.version, 3);
  assert.equal(created.status, StyleTemplateStatus.DRAFT);
  assert.equal(created.nameZh, `${template.nameZh} v2`);
  assert.equal(source.nameZh, template.nameZh, "旧版本不得被修改");
  assert.ok(createData, "必须调用 create 写入新版本");
  assert.equal((createData as Record<string, unknown>).slug, template.slug);
});

test("Phase2：重复 seed 不新增已存在版本；并归档库外 ACTIVE", async (t) => {
  let updateManyCalls = 0;
  let createCalls = 0;
  let archivedOutsideLibrary = false;
  patchStyleTemplate(t, {
    findUnique: (async () => ({ id: "existing-v2" })) as never,
    updateMany: (async (args: { where: Record<string, unknown> }) => {
      updateManyCalls++;
      if (
        args.where &&
        typeof args.where === "object" &&
        "slug" in args.where &&
        (args.where.slug as { notIn?: string[] } | undefined)?.notIn
      ) {
        archivedOutsideLibrary = true;
      }
      return { count: 0 };
    }) as never,
    create: (async () => {
      createCalls++;
      return {};
    }) as never,
  });
  patchTransaction(t, async (callback) => callback(db));

  const created = await seedBatchStyleTemplates();

  assert.equal(created, 0);
  assert.equal(createCalls, 0);
  assert.ok(updateManyCalls >= 1, "应尝试归档库外 ACTIVE");
  assert.ok(archivedOutsideLibrary, "归档条件应使用 slug notIn keepSlugs");
});

test("Phase2：激活新版本时只归档同 slug 的旧 ACTIVE", async (t) => {
  const template = BATCH_STYLE_TEMPLATE_SEEDS[0]!;
  const draft = {
    id: "tpl_v3",
    slug: template.slug,
    version: 3,
    name: template.name,
    nameZh: template.nameZh,
    category: template.category,
    coverImage: template.coverImage,
    promptSkeleton: template.promptSkeleton,
    negativePrompt: template.negativePrompt,
    lockedParams: template.lockedParams,
    imagesPerVideo: template.imagesPerVideo,
    status: StyleTemplateStatus.DRAFT,
  };
  let archivedWhere: Record<string, unknown> | null = null;
  let activatedData: Record<string, unknown> | null = null;
  patchStyleTemplate(t, {
    findUnique: (async () => ({ ...draft })) as never,
    updateMany: (async (args: { where: Record<string, unknown> }) => {
      archivedWhere = args.where;
      return { count: 1 };
    }) as never,
    update: (async (args: { data: Record<string, unknown> }) => {
      activatedData = args.data;
      return { ...draft, ...args.data };
    }) as never,
  });
  patchTransaction(t, async (callback) => callback(db));

  const activated = await activateStyleTemplate(draft.id);

  assert.equal(activated.status, StyleTemplateStatus.ACTIVE);
  assert.deepEqual(archivedWhere, {
    slug: template.slug,
    status: StyleTemplateStatus.ACTIVE,
    id: { not: draft.id },
  });
  assert.ok(activatedData, "必须写入激活状态");
  const activation = activatedData as unknown as {
    status: StyleTemplateStatus;
    activatedAt: Date;
  };
  assert.equal(activation.status, StyleTemplateStatus.ACTIVE);
  assert.ok(activation.activatedAt instanceof Date);
});
