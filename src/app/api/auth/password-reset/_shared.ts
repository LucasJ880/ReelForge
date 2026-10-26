import { NextResponse } from "next/server";

/**
 * 密码找回两个端点的共用件。middleware 经 `/api/auth` 前缀放行（与注册同一条）；
 * 鉴权之外的守卫都在 handler 里：体积上限 → zod → service（限流 / 令牌校验）。
 */
export { readLimitedJson } from "@/app/api/public/_shared";

/**
 * 与注册路由同一错误体：{ ok: false, code, error }。code 稳定、前端按语言出文案；
 * error 是给日志与旧调用方看的中文。
 */
export function resetFailure<Code extends string>(
  code: Code,
  error: string,
  status: number,
  headers?: Record<string, string>,
) {
  return NextResponse.json({ ok: false, code, error }, { status, headers });
}
