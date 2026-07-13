import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserOfTypeForGeneration } from "@/lib/api-auth";
import {
  chatJsonByTier,
  isLLMAvailable,
  isLLMForcedMock,
} from "@/lib/ai";

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
  locale: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
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

const SYSTEM_PROMPT_EN = `You are Aivora Agent Director, an English-language short-form video director. Users describe a product video conversationally and may upload product images.

Your job:
1. Collect only the missing essentials: product, audience or market, format, preferred duration, and primary proof point.
2. Once the product and format are clear, set readyToGenerate=true and return a concrete suggestedPrompt that can drive video generation.
3. If information is missing, ask one concise question at a time.
4. Recommend adding product images when none are uploaded, but do not block progress.
5. Favor stable, believable scenes and identity consistency over spectacle.

Return strict JSON: {"reply": string, "readyToGenerate": boolean, "suggestedPrompt": string|null, "suggestedDuration": 15|30|60|null}.
Keep reply under 80 words. suggestedPrompt must cover product, style, audience, proof, pacing, and consistency constraints.`;

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
  const { messages, imageCount, locale } = parsed.data;

  /// LLM 不可用 → 脚本化 fallback，demo 永不空转
  if (isLLMForcedMock() || !isLLMAvailable()) {
    return NextResponse.json({ ok: true, ...fallbackReply(messages, imageCount, locale) });
  }

  try {
    const transcript = messages
      .map((m) => `${m.role === "user" ? (locale === "en-US" ? "User" : "用户") : (locale === "en-US" ? "Director" : "导演")}：${m.content}`)
      .join("\n");
    const result = await chatJsonByTier<AgentChatResult>({
      tier: "creative",
      stage: "personal_agent_chat",
      system: locale === "en-US" ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT,
      user: locale === "en-US"
        ? `Uploaded product images: ${imageCount}\n\nConversation:\n${transcript}\n\nReturn JSON.`
        : `已上传产品图：${imageCount} 张\n\n对话记录：\n${transcript}\n\n请输出 JSON。`,
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
    return NextResponse.json({ ok: true, ...fallbackReply(messages, imageCount, locale) });
  }
}

/** 无 LLM 时的脚本化导演：第一轮追问类型，之后直接整理 brief。 */
function fallbackReply(
  messages: Array<{ role: string; content: string }>,
  imageCount: number,
  locale: "zh-CN" | "en-US",
): AgentChatResult {
  const userTurns = messages.filter((m) => m.role === "user");
  const lastUser = userTurns[userTurns.length - 1]?.content ?? "";

  if (userTurns.length <= 1 && lastUser.length < 12) {
    return {
      reply: locale === "en-US"
        ? "What are we promoting, who is it for, and should this feel like UGC, a product demo, or a performance ad?"
        : "收到！想做哪种片子——带货剧本片、UGC 口播，还是复刻某条爆款？顺便告诉我产品是什么、卖给谁。",
      readyToGenerate: false,
      suggestedPrompt: null,
      suggestedDuration: null,
    };
  }

  const allNeeds = userTurns.map((m) => m.content).join("；");
  return {
    reply: locale === "en-US"
      ? `I’ve shaped this into a production brief${imageCount > 0 ? ` using your ${imageCount} product image${imageCount === 1 ? "" : "s"}` : ""}. Review the matched template and generation settings below.`
      : "明白了，我已经把需求整理成出片方案" +
        (imageCount > 0 ? `（会用上你上传的 ${imageCount} 张产品图）` : "") +
        "。确认推荐模板和下方生成设置后就能出片。",
    readyToGenerate: true,
    suggestedPrompt: locale === "en-US"
      ? `Create a vertical short-form product video for this brief: ${allNeeds}. Open with a clear two-second hook, prove the main product benefit in one believable setting, keep the product and cast consistent, use grounded pacing, and finish with a clear action.`
      : `为以下需求制作一支竖屏短视频广告：${allNeeds}。` +
        "要求：开头 2 秒强钩子吸引目标人群；中段展示产品核心卖点与真实使用场景；" +
        "结尾引导行动。节奏明快，镜头切换自然，人物和产品保持一致。",
    suggestedDuration: 15,
  };
}
