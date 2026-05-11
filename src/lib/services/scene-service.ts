import { db } from "@/lib/db";
import { chatJsonByTier, isLLMAvailable } from "@/lib/providers/openai";

const SYSTEM_PROMPT = `你是一名真实素材广告短视频分镜师。给你脚本全文、目标时长和客户上传素材清单，请把脚本切成 3-6 个 scene，每个 scene 给出时长、视觉意图（英文）和出镜备注（英文）。只输出 JSON。

输出 JSON:
{
  "scenes": [
    {
      "scene_index": 1,
      "duration_sec": 4,
      "visual_intent": "英文，50-100 词，描述画面、运镜、光线、节奏",
      "on_camera_note": "仅当该 scene 需要出镜时填写，其余留空字符串"
    }
  ]
}

要求：
- 所有 scene duration 之和 = 输入的 duration_sec。
- 第 1 个 scene 就是 hook，要最抓人。
- 最后一个 scene 要承载 CTA。
- visual_intent 必须说明应该匹配哪类真实素材，例如 product close-up、pet reaction、store walkthrough、before/after、UGC talking head、packaging shot。
- 不要写无法由客户素材实现的虚构镜头；如果缺素材，在 visual_intent 中写 "Needs reshoot: ..."。`;

interface ScenesLLM {
  scenes: Array<{
    scene_index: number;
    duration_sec: number;
    visual_intent: string;
    on_camera_note: string;
  }>;
}

export async function generateScenesForBrief(briefId: string) {
  const brief = await db.videoBrief.findUnique({
    where: { id: briefId },
    include: {
      scripts: { where: { isCurrent: true }, orderBy: { version: "desc" }, take: 1 },
      contentAngle: {
        include: {
          round: {
            include: {
              deliveryOrder: true,
            },
          },
        },
      },
    },
  });
  if (!brief) throw new Error("Brief 不存在");
  const script = brief.scripts[0];
  if (!script) throw new Error("该 brief 尚未有脚本");

  const result = isLLMAvailable()
    ? await llmScenes({
        fullText: script.fullText,
        durationSec: brief.durationSec,
        onCameraMode: brief.onCameraMode,
        productInput: brief.contentAngle.round.deliveryOrder.productInput,
        angleLocaleNotes: brief.contentAngle.localeNotes,
      })
    : mockScenes(brief.durationSec);

  await db.scenePlan.deleteMany({ where: { scriptId: script.id } });
  await db.$transaction(
    result.scenes.map((s) =>
      db.scenePlan.create({
        data: {
          scriptId: script.id,
          sceneIndex: s.scene_index,
          durationSec: s.duration_sec,
          visualIntent: s.visual_intent,
          onCameraNote: s.on_camera_note || null,
        },
      }),
    ),
  );

  return db.scenePlan.findMany({
    where: { scriptId: script.id },
    orderBy: { sceneIndex: "asc" },
  });
}

async function llmScenes(ctx: {
  fullText: string;
  durationSec: number;
  onCameraMode: string;
  productInput: unknown;
  angleLocaleNotes: unknown;
}): Promise<ScenesLLM> {
  const user = `目标时长: ${ctx.durationSec} 秒
出镜模式: ${ctx.onCameraMode}

Angle 素材建议:
${JSON.stringify(ctx.angleLocaleNotes, null, 2)}

产品/服务输入与真实素材:
${JSON.stringify(ctx.productInput, null, 2)}

脚本全文:
"""
${ctx.fullText}
"""

请输出 JSON 分镜。scene 数量 3-6 个，duration_sec 合计必须 = ${ctx.durationSec}。`;

  const { data } = await chatJsonByTier<ScenesLLM>({
    tier: "creative",
    stage: "scene_breakdown",
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.6,
    maxTokens: 1500,
  });
  return data;
}

function mockScenes(durationSec: number): ScenesLLM {
  const half = Math.floor(durationSec / 2);
  return {
    scenes: [
      {
        scene_index: 1,
        duration_sec: Math.max(3, Math.floor(durationSec * 0.25)),
        visual_intent:
          "Hook: use the strongest real footage moment first, such as product close-up, pet reaction, before/after, or store action.",
        on_camera_note: "",
      },
      {
        scene_index: 2,
        duration_sec: half,
        visual_intent:
          "Proof: match real usage footage that shows the product or service solving the stated customer pain point.",
        on_camera_note: "",
      },
      {
        scene_index: 3,
        duration_sec: durationSec - Math.max(3, Math.floor(durationSec * 0.25)) - half,
        visual_intent:
          "CTA: end on the clearest product, storefront, result, or offer shot with bold on-screen call to action.",
        on_camera_note: "",
      },
    ],
  };
}
