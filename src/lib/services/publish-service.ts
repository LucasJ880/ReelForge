import { Prisma, PublishStatus, VideoBriefStatus } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * 发布流程 MVP（半自动）：
 *  1. QA 通过 → 自动创建 PublishRecord (PENDING)
 *  2. 运营点击 /publish/[id]/download → 标记 DOWNLOADED
 *  3. 运营在 TikTok 上传后，在 UI 回填 post_id + url → 标记 UPLOADED
 *  4. 运营确认发布上线 → PUBLISHED；同时触发 MetricsWindow 待抓取
 */

export async function markDownloaded(id: string) {
  return db.publishRecord.update({
    where: { id },
    data: { status: PublishStatus.DOWNLOADED },
  });
}

export async function submitExternalPost(
  id: string,
  params: {
    publishedById: string;
    externalPostId: string;
    publishUrl?: string;
    operatorNote?: string;
    /** 发布到哪个账号。带了它就执行「同一条成片只能登记给一个账号」；旧流程不传，行为不变。 */
    accountLabel?: string;
  },
) {
  if (params.accountLabel === undefined) {
    return db.publishRecord.update({
      where: { id },
      data: {
        status: PublishStatus.UPLOADED,
        externalPostId: params.externalPostId,
        publishUrl: params.publishUrl ?? null,
        publishedById: params.publishedById,
        operatorNote: params.operatorNote ?? null,
      },
    });
  }
  const accountLabel = cleanAccountLabel(params.accountLabel);
  if (!accountLabelKey(accountLabel)) {
    throw new PublishRegistrationInputError("请填写发布到的账号。");
  }
  const target = await db.publishRecord.findUnique({
    where: { id },
    select: { videoBriefId: true, platform: true },
  });
  if (!target) throw new Error("发布记录不存在");
  return prismaPublishRegistrationStore.withBriefLock(
    target.videoBriefId,
    target.platform,
    async (tx) => {
      /// 这一行自己不算「别的账号」：看的是同一条成片在同一平台上的其他有效登记
      const others = (await tx.list(target.videoBriefId, target.platform)).filter(
        (row) => row.id !== id,
      );
      const decision = decidePublishRegistration(others, accountLabel);
      if (decision.action === "reject") {
        throw new PublishAccountConflictError(decision.existingAccountLabel, accountLabel);
      }
      return tx.update(id, {
        accountLabel,
        status: PublishStatus.UPLOADED,
        externalPostId: params.externalPostId,
        publishUrl: params.publishUrl ?? null,
        publishedById: params.publishedById,
        operatorNote: params.operatorNote ?? null,
      });
    },
  );
}

