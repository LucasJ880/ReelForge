import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const port = 3121;
const rehearsalDatabaseUrl = process.env.NEON_REHEARSAL_DATABASE_URL;
if (!rehearsalDatabaseUrl) {
  throw new Error("Phase 3/4 route-state verification requires NEON_REHEARSAL_DATABASE_URL");
}
process.env.DATABASE_URL = rehearsalDatabaseUrl;
const baseURL = `http://localhost:${port}`;
const runId = `phase34-${Date.now()}-${randomUUID().slice(0, 8)}`;
process.env.FINAL_ACCEPTANCE_RUN_ID = runId;

const runtimeEnv = [
  `FINAL_ACCEPTANCE_RUN_ID=${runId}`,
  `FINAL_ACCEPTANCE_BASE_URL=${baseURL}`,
  `NEXTAUTH_URL=${baseURL}`,
  `AUTH_URL=${baseURL}`,
  "VIDEO_PROVIDER=mock",
  "AIVORA_DRY_RUN=1",
  "VERCEL_ENV=preview",
  "LLM_FORCE_MOCK=true",
  "VIDEO_ENGINE_MOCK=true",
  "IMAGE_ENGINE_MOCK=true",
  "CONTENT_REVIEW_MOCK=true",
  "FINAL_ACCEPTANCE_REQUIRE_REHEARSAL=true",
  "STITCH_RUNTIME=local",
  'DATABASE_URL="$NEON_REHEARSAL_DATABASE_URL"',
].join(" ");

export default defineConfig({
  testDir: "./tests/phase34",
  testMatch: /.*\.(?:setup|spec)\.ts/,
  globalTeardown: "./tests/final-acceptance/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["line"]],
  outputDir: "test-results/phase34",
  use: {
    baseURL,
    locale: "zh-CN",
    trace: "on",
    screenshot: "only-on-failure",
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "phase34-setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "phase34-desktop",
      dependencies: ["phase34-setup"],
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
        storageState: "tests/phase34/.auth/customer.json",
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
