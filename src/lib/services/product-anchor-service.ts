import type { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { db } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";
import {
  cutoutProduct,
  CutoutFailedError,
  CutoutUnavailableError,
  isCutoutAvailable,
} from "@/lib/providers/cutout";
import type { LogoBox } from "@/lib/services/logo-fidelity-gate";

/**
 * B1 · 产品身份锚定三层管线的第 0 层（PRD §5 / M5）。
 *
 * 一个 SKU 做一次，之后所有内容复用。锚点 = RGBA 切片 + mask + logo 区域框。
 *
 * 抠图 key 未配置时锚点停在 PENDING_CUTOUT，**不做假成功** ——
 * 假装处理过会让下游把整图当成 RGBA 切片用，那正是「整图重绘」那一档。
 * key 配上后跑 processPendingAnchors() 即可续上，不需要商家重新提交。
 */

export type CreateAnchorArgs = {
  userId: string;
  sku: string;
  sourceImageUrl: string;
  brandName?: string | null;
  /// 用户框一次 logo 区域（归一化坐标）。
  /// 一次性人工换 100% 可靠基准 —— 比让模型猜框可靠得多。
  logoBox?: LogoBox | null;
};

export async function createProductAnchor(args: CreateAnchorArgs) {
  const anchor = await db.productAnchor.upsert({
    where: { userId_sku: { userId: args.userId, sku: args.sku } },
    create: {
      userId: args.userId,
      sku: args.sku,
      sourceImageUrl: args.sourceImageUrl,
      brandName: args.brandName ?? null,
      logoBoxJson: args.logoBox ?? undefined,
    },
    update: {
      /// 换图 = 重新锚定：切片与 mask 作废，回到待抠图。
      sourceImageUrl: args.sourceImageUrl,
      brandName: args.brandName ?? null,
      logoBoxJson: args.logoBox ?? undefined,
      cutoutUrl: null,
      maskUrl: null,
      status: "PENDING_CUTOUT",
      failureReason: null,
    },
  });

  if (!isCutoutAvailable()) {
    /// 明确停在待抠图，界面上能看到原因。这不是失败态：key 到位就能续跑。
    return db.productAnchor.update({
      where: { id: anchor.id },
      data: {
        failureReason:
          "等待抠图服务接入（remove.bg / Clipdrop 商用 key 待配置）",
      },
    });
  }

  return runCutout(anchor.id);
}

/**
 * 执行抠图并派生 mask。独立出来是为了 key 后配的场景：
 * `processPendingAnchors` 扫 PENDING_CUTOUT 逐个续跑。
 */
/**
 * logoBoxJson 是 Json 列，读回来要防御性校验：
 * 不是合法归一化框就当没有，宁可全图抠也不给 remove.bg 喂坏 roi。
 */
export function parseStoredLogoBox(value: unknown): LogoBox | null {
  if (typeof value !== "object" || value === null) return null;
  const box = value as Record<string, unknown>;
  const nums = [box.x, box.y, box.width, box.height];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return null;
  }
  const { x, y, width, height } = box as unknown as LogoBox;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x + width > 1.001 || y + height > 1.001) return null;
  return { x, y, width, height };
}

