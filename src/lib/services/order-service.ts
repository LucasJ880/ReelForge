import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export interface CreateOrderArgs {
  title: string;
  productCategory?: string;
  targetPlatform?: string;
  targetCountry: string;
  targetLanguage: string;
  targetRegionVariant?: string;
  productInput: Record<string, unknown>;
  maxRounds?: number;
  createdById: string;
}

export async function createDeliveryOrder(args: CreateOrderArgs) {
  return db.deliveryOrder.create({
    data: {
      title: args.title,
      productCategory: args.productCategory ?? "pet_products",
      targetPlatform: args.targetPlatform ?? "tiktok",
      targetCountry: args.targetCountry,
      targetLanguage: args.targetLanguage,
      targetRegionVariant: args.targetRegionVariant ?? null,
      productInput: args.productInput as unknown as Prisma.InputJsonValue,
      maxRounds: args.maxRounds ?? 3,
      createdById: args.createdById,
      status: "DRAFT",
    },
  });
}

export async function listDeliveryOrders(
  params: {
    status?: string;
    skip?: number;
    take?: number;
  } = {},
) {
  const where = params.status ? { status: params.status as never } : {};
  const [items, total] = await Promise.all([
    db.deliveryOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        marketResearch: { select: { status: true } },
        rounds: {
          orderBy: { roundIndex: "desc" },
          take: 1,
          select: { id: true, roundIndex: true, status: true },
        },
        _count: { select: { sellingPoints: true, rounds: true } },
      },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    }),
    db.deliveryOrder.count({ where }),
  ]);
  return { items, total };
}

export async function getDeliveryOrderDetail(id: string) {
  return db.deliveryOrder.findUnique({
    where: { id },
    include: {
      marketResearch: true,
      sellingPoints: { orderBy: { rank: "asc" } },
      rounds: {
        orderBy: { roundIndex: "asc" },
        include: {
          angles: {
            orderBy: { sortOrder: "asc" },
            include: {
              videoBrief: {
                include: {
                  scripts: { where: { isCurrent: true } },
                  adEditPlans: { orderBy: { createdAt: "desc" } },
                  qaReviews: { orderBy: { createdAt: "desc" }, take: 1 },
                  publishRecords: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    include: { metricsSnapshots: true },
                  },
                  videoJobs: { orderBy: { createdAt: "desc" } },
                },
              },
              sourceDistillation: true,
            },
          },
          scoreReports: { orderBy: { createdAt: "desc" } },
        },
      },
      distillations: { orderBy: { createdAt: "desc" } },
      rawAssets: {
        orderBy: { createdAt: "desc" },
        include: { shots: { orderBy: { shotIndex: "asc" } } },
      },
      createdBy: { select: { email: true, name: true } },
    },
  });
}
