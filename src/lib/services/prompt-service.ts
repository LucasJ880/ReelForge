import { Prisma, VideoBriefStatus, VideoProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJson, isLLMAvailable } from "@/lib/providers/openai";

const SYSTEM_PROMPT = `你是一名 AI 视频生成 prompt 工程师（Seedance 2.0）。基于 scene 分镜，产出每个 scene 的 Seedance prompt。只输出 JSON。

输出 JSON:
{
  "prompts": [
    {
      "scene_index": 1,
      "provider": "SEEDANCE_T2V" | "SEEDANCE_I2V",
      "prompt_text": "英文 200-350 词的 director prompt，覆盖 shot / camera / lighting / color / motion / AUDIO DIRECTION",
      "negative_prompt": "可留空",
      "params": { "duration": 秒数, "ratio": "9:16" }
    }
  ]
}

要求：
- provider 的选择：如果 scene 的 visual_intent 强调产品真实外观（特写、品牌标识清晰可见），用 SEEDANCE_I2V；若是纯场景创意，用 SEEDANCE_T2V。
- prompt 必须包含 AUDIO DIRECTION 段落（Seedance 2.0 原生支持音频，需要明确背景音乐/voiceover 语言与情绪）。
- 时长严格遵守输入的 scene duration。
- 不要在 prompt_text 中加入 JSON 之外的任何字符。`;

interface PromptsLLM {
  prompts: Array<{
    scene_index: number;
    provider: "SEEDANCE_T2V" | "SEEDANCE_I2V";
    prompt_text: string;
    negative_prompt: string;
    params: Record<string, unknown>;
  }>;
}

export async function generatePromptsForBrief(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    include: {
      scripts: { where: { isCurrent: true }, orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!brief) throw new Error("Brief 不存在");
  const script = brief.scripts[0];
  if (!script) throw new Error("该 brief 尚未有脚本");

  const scenes = await db.scenePlan.findMany({
    where: { scriptId: script.id },
    orderBy: { sceneIndex: "asc" },
  });
  if (scenes.length === 0) throw new Error("请先生成分镜");

  const firstReferenceImage = brief.referenceImageUrls?.[0];

  const result = isLLMAvailable()
    ? await llmPrompts({
        scenes: scenes.map((s) => ({
          scene_index: s.sceneIndex,
          duration_sec: s.durationSec,
          visual_intent: s.visualIntent,
          on_camera_note: s.onCameraNote,
        })),
        aspectRatio: brief.aspectRatio,
        hasReference: !!firstReferenceImage,
      })
    : mockPrompts(scenes);

  // 清掉旧 prompt 再写新的
  const sceneIds = scenes.map((s) => s.id);
  await db.videoPrompt.deleteMany({
    where: { scenePlanId: { in: sceneIds } },
  });

  await db.$transaction(
    result.prompts.map((p) => {
      const scene = scenes.find((s) => s.sceneIndex === p.scene_index);
      if (!scene) throw new Error(`prompt 找不到对应 scene #${p.scene_index}`);
      const provider =
        p.provider === "SEEDANCE_I2V"
          ? VideoProvider.SEEDANCE_I2V
          : VideoProvider.SEEDANCE_T2V;
      return db.videoPrompt.create({
        data: {
          scenePlanId: scene.id,
          provider,
          promptText: p.prompt_text,
          negativePrompt: p.negative_prompt || null,
          params: (p.params ?? {}) as unknown as Prisma.InputJsonValue,
          referenceImageUrl:
            provider === VideoProvider.SEEDANCE_I2V
              ? firstReferenceImage ?? null
              : null,
        },
      });
    }),
  );

  await db.videoBrief.update({
    where: { id: briefId },
    data: { status: VideoBriefStatus.SCENE_PROMPT_READY },
  });
  return db.videoPrompt.findMany({
    where: { scenePlanId: { in: sceneIds } },
    orderBy: { scenePlan: { sceneIndex: "asc" } },
  });
}

async function llmPrompts(ctx: {
  scenes: Array<{
    scene_index: number;
    duration_sec: number;
    visual_intent: string;
    on_camera_note: string | null;
  }>;
  aspectRatio: string;
  hasReference: boolean;
}): Promise<PromptsLLM> {
  const user = `Scenes:
${ctx.scenes.map((s) => `  #${s.scene_index}: ${s.duration_sec}s — ${s.visual_intent}${s.on_camera_note ? ` [on-camera: ${s.on_camera_note}]` : ""}`).join("\n")}

aspect_ratio: ${ctx.aspectRatio}
has_reference_image: ${ctx.hasReference}

请按 scene 顺序输出 JSON prompts。`;

  const { data } = await chatJson<PromptsLLM>({
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.6,
    maxTokens: 3500,
  });
  return data;
}

function mockPrompts(
  scenes: { id: string; sceneIndex: number; durationSec: number; visualIntent: string }[],
): PromptsLLM {
  return {
    prompts: scenes.map((s) => ({
      scene_index: s.sceneIndex,
      provider: s.sceneIndex === 1 ? "SEEDANCE_I2V" : "SEEDANCE_T2V",
      prompt_text: `[MOCK PROMPT] Scene ${s.sceneIndex}: ${s.visualIntent}
AUDIO DIRECTION: warm ambient music, no voiceover.`,
      negative_prompt: "",
      params: { duration: s.durationSec, ratio: "9:16" },
    })),
  };
}