export async function runCutout(anchorId: string) {
  const anchor = await db.productAnchor.findUniqueOrThrow({
    where: { id: anchorId },
  });

  try {
    const sourceRes = await fetch(anchor.sourceImageUrl);
    if (!sourceRes.ok) {
      throw new Error(`原图取不到：HTTP ${sourceRes.status}`);
    }
    const source = Buffer.from(await sourceRes.arrayBuffer());

    /// 商家框选的产品区域先作为 remove.bg 的 roi：
    /// 生活场景照没有它会抠错主体（B1 验收实测把餐桌椅当成了产品）。
    const box = parseStoredLogoBox(anchor.logoBoxJson);
    let cutout;
    try {
      cutout = await cutoutProduct(source, { roi: box });
    } catch (err) {
      /// 0803 UI 验收实测：贴边产品（窗帘/百叶整窗照）加 roi 后 remove.bg
      /// 整体报 unknown_foreground——连近全幅框都失败，而全图抠是成功的。
      /// 所以 roi 失败时退回全图抠，把框改用为下面的**事后校验**：
      /// 抠错主体依然会被拒掉，不做假成功。
      const roiRejected =
        box !== null &&
        err instanceof CutoutFailedError &&
        /unknown_foreground/.test(err.message);
      if (!roiRejected) throw err;
      cutout = await cutoutProduct(source);
    }
    const { rgba, provider } = cutout;
    const mask = await maskFromAlpha(rgba);

    if (box) {
      const coverage = await maskCoverageInBox(mask, box);
      if (coverage < MIN_BOX_COVERAGE) {
        return db.productAnchor.update({
          where: { id: anchor.id },
          data: {
            status: "FAILED",
            failureReason:
              `抠出的主体只有 ${Math.round(coverage * 100)}% 落在框选区域内，` +
              "很可能把框外物体当成了产品。请换主体更突出的产品照，或调整框选范围后重试。",
          },
        });
      }
    }

    const storage = getStorageProvider();
    const prefix = `product-anchors/${anchor.id}`;
    const [cutoutObj, maskObj] = await Promise.all([
      storage.uploadBuffer("renders", rgba, {
        key: `${prefix}/cutout.png`,
        access: "public",
        contentType: "image/png",
        overwrite: true,
      }),
      storage.uploadBuffer("renders", mask, {
        key: `${prefix}/mask.png`,
        access: "public",
        contentType: "image/png",
        overwrite: true,
      }),
    ]);

    return db.productAnchor.update({
      where: { id: anchor.id },
      data: {
        cutoutUrl: cutoutObj.url,
        maskUrl: maskObj.url,
        cutoutProvider: provider,
        status: "READY",
        failureReason: null,
      },
    });
  } catch (err) {
    if (err instanceof CutoutUnavailableError) {
      /// key 没配不算失败，留在待抠图。
      return db.productAnchor.update({
        where: { id: anchor.id },
        data: { failureReason: err.message },
      });
    }
    return db.productAnchor.update({
      where: { id: anchor.id },
      data: {
        status: "FAILED",
        failureReason: (err as Error).message.slice(0, 500),
      },
    });
  }
}

/** 品牌页锚点列表：一个商家的 SKU 通常个位数，不分页。 */
export async function listProductAnchorsForUser(userId: string) {
  return db.productAnchor.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

/** 归属校验：查不到与不属于同样返回 null，路由层统一 404，不泄露存在性。 */
export async function getOwnedProductAnchor(userId: string, anchorId: string) {
  return db.productAnchor.findFirst({ where: { id: anchorId, userId } });
}

/** processPendingAnchors 的可注入依赖：测试不打库、不打 remove.bg。 */
export type PendingAnchorRunner = {
  listPending: (limit: number) => Promise<Array<{ id: string }>>;
  runCutout: (anchorId: string) => Promise<{ status: string }>;
  now: () => number;
};

const defaultPendingAnchorRunner: PendingAnchorRunner = {
  listPending: (limit) =>
    db.productAnchor.findMany({
      where: { status: "PENDING_CUTOUT" },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true },
    }),
  runCutout,
  now: () => Date.now(),
};

export type ProcessPendingAnchorsResult = {
  /** 这次捞到的待抠图锚点数（≤ limit） */
  scanned: number;
  /** 真正跑了抠图的个数（预算用完会少于 scanned） */
  processed: number;
  /** 跑完变成 READY 的个数 */
  ready: number;
  /** 时间预算用完提前停了：剩下的留给下一轮，不算失败 */
  budgetExhausted: boolean;
};

/**
 * key 后配时的续跑入口：扫所有停在待抠图的锚点。
 *
 * P02-E0：加了时间预算——cron 里每轮只处理少量、超时就停，剩下的下一轮接着来；
 * 单个锚点失败由 runCutout 自己落 FAILED / failureReason，不中断整轮。
 */
export async function processPendingAnchors(
  limit = 20,
  options: { budgetMs?: number; runner?: PendingAnchorRunner } = {},
): Promise<ProcessPendingAnchorsResult> {
  const runner = options.runner ?? defaultPendingAnchorRunner;
  const startedAt = runner.now();
  const pending = await runner.listPending(limit);
  let ready = 0;
  let processed = 0;
  let budgetExhausted = false;
  for (const anchor of pending) {
    if (options.budgetMs !== undefined && runner.now() - startedAt >= options.budgetMs) {
      budgetExhausted = true;
      break;
    }
    const updated = await runner.runCutout(anchor.id);
    processed += 1;
    if (updated.status === "READY") ready += 1;
  }
  return { scanned: pending.length, processed, ready, budgetExhausted };
}

/* ── P02-E0 · cron 接线（默认关） ─────────────────────────────────────── */

/** 每轮 cron 最多处理的锚点数与总时间预算：poll-videos 还要给视频轮询与帧质检留时间。 */
export const ANCHOR_CUTOUT_CRON_LIMIT = 5;
export const ANCHOR_CUTOUT_CRON_BUDGET_MS = 20_000;

