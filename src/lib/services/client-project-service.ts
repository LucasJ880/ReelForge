import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  parseClientBrief,
  parseClientBriefPatch,
  type ClientBrief,
  type ClientBriefPatch,
} from "@/lib/schemas/client-brief";
import { getCreativeEvidenceCard } from "./creative-evidence-service";

/**
 * Client Project Service —— Wizard 持久化层。
 *
 * 强制约束（Phase 1.5 收紧）：
 * - **任何写入** clientBrief 都必须通过 writeClientBriefToOrder()，
 *   它会按 完整/部分 两种模式做 zod 校验，不允许直接 db.deliveryOrder.update({ clientBrief: ... })。
 * - **API 层读取** clientBrief 应使用 requireClientBrief()（严格，无效会抛错）；
 * - **UI 层兼容老数据** 才使用 readClientBrief()（解析失败返回 null）。
 *
 * 其它设计要点：
 * - 客户项目仍然挂在现有 DeliveryOrder 上（不引入并行 Project 表）；
 * - selectedCreativeCardId 关系字段直接索引；
 * - 不修改 admin 流程（productInput / sellingPoints / rounds 等保持现有行为）。
 */

export interface InitClientProjectInput {
  /// 选填：如果不传则用 brief.businessName 作为 title
  title?: string;
  brief: ClientBrief;
  /// 创建者（运营或客户自助）
  createdById?: string;
  /// 默认 maxRounds = 1（客户向导版默认只跑一次，不进入赛马）
  maxRounds?: number;
}

export async function initClientProject(input: InitClientProjectInput) {
  const brief = parseClientBrief(input.brief);

  /// targetCountry / targetLanguage / productCategory 是 admin pipeline 的必填，
  /// Wizard 默认填一组安全值，且 productInput 留一个可读的 stub，避免破坏老流程。
  const productCategory = mapIndustryToCategory(brief.industry);
  const targetLanguage = "en";
  const targetCountry = "US";
  const targetRegionVariant = "en-US";

  const selectedCardId = await resolveSelectedCardId(brief.selectedCardSlug);
  const briefForDb = serializeBriefForDb(brief);

  return db.deliveryOrder.create({
    data: {
      title: input.title ?? `${brief.businessName} · ${brief.objective}`,
      productCategory,
      targetPlatform: brief.targetPlatforms[0] ?? "tiktok",
      targetCountry,
      targetLanguage,
      targetRegionVariant,
      maxRounds: input.maxRounds ?? 1,
      createdById: input.createdById ?? null,
      productInput: {
        product_name: brief.businessName,
        target_audience: `Local ${brief.industry} audience`,
        brand_style: brief.brandTone,
        client_brief_summary: brief.keyMessage ?? null,
      } as Prisma.InputJsonValue,
      clientBrief: briefForDb,
      selectedCreativeCardId: selectedCardId ?? null,
    },
  });
}

export async function updateClientBrief(
  deliveryOrderId: string,
  patch: ClientBriefPatch,
) {
  const validated = parseClientBriefPatch(patch);
  const order = await db.deliveryOrder.findUnique({
    where: { id: deliveryOrderId },
    select: { clientBrief: true },
  });
  if (!order) throw new Error("ClientProject 不存在");

  const current = readClientBrief(order.clientBrief);
  const merged = mergeBriefAndPatch(current, validated);

  let selectedCardId: string | null | undefined;
  if (validated.selectedCardSlug !== undefined) {
    if (validated.selectedCardSlug === null) {
      selectedCardId = null;
    } else {
      const id = await resolveSelectedCardId(validated.selectedCardSlug);
      if (!id) {
        throw new Error(
          `选中的创意证据卡 slug="${validated.selectedCardSlug}" 不存在`,
        );
      }
      selectedCardId = id;
    }
  }

  return db.deliveryOrder.update({
    where: { id: deliveryOrderId },
    data: {
      clientBrief: merged,
      ...(selectedCardId !== undefined
        ? { selectedCreativeCardId: selectedCardId }
        : {}),
      ...(validated.businessName ? { title: validated.businessName } : {}),
    },
  });
}

