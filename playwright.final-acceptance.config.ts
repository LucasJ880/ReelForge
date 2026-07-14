import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const rehearsalDatabaseUrl = process.env.NEON_REHEARSAL_DATABASE_URL;
if (!rehearsalDatabaseUrl) {
  throw new Error("Final acceptance requires NEON_REHEARSAL_DATABASE_URL");
}
process.env.DATABASE_URL = rehearsalDatabaseUrl;
const baseURL = process.env.FINAL_ACCEPTANCE_BASE_URL ?? `http://localhost:${port}`;
const runId = process.env.FINAL_ACCEPTANCE_RUN_ID ?? `fa-${Date.now()}-${randomUUID().slice(0, 8)}`;
const soakMs = Number(process.env.FINAL_ACCEPTANCE_SOAK_MS ?? "5000");

process.env.FINAL_ACCEPTANCE_RUN_ID = runId;

const runtimeEnv = [
  `FINAL_ACCEPTANCE_RUN_ID=${runId}`,
  `NEXTAUTH_URL=${baseURL}`,
  `AUTH_URL=${baseURL}`,
  "VIDEO_PROVIDER=mock",
  "LLM_FORCE_MOCK=true",
  "VIDEO_ENGINE_MOCK=true",
  "IMAGE_ENGINE_MOCK=true",
  "PRODUCT_IMAGE_RATE_LIMIT_PER_HOUR=100",
  "CONTENT_REVIEW_MOCK=true",
  "FINAL_ACCEPTANCE_REQUIRE_REHEARSAL=true",
  "VIDEO_ENGINE_MOCK_LATENCY_MS=0",
  "STITCH_RUNTIME=local",
  `MOCK_LATENCY_MS=${process.env.MOCK_LATENCY_MS ?? "150"}`,
  "MOCK_FAILURE_RATE=.05",
  "MOCK_STALL_RATE=.02",
  "PROVIDER_STALL_MIN=.0001",
  "WATCHDOG_GRACE_MIN=0",
  "DISPATCH_BREAKER_ENABLED=false",
  "FRAME_QA_DISABLED=true",
  'DATABASE_URL="$NEON_REHEARSAL_DATABASE_URL"',
].join(" ");

export default defineConfig({
  testDir: "./tests/final-acceptance",
  testMatch: /.*\.spec\.ts/,
  globalTeardown: "./tests/final-acceptance/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: Math.max(180_000, soakMs + 120_000),
  expect: { timeout: 20_000 },
  reporter: [
    ["line"],
    [
      "html",
      {
        outputFolder: "playwright-report/final-acceptance",
        open: "never",
      },
    ],
  ],
  outputDir: "test-results/final-acceptance",
  use: {
    baseURL,
    locale: "zh-CN",
    colorScheme: "light",
    trace: "on",
    screenshot: "on",
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "final-acceptance-setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "final-acceptance-desktop",
      dependencies: ["final-acceptance-setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
        storageState: "tests/final-acceptance/.auth/personal.json",
      },
    },
    {
      name: "final-acceptance-mobile",
      dependencies: ["final-acceptance-setup"],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        storageState: "tests/final-acceptance/.auth/personal.json",
      },
    },
  ],
  webServer: {
    command: `npx dotenv -e .env.local -- sh -c '${runtimeEnv} tsx tests/final-acceptance/seed-fixture.ts && ${runtimeEnv} npm run start -- -p ${port}'`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