/** `PRODUCT_ANCHOR_CUTOUT_CRON=on` 才开；默认关。接受 on / 1 / true。 */
export function isAnchorCutoutCronEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): boolean {
  const raw = env.PRODUCT_ANCHOR_CUTOUT_CRON?.trim().toLowerCase();
  return raw === "on" || raw === "1" || raw === "true";
}

export type AnchorCutoutSweepResult =
  | { enabled: false; reason: "flag_off" | "cutout_unavailable" }
  | ({ enabled: true } & ProcessPendingAnchorsResult);

export type AnchorCutoutSweepDeps = {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  isCutoutAvailable: () => boolean;
  processPendingAnchors: (
    limit: number,
    options: { budgetMs: number },
  ) => Promise<ProcessPendingAnchorsResult>;
  log: Pick<Console, "debug">;
};

/**
 * cron 一轮的锚点续跑：开关关着 → 什么都不做；抠图能力不可用（没 key）→ 跳过并打一条 debug，
 * 不去逐个 runCutout 把同一句「等待抠图服务接入」重写 N 遍。
 */
export async function sweepProductAnchorCutouts(
  deps: Partial<AnchorCutoutSweepDeps> = {},
): Promise<AnchorCutoutSweepResult> {
  const env = deps.env ?? process.env;
  if (!isAnchorCutoutCronEnabled(env)) return { enabled: false, reason: "flag_off" };
  const cutoutAvailable = deps.isCutoutAvailable ?? isCutoutAvailable;
  if (!cutoutAvailable()) {
    (deps.log ?? console).debug(
      "[product-anchor] PRODUCT_ANCHOR_CUTOUT_CRON=on 但抠图能力不可用（无 REMOVE_BG_API_KEY / CLIPDROP_API_KEY），本轮跳过",
    );
    return { enabled: false, reason: "cutout_unavailable" };
  }
  const run = deps.processPendingAnchors ?? processPendingAnchors;
  const result = await run(ANCHOR_CUTOUT_CRON_LIMIT, { budgetMs: ANCHOR_CUTOUT_CRON_BUDGET_MS });
  return { enabled: true, ...result };
}

/* ── P02-E0 · 已就绪锚点查找 ─────────────────────────────────────────── */

export type ReadyAnchorCutout = {
  imageUrl: string;
  cutoutUrl: string;
  anchorId: string;
};

export type AnchorLookupClient = Pick<PrismaClient, "productAnchor" | "mediaAsset">;

/**
 * 给一批产品图找已就绪的锚点切片。
 *
 * 先按 sourceImageUrl 精确匹配；匹配不上的用 MediaAsset.sha256 兜底——同一张图重新上传
 * 会得到不同的 blob 地址，但内容哈希一样。两步查询都先按 userId 收窄：锚点是商家私有资产，
 * 不许跨商家借用别人的切片。
 *
 * 返回只含匹配上的图，顺序跟 imageUrls 一致；没匹配到的不占位。
 */
export async function findReadyAnchorCutoutsForImages(
  userId: string,
  imageUrls: readonly string[],
  client: AnchorLookupClient = db,
): Promise<ReadyAnchorCutout[]> {
  const wanted = [...new Set(imageUrls.map((url) => url.trim()).filter(Boolean))];
  if (!userId || wanted.length === 0) return [];

  const readyWhere = { userId, status: "READY" as const, cutoutUrl: { not: null } };
  const select = { id: true, sourceImageUrl: true, cutoutUrl: true } as const;

  const exact = await client.productAnchor.findMany({
    where: { ...readyWhere, sourceImageUrl: { in: wanted } },
    select,
  });
  const bySource = new Map<string, { id: string; cutoutUrl: string }>();
  for (const anchor of exact) {
    if (anchor.cutoutUrl && !bySource.has(anchor.sourceImageUrl)) {
      bySource.set(anchor.sourceImageUrl, { id: anchor.id, cutoutUrl: anchor.cutoutUrl });
    }
  }

  const unmatched = wanted.filter((url) => !bySource.has(url));
  const byUrl = new Map<string, { id: string; cutoutUrl: string }>(bySource);
  if (unmatched.length > 0) {
    /// 兜底：图 → 它的 sha256 → 同哈希的所有地址 → 以其中任一地址为源图的 READY 锚点
    const assets = await client.mediaAsset.findMany({
      where: { userId, url: { in: unmatched } },
      select: { url: true, sha256: true },
    });
    const shaOfUrl = new Map(assets.map((asset) => [asset.url, asset.sha256]));
    const shas = [...new Set(assets.map((asset) => asset.sha256).filter(Boolean))];
    if (shas.length > 0) {
      const sameContent = await client.mediaAsset.findMany({
        where: { userId, sha256: { in: shas } },
        select: { url: true, sha256: true },
      });
      const urlsOfSha = new Map<string, string[]>();
      for (const asset of sameContent) {
        const list = urlsOfSha.get(asset.sha256) ?? [];
        list.push(asset.url);
        urlsOfSha.set(asset.sha256, list);
      }
      const candidateSources = [...new Set(sameContent.map((asset) => asset.url))];
      const anchors = candidateSources.length
        ? await client.productAnchor.findMany({
            where: { ...readyWhere, sourceImageUrl: { in: candidateSources } },
            select,
          })
        : [];
      const anchorBySource = new Map<string, { id: string; cutoutUrl: string }>();
      for (const anchor of anchors) {
        if (anchor.cutoutUrl && !anchorBySource.has(anchor.sourceImageUrl)) {
          anchorBySource.set(anchor.sourceImageUrl, { id: anchor.id, cutoutUrl: anchor.cutoutUrl });
        }
      }
      for (const url of unmatched) {
        const sha = shaOfUrl.get(url);
        if (!sha) continue;
        const hit = (urlsOfSha.get(sha) ?? [])
          .map((source) => anchorBySource.get(source))
          .find((anchor): anchor is { id: string; cutoutUrl: string } => Boolean(anchor));
        if (hit) byUrl.set(url, hit);
      }
    }
  }

  return wanted
    .filter((url) => byUrl.has(url))
    .map((url) => {
      const hit = byUrl.get(url)!;
      return { imageUrl: url, cutoutUrl: hit.cutoutUrl, anchorId: hit.id };
    });
}

