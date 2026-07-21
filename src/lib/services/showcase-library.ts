import { db } from "@/lib/db";

/**
 * 成品库「客户样片」注入（2026-07-21 内部测试开放）。
 *
 * 成品库本身按用户硬隔离（createdById = 自己）。为了让所有用户——包括新注册的
 * 运营测试账号——都能看到 SunnyShutter 客户的成片，这里把一个「样片账号」名下
 * 的已完成成片以【只读】方式注入进每个用户的成品库。
 *
 * - 来源账号由 SHOWCASE_LIBRARY_EMAIL 指定，默认 demo@aivora.app（SunnyShutter
 *   成片当前发布在此）。
 * - 通过 LIBRARY_SHOWCASE=off 可一键关闭（内部测试结束后即可下线，无需回滚代码）。
 * - 样片只读：UI 隐藏重新生成 / 品牌封装等改动入口，详情/批量监控只读浏览。
 */

const SHOWCASE_EMAIL =
  process.env.SHOWCASE_LIBRARY_EMAIL?.trim() || "demo@aivora.app";

export function isShowcaseEnabled(): boolean {
  return process.env.LIBRARY_SHOWCASE?.trim().toLowerCase() !== "off";
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
 * 当前访问者是否应把某账号的内容当作「他人样片」看待：
 * 样片开启、样片账号存在、且访问者不是样片账号本人。
 */
export async function resolveShowcaseSourceFor(
  viewerUserId: string,
): Promise<string | null> {
  const showcaseUserId = await getShowcaseUserId();
  if (!showcaseUserId || showcaseUserId === viewerUserId) return null;
  return showcaseUserId;
}
