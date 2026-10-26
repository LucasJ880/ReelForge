import type { Prisma, PrismaClient, ProductAnchor } from "@prisma/client";
import sharp from "sharp";
import { db } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";
import {
  cutoutProduct,
  CutoutFailedError,
  CutoutUnavailableError,
  isCutoutAvailable,
} from "@/lib/providers/cutout";
import type { CapabilityStatus } from "@/lib/capabilities/registry";
import { getCapabilities } from "@/lib/services/capability-status-service";
import type { LogoBox } from "@/lib/services/logo-fidelity-gate";

/**
 * B1 · 产品身份锚定三层管线的第 0 层（PRD §5 / M5）。
 *
 * 一个 SKU 做一次，之后所有内容复用。锚点 = RGBA 切片 + mask + logo 区域框。
 *
 * 抠图 key 未配置时锚点停在 PENDING_CUTOUT，**不做假成功** ——
 * 假装处理过会让下游把整图当成 RGBA 切片用，那正是「整图重绘」那一档。
 * key 配上后跑 processPendingAnchors() 即可续上，不需要商家重新提交。
 *
 * 抠图按张付费，所以每次执行都先原子认领（CAS 在 updatedAt 上），同步路径与 cron 不会为同一张图付两次。
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

/* ── 抠图执行 ───────────────────────────────────────────────────────── */

export type CutoutOutcome =
  /** 切片与 mask 已落库，锚点 READY */
  | "ready"
  /** 这张图自己的问题（原图取不到、抠错主体、上游 5xx）：FAILED，商家可重试 */
  | "failed"
  /** 别人（并发的 cron / 同步新建）已经认领：本次没跑、没付费 */
  | "not_claimed"
  /** 抠图 key 没配：保持 PENDING */
  | "pending_unavailable"
  /** 供应商按账户拒绝（401 / 402 / 403）：不是这张图的问题，保持 PENDING，cron 整轮中止 */
  | "pending_provider_rejected"
  /** 本轮预算用完被中止：保持 PENDING，下一轮继续 */
  | "pending_timeout";

export type RunCutoutDeps = {
  client: Pick<PrismaClient, "productAnchor">;
  fetchImpl: typeof fetch;
  cutout: typeof cutoutProduct;
  storage: typeof getStorageProvider;
  now: () => Date;
};

export type RunCutoutOptions = {
  /** 一路传到原图 fetch 与抠图调用（roi 重试也受同一个信号） */
  signal?: AbortSignal;
  /** cron 的认领事务已经把 updatedAt 写成这个值：跳过自己的认领，直接拿它当 CAS 令牌 */
  claimToken?: Date;
  deps?: Partial<RunCutoutDeps>;
};

const defaultRunCutoutDeps: RunCutoutDeps = {
  client: db,
  fetchImpl: (input, init) => fetch(input, init),
  cutout: cutoutProduct,
  storage: getStorageProvider,
  now: () => new Date(),
};

/** 供应商按账户拒绝：额度用完 / key 被拒。这不是这张图的问题，锚点不该变 FAILED。 */
function isAccountRejection(status: number | undefined): boolean {
  return status === 401 || status === 402 || status === 403;
}

function isAbortError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * 执行抠图并派生 mask，带原子认领。
 *
 * 认领 = 在读到的 updatedAt 上做 CAS（`updateMany where { id, status, updatedAt }`）：
 * 同步路径（新建 / 重试）与 cron 都经过这里，谁先改到谁跑，另一方拿到 not_claimed，
 * 不会为同一张图付两次抠图费。之后每次落库都带同一个 CAS 条件：期间商家换图重新锚定
 * （upsert 会改 updatedAt）就放弃这次结果，不覆盖新图的状态。
 */
