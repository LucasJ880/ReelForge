import { db } from "@/lib/db";
import { SHOWCASE_SAMPLES, type ShowcaseSample } from "@/lib/config/showcase-allowlist";

/**
 * 成品库「客户样片」注入（2026-07-21 内部测试开放；2026-10-25 审计 A10 改为白名单）。
 *
 * 成品库本身按用户硬隔离（createdById = 自己）。为了让新账号也能看到 SunnyShutter 客户的成片，
 * 这里把「样片账号」名下**白名单里点名的**已完成内容以【只读】方式注入进每个用户的成品库。
 *
 * - 来源账号由 SHOWCASE_LIBRARY_EMAIL 指定，默认 demo@aivora.app（SunnyShutter 成片当前发布在此）。
 * - 注入什么由 src/lib/config/showcase-allowlist.ts 决定：默认空 ⇒ 什么都不注入。
 *   之前是把样片账号的全部已完成内容都注入，里面混着不是 SunnyShutter 的测试片。
 * - 通过 LIBRARY_SHOWCASE=off 可一键关闭（无需回滚代码）。
 * - 样片只读：UI 标「样片」，隐藏重新生成 / 品牌封装 / 取消等改动入口，详情 / 批量监控只读浏览；
 *   不计入任何读数（exchange-readings 只数访问者本人的数据）。
 */

const SHOWCASE_EMAIL =
  process.env.SHOWCASE_LIBRARY_EMAIL?.trim() || "demo@aivora.app";

export function isShowcaseEnabled(): boolean {
  return process.env.LIBRARY_SHOWCASE?.trim().toLowerCase() !== "off";
}

/** 白名单按来源拆开的 id 表（去空白、去重）。 */
export type ShowcaseAllowlist = {
  finalVideoIds: string[];
  orderIds: string[];
  batchVideoJobIds: string[];
  contentPostIds: string[];
};

export function showcaseAllowlist(
  samples: readonly ShowcaseSample[] = SHOWCASE_SAMPLES,
): ShowcaseAllowlist {
  const sets = {
    final_video: new Set<string>(),
    order: new Set<string>(),
    batch_video: new Set<string>(),
    content_post: new Set<string>(),
  };
  for (const sample of samples) {
    const id = sample.id.trim();
    if (id && sample.kind in sets) sets[sample.kind].add(id);
  }
  return {
    finalVideoIds: [...sets.final_video],
    orderIds: [...sets.order],
    batchVideoJobIds: [...sets.batch_video],
    contentPostIds: [...sets.content_post],
  };
}

export function isShowcaseAllowlistEmpty(allow: ShowcaseAllowlist): boolean {
  return (
    allow.finalVideoIds.length === 0 &&
    allow.orderIds.length === 0 &&
    allow.batchVideoJobIds.length === 0 &&
    allow.contentPostIds.length === 0
  );
}

/** 批次详情只读展示的前提：这一批里至少有一条被点名的批量样片。 */
export function isShowcaseBatchAllowed(
  jobs: ReadonlyArray<{ id: string }>,
  allow: ShowcaseAllowlist,
): boolean {
  return jobs.some((job) => allow.batchVideoJobIds.includes(job.id));
}

/** 样片账号邮箱 → userId 的进程内缓存，避免每次成品库渲染都查库。 */
let showcaseUserIdCache: Promise<string | null> | undefined;

export function getShowcaseUserId(): Promise<string | null> {
  if (!isShowcaseEnabled()) return Promise.resolve(null);
  if (!showcaseUserIdCache) {
    showcaseUserIdCache = db.adminUser
      .findUnique({ where: { email: SHOWCASE_EMAIL }, select: { id: true } })
      .then((user) => user?.id ?? null)
      .catch(() => {
        // 查库失败不缓存 null，下次渲染重试。
        showcaseUserIdCache = undefined;
        return null;
      });
  }
  return showcaseUserIdCache;
}

/**
 * 当前访问者该看到的样片：样片开启、白名单非空、样片账号存在、且访问者不是样片账号本人。
 * 任一不满足返回 null（什么都不注入）；白名单为空时连样片账号都不查。
 */
export async function resolveShowcaseFor(
  viewerUserId: string,
  samples: readonly ShowcaseSample[] = SHOWCASE_SAMPLES,
): Promise<{ ownerId: string; allow: ShowcaseAllowlist } | null> {
  if (!isShowcaseEnabled()) return null;
  const allow = showcaseAllowlist(samples);
  if (isShowcaseAllowlistEmpty(allow)) return null;
  const ownerId = await getShowcaseUserId();
  if (!ownerId || ownerId === viewerUserId) return null;
  return { ownerId, allow };
}

/**
 * 当前访问者是否应把某账号的内容当作「他人样片」看待（旧入口，保留给其它调用方）：
 * 同 resolveShowcaseFor——白名单为空时也返回 null，默认什么都不露出。
 */
export async function resolveShowcaseSourceFor(
  viewerUserId: string,
): Promise<string | null> {
  return (await resolveShowcaseFor(viewerUserId))?.ownerId ?? null;
}

export const __test__ = {
  resetShowcaseUserIdCache() {
    showcaseUserIdCache = undefined;
  },
};
