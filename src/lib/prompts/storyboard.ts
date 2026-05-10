import { PROMPT_VERSIONS } from "./index";
import type { ClientBrief } from "@/lib/schemas/client-brief";
import type { ScriptOutput } from "@/lib/schemas/script-output";
import type { StoryboardOutput } from "@/lib/schemas/storyboard";

export const PROMPT_VERSION = PROMPT_VERSIONS.storyboard;

/**
 * Prompt: generateStoryboard
 *
 * 输入：ScriptOutput + ClientBrief（行业 / 目标 / 时长 / 出镜偏好）
 * 输出：StoryboardOutput（每个 shot 都包含商家友好维度）
 */
export const STORYBOARD_SYSTEM = `你是 Aivora 的真实素材分镜师。基于已生成的脚本与商家 brief，输出一份"商家可以照拍"的分镜表。只输出 JSON。

输出 JSON：
{
  "totalDurationSec": 与 brief.videoLengthSec 一致,
  "pacingNote": "整体节奏短评",
  "shots": [
    {
      "sceneIndex": 1,
      "durationSec": 3,
      "shotType": "wide | medium | close_up | extreme_close_up | over_the_shoulder | pov | establishing | detail | talking_head | b_roll",
      "visualIntent": "英文 director 注释（剪辑团队用）",
      "whatToFilm": "中英文均可，告诉商家「这条镜头要怎么拍」",
      "composition": "rule_of_thirds | centered | symmetrical | leading_lines | frame_within_frame | negative_space",
      "cameraMovement": "static | pan | tilt | push_in | pull_out | tracking | handheld | gimbal",
      "orientation": "portrait | landscape | square",
      "requiredFlag": true,
      "humanRequired": false,
      "requiredProps": ["道具 1", "道具 2"],
      "captionText": "可选屏幕字幕",
      "voiceoverSegment": "可选 voiceover 段落",
      "onCameraNote": "若 humanRequired=true 写真人出镜要点；否则空字符串"
    }
  ]
}

强制要求：
- shots 数量在 3-8 之间。
- 每个 shot 的 durationSec 之和 = totalDurationSec = brief.videoLengthSec。
- 第 1 个 shot 必须是 hook（建议 wide 或 establishing 或 close_up）。
- 最后一个 shot 必须承载 CTA（含 captionText）。
- 不要假装商家有不存在的拍摄场地/设备；如果该 shot 需要补拍，requiredFlag 仍然 true，但 whatToFilm 中必须给出可行的替代方案。
- 不要复制参考视频原镜头脚本；只能给「结构 + 拍摄要点」。
- humanRequired 必须诚实：talking_head / over_the_shoulder / pov 通常需要真人。
- orientation 默认 portrait（短视频）；当 brief.targetPlatforms 仅包含 youtube_shorts/facebook 横屏时给 landscape。
- 输出必须是合法 JSON。`;

export interface StoryboardPromptInput {
  brief: ClientBrief;
  script: ScriptOutput;
}

export function buildStoryboardUser(input: StoryboardPromptInput) {
  return `商家 Brief:
${JSON.stringify(
  {
    businessName: input.brief.businessName,
    industry: input.brief.industry,
    objective: input.brief.objective,
    videoLengthSec: input.brief.videoLengthSec,
    brandTone: input.brief.brandTone,
    targetPlatforms: input.brief.targetPlatforms,
    keyMessage: input.brief.keyMessage,
  },
  null,
  2,
)}

脚本:
${JSON.stringify(
  {
    title: input.script.title,
    hook: input.script.hook,
    voiceover: input.script.voiceover,
    captions: input.script.captions,
    cta: input.script.cta,
  },
  null,
  2,
)}

请输出 JSON 分镜。totalDurationSec 必须等于 ${input.brief.videoLengthSec}。`;
}

/** Mock 输出 */
export function mockStoryboard(input: StoryboardPromptInput): StoryboardOutput {
  const total = input.brief.videoLengthSec;
  const hookDur = Math.max(3, Math.floor(total * 0.2));
  const ctaDur = Math.max(3, Math.floor(total * 0.2));
  const proofDur = Math.max(3, total - hookDur - ctaDur);

  return {
    totalDurationSec: total,
    pacingNote:
      "[Mock] Hook (~20%) → Proof (~60%) → CTA (~20%)，前快后慢，结尾留出 1.5s 静帧",
    shots: [
      {
        sceneIndex: 1,
        durationSec: hookDur,
        shotType: "establishing",
        visualIntent:
          "[Mock] Wide establishing shot of storefront / location to anchor local trust",
        whatToFilm: `用真实门店/外观开场，9:16 竖屏，让 ${input.brief.businessName} 的招牌或入口清晰可见`,
        composition: "rule_of_thirds",
        cameraMovement: "static",
        orientation: "portrait",
        requiredFlag: true,
        humanRequired: false,
        requiredProps: ["门店外景", "招牌"],
        captionText: input.script.captions[0]?.text ?? input.brief.businessName,
        voiceoverSegment: input.script.hook,
      },
      {
        sceneIndex: 2,
        durationSec: proofDur,
        shotType: "close_up",
        visualIntent: "[Mock] Tight proof shots: real product/service detail, real human reaction",
        whatToFilm:
          "拍 2-3 段真实细节：产品/服务的近景，加上一个真实人/宠物/客户的真实反应。每段 2-3 秒",
        composition: "centered",
        cameraMovement: "handheld",
        orientation: "portrait",
        requiredFlag: true,
        humanRequired: false,
        requiredProps: ["商品", "工作中的真实场景"],
        captionText: input.script.captions[1]?.text ?? "真实细节 · 真实信任",
        voiceoverSegment: input.script.voiceover.slice(0, 200),
      },
      {
        sceneIndex: 3,
        durationSec: ctaDur,
        shotType: "medium",
        visualIntent: "[Mock] CTA shot with logo / phone / website overlay",
        whatToFilm:
          "用最干净的产品/服务主镜头收尾，留出 1.5s 静帧给字幕和 logo",
        composition: "centered",
        cameraMovement: "static",
        orientation: "portrait",
        requiredFlag: true,
        humanRequired: false,
        requiredProps: ["品牌 logo 卡", "联系方式"],
        captionText: input.script.cta,
        voiceoverSegment: input.script.cta,
      },
    ],
  };
}
