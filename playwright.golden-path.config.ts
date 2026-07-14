import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const port = 3120;
const rehearsalDatabaseUrl = process.env.NEON_REHEARSAL_DATABASE_URL?.trim();
if (!rehearsalDatabaseUrl) {
  throw new Error("Golden path requires NEON_REHEARSAL_DATABASE_URL");
}

const baseURL = `http://localhost:${port}`;
const runId = process.env.GOLDEN_PATH_RUN_ID?.trim()
  || `gp-${Date.now()}-${randomUUID().slice(0, 8)}`;
const emailSuffix = runId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(-60);
const runtimeEnv: Record<string, string> = {
  DATABASE_URL: rehearsalDatabaseUrl,
  NEON_REHEARSAL_DATABASE_URL: rehearsalDatabaseUrl,
  GOLDEN_PATH_RUN_ID: runId,
  GOLDEN_PATH_EMAIL: `golden-${emailSuffix}@aivora.invalid`,
  NEXTAUTH_URL: baseURL,
  AUTH_URL: baseURL,
  NEXT_PUBLIC_APP_URL: baseURL,
  AUTH_SECRET: "golden-path-local-auth-secret-2026",
  AIVORA_DRY_RUN: "1",
  VIDEO_PROVIDER: "mock",
  VIDEO_PROVIDER_DEFAULT: "mock",
  VIDEO_ENGINE_MOCK: "true",
  VIDEO_ENGINE_MOCK_LATENCY_MS: "0",
  MOCK_LATENCY_MS: "0",
  MOCK_LATENCY_JITTER: "0",
  MOCK_FAILURE_RATE: "0",
  MOCK_STALL_RATE: "0",
  MOCK_OUTPUT_VIDEO_URL: `${baseURL}/mock-clips/9x16.mp4`,
  LLM_FORCE_MOCK: "true",
  DIRECTOR_FORCE_MOCK: "true",
  SCRIPT_FORCE_MOCK: "true",
  IMAGE_ENGINE_MOCK: "true",
  CONTENT_REVIEW_MOCK: "true",
  FRAME_QA_DISABLED: "true",
  DISPATCH_BREAKER_ENABLED: "false",
  STITCH_RUNTIME: "external",
  CRON_SECRET: "golden-path-local-cron-secret-2026",
  BLOB_READ_WRITE_TOKEN: "",
  BYTEPLUS_ARK_API_KEY: "",
  OPENAI_API_KEY: "",
  shuyu_api_key: "",
};

Object.assign(process.env, runtimeEnv);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /golden-path\.spec\.ts/,
  globalSetup: "./e2e/golden-path-global-setup.ts",
  globalTeardown: "./e2e/golden-path-global-teardown.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["line"],
    ["json", { outputFile: `qa/evidence/phase1/golden-path-${runId}.json` }],
  ],
  outputDir: `test-results/golden-path/${runId}`,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
  },
  webServer: {
    command: `npm run start -- -p ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