/**
 * 抠出的产品像素落在框选区域内的最低比例。
 * 低于它 = 前景大头在框外 = 抠错主体（餐桌椅那一档），判 FAILED。
 * 0.7 留出产品自然超出框选边缘的余量（框只是人手画的近似）。
 */
export const MIN_BOX_COVERAGE = 0.7;

/** 白=产品 mask 中，产品像素落在归一化框内的比例；无产品像素返回 0。 */
export async function maskCoverageInBox(
  mask: Buffer,
  box: LogoBox,
): Promise<number> {
  const { data, info } = await sharp(mask)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const x1 = Math.floor(box.x * info.width);
  const y1 = Math.floor(box.y * info.height);
  const x2 = Math.ceil((box.x + box.width) * info.width);
  const y2 = Math.ceil((box.y + box.height) * info.height);
  let product = 0;
  let inside = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] >= 128) {
        product += 1;
        if (x >= x1 && x < x2 && y >= y1 && y < y2) inside += 1;
      }
    }
  }
  return product === 0 ? 0 : inside / product;
}

/**
 * 从 RGBA 的 alpha 通道派生 mask：白 = 产品，黑 = 背景。
 *
 * 阈值取 128 而不是 >0：抠图边缘有半透明羽化像素，
 * 把它们算进产品会让 mask 边缘带一圈锯齿状的「毛边保护区」。
 */
export async function maskFromAlpha(rgba: Buffer): Promise<Buffer> {
  return sharp(rgba)
    .ensureAlpha()
    .extractChannel("alpha")
    .threshold(128)
    .png()
    .toBuffer();
}

/**
 * 路径 A 的 mask 变换：OpenAI images.edit 的语义是**透明区域才允许重画**。
 * 我们的 mask 是「白=产品」，所以要变成「产品不透明（锁死）、环境透明（可画）」。
 */
export async function toEditableMask(mask: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(mask)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i += 1) {
    const isProduct = data[i] >= 128;
    out[i * 4] = 0;
    out[i * 4 + 1] = 0;
    out[i * 4 + 2] = 0;
    /// 产品像素不透明 = 不许画；环境透明 = 可画。
    out[i * 4 + 3] = isProduct ? 255 : 0;
  }
  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * 路径 B · 贴回合成（PRD §5 第 1 层）：
 * 模型生成环境 → 锚点 RGBA 原位贴回。Shuyu image2 无 mask 能力走这条。
 *
 * 光影匹配（PRD 提到的进阶步骤）此版不做：贴回是确定性操作，
 * 光影匹配是另一个生成问题，混在一起会让「产品像素零重画」这个保证失效。
 */
export async function compositeAnchorOnto(
  environment: Buffer,
  cutout: Buffer,
): Promise<Buffer> {
  const envMeta = await sharp(environment).metadata();
  const width = envMeta.width ?? 1024;
  const height = envMeta.height ?? 1024;

  /// 切片按环境图等比缩放到不超过画面（保持产品原比例，不拉伸）。
  const fitted = await sharp(cutout)
    .resize(width, height, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();

  return sharp(environment)
    .composite([{ input: fitted, gravity: "centre" }])
    .png()
    .toBuffer();
}
