export type ShuyuResolution = "1K" | "2K" | "4K";

/** Shuyu 价目表 capabilities.aspect_ratios 的全部合法取值（与 shuyuPriceSchema 同一份枚举）。 */
export const SHUYU_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "9:16",
  "16:9",
] as const;

export type ShuyuAspectRatio = (typeof SHUYU_IMAGE_ASPECT_RATIOS)[number];

export interface AuditedShuyuImagePlan {
  planId: string;
  model: string;
  resolution: ShuyuResolution;
  points: number;
  family: "gpt-image-2";
  /**
   * 价目表声明这档支持的画幅（capabilities.aspect_ratios）。可选：从任务行
   * 重建的计价快照不带它；目录里没声明时解析为空数组——按画幅筛选时视为不支持（fail closed）。
   */
  aspectRatios?: ShuyuAspectRatio[];
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
        aspectRatios: parseAspectRatios(value.capabilities),
      },
    ];
  });

  return { imagePlans };
}

function parseAspectRatios(capabilities: unknown): ShuyuAspectRatio[] {
  if (!isRecord(capabilities) || !Array.isArray(capabilities.aspect_ratios)) return [];
  const known = new Set<string>(SHUYU_IMAGE_ASPECT_RATIOS);
  return [
    ...new Set(
      capabilities.aspect_ratios.filter(
        (ratio): ratio is ShuyuAspectRatio => typeof ratio === "string" && known.has(ratio),
      ),
    ),
  ];
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
 *
 * C2：传 aspectRatio 时只在价目表声明支持该画幅的档位里选（图文帖要 2:3 竖版）；
 * 不传则不按画幅筛选（故事板 / 产品图的既有行为不变）。
 */
export function selectAuditedImage2Plan(
  catalog: ShuyuCatalog,
  resolution: ShuyuResolution,
  options: { aspectRatio?: ShuyuAspectRatio } = {},
): AuditedShuyuImagePlan {
  const image2 = catalog.imagePlans.filter(
    (candidate) => candidate.family === "gpt-image-2",
  );
  if (image2.length === 0) {
    throw new ShuyuPlanUnavailableError("Image 2 is unavailable");
  }
  const aspectRatio = options.aspectRatio;
  const framed = aspectRatio
    ? image2.filter((candidate) => candidate.aspectRatios?.includes(aspectRatio) ?? false)
    : image2;
  if (framed.length === 0) {
    throw new ShuyuPlanUnavailableError(
      `Image 2 with aspect ratio ${aspectRatio} is unavailable`,
    );
  }
  const wanted = RESOLUTION_RANK[resolution];
  const atOrAbove = framed.filter(
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
