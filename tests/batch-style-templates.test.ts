import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { StyleTemplateStatus } from "@prisma/client";
import {
  BATCH_STYLE_TEMPLATE_SEEDS,
  renderBatchTemplatePrompt,
} from "../src/lib/video-generation/batch-style-templates";
import {
  createStyleTemplateVersion,
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

test("阶段1：初始模板恰好 10 个，slug 唯一且全部为 v1", () => {
  assert.equal(BATCH_STYLE_TEMPLATE_SEEDS.length, 10);
  assert.equal(
    new Set(BATCH_STYLE_TEMPLATE_SEEDS.map((template) => template.slug)).size,
    10,
  );
  assert.ok(BATCH_STYLE_TEMPLATE_SEEDS.every((template) => template.version === 1));
});

test("INV-B1：每个模板都含 IMAGE_REFS、具体镜头/布光/节奏和负面词", () => {
  const cameraWords = /camera|orbit|glide|track|push|slider|zoom|tripod|handheld/i;
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
  }
});

test("INV-B1：prompt 只做确定性模板填空，不留占位符、不调用 LLM", () => {
  const template = BATCH_STYLE_TEMPLATE_SEEDS[0];
  const input = {
    promptSkeleton: template.promptSkeleton,
    imageUrls: ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"],
    productName: "Trail Shoe",
  };
  const first = renderBatchTemplatePrompt(input);
  const second = renderBatchTemplatePrompt(input);

  assert.equal(first, second);
  assert.match(first, /Trail Shoe/);
  assert.match(first, /Image 1: https:\/\/cdn\.test\/a\.jpg/);
  assert.match(first, /Image 2: https:\/\/cdn\.test\/b\.jpg/);
  assert.doesNotMatch(first, /\{IMAGE_REFS\}|\{PRODUCT_NAME\}/);
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

  const template = BATCH_STYLE_TEMPLATE_SEEDS[0];
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
  const template = BATCH_STYLE_TEMPLATE_SEEDS[0];
  const source = {
    id: "tpl_v1",
    slug: template.slug,
    version: 1,
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
    findFirst: (async () => ({ version: 1 })) as never,
    create: (async (args: { data: Record<string, unknown> }) => {
      createData = args.data;
      return { id: "tpl_v2", ...args.data };
    }) as never,
  });

  const created = await createStyleTemplateVersion("tpl_v1", {
    nameZh: "360 慢旋转展示 v2",
  });

  assert.equal(created.version, 2);
  assert.equal(created.status, StyleTemplateStatus.DRAFT);
  assert.equal(created.nameZh, "360 慢旋转展示 v2");
  assert.equal(source.nameZh, template.nameZh, "旧版本不得被修改");
  assert.ok(createData, "必须调用 create 写入新版本");
  assert.equal((createData as Record<string, unknown>).slug, template.slug);
});
