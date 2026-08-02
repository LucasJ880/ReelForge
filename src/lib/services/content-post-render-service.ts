import { db } from "@/lib/db";
import { getAiProvider } from "@/lib/ai";

/**
 * O1 · 图文帖出图（PRD §3 / M3）。
 *
 * 与产品图工作台不同，这里**不复用** product-image-service：
 * 那条是带租约、重试、供应商积分快照的异步作业管线，为「同一 SKU 跨次一致」建的。
 * 社媒配图是一次性视觉，走同步出图 + 落 blob 就够；把它塞进那条管线只会
 * 让两边的失败语义纠缠在一起。
 *
 * 计费口径（PRD 决策 4）：**出图才计费，且失败零计费**。
 * 一周计划的生成不收费，商家改文案、重排、丢弃都不该被罚。
 */

/// 社媒竖版。gpt-image-2 接受任意满足约束的分辨率。
const SOCIAL_PORTRAIT_SIZE = "1024x1536";

export class ContentPostRenderError extends Error {
  constructor(
    message: string,
    readonly reason: "not_found" | "wrong_format" | "no_prompt" | "provider",
  ) {
    super(message);
    this.name = "ContentPostRenderError";
  }
}

type Slide = {
  order: number;
  imagePrompt: string;
  overlayText: string | null;
};

/**
 * 出图提示词的硬性尾巴。
 *
 * 模型把字写错是能力问题，我们的策略是**不让它写字**（PRD §12）。
 * 文字由 overlayText 在展示层叠上去，所以这里必须显式禁止。
 */
export function hardenImagePrompt(prompt: string): string {
  return `${prompt.trim()}\n\nSTRICT: no text, no letters, no numbers, no logos, no watermarks anywhere in the image. Photorealistic. Vertical composition for social media.`;
}

export async function renderContentPost(args: {
  userId: string;
  postId: string;
}): Promise<{ urls: string[]; skipped: boolean }> {
  const post = await db.contentPost.findFirst({
    /// owner 校验放进查询条件，不靠调用方记得比对。
    where: { id: args.postId, plan: { userId: args.userId } },
    select: {
      id: true,
      format: true,
      imagePrompt: true,
      slidesJson: true,
      renderedImageUrls: true,
    },
  });
  if (!post) {
    throw new ContentPostRenderError("找不到这条内容", "not_found");
  }
  if (post.format !== "SINGLE_IMAGE" && post.format !== "CAROUSEL") {
    throw new ContentPostRenderError(
      "只有单图帖和轮播需要出图",
      "wrong_format",
    );
  }
  /// 已经出过图就直接返回：重复点「生成配图」不该重复扣费。
  if (post.renderedImageUrls.length > 0) {
    return { urls: post.renderedImageUrls, skipped: true };
  }

  const prompts =
    post.format === "SINGLE_IMAGE"
      ? post.imagePrompt
        ? [post.imagePrompt]
        : []
      : readSlides(post.slidesJson).map((slide) => slide.imagePrompt);

  if (prompts.length === 0) {
    throw new ContentPostRenderError("这条内容没有可用的出图提示词", "no_prompt");
  }

  /// 走 AI provider 抽象而不是直接引 openai-image：
  /// 出图供应商要能整体切换（中国线路走火山），直连会把切换点漏掉。
  const ai = getAiProvider();
  if (!ai.isConfigured()) {
    throw new ContentPostRenderError(
      "出图服务当前不可用，稍后再试",
      "provider",
    );
  }

  const urls: string[] = [];
  try {
    for (const [index, prompt] of prompts.entries()) {
      const result = await ai.generateImages({
        prompt: hardenImagePrompt(prompt),
        /// 每屏只出一张：轮播已经是多张，再抽卡会让成本乘上去。
        n: 1,
        size: SOCIAL_PORTRAIT_SIZE,
        storagePrefix: `content-posts/${post.id}/${index}-`,
      });
      if (!result.urls[0]) {
        throw new ContentPostRenderError("出图返回空结果", "provider");
      }
      urls.push(result.urls[0]);
    }
  } catch (err) {
    /// 失败零计费：把已出的图也记下来（素材是花过钱的，不能丢），
    /// 但状态留在 DRAFT 并写明原因，让商家能重试或取消。
    await db.contentPost.update({
      where: { id: post.id },
      data: {
        renderedImageUrls: urls,
        renderError:
          err instanceof ContentPostRenderError
            ? err.message
            : (err as Error).message,
      },
    });
    throw err instanceof ContentPostRenderError
      ? err
      : new ContentPostRenderError("出图失败，请重试", "provider");
  }

  await db.contentPost.update({
    where: { id: post.id },
    data: {
      renderedImageUrls: urls,
      renderedAt: new Date(),
      renderError: null,
      /// 视觉素材齐了才算 READY —— READY 的语义是「可以交给青砚发布」。
      status: "READY",
    },
  });

  return { urls, skipped: false };
}

/**
 * 取消这一轮出图。
 *
 * 铁律：每一轮任务都必须可取消，取消要**清运行态、保留素材**。
 * 已经出好的图是花过钱的，取消不能把它们删掉。
 */
export async function discardContentPost(args: {
  userId: string;
  postId: string;
}): Promise<boolean> {
  const updated = await db.contentPost.updateMany({
    where: { id: args.postId, plan: { userId: args.userId } },
    data: { status: "DISCARDED", renderError: null },
  });
  return updated.count === 1;
}

export function readSlides(raw: unknown): Slide[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const slide = item as Record<string, unknown>;
      const imagePrompt =
        typeof slide.imagePrompt === "string" ? slide.imagePrompt.trim() : "";
      if (!imagePrompt) return null;
      return {
        order: typeof slide.order === "number" ? slide.order : index,
        imagePrompt,
        overlayText:
          typeof slide.overlayText === "string" ? slide.overlayText : null,
      };
    })
    .filter((slide): slide is Slide => slide !== null)
    .sort((a, b) => a.order - b.order);
}
