import { PROMPT_VERSIONS } from "./index";
import type { ClientBrief } from "@/lib/schemas/client-brief";
import type {
  ShootingGuideDoc,
  ShootingGuideItem,
} from "@/lib/schemas/shooting-guide";
import type { StoryboardOutput } from "@/lib/schemas/storyboard";

export const PROMPT_VERSION = PROMPT_VERSIONS.shootingGuide;

/**
 * Prompt: generateShootingGuide
 *
 * 输入：StoryboardOutput + ClientBrief
 * 输出：ShootingGuideDoc（商家可以打印 / 边拍边对照的清单）
 *
 * 重要：MVP 中 storyboard 已经基本包含商家可读字段，
 * 因此该 prompt 只在「需要重新润色 / 翻译为商家母语 / 加入常见错误提醒」时调用。
 * 默认实现：service 层会先尝试 buildShootingGuideFromStoryboard()（确定性的本地构造），
 * 仅当 LLM 可用且 brief 要求增强时才调 LLM。
 */
export const SHOOTING_GUIDE_SYSTEM = `你是 Aivora 的商家拍摄教练。基于已生成的分镜表，输出一份"商家可以照拍"的清单。只输出 JSON。

输出 JSON：
{
  "totalDurationSec": 与 storyboard 一致,
  "totalShots": shot 数量,
  "requiredShots": 必拍数量,
  "optionalShots": 可选数量,
  "preflightChecklist": ["拍摄前自检 1", "拍摄前自检 2"],
  "summary": "中文 2-3 句总结",
  "items": [
    {
      "sceneIndex": 1,
      "durationSec": 3,
      "shotType": "...",
      "whatToFilm": "...",
      "composition": "...",
      "cameraMovement": "...",
      "orientation": "...",
      "requiredFlag": true,
      "humanRequired": false,
      "requiredProps": ["..."],
      "lightingNote": "中文光线提醒",
      "audioNote": "中文音频提醒",
      "captionText": "...",
      "voiceoverSegment": "...",
      "commonMistakes": ["商家容易踩的坑 1", "..."],
      "uploadHints": ["上传前 self-check 1", "..."]
    }
  ]
}

强制要求：
- items.length === storyboard.shots.length，且 sceneIndex 一一对应。
- preflightChecklist 至少 3 条（光线、音频、构图、文件命名各 1 条）。
- commonMistakes 必须实际可避免，例如 "竖屏拍成横屏"、"麦克风离嘴超过 30cm"。
- uploadHints 至少 1 条；最后一条镜头的 uploadHints 必须包含 "上传前确认 CTA 字幕清晰可读"。
- 不要假装拍摄设备/场地；如果 storyboard.requiredFlag=true 但 humanRequired=true，必须在 commonMistakes 中提示真人拍摄常见问题。
- 输出必须是合法 JSON。`;

export interface ShootingGuidePromptInput {
  storyboard: StoryboardOutput;
  brief: ClientBrief;
}

export function buildShootingGuideUser(input: ShootingGuidePromptInput) {
  return `Storyboard:
${JSON.stringify(input.storyboard, null, 2)}

商家 Brief:
${JSON.stringify(
  {
    businessName: input.brief.businessName,
    industry: input.brief.industry,
    objective: input.brief.objective,
    brandTone: input.brief.brandTone,
    videoLengthSec: input.brief.videoLengthSec,
  },
  null,
  2,
)}

请输出 JSON 拍摄清单。`;
}

/**
 * 确定性 fallback：从 storyboard 直接构造 ShootingGuideDoc。
 * 默认 MVP 路径走这里，不消耗 LLM token。
 */
export function buildShootingGuideFromStoryboard(
  input: ShootingGuidePromptInput,
): ShootingGuideDoc {
  const items: ShootingGuideItem[] = input.storyboard.shots.map((shot) => ({
    sceneIndex: shot.sceneIndex,
    durationSec: shot.durationSec,
    shotType: shot.shotType,
    whatToFilm: shot.whatToFilm,
    composition: shot.composition,
    cameraMovement: shot.cameraMovement,
    orientation: shot.orientation,
    requiredFlag: shot.requiredFlag,
    humanRequired: shot.humanRequired,
    requiredProps: shot.requiredProps,
    lightingNote: defaultLightingFor(shot.shotType),
    audioNote: shot.humanRequired
      ? "如果有真人出镜，麦克风/手机距离嘴部 20-30cm，避免顶光风噪"
      : "环境音可保留；避免突兀人声",
    captionText: shot.captionText,
    voiceoverSegment: shot.voiceoverSegment,
    commonMistakes: defaultCommonMistakes(shot),
    uploadHints: defaultUploadHints(shot, input.storyboard.shots.length),
  }));

  const requiredShots = items.filter((i) => i.requiredFlag).length;
  return {
    totalDurationSec: input.storyboard.totalDurationSec,
    totalShots: items.length,
    requiredShots,
    optionalShots: items.length - requiredShots,
    preflightChecklist: [
      "拍摄前确认手机存储 ≥ 5GB，关闭省电模式",
      "白天自然光优先，避免顶光与逆光",
      "音频使用领夹麦或手机麦近距离录音，房间避免空旷回声",
      "竖屏 9:16 拍摄，禁止横屏后再裁剪",
      "每条镜头多拍 1-2 个备份 take",
    ],
    summary: `共 ${items.length} 个镜头（${requiredShots} 必拍 / ${items.length - requiredShots} 可选），总时长 ${input.storyboard.totalDurationSec}s。围绕「${input.brief.businessName}」的真实场景拍摄即可。`,
    items,
  };
}

function defaultLightingFor(shotType: ShootingGuideItem["shotType"]) {
  if (shotType === "talking_head" || shotType === "over_the_shoulder") {
    return "面光为主，主光在 45° 角，避免脸部阴影；如室内补一盏冷暖可调灯";
  }
  if (shotType === "extreme_close_up" || shotType === "detail") {
    return "侧逆光勾边，让产品/物体细节更立体；避免反光";
  }
  return "白天自然光优先；如室内确保 ≥ 300lux 主光";
}

function defaultCommonMistakes(shot: {
  shotType: ShootingGuideItem["shotType"];
  humanRequired: boolean;
  cameraMovement: ShootingGuideItem["cameraMovement"];
}) {
  const mistakes: string[] = [];
  if (shot.humanRequired) {
    mistakes.push("出镜人不要直视镜头底部边缘，眼神看镜头");
    mistakes.push("提前对好稿，不要中途停顿超过 1 秒");
  }
  if (shot.cameraMovement === "handheld") {
    mistakes.push("双手握稳手机，肘部夹紧，运动镜头慢一拍");
  }
  if (shot.shotType === "establishing" || shot.shotType === "wide") {
    mistakes.push("不要把招牌/品牌 logo 拍出框");
  }
  if (mistakes.length === 0) {
    mistakes.push("竖屏拍成横屏；记得切到 9:16");
  }
  return mistakes.slice(0, 4);
}

function defaultUploadHints(
  shot: {
    sceneIndex: number;
    captionText?: string;
  },
  totalShots: number,
) {
  const hints: string[] = ["上传前预览一次，确保画面没有抖到看不清"];
  if (shot.sceneIndex === totalShots) {
    hints.push("上传前确认 CTA 字幕清晰可读");
  }
  return hints;
}
