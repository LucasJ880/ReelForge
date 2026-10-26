/**
 * 样片白名单门禁（1025 A6 7.4）：名单里的预览文件必须真实存在，且 jpg / mp4 的
 * md5 两两不同。0803 起首发 8 个 commerce-* 的预览是旧模板预览的逐字节拷贝
 * （16 对文件 md5 相同，「高转化主持带货」挂着一只猫），却一直以「已验收样片」上墙。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  SHOWCASE_SAFE_SLUGS,
  hasVerifiedTemplateVideo,
  verifiedTemplatePreviewSlugs,
  verifiedTemplateSample,
  verifiedTemplateVideo,
} from "../src/lib/video-generation/template-sample";

const PREVIEW_DIR = path.join(process.cwd(), "public/template-previews");

/// 预览与旧模板逐字节相同、1025 撤榜的首发 8 个配方
const DUPLICATED_LEGACY_COMMERCE_SLUGS = [
  "commerce-aesthetic-mood",
  "commerce-ugc-testimonial",
  "commerce-demo-first-reveal",
  "commerce-single-feature-proof",
  "commerce-unboxing-transform",
  "commerce-value-proof",
  "commerce-problem-solution",
  "commerce-hard-sell-presenter",
] as const;

function whitelistedFiles(): string[] {
  const { images, videos } = verifiedTemplatePreviewSlugs();
  return [
    ...images.map((slug) => `${slug}.jpg`),
    ...videos.map((slug) => `${slug}.mp4`),
  ];
}

test("白名单里的每个预览文件都随仓库提交", () => {
  const files = whitelistedFiles();
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(existsSync(path.join(PREVIEW_DIR, file)), `public/template-previews/${file} 不存在`);
  }
});

test("白名单里的预览文件 md5 两两不同（不许拿别的模板的样片冒充）", () => {
  const owners = new Map<string, string>();
  for (const file of whitelistedFiles()) {
    const digest = createHash("md5")
      .update(readFileSync(path.join(PREVIEW_DIR, file)))
      .digest("hex");
    const previous = owners.get(digest);
    assert.equal(previous, undefined, `${file} 与 ${previous} 逐字节相同（md5 ${digest}）`);
    owners.set(digest, file);
  }
});

/// 1026 整合轮：其中 5 个按框架 v2 真机重出并逐条 QA 通过，换上新文件（md5 唯一由上面的门禁保证）；
/// 其余 3 个仍不过检，继续撤榜。
const RESHOT_AND_PASSED_1026 = new Set<string>([
  "commerce-aesthetic-mood",
  "commerce-demo-first-reveal",
  "commerce-single-feature-proof",
  "commerce-problem-solution",
  "commerce-hard-sell-presenter",
]);

test("撤榜的首发 8 个 commerce-*：重出过检的才回榜，其余不再作为已验收样片对外展示", () => {
  for (const slug of DUPLICATED_LEGACY_COMMERCE_SLUGS) {
    if (RESHOT_AND_PASSED_1026.has(slug)) {
      assert.equal(hasVerifiedTemplateVideo(slug), true, slug);
      continue;
    }
    assert.equal(verifiedTemplateSample(slug, `/template-previews/${slug}.jpg`), null, slug);
    assert.equal(verifiedTemplateVideo(slug, `/template-previews/${slug}.mp4`), null, slug);
    assert.equal(hasVerifiedTemplateVideo(slug), false, slug);
  }
});

test("公开面零瑕疵样片必须同时在图片与视频白名单里", () => {
  const { images, videos } = verifiedTemplatePreviewSlugs();
  assert.ok(SHOWCASE_SAFE_SLUGS.length > 0);
  for (const slug of SHOWCASE_SAFE_SLUGS) {
    assert.ok(images.includes(slug), `${slug} 不在图片白名单`);
    assert.ok(videos.includes(slug), `${slug} 不在视频白名单`);
    assert.equal(
      verifiedTemplateVideo(slug, `/template-previews/${slug}.mp4`),
      `/template-previews/${slug}.mp4`,
    );
  }
});
