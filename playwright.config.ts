import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/// .env.local 就是生产库（CLAUDE.md §4）。webServer 先跑视觉夹具种子，种子过 tests/e2e/e2e-db-guard：
/// 没有专用 E2E 库（E2E_DATABASE_URL）、也没有 CONFIRM_PRODUCTION_DB=e2e:seed 就退出码 1、一行不写，
/// dev server 也就起不来——只带 .env.local 跑 `npx playwright test` 不会写生产库。
/// 提供了 E2E_DATABASE_URL 时种子与 dev server 都连它：dotenv-cli 与 next dev 都不覆盖已有变量，
/// .env.local 只补其余密钥。
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL?.trim();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["line"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results/playwright",
  snapshotPathTemplate: "{testDir}/../../visual-baseline/{arg}{ext}",
  use: {
    baseURL,
    locale: "zh-CN",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "desktop",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
        storageState: "tests/e2e/.auth/personal.json",
      },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        storageState: "tests/e2e/.auth/personal.json",
      },
    },
  ],
  webServer: {
    command:
      "npx dotenv -e .env.local -- tsx tests/e2e/seed-visual-fixture.ts && VIDEO_PROVIDER=mock MOCK_LATENCY_MS=25 MOCK_FAILURE_RATE=0 MOCK_STALL_RATE=0 npm run dev",
    env: e2eDatabaseUrl ? { DATABASE_URL: e2eDatabaseUrl, DIRECT_URL: e2eDatabaseUrl } : undefined,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
