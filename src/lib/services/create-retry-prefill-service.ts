import { db } from "@/lib/db";

/**
 * 成品库「重新生成」→ /app/create?retry=<orderId> 的预填数据。
 *
 * 只按属主读（createdById = 当前用户），别人的订单一律当作不存在。预填的是
 * 商家当时真正交给我们的东西：出故事板用的那几张产品照片（MediaAsset，仍归本人
 * 所有的才带上）+ 创作描述 + 时长 / 画幅。不复制任何生成结果，也不自动提交——
 * 用户在创作台确认后照常走「故事板 → 确认 → 生成」，每一步都可取消。
 */
export interface CreateRetryPrefill {
  orderId: string;
  prompt: string;
  durationSec: 15 | 30 | 60 | null;
  aspectRatio: "9:16" | "16:9" | "1:1" | null;
  productAssets: Array<{
    id: string;
    url: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  }>;
}

const RETRY_DURATIONS = [15, 30, 60] as const;
const RETRY_ASPECT_RATIOS = ["9:16", "16:9", "1:1"] as const;
const MAX_PROMPT_CHARS = 4_000;

export async function loadCreateRetryPrefill(
  orderId: string,
  userId: string,
): Promise<CreateRetryPrefill | null> {
  const id = orderId.trim();
  if (!id || id.length > 200) return null;
  const order = await db.deliveryOrder.findFirst({
    where: { id, createdById: userId, productCategory: "unified_input" },
    select: {
      id: true,
      productInput: true,
      rounds: {
        orderBy: { roundIndex: "desc" },
        take: 5,
        select: {
          angles: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: {
              videoBrief: {
                select: {
                  durationSec: true,
                  targetDurationSec: true,
                  aspectRatio: true,
                  storyboardRun: {
                    select: {
                      userId: true,
                      sourcePrompt: true,
                      durationSec: true,
                      aspectRatio: true,
                      inputAssetIds: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) return null;

  const briefs = order.rounds
    .map((round) => round.angles[0]?.videoBrief ?? null)
    .filter((brief): brief is NonNullable<typeof brief> => brief !== null);
  // 最近一轮优先；没有故事板（历史订单）就退回最近的 brief 只取时长画幅。
  const brief = briefs.find((candidate) => candidate.storyboardRun) ?? briefs[0] ?? null;
  const storyboard =
    brief?.storyboardRun && brief.storyboardRun.userId === userId
      ? brief.storyboardRun
      : null;

  const prompt = (rawPromptFrom(order.productInput) ?? storyboard?.sourcePrompt ?? "")
    .trim()
    .slice(0, MAX_PROMPT_CHARS);
  const durationSec = pickDuration(
    storyboard?.durationSec,
    brief?.targetDurationSec,
    brief?.durationSec,
  );
  const aspectRatio = pickAspectRatio(storyboard?.aspectRatio ?? brief?.aspectRatio);

  const assetIds = [...new Set(storyboard?.inputAssetIds ?? [])];
  const assets = assetIds.length
    ? await db.mediaAsset.findMany({
        where: { id: { in: assetIds }, userId },
        select: { id: true, url: true, mimeType: true, width: true, height: true },
      })
    : [];
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const productAssets = assetIds
    .map((assetId) => byId.get(assetId))
    .filter((asset): asset is NonNullable<typeof asset> =>
      Boolean(asset && asset.mimeType.toLowerCase().startsWith("image/")),
    );

  if (!prompt && productAssets.length === 0) return null;
  return { orderId: order.id, prompt, durationSec, aspectRatio, productAssets };
}

/** 创作页「接着拍这些商品」的一格：点了就是 /app/create?retry=<orderId>。 */
export interface RecentCreateSource {
  orderId: string;
  /** 当时写的描述（原样；调用方自己去掉开头方向 / 尺寸行再截短显示） */
  prompt: string;
  /** 第一张商品图 */
  thumbnailUrl: string;
  /** 第一张商品图的素材 id：用来判断「这一件是不是已经存成商品档案了」 */
  firstAssetId: string;
  imageCount: number;
}

/**
 * 最近拍过的商品（2026-11-10）：商家回来多半是给同一件商品再拍一条，不该每次重新传图、重新写描述。
 * 不建新表——「一件商品」就是以前某一单用过的那组商品图：按属主取最近的单条创作订单，
 * 同一组图（看第一张）只留最近一次，带回去走的仍是 loadCreateRetryPrefill 那条已有的路。
 * 只读、只按属主；图片已不归本人的那一单不出现。任何失败由调用方兜成空列表。
 */
export async function listRecentCreateSources(userId: string, limit = 4): Promise<RecentCreateSource[]> {
  const orders = await db.deliveryOrder.findMany({
    where: { createdById: userId, productCategory: "unified_input" },
    orderBy: { createdAt: "desc" },
    take: 24,
    select: {
      id: true,
      productInput: true,
      rounds: {
        orderBy: { roundIndex: "desc" },
        take: 1,
        select: {
          angles: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: {
              videoBrief: {
                select: { storyboardRun: { select: { userId: true, sourcePrompt: true, inputAssetIds: true } } },
              },
            },
          },
        },
      },
    },
  });
  const candidates: Array<{ orderId: string; prompt: string; assetIds: string[] }> = [];
  const seenFirstAsset = new Set<string>();
  for (const order of orders) {
    const storyboard = order.rounds[0]?.angles[0]?.videoBrief?.storyboardRun ?? null;
    if (!storyboard || storyboard.userId !== userId) continue;
    const assetIds = [...new Set(storyboard.inputAssetIds)];
    if (assetIds.length === 0 || seenFirstAsset.has(assetIds[0])) continue;
    const prompt = (rawPromptFrom(order.productInput) ?? storyboard.sourcePrompt ?? "").trim();
    if (!prompt) continue;
    seenFirstAsset.add(assetIds[0]);
    candidates.push({ orderId: order.id, prompt: prompt.slice(0, MAX_PROMPT_CHARS), assetIds });
    if (candidates.length >= limit * 2) break;
  }
  if (candidates.length === 0) return [];
  const firstAssets = await db.mediaAsset.findMany({
    where: { id: { in: candidates.map((candidate) => candidate.assetIds[0]) }, userId },
    select: { id: true, url: true, mimeType: true },
  });
  const urlById = new Map(
    firstAssets
      .filter((asset) => asset.mimeType.toLowerCase().startsWith("image/"))
      .map((asset) => [asset.id, asset.url]),
  );
  return candidates
    .filter((candidate) => urlById.has(candidate.assetIds[0]))
    .slice(0, limit)
    .map((candidate) => ({
      orderId: candidate.orderId,
      prompt: candidate.prompt,
      thumbnailUrl: urlById.get(candidate.assetIds[0]) as string,
      firstAssetId: candidate.assetIds[0],
      imageCount: candidate.assetIds.length,
    }));
}

/**
 * 给创作页用的可选装饰：读不到就当没有，并留一行日志——页面照常能创作。
 * 页面加载器不许把服务失败吞成空数据（RF-012：那会让「坏了」看起来像「你什么都没有」）；
 * 这一条不显示任何「你还没有…」的空态，读不到只是这一行不出现，所以在服务层兜住、把原因记下来。
 */
export async function loadRecentCreateSourcesOrNone(userId: string, limit = 4): Promise<RecentCreateSource[]> {
  try {
    return await listRecentCreateSources(userId, limit);
  } catch (error) {
    console.warn("[create] recent sources unavailable:", error instanceof Error ? error.message : String(error));
    return [];
  }
}

function rawPromptFrom(productInput: unknown): string | null {
  if (!productInput || typeof productInput !== "object" || Array.isArray(productInput)) {
    return null;
  }
  const raw = (productInput as Record<string, unknown>).rawPrompt;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function pickDuration(...values: Array<number | null | undefined>): 15 | 30 | 60 | null {
  for (const value of values) {
    if ((RETRY_DURATIONS as readonly number[]).includes(value ?? -1)) {
      return value as 15 | 30 | 60;
    }
  }
  return null;
}

function pickAspectRatio(value: string | null | undefined): "9:16" | "16:9" | "1:1" | null {
  return (RETRY_ASPECT_RATIOS as readonly string[]).includes(value ?? "")
    ? (value as "9:16" | "16:9" | "1:1")
    : null;
}
