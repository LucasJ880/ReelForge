/**
 * 爆款风格模版（爆款广告分类）demo 安全性测试 —— heuristic 模式（LLM forced mock）。
 *
 * 目标：CEO 在前端选任意爆款模版 → plan → dispatch 的链路不允许出现
 * blocker / 空 prompt / 品牌守卫失效。这是现场 demo 的最低保障线。
 */
process.env.LLM_FORCE_MOCK = "true";

import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSISTENCY_LOCKS,
  STYLE_TEMPLATES,
  STYLE_TEMPLATE_CATEGORIES,
  getStyleTemplate,
} from "../src/lib/video-generation/style-templates";
import { buildPlan } from "../src/lib/video-generation/generation-supervisor";
import type {
  UnifiedVideoGenerationRequest,
  UploadedAsset,
} from "../src/types/video-generation";

const viralTemplates = STYLE_TEMPLATES.filter((t) => t.viral);

test("[viral-templates] 爆款广告分类存在且至少 4 个模版全部打上 viral+featured", () => {
  assert.ok(STYLE_TEMPLATE_CATEGORIES.includes("爆款广告"));
  assert.ok(viralTemplates.length >= 4, `viral 模版只有 ${viralTemplates.length} 个`);
  for (const t of viralTemplates) {
    assert.equal(t.category, "爆款广告", `${t.id} 分类错误`);
    assert.equal(t.featured, true, `${t.id} 未标 featured（爆款必须优先推荐）`);
  }
});

test("[viral-templates] 模版库 id 全局唯一且 getStyleTemplate 可取回", () => {
  const ids = STYLE_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "存在重复模版 id");
  for (const t of STYLE_TEMPLATES) {
    assert.equal(getStyleTemplate(t.id)?.name, t.name);
  }
});

test("[viral-templates] scaffold 完整：styleKeywords/cameraLanguage/shotPattern 非空", () => {
  for (const t of STYLE_TEMPLATES) {
    assert.ok(t.scaffold.styleKeywords.trim().length > 20, `${t.id} styleKeywords 过短`);
    assert.ok(t.scaffold.cameraLanguage.trim().length > 5, `${t.id} cameraLanguage 过短`);
    assert.ok(t.scaffold.shotPattern.includes("→"), `${t.id} shotPattern 缺少分镜结构`);
    assert.ok(t.samplePrompt.trim().length >= 10, `${t.id} samplePrompt 过短`);
  }
});

function curtainRequest(styleTemplateId: string): UnifiedVideoGenerationRequest {
  const productImages: UploadedAsset[] = [1, 2].map((i) => ({
    id: `curtain_${i}`,
    type: "IMAGE",
    inferredRole: "product_image",
    roleConfidence: 0.9,
    url: `https://example.com/curtain-${i}.png`,
    mimeType: "image/png",
    fileName: `curtain-${i}.png`,
    width: 768,
    height: 1024,
  }));
  return {
    userType: "personal",
    rawPrompt: "15秒窗帘产品广告：突出遮光效果与高级质感，真实家居场景。",
    attachments: productImages,
    selectedDuration: 15,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "none",
    platform: "tiktok",
    language: "zh-CN",
    styleTemplateId,
    consistencyLockIds: CONSISTENCY_LOCKS.map((l) => l.id),
  };
}

test("[viral-templates] 每个爆款模版走完整 buildPlan → canDispatch 且 prompt 合规", async () => {
  for (const tpl of viralTemplates) {
    const plan = await buildPlan(curtainRequest(tpl.id));
    assert.equal(
      plan.qualityReview.canDispatch,
      true,
      `${tpl.id} 出现 blocker: ${JSON.stringify(plan.qualityReview.blockers)}`,
    );
    const aiSegs = plan.segments.filter((s) => s.type === "ai_generated_clip");
    assert.ok(aiSegs.length >= 1, `${tpl.id} 没有 AI 段`);
    for (const sp of plan.seedancePrompts) {
      assert.ok(sp.prompt.trim().length > 100, `${tpl.id} prompt 过短`);
      assert.doesNotMatch(sp.prompt, /https?:\/\//, `${tpl.id} prompt 泄漏 URL`);
      assert.ok(sp.negativePrompt.includes("no logo"), `${tpl.id} 品牌守卫缺失`);
      /// 窗帘产品图必须作为参考图带上（Omni-Reference 锚定）
      assert.ok(sp.referenceImageUrls.length >= 2, `${tpl.id} 参考图未带上`);
    }
  }
});
