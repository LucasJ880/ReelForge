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

export function selectAuditedImage2Plan(
  catalog: ShuyuCatalog,
  resolution: ShuyuResolution,
): AuditedShuyuImagePlan {
  const plan = catalog.imagePlans.find(
    (candidate) => candidate.family === "gpt-image-2" && candidate.resolution === resolution,
  );
  if (!plan) throw new ShuyuPlanUnavailableError(`Image 2 ${resolution} is unavailable`);
  return plan;
}