export async function runCutoutDetailed(
  anchorId: string,
  options: RunCutoutOptions = {},
): Promise<{ anchor: ProductAnchor; outcome: CutoutOutcome }> {
  const deps: RunCutoutDeps = { ...defaultRunCutoutDeps, ...options.deps };
  const { client } = deps;
  const anchor = await client.productAnchor.findUniqueOrThrow({ where: { id: anchorId } });
  if (anchor.status === "READY") return { anchor, outcome: "ready" };

  let token: Date;
  if (options.claimToken) {
    if (anchor.updatedAt.getTime() !== options.claimToken.getTime()) {
      return { anchor, outcome: "not_claimed" };
    }
    token = options.claimToken;
  } else {
    token = deps.now();
    const claimed = await client.productAnchor.updateMany({
      where: { id: anchor.id, status: anchor.status, updatedAt: anchor.updatedAt },
      data: { updatedAt: token },
    });
    if (claimed.count === 0) {
      return {
        anchor: await client.productAnchor.findUniqueOrThrow({ where: { id: anchorId } }),
        outcome: "not_claimed",
      };
    }
  }

  const commit = async (data: Prisma.ProductAnchorUpdateManyMutationInput) => {
    const written = await client.productAnchor.updateMany({
      where: { id: anchor.id, updatedAt: token },
      data,
    });
    const fresh = await client.productAnchor.findUniqueOrThrow({ where: { id: anchorId } });
    return { anchor: fresh, written: written.count === 1 };
  };

  try {
    const sourceRes = await deps.fetchImpl(anchor.sourceImageUrl, { signal: options.signal });
    if (!sourceRes.ok) {
      throw new Error(`原图取不到：HTTP ${sourceRes.status}`);
    }
    const source = Buffer.from(await sourceRes.arrayBuffer());

    /// 商家框选的产品区域先作为 remove.bg 的 roi：
    /// 生活场景照没有它会抠错主体（B1 验收实测把餐桌椅当成了产品）。
    const box = parseStoredLogoBox(anchor.logoBoxJson);
    let cutout;
    try {
      cutout = await deps.cutout(source, { roi: box, signal: options.signal });
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
      cutout = await deps.cutout(source, { signal: options.signal });
    }
    const { rgba, provider } = cutout;
    const mask = await maskFromAlpha(rgba);

    if (box) {
      const coverage = await maskCoverageInBox(mask, box);
      if (coverage < MIN_BOX_COVERAGE) {
        const result = await commit({
          status: "FAILED",
          failureReason:
            `抠出的主体只有 ${Math.round(coverage * 100)}% 落在框选区域内，` +
            "很可能把框外物体当成了产品。请换主体更突出的产品照，或调整框选范围后重试。",
        });
        return { anchor: result.anchor, outcome: result.written ? "failed" : "not_claimed" };
      }
    }

    const storage = deps.storage();
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

    const result = await commit({
      cutoutUrl: cutoutObj.url,
      maskUrl: maskObj.url,
      cutoutProvider: provider,
      status: "READY",
      failureReason: null,
    });
    return { anchor: result.anchor, outcome: result.written ? "ready" : "not_claimed" };
  } catch (err) {
    if (err instanceof CutoutUnavailableError) {
      /// key 没配不算失败，留在待抠图。
      const result = await commit({ failureReason: err.message });
      return { anchor: result.anchor, outcome: "pending_unavailable" };
    }
    if (isAbortError(err) || options.signal?.aborted) {
      /// 预算到点被中止：不是这张图的问题，保留锚点，下一轮继续。
      const result = await commit({ failureReason: "本轮抠图超时，锚点保留，下一轮继续" });
      return { anchor: result.anchor, outcome: "pending_timeout" };
    }
    if (err instanceof CutoutFailedError && isAccountRejection(err.status)) {
      /// 额度 / key 问题会让整个队列都失败：保持 PENDING，不把队列打成 FAILED；cron 看到它整轮停。
      const result = await commit({
        failureReason: `抠图服务按账户拒绝（HTTP ${err.status}）：额度或 key 问题，锚点保留，处理后自动续跑`,
      });
      return { anchor: result.anchor, outcome: "pending_provider_rejected" };
    }
    const result = await commit({
      status: "FAILED",
      failureReason: (err as Error).message.slice(0, 500),
    });
    return { anchor: result.anchor, outcome: result.written ? "failed" : "not_claimed" };
  }
}

