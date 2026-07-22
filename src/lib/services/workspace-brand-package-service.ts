import { Prisma, type MediaAsset } from "@prisma/client";
import { db } from "@/lib/db";

const packageInclude = {
  logoAsset: true,
  endCardAsset: true,
} as const;

export type WorkspaceBrandPackageRecord = Prisma.WorkspaceBrandPackageGetPayload<{
  include: typeof packageInclude;
}>;

export type WorkspaceBrandPackageView = {
  id: string;
  name: string;
  brandName: string;
  slogan: string | null;
  cta: string | null;
  contactLines: string[];
  website: string | null;
  clientProfileId: string | null;
  isDefault: boolean;
  logoAsset: Pick<MediaAsset, "id" | "url" | "mimeType" | "width" | "height">;
  endCardAsset: Pick<MediaAsset, "id" | "url" | "mimeType" | "width" | "height"> | null;
};

export function workspaceBrandPackageView(
  value: WorkspaceBrandPackageRecord,
): WorkspaceBrandPackageView {
  return {
    id: value.id,
    name: value.name,
    brandName: value.brandName,
    slogan: value.slogan,
    cta: value.cta,
    contactLines: [...value.contactLines],
    website: value.website,
    clientProfileId: value.clientProfileId,
    isDefault: value.isDefault,
    logoAsset: {
      id: value.logoAsset.id,
      url: value.logoAsset.url,
      mimeType: value.logoAsset.mimeType,
      width: value.logoAsset.width,
      height: value.logoAsset.height,
    },
    endCardAsset: value.endCardAsset
      ? {
          id: value.endCardAsset.id,
          url: value.endCardAsset.url,
          mimeType: value.endCardAsset.mimeType,
          width: value.endCardAsset.width,
          height: value.endCardAsset.height,
        }
      : null,
  };
}

export async function listWorkspaceBrandPackagesForUser(
  userId: string,
): Promise<WorkspaceBrandPackageView[]> {
  const rows = await db.workspaceBrandPackage.findMany({
    where: { workspace: { ownerId: userId }, isActive: true },
    include: packageInclude,
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(workspaceBrandPackageView);
}

export async function findWorkspaceBrandPackageForUser(
  packageId: string,
  userId: string,
): Promise<WorkspaceBrandPackageRecord | null> {
  return db.workspaceBrandPackage.findFirst({
    where: { id: packageId, workspace: { ownerId: userId }, isActive: true },
    include: packageInclude,
  });
}

export async function upsertWorkspaceBrandPackageForUser(input: {
  userId: string;
  id?: string;
  name: string;
  brandName: string;
  slogan?: string | null;
  cta?: string | null;
  contactLines?: string[];
  website?: string | null;
  clientProfileId?: string | null;
  logoAssetId: string;
  endCardAssetId?: string | null;
  isDefault?: boolean;
}): Promise<WorkspaceBrandPackageView> {
  const workspace = await db.workspace.findUnique({
    where: { ownerId: input.userId },
    select: { id: true },
  });
  if (!workspace) throw new Error("workspace not found");
  const assetIds = [input.logoAssetId, input.endCardAssetId].filter(
    (id): id is string => Boolean(id),
  );
  const assets = await db.mediaAsset.findMany({
    where: { id: { in: assetIds }, userId: input.userId },
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const logo = byId.get(input.logoAssetId);
  const endCard = input.endCardAssetId ? byId.get(input.endCardAssetId) : null;
  if (!logo?.mimeType.startsWith("image/")) throw new Error("owned image logo required");
  if (input.endCardAssetId && !endCard) throw new Error("owned end-card asset required");

  const data = {
    name: input.name.trim(),
    brandName: input.brandName.trim(),
    slogan: input.slogan?.trim() || null,
    cta: input.cta?.trim() || null,
    contactLines: (input.contactLines ?? []).map((line) => line.trim()).filter(Boolean).slice(0, 3),
    website: input.website?.trim() || null,
    clientProfileId: input.clientProfileId?.trim() || null,
    logoAssetId: logo.id,
    endCardAssetId: endCard?.id ?? null,
    isDefault: input.isDefault ?? false,
    isActive: true,
  };

  const row = await db.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.workspaceBrandPackage.updateMany({
        where: { workspaceId: workspace.id, isDefault: true },
        data: { isDefault: false },
      });
    }
    if (input.id) {
      const updated = await tx.workspaceBrandPackage.updateMany({
        where: { id: input.id, workspaceId: workspace.id },
        data,
      });
      if (updated.count !== 1) throw new Error("brand package not found");
      return tx.workspaceBrandPackage.findUniqueOrThrow({
        where: { id: input.id },
        include: packageInclude,
      });
    }
    return tx.workspaceBrandPackage.create({
      data: { ...data, workspaceId: workspace.id },
      include: packageInclude,
    });
  });
  return workspaceBrandPackageView(row);
}
