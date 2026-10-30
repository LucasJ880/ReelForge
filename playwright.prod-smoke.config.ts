import { defineConfig, devices } from "@playwright/test";

/// 发布后冒烟（e2e/prod-smoke.spec.ts）：对已经部署的站点跑，不起本地 server、不连任何数据库。
/// 基址必须显式给，免得手滑对错环境跑。仓库是公开的，CI 日志任何人都能看：trace 会录下输入的
/// 密码和会话 cookie，所以默认关掉；本地排查要看就加 `--trace on`（产物在 test-results/，用完删掉）。
const baseURL = process.env.PROD_SMOKE_BASE_URL?.trim().replace(/\/+$/, "");
if (!baseURL) {
  throw new Error("Prod smoke requires PROD_SMOKE_BASE_URL, e.g. https://reelforge-delta.vercel.app");
}

export default defineConfig({
  testDir: "./e2e",
  /// detectors：探测器离线自检，先证明认得出坏样子；spec：对生产的真冒烟
  testMatch: /prod-smoke\.(detectors\.)?spec\.ts$/,
  globalSetup: "./e2e/prod-smoke.global-setup.ts",
  fullyParallel: false,
  forbidOnly: true,
  /// 不重试：冒烟偶发失败本身就是信号（10-30 那种问题重试也只是多传一张图）
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  outputDir: "test-results/prod-smoke",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
    trace: "off",
    video: "off",
    screenshot: "off",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
});
