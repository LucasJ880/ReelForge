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
