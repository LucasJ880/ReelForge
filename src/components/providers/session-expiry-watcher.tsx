"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

/**
 * 会话过期的可见出口。
 *
 * middleware 只在「发起导航」时才把过期用户送回登录页。一个开着不动的标签页
 * 在会话过期后仍然看起来是登录状态，用户点什么都只会拿到静默 401 —— 这正是
 * 「登录进去好像永远不会过期，直到突然什么都点不动」的来源。
 *
 * 这里监听 next-auth 的 session 状态（默认在窗口重新获得焦点时复核）：一旦从
 * 已登录变为未登录，立刻带着 from + reason 跳回登录页，由登录页解释发生了什么。
 */
export function SessionExpiryWatcher() {
  const { status } = useSession();
  const pathname = usePathname();
  const wasAuthenticated = useRef(false);
  const redirecting = useRef(false);

  useEffect(() => {
    if (status === "authenticated") {
      wasAuthenticated.current = true;
      return;
    }
    if (status !== "unauthenticated") return;
    /// 从未登录过（公开页）不打扰；只处理「登录态掉了」这一种情况
    if (!wasAuthenticated.current || redirecting.current) return;
    redirecting.current = true;
    const target = new URL("/login", window.location.origin);
    target.searchParams.set("from", pathname || "/app");
    target.searchParams.set("reason", "expired");
    window.location.assign(target.toString());
  }, [pathname, status]);

  return null;
}
