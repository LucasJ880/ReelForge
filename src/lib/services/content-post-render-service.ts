import { db } from "@/lib/db";
import { isProviderBillingError } from "@/lib/providers/provider-billing-error";
import { getAiProvider } from "@/lib/ai";
import type { AiProvider } from "@/lib/ai/types";

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

/**
 * 渲染锁时限（bughunt #15）：开始出图时写 renderStartedAt，结束清空；
 * 超过这个时长仍未清空视为失效锁（进程被杀 / 超时），允许重新出图。
 * 必须长于出图路由的 maxDuration（300 秒），否则一次正常的长渲染会被并发请求「接管」。
 */
export const RENDER_LOCK_TTL_MS = 10 * 60 * 1000;

export class ContentPostRenderError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_found"
      | "wrong_format"
      | "no_prompt"
      | "provider"
      /// 出图供应商账户层故障（额度用完 / 无模型权限）：原样重试必然再失败
      | "provider_unavailable"
      /// 另一个请求正在出这条（渲染锁未过期）
      | "in_progress"
      /// 商家已弃用 / 出图期间被取消；已出的图照样保留
      | "discarded"
      /// C2（Shuyu 异步线路）：缺的那几屏上一次失败且供应商没确认退款，
      /// 为避免重复扣费不自动重出，需要人工核对
      | "billing_review",
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

/**
 * 还缺图的 slide 序号（按 renderedImageUrls 的位置对应 prompts 的位置）。
 *
 * 中途失败会把已出的前几张写回去；再点一次只补缺的那几张——
 * 以前「有任意一张就直接返回」，半套轮播永远补不齐还被当成已完成。
 */
export function missingSlideIndexes(
  promptCount: number,
  renderedImageUrls: readonly string[],
): number[] {
  const missing: number[] = [];
  for (let index = 0; index < promptCount; index += 1) {
    if (!renderedImageUrls[index]?.trim()) missing.push(index);
  }
  return missing;
}

/** 按位置合并：新出的图填进对应 slide，空位用 "" 占位、去掉尾部空位。 */
export function mergeRenderedUrls(
  existing: readonly string[],
  rendered: ReadonlyMap<number, string>,
): string[] {
  const length = Math.max(
    existing.length,
    rendered.size ? Math.max(...rendered.keys()) + 1 : 0,
  );
  const merged = Array.from(
    { length },
    (_, index) => rendered.get(index) ?? existing[index] ?? "",
  );
  while (merged.length && !merged[merged.length - 1]) merged.pop();
  return merged;
}

type ImageRenderer = Pick<AiProvider, "isConfigured" | "generateImages">;