export async function confirmPublished(id: string) {
  const record = await db.publishRecord.update({
    where: { id },
    data: {
      status: PublishStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });
  await db.videoBrief.update({
    where: { id: record.videoBriefId },
    data: { status: VideoBriefStatus.PUBLISHED },
  });
  // 触发数据回流：立即创建 metrics 窗口占位由 metrics-service 负责
  return record;
}

export async function failPublish(id: string, reason: string) {
  return db.publishRecord.update({
    where: { id },
    data: { status: PublishStatus.FAILED, operatorNote: reason },
  });
}

export async function listPendingPublish() {
  return db.publishRecord.findMany({
    where: {
      status: {
        in: [PublishStatus.PENDING, PublishStatus.DOWNLOADED, PublishStatus.UPLOADED],
      },
    },
    orderBy: { createdAt: "asc" },
    include: {
      videoBrief: {
        include: {
          contentAngle: {
            include: { round: { include: { deliveryOrder: true } } },
          },
        },
      },
    },
  });
}

/**
 * 启动赛马轮次 LIVE 状态（当该轮全部 PublishRecord 都 PUBLISHED 时）。
 */
export async function tryTransitionRoundToLive(publishRecordId: string) {
  const record = await db.publishRecord.findUnique({
    where: { id: publishRecordId },
    include: {
      videoBrief: {
        include: { contentAngle: true },
      },
    },
  });
  if (!record) return;
  const roundId = record.videoBrief.contentAngle.roundId;
  const all = await db.contentAngle.findMany({
    where: { roundId },
    include: {
      videoBrief: {
        include: {
          publishRecords: {
            where: { status: PublishStatus.PUBLISHED },
            take: 1,
          },
        },
      },
    },
  });
  const allPublished = all.every(
    (a) => a.videoBrief && a.videoBrief.publishRecords.length > 0,
  );
  if (allPublished) {
    await db.round.update({
      where: { id: roundId },
      data: {
        status: "LIVE",
        startedAt: new Date(),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// 平台发布登记（2026-11-09 · 抖音发布包）
// ---------------------------------------------------------------------------
//
// 运营人工发到抖音之后，回来登记「发到了哪个号、链接是什么」。规则只有一条：
// **同一条成片只能登记给一个账号。** 矩阵号之间发同一条片会被平台判成批量同质化搬运，
// 所以第二个不同账号来登记时直接拒绝，并告诉对方这条片已经归了谁。
// 撤销登记（发错号 / 没发出去）之后，这条片才能改登记给别的账号；撤销只改状态，行保留。

/** 还占着这条成片的登记状态（已撤销 / 失败的不算）。 */
export const ACTIVE_PUBLISH_STATUSES: readonly PublishStatus[] = [
  PublishStatus.PENDING,
  PublishStatus.DOWNLOADED,
  PublishStatus.UPLOADED,
  PublishStatus.PUBLISHED,
];

export class PublishAccountConflictError extends Error {
  readonly code = "PUBLISH_ACCOUNT_CONFLICT";
  constructor(
    readonly existingAccountLabel: string,
    readonly requestedAccountLabel: string,
  ) {
    super(
      `这条成片已登记给账号「${existingAccountLabel}」，同一条成片只能发一个账号。要改发「${requestedAccountLabel}」，请先撤销原登记。`,
    );
    this.name = "PublishAccountConflictError";
  }
}

export class PublishRegistrationInputError extends Error {
  readonly code = "PUBLISH_REGISTRATION_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "PublishRegistrationInputError";
  }
}

/** 列还没加（迁移未执行）时的明确报错：不让它变成一个看不懂的 500。 */
export class PublishRegistrationUnavailableError extends Error {
  readonly code = "PUBLISH_REGISTRATION_UNAVAILABLE";
  constructor() {
    super("发布登记暂不可用：数据库还没有执行 accountLabel 迁移。");
    this.name = "PublishRegistrationUnavailableError";
  }
}

export const ACCOUNT_LABEL_MAX = 60;

/** 账号标签的展示写法：去首尾空白、压缩中间空白。 */
export function cleanAccountLabel(label: string): string {
  return label.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/** 账号标签的比较键：展示写法再去掉开头的 @、不分大小写——「@Aivora好物」和「aivora好物」是同一个号。 */
export function accountLabelKey(label: string | null | undefined): string {
  return cleanAccountLabel(label ?? "").replace(/^@+/u, "").toLowerCase();
}

export interface PublishRegistrationRow {
  id: string;
  platform: string;
  accountLabel: string | null;
  status: PublishStatus;
  publishUrl: string | null;
  externalPostId: string | null;
  operatorNote: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export type PublishRegistrationDecision =
  | { action: "create" }
  | { action: "update"; id: string }
  | { action: "reject"; existingAccountLabel: string };

/**
 * 纯决策：这条成片在该平台上现有的有效登记 + 这次要登记的账号 → 新建 / 更新 / 拒绝。
 *   - 没有有效登记 → 新建；
 *   - 有效登记是同一个账号 → 更新那一行（重复提交、补链接都走这里，幂等）；
 *   - 有效登记是别的账号 → 拒绝。
 * 历史行没有账号标签（null）时归谁无从判断，一律当作「别的账号」拒绝，让人先撤销再登记。
 */
export function decidePublishRegistration(
  existing: ReadonlyArray<Pick<PublishRegistrationRow, "id" | "accountLabel" | "status">>,
  accountLabel: string,
): PublishRegistrationDecision {
  const key = accountLabelKey(accountLabel);
  const active = existing.filter((row) => ACTIVE_PUBLISH_STATUSES.includes(row.status));
  const other = active.find((row) => accountLabelKey(row.accountLabel) !== key);
  if (other) {
    return { action: "reject", existingAccountLabel: other.accountLabel?.trim() || "未标注账号" };
  }
  const same = active[0];
  return same ? { action: "update", id: same.id } : { action: "create" };
}

/** 登记用到的最小数据访问面：生产走 Prisma（带按成片加锁的事务），单测注入内存实现。 */
export interface PublishRegistrationStore {
  /** 在「同一条成片 + 同一平台」的互斥区里执行（两个号同时登记只会有一个成功）。 */
  withBriefLock<T>(
    videoBriefId: string,
    platform: string,
    fn: (tx: PublishRegistrationTx) => Promise<T>,
  ): Promise<T>;
}

export interface PublishRegistrationTx {
  list(videoBriefId: string, platform: string): Promise<PublishRegistrationRow[]>;
  create(data: {
    videoBriefId: string;
    platform: string;
    accountLabel: string;
    status: PublishStatus;
    publishUrl: string | null;
    externalPostId: string | null;
    operatorNote: string | null;
    publishedById: string | null;
    publishedAt: Date | null;
  }): Promise<PublishRegistrationRow>;
  update(
    id: string,
    data: {
      accountLabel?: string;
      status?: PublishStatus;
      publishUrl?: string | null;
      externalPostId?: string | null;
      operatorNote?: string | null;
      publishedById?: string | null;
      publishedAt?: Date | null;
    },
  ): Promise<PublishRegistrationRow>;
}

const registrationSelect = {
  id: true,
  platform: true,
  accountLabel: true,
  status: true,
  publishUrl: true,
  externalPostId: true,
  operatorNote: true,
  publishedAt: true,
  createdAt: true,
} satisfies Prisma.PublishRecordSelect;

function prismaRegistrationTx(tx: Prisma.TransactionClient): PublishRegistrationTx {
  return {
    list: (videoBriefId, platform) =>
      tx.publishRecord.findMany({
        where: { videoBriefId, platform },
        orderBy: { createdAt: "asc" },
        select: registrationSelect,
      }),
    create: (data) => tx.publishRecord.create({ data, select: registrationSelect }),
    update: (id, data) => tx.publishRecord.update({ where: { id }, data, select: registrationSelect }),
  };
}

/** accountLabel 列不存在（P2022）→ 明确的「迁移未执行」，其余原样抛。 */
function mapMissingColumn(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2022") {
    throw new PublishRegistrationUnavailableError();
  }
  throw err;
}

export const prismaPublishRegistrationStore: PublishRegistrationStore = {
  async withBriefLock(videoBriefId, platform, fn) {
    try {
      return await db.$transaction(async (tx) => {
        /// 事务级咨询锁：随事务结束自动释放，走连接池（pgbouncer transaction 模式）也不会泄漏
        /// 用 $executeRaw：pg_advisory_xact_lock 返回 void，$queryRaw 反序列化不了这一列（真库验收踩到 P2010）
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`publish-registration:${platform}:${videoBriefId}`}))`;
        return fn(prismaRegistrationTx(tx));
      });
    } catch (err) {
      return mapMissingColumn(err);
    }
  },
};

/**
 * 登记一条成片发到了哪个平台账号。
 * @throws PublishAccountConflictError 这条成片已登记给另一个账号
 * @throws PublishRegistrationInputError 账号标签为空 / 过长
 */
export async function registerPlatformPublish(
  params: {
    videoBriefId: string;
    platform: string;
    accountLabel: string;
    publishUrl?: string | null;
    externalPostId?: string | null;
    operatorNote?: string | null;
    publishedById?: string | null;
    now?: Date;
  },
  store: PublishRegistrationStore = prismaPublishRegistrationStore,
): Promise<{ record: PublishRegistrationRow; created: boolean }> {
  const accountLabel = cleanAccountLabel(params.accountLabel);
  if (!accountLabelKey(accountLabel)) {
    throw new PublishRegistrationInputError("请填写发布到的账号。");
  }
  if (accountLabel.length > ACCOUNT_LABEL_MAX) {
    throw new PublishRegistrationInputError(`账号标签不能超过 ${ACCOUNT_LABEL_MAX} 个字。`);
  }
  const publishUrl = params.publishUrl?.trim() || null;
  const externalPostId = params.externalPostId?.trim() || null;
  const operatorNote = params.operatorNote?.trim() || null;
  /// 给了作品链接 = 已经发出去了；只登记账号 = 已上传待确认
  const status = publishUrl ? PublishStatus.PUBLISHED : PublishStatus.UPLOADED;
  const publishedAt = publishUrl ? (params.now ?? new Date()) : null;

  return store.withBriefLock(params.videoBriefId, params.platform, async (tx) => {
    const existing = await tx.list(params.videoBriefId, params.platform);
    const decision = decidePublishRegistration(existing, accountLabel);
    if (decision.action === "reject") {
      throw new PublishAccountConflictError(decision.existingAccountLabel, accountLabel);
    }
    if (decision.action === "update") {
      const current = existing.find((row) => row.id === decision.id);
      const record = await tx.update(decision.id, {
        accountLabel,
        status,
        publishUrl,
        externalPostId,
        operatorNote,
        publishedById: params.publishedById ?? null,
        /// 已有发布时间的不往后改
        publishedAt: current?.publishedAt ?? publishedAt,
      });
      return { record, created: false };
    }
    const record = await tx.create({
      videoBriefId: params.videoBriefId,
      platform: params.platform,
      accountLabel,
      status,
      publishUrl,
      externalPostId,
      operatorNote,
      publishedById: params.publishedById ?? null,
      publishedAt,
    });
    return { record, created: true };
  });
}

/**
 * 撤销登记（发错号 / 没发出去）：只改状态为 CANCELLED，行保留。撤销后这条成片可以登记给别的账号。
 * 返回被撤销的行数（0 = 本来就没有有效登记，幂等）。
 */
export async function cancelPlatformPublish(
  params: { videoBriefId: string; platform: string; reason?: string | null },
  store: PublishRegistrationStore = prismaPublishRegistrationStore,
): Promise<{ cancelled: number }> {
  return store.withBriefLock(params.videoBriefId, params.platform, async (tx) => {
    const active = (await tx.list(params.videoBriefId, params.platform)).filter((row) =>
      ACTIVE_PUBLISH_STATUSES.includes(row.status),
    );
    for (const row of active) {
      await tx.update(row.id, {
        status: PublishStatus.CANCELLED,
        ...(params.reason?.trim() ? { operatorNote: params.reason.trim() } : {}),
      });
    }
    return { cancelled: active.length };
  });
}

/** 这条成片在该平台上当前有效的那一条登记（没有 = null）。 */
export async function getActivePlatformPublish(
  videoBriefId: string,
  platform: string,
): Promise<PublishRegistrationRow | null> {
  try {
    return await db.publishRecord.findFirst({
      where: { videoBriefId, platform, status: { in: [...ACTIVE_PUBLISH_STATUSES] } },
      orderBy: { createdAt: "asc" },
      select: registrationSelect,
    });
  } catch (err) {
    return mapMissingColumn(err);
  }
}
