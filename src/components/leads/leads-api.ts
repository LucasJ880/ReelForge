/**
 * 询盘相关表单的浏览器端请求件：只发 JSON、只读 reason / fallback 字段。
 * 纯 fetch，不引任何服务端模块（client-bundle-safety 守着）。
 */

export type ApiOutcome<T = Record<string, unknown>> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; reason: string; fallbackPhone?: string; fallbackEmail?: string };

export async function sendJson<T = Record<string, unknown>>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "GET",
  body?: unknown,
): Promise<ApiOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, reason: "network" };
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    /// 非 JSON（网关错误页等）：按状态码处理
  }
  if (response.ok) return { ok: true, status: response.status, data: payload as T };
  return {
    ok: false,
    status: response.status,
    reason: typeof payload.reason === "string" ? payload.reason : response.status === 429 ? "rate_limited" : "unavailable",
    fallbackPhone: typeof payload.fallbackPhone === "string" ? payload.fallbackPhone : undefined,
    fallbackEmail: typeof payload.fallbackEmail === "string" ? payload.fallbackEmail : undefined,
  };
}

/** 去掉空白字段：可选项留空时不发空串。 */
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => !(typeof item === "string" && item.trim() === "")),
  ) as Partial<T>;
}