export async function renderContentPost(
  args: {
    userId: string;
    postId: string;
    /**
     * 拿到渲染锁、确认确实要花钱出图之后才调用（路由在这里做按用户限流）：
     * 幂等短路和锁冲突都不计次数。抛错会释放渲染锁并原样上抛。
     */
    beforeRender?: () => Promise<void>;
  },
  deps: { ai?: ImageRenderer; now?: () => Date } = {},
): Promise<{ urls: string[]; skipped: boolean }> {
  const now = deps.now ?? (() => new Date());
  const post = await db.contentPost.findFirst({
    /// owner 校验放进查询条件，不靠调用方记得比对。
    where: { id: args.postId, plan: { userId: args.userId } },
    select: {
      id: true,
      format: true,
      status: true,
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
  if (post.status === "DISCARDED") {
    throw new ContentPostRenderError(
      "这条内容已取消，已出的图都保留着；需要的话请重新排一条",
      "discarded",
    );
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

  const missing = missingSlideIndexes(prompts.length, post.renderedImageUrls);
  /// 每屏都已出过图就直接返回：重复点「生成配图」不该重复扣费。
  if (missing.length === 0) {
    if (post.status === "DRAFT") await promoteCompletedDraft(post.id, now());
    return { urls: post.renderedImageUrls, skipped: true };
  }

  /// 走 AI provider 抽象而不是直接引 openai-image：
  /// 出图供应商要能整体切换（中国线路走火山），直连会把切换点漏掉。
  const ai = deps.ai ?? getAiProvider();
  if (!ai.isConfigured()) {
    throw new ContentPostRenderError(
      "出图服务当前不可用，稍后再试",
      "provider",
    );
  }

  /// 渲染锁：只有草稿、且没人在渲染（或锁已过期）才能开工。两次点击 / 两个标签页
  /// 只有一个能拿到锁，另一个直接告诉商家「正在出图」，不会各出一遍各扣一遍。
  /// 锁值就是本次开工时间，后面的收尾写都以它为条件，过期被接管后不会互相覆盖。
  const lockedAt = now();
  const lock = await db.contentPost.updateMany({
    where: {
      id: post.id,
      plan: { userId: args.userId },
      status: "DRAFT",
      OR: [
        { renderStartedAt: null },
        { renderStartedAt: { lt: new Date(lockedAt.getTime() - RENDER_LOCK_TTL_MS) } },
      ],
      /// C2：异步线路（Shuyu）还有没结束的任务时，这条帖子的锁属于那一轮，不论锁多旧都不接管。
      imageTasks: { none: { status: { in: ["QUEUED", "PROCESSING"] } } },
    },
    /// 清掉轮次号：锁归同步线路，异步线路的收尾（只认自己的轮次号）不会误放这把锁。
    data: { renderStartedAt: lockedAt, renderRunId: null },
  });
  if (lock.count !== 1) {
    const current = await db.contentPost.findFirst({
      where: { id: post.id },
      select: { status: true, renderedImageUrls: true },
    });
    if (current?.status === "READY") {
      return { urls: current.renderedImageUrls, skipped: true };
    }
    if (current?.status === "DISCARDED") {
      throw new ContentPostRenderError(
        "这条内容已取消，已出的图都保留着；需要的话请重新排一条",
        "discarded",
      );
    }
    throw new ContentPostRenderError(
      "这条内容正在出图，请稍候刷新查看",
      "in_progress",
    );
  }

  try {
    await args.beforeRender?.();
  } catch (err) {
    await releaseRenderLock(post.id, lockedAt);
    throw err;
  }

  const rendered = new Map<number, string>();
  let failure: unknown = null;
  for (const [position, index] of missing.entries()) {
    /// 铁律 #7：取消要真的停下来。每出完一屏看一眼，商家点了取消就不再出下一张；
    /// 已出的照样落库（下面的 CAS 收尾会走「已取消」分支）。
    if (position > 0 && (await isRenderCancelled(post.id))) break;
    try {
      const result = await ai.generateImages({
        prompt: hardenImagePrompt(prompts[index]),
        /// 每屏只出一张：轮播已经是多张，再抽卡会让成本乘上去。
        n: 1,
        size: SOCIAL_PORTRAIT_SIZE,
        storagePrefix: `content-posts/${post.id}/${index}-`,
      });
      if (!result.urls[0]) {
        throw new ContentPostRenderError("出图返回空结果", "provider");
      }
      rendered.set(index, result.urls[0]);
    } catch (err) {
      failure = err;
      break;
    }
  }
  const urls = mergeRenderedUrls(post.renderedImageUrls, rendered);

  if (failure) {
    /// 失败零计费：把已出的图也记下来（素材是花过钱的，不能丢），
    /// 状态不动（仍是草稿，或期间已被取消），写明原因让商家能补齐剩下的或取消。
    await db.contentPost.updateMany({
      where: { id: post.id, renderStartedAt: lockedAt },
      data: {
        renderedImageUrls: urls,
        renderStartedAt: null,
        renderError:
          failure instanceof ContentPostRenderError
            ? failure.message
            : (failure as Error).message,
      },
    });
    if (!(failure instanceof ContentPostRenderError) && isProviderBillingError(failure)) {
      /// 1025 真机验收：OpenAI 无额度时这里写的是「出图失败，请重试」——重试只会再失败。
      throw new ContentPostRenderError(
        "配图服务暂时不可用：AI 出图服务正在恢复，我们已在处理。已出的图都保留着，恢复后再点一次即可。",
        "provider_unavailable",
      );
    }
    throw failure instanceof ContentPostRenderError
      ? failure
      : new ContentPostRenderError("出图失败，请重试", "provider");
  }

  /// 视觉素材齐了才算 READY —— READY 的语义是「可以交给青砚发布」。
  /// CAS：只有仍是草稿、且锁还是自己的，才写 READY；出图期间被取消的不复活。
  const completed = await db.contentPost.updateMany({
    where: { id: post.id, status: "DRAFT", renderStartedAt: lockedAt },
    data: {
      renderedImageUrls: urls,
      renderedAt: now(),
      renderError: null,
      renderStartedAt: null,
      status: "READY",
    },
  });
  if (completed.count !== 1) {
    /// 出图期间被取消：图照样落库（取消要保留素材），只是不改状态。
    await db.contentPost.updateMany({
      where: { id: post.id, renderStartedAt: lockedAt },
      data: { renderedImageUrls: urls, renderedAt: now(), renderStartedAt: null },
    });
    throw new ContentPostRenderError(
      "出图期间这条内容已被取消，已出的图都保留着",
      "discarded",
    );
  }

  return { urls, skipped: false };
}

/**
 * 图齐了但状态还是草稿（旧数据 / 上次收尾写失败）：只在仍为草稿、且无人在渲染时补成 READY。
 */
async function promoteCompletedDraft(postId: string, now: Date): Promise<void> {
  await db.contentPost.updateMany({
    where: {
      id: postId,
      status: "DRAFT",
      OR: [
        { renderStartedAt: null },
        { renderStartedAt: { lt: new Date(now.getTime() - RENDER_LOCK_TTL_MS) } },
      ],
    },
    data: { status: "READY", renderError: null, renderStartedAt: null },
  });
}

async function isRenderCancelled(postId: string): Promise<boolean> {
  const live = await db.contentPost.findFirst({
    where: { id: postId },
    select: { status: true },
  });
  return live?.status !== "DRAFT";
}

async function releaseRenderLock(postId: string, lockedAt: Date): Promise<void> {
  await db.contentPost.updateMany({
    where: { id: postId, renderStartedAt: lockedAt },
    data: { renderStartedAt: null },
  });
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