/** 同步路径（新建 / 重试）的入口：只要最终那一行。 */
export async function runCutout(anchorId: string, options: RunCutoutOptions = {}): Promise<ProductAnchor> {
  return (await runCutoutDetailed(anchorId, options)).anchor;
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

/* ── P02-E0 · cron 续跑（开关默认关） ────────────────────────────────── */

/** 每轮 cron 最多处理的锚点数与总时间预算：poll-videos 还要给视频轮询与帧质检留时间。 */
export const ANCHOR_CUTOUT_CRON_LIMIT = 5;
export const ANCHOR_CUTOUT_CRON_BUDGET_MS = 20_000;
/** 预算之外的宽限：个别步骤（sharp 像素运算）不认 AbortSignal，到点仍要把控制权交还 poll-videos。 */
export const ANCHOR_CUTOUT_CRON_GRACE_MS = 2_000;
/**
 * 只捞 updatedAt 早于这个时长的待抠图行：刚新建 / 刚重试的锚点正由同步路径的 runCutout 处理
 * （单次最坏几十秒），cron 两分钟内不碰它；被 cron 认领过（updatedAt 被改到认领时刻）的也一样。
 */
export const ANCHOR_CLAIM_MIN_AGE_MS = 2 * 60_000;
/** pg_try_advisory_xact_lock 的键：只在认领事务内持有，事务结束自动释放，不会泄漏在 pgbouncer 的复用连接上。 */
export const ANCHOR_CUTOUT_LOCK_KEY = 7_204_601;

/** 待抠图候选的 where：单独导出给测试守形状。 */
export function pendingAnchorWhere(olderThan: Date): Prisma.ProductAnchorWhereInput {
  return { status: "PENDING_CUTOUT", updatedAt: { lt: olderThan } };
}

export type ProcessPendingAnchorsResult = {
  /** 这次认领到的待抠图锚点数（≤ limit） */
  scanned: number;
  /** 真正跑了抠图的个数（预算用完 / 整轮中止会少于 scanned） */
  processed: number;
  /** 跑完变成 READY 的个数 */
  ready: number;
  /** 时间预算用完提前停了：剩下的留给下一轮，不算失败 */
  budgetExhausted: boolean;
  /** 另一轮正在认领（没拿到 advisory lock）：本轮什么都没做 */
  locked: boolean;
  /** 整轮被中止的原因；供应商按账户拒绝时停下来，不把队列逐个打成失败 */
  abortedBy: "provider_rejected" | null;
};

export function emptyProcessPendingAnchorsResult(): ProcessPendingAnchorsResult {
  return { scanned: 0, processed: 0, ready: 0, budgetExhausted: false, locked: false, abortedBy: null };
}

/** processPendingAnchors 的可注入依赖：测试不打库、不打 remove.bg。 */
export type PendingAnchorRunner = {
  /**
   * 认领一批：一个事务里拿 xact 级 advisory lock、捞 updatedAt < olderThan 的待抠图行、
   * 逐行 CAS 把 updatedAt 写成 claimAt。拿不到锁返回 null（另一轮正在认领）。
   */
  claimPending: (args: { limit: number; olderThan: Date; claimAt: Date }) => Promise<string[] | null>;
  runCutout: (anchorId: string, options: { signal: AbortSignal; claimToken: Date }) => Promise<{ outcome: CutoutOutcome }>;
  now: () => number;
};

const defaultPendingAnchorRunner: PendingAnchorRunner = {
  claimPending: ({ limit, olderThan, claimAt }) =>
    db.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${ANCHOR_CUTOUT_LOCK_KEY}::bigint) AS locked
      `;
      if (!lock[0]?.locked) return null;
      const pending = await tx.productAnchor.findMany({
        where: pendingAnchorWhere(olderThan),
        orderBy: { createdAt: "asc" },
        take: limit,
        select: { id: true, updatedAt: true },
      });
      const claimed: string[] = [];
      for (const row of pending) {
        const result = await tx.productAnchor.updateMany({
          where: { id: row.id, status: "PENDING_CUTOUT", updatedAt: row.updatedAt },
          data: { updatedAt: claimAt },
        });
        if (result.count === 1) claimed.push(row.id);
      }
      return claimed;
    }),
  runCutout: (anchorId, options) =>
    runCutoutDetailed(anchorId, { signal: options.signal, claimToken: options.claimToken }),
  now: () => Date.now(),
};

/**
 * key 后配时的续跑入口：扫停在待抠图的锚点。
 *
 * P02-E0：原子认领 + 时间预算。每个锚点按剩余预算给 AbortSignal，一路传到原图 fetch 与抠图调用；
 * 供应商按账户拒绝（401 / 402 / 403）时整轮停下，不把队列逐个打成 FAILED。
 */
export async function processPendingAnchors(
  limit = ANCHOR_CUTOUT_CRON_LIMIT,
  options: {
    budgetMs?: number;
    signal?: AbortSignal;
    minAgeMs?: number;
    runner?: PendingAnchorRunner;
    /** 调用方传进来的进度对象：硬 deadline 把本轮打断时还能拿到已完成的计数 */
    progress?: ProcessPendingAnchorsResult;
  } = {},
): Promise<ProcessPendingAnchorsResult> {
  const runner = options.runner ?? defaultPendingAnchorRunner;
  const result = options.progress ?? emptyProcessPendingAnchorsResult();
  const startedAt = runner.now();
  const claimAt = new Date(startedAt);
  const olderThan = new Date(startedAt - (options.minAgeMs ?? ANCHOR_CLAIM_MIN_AGE_MS));

  const claimed = await runner.claimPending({ limit, olderThan, claimAt });
  if (claimed === null) {
    result.locked = true;
    return result;
  }
  result.scanned = claimed.length;

  for (const anchorId of claimed) {
    const remaining = options.budgetMs === undefined ? Number.POSITIVE_INFINITY : options.budgetMs - (runner.now() - startedAt);
    if (remaining <= 0 || options.signal?.aborted) {
      result.budgetExhausted = true;
      break;
    }
    const signals: AbortSignal[] = [];
    if (options.signal) signals.push(options.signal);
    if (Number.isFinite(remaining)) signals.push(AbortSignal.timeout(remaining));
    const signal = signals.length > 0 ? AbortSignal.any(signals) : new AbortController().signal;

    const { outcome } = await runner.runCutout(anchorId, { signal, claimToken: claimAt });
    result.processed += 1;
    if (outcome === "ready") result.ready += 1;
    if (outcome === "pending_timeout") {
      result.budgetExhausted = true;
      break;
    }
    if (outcome === "pending_provider_rejected") {
      result.abortedBy = "provider_rejected";
      break;
    }
  }
  return result;
}

/** `PRODUCT_ANCHOR_CUTOUT_CRON=on` 才开；默认关。接受 on / 1 / true。 */
export function isAnchorCutoutCronEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): boolean {
  const raw = env.PRODUCT_ANCHOR_CUTOUT_CRON?.trim().toLowerCase();
  return raw === "on" || raw === "1" || raw === "true";
}

export type AnchorCutoutSweepResult =
  | { enabled: false; reason: "flag_off" | "cutout_unavailable" | "cutout_capability_paused" }
  | ({ enabled: true; deadlineHit: boolean } & ProcessPendingAnchorsResult);

export type AnchorCutoutSweepDeps = {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  isCutoutAvailable: () => boolean;
  /** 能力状态表里「产品抠图」的当前状态；读不到按 null（放行，交给供应商回答） */
  cutoutCapabilityStatus: () => Promise<CapabilityStatus | null>;
  processPendingAnchors: (
    limit: number,
    options: { budgetMs: number; signal: AbortSignal; progress: ProcessPendingAnchorsResult },
  ) => Promise<ProcessPendingAnchorsResult>;
  log: Pick<Console, "debug">;
  budgetMs: number;
  graceMs: number;
};

async function defaultCutoutCapabilityStatus(): Promise<CapabilityStatus | null> {
  try {
    const view = await getCapabilities();
    return view.items.find((item) => item.key === "cutout")?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * cron 一轮的锚点续跑：
 *  - 开关关着 → 什么都不做；
 *  - 抠图 key 没配，或能力状态表里「产品抠图」已暂停 / 未开通（上一轮 402 / 401 回写过）→ 跳过并打一条 debug，
 *    不去逐个 runCutout 把同一句失败原因重写 N 遍；
 *  - 整轮套硬 deadline（预算 + 宽限）：哪怕某一步不认 AbortSignal，也按时把控制权交还 poll-videos。
 */
export async function sweepProductAnchorCutouts(
  deps: Partial<AnchorCutoutSweepDeps> = {},
): Promise<AnchorCutoutSweepResult> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console;
  if (!isAnchorCutoutCronEnabled(env)) return { enabled: false, reason: "flag_off" };
  const cutoutAvailable = deps.isCutoutAvailable ?? isCutoutAvailable;
  if (!cutoutAvailable()) {
    log.debug(
      "[product-anchor] PRODUCT_ANCHOR_CUTOUT_CRON=on 但抠图能力不可用（无 REMOVE_BG_API_KEY / CLIPDROP_API_KEY），本轮跳过",
    );
    return { enabled: false, reason: "cutout_unavailable" };
  }
  const status = await (deps.cutoutCapabilityStatus ?? defaultCutoutCapabilityStatus)();
  if (status === "unavailable" || status === "not_configured") {
    log.debug(`[product-anchor] 能力状态表里产品抠图=${status}（额度 / key 问题），本轮跳过，不逐个打供应商`);
    return { enabled: false, reason: "cutout_capability_paused" };
  }

  const budgetMs = deps.budgetMs ?? ANCHOR_CUTOUT_CRON_BUDGET_MS;
  const graceMs = deps.graceMs ?? ANCHOR_CUTOUT_CRON_GRACE_MS;
  const run = deps.processPendingAnchors ?? processPendingAnchors;
  const progress = emptyProcessPendingAnchorsResult();
  const controller = new AbortController();
  const budgetTimer = setTimeout(() => controller.abort(), budgetMs);
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    const work = run(ANCHOR_CUTOUT_CRON_LIMIT, { budgetMs, signal: controller.signal, progress });
    const deadline = new Promise<null>((resolve) => {
      deadlineTimer = setTimeout(() => resolve(null), budgetMs + graceMs);
    });
    const result = await Promise.race([work, deadline]);
    if (result === null) {
      /// 没按时回来：带着已完成的计数返回，剩下的锚点留给下一轮（认领过的两分钟后自动回到候选）
      work.catch(() => undefined);
      return { enabled: true, deadlineHit: true, ...progress, budgetExhausted: true };
    }
    return { enabled: true, deadlineHit: false, ...result };
  } finally {
    clearTimeout(budgetTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
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
  /// 查询用去空白后的地址，返回时还原成调用方传进来的原串（调用方要拿它回去对自己的列表）。
  const originalByTrimmed = new Map<string, string>();
  for (const raw of imageUrls) {
    const trimmed = raw.trim();
    if (trimmed && !originalByTrimmed.has(trimmed)) originalByTrimmed.set(trimmed, raw);
  }
  const wanted = [...originalByTrimmed.keys()];
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
      return { imageUrl: originalByTrimmed.get(url) ?? url, cutoutUrl: hit.cutoutUrl, anchorId: hit.id };
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