export async function selectCreativeCard(
  deliveryOrderId: string,
  slug: string,
) {
  return updateClientBrief(deliveryOrderId, { selectedCardSlug: slug });
}

export async function getClientProject(deliveryOrderId: string) {
  const order = await db.deliveryOrder.findUnique({
    where: { id: deliveryOrderId },
    include: {
      selectedCreativeCard: true,
    },
  });
  if (!order) return null;
  return {
    order,
    brief: readClientBrief(order.clientBrief),
  };
}

/**
 * 宽容读取：解析失败返回 null。
 * 用于 UI 渲染向导中间态：让 UI 自然引导用户重新填，不抛错。
 */
export function readClientBrief(value: unknown): ClientBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return parseClientBrief(value);
  } catch {
    return null;
  }
}

/**
 * 严格读取：解析失败抛错。
 * 用于 API 层（generate script / storyboard / render）—— 缺关键字段必须停下来让用户回到 Wizard。
 */
export async function requireClientBrief(
  deliveryOrderId: string,
): Promise<ClientBrief> {
  const order = await db.deliveryOrder.findUnique({
    where: { id: deliveryOrderId },
    select: { clientBrief: true },
  });
  if (!order) throw new Error("ClientProject 不存在");
  if (!order.clientBrief) {
    throw new Error(
      "ClientBrief 未填写：请先回到 Wizard Step 1 完成商家信息再继续。",
    );
  }
  /// parseClientBrief throws 内含详细字段，方便前端展示
  return parseClientBrief(order.clientBrief);
}

/**
 * 统一写入入口：封装强制 zod parse + 关系字段维护。
 * 任何想直接 db.deliveryOrder.update({ clientBrief }) 的地方，请改用这里。
 */
export async function writeClientBriefToOrder(
  deliveryOrderId: string,
  value: ClientBrief | ClientBriefPatch,
  mode: "full" | "patch",
) {
  if (mode === "full") {
    const brief = parseClientBrief(value);
    const selectedCardId = await resolveSelectedCardId(brief.selectedCardSlug);
    return db.deliveryOrder.update({
      where: { id: deliveryOrderId },
      data: {
        clientBrief: serializeBriefForDb(brief),
        selectedCreativeCardId: selectedCardId ?? null,
        title: brief.businessName,
      },
    });
  }
  return updateClientBrief(deliveryOrderId, value as ClientBriefPatch);
}

/// ---------- 内部工具 ----------

/**
 * 双重保险：合并后再用 partial schema 做一次校验，确保 patch 里没夹带非法字段。
 */
function mergeBriefAndPatch(
  current: ClientBrief | null,
  patch: ClientBriefPatch,
): Prisma.InputJsonValue {
  const merged: Partial<ClientBrief> = { ...(current ?? {}), ...patch };
  /// partial parse —— 不会因 wizard 中间态字段不全而抛错，但会拒绝任何不在 schema 里的字段
  const validated = parseClientBriefPatch(merged);
  return validated as unknown as Prisma.InputJsonValue;
}

function serializeBriefForDb(brief: ClientBrief): Prisma.InputJsonValue {
  /// brief 已经过 parseClientBrief 校验，这里只做类型转换
  return brief as unknown as Prisma.InputJsonValue;
}

async function resolveSelectedCardId(
  slug: string | undefined | null,
): Promise<string | null> {
  if (!slug) return null;
  const card = await getCreativeEvidenceCard(slug);
  if (!card) {
    throw new Error(
      `选中的创意证据卡 slug="${slug}" 不存在，请刷新卡片列表后重试`,
    );
  }
  return card.id;
}

function mapIndustryToCategory(industry: ClientBrief["industry"]) {
  switch (industry) {
    case "real_estate":
      return "local_service";
    case "pet_business":
      return "pet_products";
    case "restaurant":
      return "local_service";
    case "local_service":
      return "local_service";
    default:
      return "other_real_footage_ads";
  }
}
