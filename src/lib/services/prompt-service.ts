import { Prisma, VideoBriefStatus, VideoProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJsonByTier, isLLMAvailable } from "@/lib/ai";

const SYSTEM_PROMPT = `You are a Seedance 2.0 (Volcengine Ark) director-prompt engineer.
Your job: turn each scene plan into a single, cinematic, ready-to-render prompt that produces a vertical 9:16 short-form ad shot.

OUTPUT JSON ONLY:
{
  "prompts": [
    {
      "scene_index": 1,
      "provider": "SEEDANCE_T2V" | "SEEDANCE_I2V",
      "prompt_text": "200-350 English words. MUST follow the section template below.",
      "negative_prompt": "Optional, comma-separated terms to avoid",
      "params": { "duration": <seconds>, "ratio": "9:16" }
    }
  ]
}

PROMPT TEMPLATE — every prompt_text must include these sections, in order, with these labels:
SHOT: <subject + framing + composition (e.g. tight close-up of hand on a smart-home control)>
CAMERA: <move + lens (e.g. slow dolly-in, 35mm look)>
ENVIRONMENT: <location + props + light + time of day, anchored to the product's real-world setting>
MOTION: <what changes during the shot>
COLOR & MOOD: <palette + emotional tone, 1 line>
ACTION & TIMING: <beat-by-beat for the shot's duration>
AUDIO DIRECTION: <music style + voiceover language + voiceover tone (Seedance 2.0 generates audio; required)>

PROVIDER SELECTION:
- Use SEEDANCE_I2V if the scene needs the actual product look-and-brand fidelity AND a reference image is available (has_reference_image = true).
- Otherwise use SEEDANCE_T2V (atmosphere, transitions, B-roll, lifestyle).

HARD REQUIREMENTS:
1. duration MUST equal the input scene duration_sec exactly. ratio = "9:16".
2. Be concrete and sensory. Avoid: "amazing", "premium look", "professional grade", "ultra-realistic". Prefer: "morning light slants across hardwood", "shutter blades roll closed in 1.5 seconds".
3. Stay feasible. Don't ask for shots that the model can't reliably render in 5–10s clips (no 50-person crowds, no dialogue lip-sync).
4. Stay TRUE to the product. For motorized blinds: the visible mechanism / cord-free window / smart speaker on a shelf / hand on remote. Do NOT default to "luxury hotel suite" stock-footage cliches.
5. Avoid showing recognizable celebrities, brand logos that aren't ours, copyrighted characters.
6. negative_prompt should include common Seedance 2.0 failures: "warped hands, distorted text, watermarks, glitching faces, unnatural fingers".
7. AUDIO DIRECTION is required. Specify music tempo / mood / whether there's a VO and in what language. Match the Brief on-camera mode.
8. No JSON outside the single output object.

Output JSON only — no markdown, no commentary.`;

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

  const { data } = await chatJsonByTier<PromptsLLM>({
    tier: "creative",
    stage: "video_prompt_generation",
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
