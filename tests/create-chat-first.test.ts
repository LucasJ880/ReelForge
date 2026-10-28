import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoryboardWorkflowPanel } from "../src/components/video-generation/storyboard-workflow-panel";
import { buildStoryboardFramePlans } from "../src/lib/video-generation/storyboard-service";
import { customerVisibleFramePrompt } from "../src/lib/video-generation/storyboard-prompt-display";

/**
 * 创作页对话框优先（2026-10-28 晚，上线审核 §3–§4，学 Runway / LibTV 工作台首屏）：
 * 一句轻标题 + 一张提示卡（素材 · 描述 · 帮我写 · 主按钮），规格芯片在卡下，口播 / 字幕 / 参考方式收进「更多设置」；
 * 故事板每帧可「查看提示词」，回应 CEO「同行把提示词给用户看」又不把写提示词的负担转给商家。
 */

const STUDIO = "src/components/video-generation/streamlined-video-studio.tsx";
const PANEL = "src/components/video-generation/storyboard-workflow-panel.tsx";

function sliceFunction(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const end = source.indexOf("\n  }\n", start);
  return source.slice(start, end);
}

test("帮我写：只送素材 id 与商家已写的字；写好才替换描述，失败保留原字", async () => {
  const studio = await readFile(STUDIO, "utf8");
  const draft = sliceFunction(studio, "async function draftPrompt()");
  assert.match(draft, /fetch\("\/api\/video-generation\/prompt-draft"/);
  assert.match(draft, /assetIds: productAssets\.map\(\(asset\) => asset\.assetId \?\? asset\.id\)\.slice\(0, 6\)/);
  assert.match(draft, /hint: hint \|\| null/);
  assert.doesNotMatch(draft, /url:|imageUrls/, "图片地址由服务端按属主解析，前端不送 URL");
  /// setRawPrompt 只出现在成功分支
  assert.equal((draft.match(/setRawPrompt\(/g) ?? []).length, 1);
  assert.match(draft, /if \(response\.ok && payload\?\.description\) \{\s*setRawPrompt\(payload\.description\);\s*invalidatePlan\(\);/);
  assert.match(draft, /finally \{\s*setDraftingPrompt\(false\);/);
  /// 写的过程中输入框与主按钮都锁住
  assert.match(studio, /disabled=\{locked \|\| draftingPrompt\}/);
  assert.match(studio, /&& uploadingTarget === null\s*&& !draftingPrompt\s*&& selectedRouteAvailable === true;/);
  assert.match(studio, /helpPolish: "帮我润色"/);
});

test("主按钮只有一枚：没有故事板时在提示卡里，有故事板时在故事板下的贴底操作条里", async () => {
  const studio = await readFile(STUDIO, "utf8");
  assert.equal((studio.match(/id="platform-primary-generate"/g) ?? []).length, 1);
  assert.equal((studio.match(/data-testid="streamlined-generate-bar"/g) ?? []).length, 1);
  assert.match(studio, /\{!storyboard \? generateBar : null\}/);
  const storyboardSection = studio.slice(studio.indexOf('<div id="single-video-storyboard"'));
  assert.match(storyboardSection, /sticky bottom-20 z-10[\s\S]*?\{statusNotices\}[\s\S]*?\{generateBar\}/);
  /// 每一轮都能退出：错误框与故事板下面都有「取消这一轮」
  assert.ok((studio.match(/onClick=\{\(\) => void cancelCurrentRound\(\)\}/g) ?? []).length >= 2);
});

test("模板芯片取代快速 / 高级生成；更多设置收起时也保持挂载（线路可用性检查照常跑）", async () => {
  const studio = await readFile(STUDIO, "utf8");
  assert.doesNotMatch(studio, /<OptionButton[\s\S]{0,80}title=\{copy\.quick\}/);
  assert.match(studio, /value=\{activeStyleTemplateId\}[\s\S]{0,200}onChange=\{\(value\) => \{\s*setCreationMode\("advanced"\);\s*setStyleTemplateId\(value\);\s*invalidatePlan\(\);/);
  assert.match(studio, /data-testid="streamlined-generation-mode"/);
  assert.match(studio, /id="streamlined-more-settings"\s+hidden=\{!moreOpen\}/);
  assert.match(studio, /aria-controls="streamlined-more-settings"/);
  /// 透明原生下拉铺满芯片：点哪里都能打开，键盘与读屏不用另做
  assert.match(studio, /className="absolute inset-0 cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"/);
  /// 示例描述换成真实商品的说法（原来是浴室 UGC 的长句）
  assert.match(studio, /promptPlaceholder: "例：把这只保温杯拍成通勤广告/);
  assert.doesNotMatch(studio, /明亮浴室/);
});

test("拖进提示卡：有图当商品图（满了转参考），只有视频进参考；上传中 / 锁定时不接", async () => {
  const studio = await readFile(STUDIO, "utf8");
  const drop = sliceFunction(studio, "function dropFiles(files: File[])");
  assert.match(drop, /if \(images\.length > 0 && !productSlotsFull\) \{\s*void uploadProductImages\(images\);\s*return;\s*\}\s*void uploadReferenceAssets\(files\);/);
  assert.match(studio, /if \(attachDisabled \|\| !event\.dataTransfer\.types\.includes\("Files"\)\) return;/);
});

test("查看提示词：原文照给，只去掉供应商模型名", async () => {
  assert.equal(
    customerVisibleFramePrompt("Create ONE photorealistic commercial storyboard keyframe with GPT Image 2: a single shot."),
    "Create ONE photorealistic commercial storyboard keyframe: a single shot.",
  );
  assert.equal(customerVisibleFramePrompt("Redraw it in GPT-Image-2.1 style"), "Redraw it in the image model style");
  const [frame] = buildStoryboardFramePlans({
    prompt: "清晨地铁站，上班族拿出 NORDA 随行杯喝一口热咖啡。",
    durationSec: 15,
    aspectRatio: "9:16",
    productImageCount: 2,
  });
  assert.match(frame!.prompt, /Image 2/, "发给出图模型的原文本身带模型名（守住这条测试的前提）");
  const shown = customerVisibleFramePrompt(frame!.prompt);
  assert.doesNotMatch(shown, /Image 2|GPT/);
  assert.match(shown, /NORDA 随行杯/, "商家自己的话原样保留");

  const panel = await readFile(PANEL, "utf8");
  assert.match(panel, /data-testid="storyboard-frame-prompt"/);
  assert.match(panel, /\{customerVisibleFramePrompt\(frame\.prompt\)\}/);
  assert.doesNotMatch(panel, /\{frame\.prompt\}/, "不直接渲染未清理的原文");
});

test("查看提示词：故事板每帧渲染折叠的原文，不带模型名；没有原文的帧不渲染", () => {
  const render = (english: boolean) => renderToStaticMarkup(React.createElement(StoryboardWorkflowPanel, {
    run: {
      id: "run-1",
      status: "AWAITING_APPROVAL",
      approvalPolicy: "MANUAL",
      durationSec: 15,
      aspectRatio: "9:16",
      approvedAt: null,
      errorCode: null,
      errorMessage: null,
      canApprove: true,
      frames: [
        {
          id: "f1",
          ordinal: 0,
          attempt: 1,
          beat: "hook",
          prompt: "Create ONE photorealistic commercial storyboard keyframe with GPT Image 2: a commuter sips from the NORDA tumbler.",
          status: "SUCCEEDED",
          imageUrl: "https://blob.example/f1.png",
          errorCode: null,
          errorMessage: null,
        },
        { id: "f2", ordinal: 1, attempt: 1, beat: "demo", prompt: "", status: "QUEUED", imageUrl: null, errorCode: null, errorMessage: null },
      ],
    },
    english,
    busyFrameId: null,
    approving: false,
    onRegenerate: () => {},
    onApprove: () => {},
    onEditPlan: () => {},
  }));
  const zh = render(false);
  assert.equal((zh.match(/data-testid="storyboard-frame-prompt"/g) ?? []).length, 1);
  assert.match(zh, /查看提示词/);
  assert.match(zh, /只供参考，不用改/);
  assert.match(zh, /a commuter sips from the NORDA tumbler/);
  assert.doesNotMatch(zh, /Image 2/);
  const en = render(true);
  assert.match(en, /View prompt/);
  assert.doesNotMatch(en, /查看提示词/);
});
