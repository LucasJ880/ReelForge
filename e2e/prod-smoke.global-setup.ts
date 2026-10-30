import { request, type FullConfig } from "@playwright/test";
import { checkLiveRelease, readRelease } from "./prod-smoke-helpers";

/// 部署成功到生产别名切过来之间可能有几十秒；等不到就整轮不跑，免得把上一版测成「这一版没问题」
const RELEASE_WAIT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

/**
 * 发布后冒烟开跑前：确认生产别名上跑的就是工作流要测的那次部署（GET /api/health 的 release）。
 * 没给 PROD_SMOKE_EXPECTED_RELEASE（手动跑）就不等；health 不报 release 时核对不了，提示后照常跑。
 */
export default async function prodSmokeGlobalSetup(config: FullConfig): Promise<void> {
  const expected = process.env.PROD_SMOKE_EXPECTED_RELEASE?.trim().toLowerCase();
  if (!expected) return;
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("playwright.prod-smoke.config.ts 没配 baseURL");

  const api = await request.newContext({ baseURL });
  try {
    const deadline = Date.now() + RELEASE_WAIT_MS;
    for (;;) {
      const response = await api.get("/api/health", { failOnStatusCode: false }).catch(() => null);
      const health: unknown = await response?.json().catch(() => null);
      const check = checkLiveRelease(health, expected);
      if (check.kind === "match") {
        console.log(`[prod-smoke] ${baseURL} 已在跑 ${check.live}`);
        return;
      }
      if (check.kind === "unknown" && response?.ok()) {
        console.warn(`[prod-smoke] /api/health 没报 release，核对不了别名上是不是 ${expected}，照常开跑`);
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `${baseURL} 等了 ${RELEASE_WAIT_MS / 60_000} 分钟仍不是部署 ${expected}`
            + `（现在：${readRelease(health) ?? `health ${response?.status() ?? "无响应"}`}）。`
            + "生产部署没被提升到别名，或别名切换卡住了。",
        );
      }
      console.log(`[prod-smoke] 等别名切到 ${expected}（现在：${readRelease(health) ?? "未知"}）`);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } finally {
    await api.dispose();
  }
}
