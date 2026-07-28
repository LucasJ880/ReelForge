export type ShuyuResolution = "1K" | "2K" | "4K";

export interface AuditedShuyuImagePlan {
  planId: string;
  model: string;
  resolution: ShuyuResolution;
  points: number;
  family: "gpt-image-2";
}

export interface ShuyuCatalog {
  imagePlans: AuditedShuyuImagePlan[];
}

export class ShuyuPlanUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShuyuPlanUnavailableError";
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResolution(value: unknown): ShuyuResolution | null {
  return value === "1K" || value === "2K" || value === "4K" ? value : null;
}

function isGptImage2Plan(plan: UnknownRecord): boolean {
  const model = typeof plan.model === "string" ? plan.model : "";
  const displayName =
    typeof plan.display_name === "string" ? plan.display_name : "";
  return /gpt[ -]?image[ -]?2/i.test(model) || /gpt[ -]?image[ -]?2/i.test(displayName);
}

/**
 * Maps the live Shuyu price response to only the plans that meet the Image 2
 * contract. Other image models remain intentionally absent from this catalog.
 */
export function parseShuyuCatalog(input: unknown): ShuyuCatalog {
  if (!isRecord(input) || !Array.isArray(input.data)) {
    throw new Error("Shuyu catalog response must contain a plan list");
  }

  const imagePlans = input.data.flatMap((value): AuditedShuyuImagePlan[] => {
    if (!isRecord(value) || value.kind !== "image" || value.status !== "available") {
      return [];
    }
    const resolution = parseResolution(value.resolution);
    const planId = typeof value.plan_id === "string" ? value.plan_id.trim() : "";
    const model = typeof value.model === "string" ? value.model.trim() : "";
    const points = value.sale_points;
    if (
      !resolution ||
      !planId ||
      !model ||
      !Number.isInteger(points) ||
      typeof points !== "number" ||
      points < 0 ||
      !isGptImage2Plan(value)
    ) {
      return [];
    }
    return [
      {
        planId,
        model,
        resolution,
        points,
        family: "gpt-image-2",
      },
    ];
  });

  return { imagePlans };
}

const RESOLUTION_RANK: Record<ShuyuResolution, number> = { "1K": 1, "2K": 2, "4K": 3 };

/**
 * 选取可用的 Image 2 套餐。
 *
 * 合作方会轮换套餐档位：0728 真机实测目录里 1K 整档消失（只剩 2K/4K），
 * 而调用方仍按 "1K" 请求。此前这里做的是分辨率**完全相等**匹配，匹配不到直接抛错，
 * 于是每一帧在 preflight 阶段就失败、故事板全灭、批次卡死在 QUEUED。
 *
 * 现在按「不低于请求档位、同档取积分最低」选取；低档下线时允许向上升级，
 * 但高档下线时必须报错，不能静默降低客户请求的画质。
 */
export function selectAuditedImage2Plan(
  catalog: ShuyuCatalog,
  resolution: ShuyuResolution,
): AuditedShuyuImagePlan {
  const image2 = catalog.imagePlans.filter(
    (candidate) => candidate.family === "gpt-image-2",
  );
  if (image2.length === 0) {
    throw new ShuyuPlanUnavailableError("Image 2 is unavailable");
  }
  const wanted = RESOLUTION_RANK[resolution];
  const atOrAbove = image2.filter(
    (candidate) => RESOLUTION_RANK[candidate.resolution] >= wanted,
  );
  if (atOrAbove.length === 0) {
    throw new ShuyuPlanUnavailableError(
      `Image 2 ${resolution} or higher is unavailable`,
    );
  }
  return [...atOrAbove].sort(
    (a, b) =>
      a.points - b.points ||
      RESOLUTION_RANK[a.resolution] - RESOLUTION_RANK[b.resolution],
  )[0]!;
}
