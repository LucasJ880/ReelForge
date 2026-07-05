import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserOfTypeForGeneration } from "@/lib/api-auth";
import {
  chatJsonByTier,
  isLLMForcedMock,
} from "@/lib/providers/openai";

/**
 * POST /api/personal/agent-chat —— Agent 导演对话（对齐同行「像聊天一样出片」）。
 *
 * 输入：对话历史 + 已上传产品图数量；
 * 输出：导演回复 + 是否已收集到足够信息可以出片 + 建议的创作 brief。
 *
 * LLM 不可用（mock 模式 / 无 key / 报错）时回退到脚本化引导，保证 demo 不断线。
 */

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(30),
  imageCount: z.number().int().min(0).max(10).default(0),
});

interface AgentChatResult {
  reply: string;
  readyToGenerate: boolean;
  suggestedPrompt: string | null;
  suggestedDuration: 15 | 30 | 60 | null;
}

const SYSTEM_PROMPT = `你是「Aivora Agent 导演」，一个中文短视频广告导演助手。用户会上传产品图并像聊天一样告诉你想要什么视频（如带货剧本片 / UGC 口播 / 复刻爆款）。

你的职责：
1. 用轻松、专业的口吻和用户对话，一步步收集出片所需信息：产品是什么、目标人群/市场、视频类型、时长偏好、突出的卖点。
2. 信息足够时（知道产品 + 视频类型即可），把需求整理成一段可直接用于 AI 视频生成的中文创作描述（suggestedPrompt），并把 readyToGenerate 设为 true，同时在 reply 里告诉用户「可以点右下角生成了」。
3. 信息不够时 readyToGenerate=false，reply 里追问最关键的一个问题（一次只问一个）。
4. 用户没上传产品图时提醒上传效果更好，但不阻塞。

严格输出 JSON：{"reply": string, "readyToGenerate": boolean, "suggestedPrompt": string|null, "suggestedDuration": 15|30|60|null}
reply 不超过 120 字。suggestedPrompt 需包含：产品描述、视频风格类型、目标观众、核心卖点、镜头节奏建议。`;

export async function POST(req: NextRequest) {
  const guard = await requireUserOfTypeForGeneration();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "参数不合法" },
      { status: 400 },
    );
  }
  const { messages, imageCount } = parsed.data;

  /// LLM 不可用 → 脚本化 fallback，demo 永不空转
  if (isLLMForcedMock() || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ ok: true, ...fallbackReply(messages, imageCount) });
  }

  try {
    const transcript = messages
      .map((m) => `${m.role === "user" ? "用户" : "导演"}：${m.content}`)
      .join("\n");
    const result = await chatJsonByTier<AgentChatResult>({
      tier: "creative",
      stage: "personal_agent_chat",
      system: SYSTEM_PROMPT,
      user: `已上传产品图：${imageCount} 张\n\n对话记录：\n${transcript}\n\n请输出 JSON。`,
      temperature: 0.7,
      maxTokens: 800,
    });
    const data = result.data;
    return NextResponse.json({
      ok: true,
      reply: String(data.reply ?? "").slice(0, 500) || "收到，我在想镜头方案…再多说一点你的需求？",
      readyToGenerate: Boolean(data.readyToGenerate) && Boolean(data.suggestedPrompt),
      suggestedPrompt: data.suggestedPrompt ? String(data.suggestedPrompt).slice(0, 3000) : null,
      suggestedDuration: [15, 30, 60].includes(Number(data.suggestedDuration))
        ? (Number(data.suggestedDuration) as 15 | 30 | 60)
        : null,
    });
  } catch (err) {
    console.error("[/api/personal/agent-chat] LLM failed, fallback", err);
    return NextResponse.json({ ok: true, ...fallbackReply(messages, imageCount) });
  }
}

/** 无 LLM 时的脚本化导演：第一轮追问类型，之后直接整理 brief。 */
function fallbackReply(
  messages: Array<{ role: string; content: string }>,
  imageCount: number,
): AgentChatResult {
  const userTurns = messages.filter((m) => m.role === "user");
  const lastUser = userTurns[userTurns.length - 1]?.content ?? "";

  if (userTurns.length <= 1 && lastUser.length < 12) {
    return {
      reply:
        "收到！想做哪种片子——带货剧本片、UGC 口播，还是复刻某条爆款？顺便告诉我产品是什么、卖给谁。",
      readyToGenerate: false,
      suggestedPrompt: null,
      suggestedDuration: null,
    };
  }

  const allNeeds = userTurns.map((m) => m.content).join("；");
  return {
    reply:
      "明白了，我已经把需求整理成出片方案" +
      (imageCount > 0 ? `（会用上你上传的 ${imageCount} 张产品图）` : "") +
      "。点右下角「去出片」，确认脚本后就能生成成片。",
    readyToGenerate: true,
    suggestedPrompt:
      `为以下需求制作一支竖屏短视频广告：${allNeeds}。` +
      "要求：开头 2 秒强钩子吸引目标人群；中段展示产品核心卖点与真实使用场景；" +
      "结尾引导行动。节奏明快，镜头切换自然，画面质感真实（UGC 风格优先）。",
    suggestedDuration: 15,
  };
}
