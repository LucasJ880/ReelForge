/**
 * 导演写手的模型接法（线上对齐第 1 步，2026-11-17）：一次看图 + JSON 的调用，走 AI provider 抽象的 `analyzeImages`，
 * 用 director 档的回退链（缺省 gpt-5.6-sol）。`OPENAI_DIRECTOR_WRITER_MODEL` 可以只给写手换一个模型做对比
 * （例：gpt-6-astra），不影响别的阶段。
 *
 * 单独放一个文件：director-writer.ts 不引它，单测不会碰到网络。**现在只有 `npm run director -- draft` 用它**，线上流程还没接。
 *
 * JSON 模式、推理模型的思考余量、截断时上限翻倍再问一次、「模型不存在 / 没权限」才换下一个、OpenAI 拉图超时由服务端
 * 转成内嵌图重试、能力状态回写——都是 `analyzeImages` 本来就有的，这里不重写。它一次最多看 8 张图，正好是写手的上限。
 * 正文不是合格的 JSON 时它会抛错，写手记成 `model_unavailable`（JSON 模式下很少见）。
 */
import { getAiProvider } from "@/lib/ai";
import { openAiVisionModelChain } from "@/lib/ai/providers/openai-provider";
import type { DirectorWriterCompleter } from "@/lib/video-generation/director-writer";

export const DIRECTOR_WRITER_MODEL_ENV = "OPENAI_DIRECTOR_WRITER_MODEL";
/** 一份草稿的正文：15 秒约 1,300 token、30 秒约 2,200；留足余量，按实际生成计费。推理模型的思考余量由 provider 另加。 */
export const DIRECTOR_WRITER_ANSWER_TOKENS = 6_000;

export interface OpenAiDirectorCompleterOptions {
  /// 商品的结构、材质、有没有字都要看清，缺省 high
  detail?: "low" | "high" | "auto";
  answerTokens?: number;
}

function writerModelOverride(): string | undefined {
  return process.env[DIRECTOR_WRITER_MODEL_ENV]?.trim() || undefined;
}

/** 写手会按什么顺序试哪些模型：点名的在最前，后面是 director 档的回退链。 */
export function directorWriterModelChain(): string[] {
  return openAiVisionModelChain("director", writerModelOverride());
}

/** 给 `writeDirectorJob` 用的真实模型调用。每次成功后把实际用的模型写在返回函数的 `model` 上。 */
export function createOpenAiDirectorCompleter(options: OpenAiDirectorCompleterOptions = {}): DirectorWriterCompleter {
  const complete: DirectorWriterCompleter = async ({ system, user, images }) => {
    const result = await getAiProvider().analyzeImages({
      imageUrls: images,
      system,
      user,
      detail: options.detail ?? "high",
      maxTokens: options.answerTokens ?? DIRECTOR_WRITER_ANSWER_TOKENS,
      tier: "director",
      model: writerModelOverride(),
    });
    complete.model = result.modelUsed;
    return result.data;
  };
  return complete;
}
