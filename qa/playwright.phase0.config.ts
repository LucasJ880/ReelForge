import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const port = 3110;
const rehearsalDatabaseUrl = process.env.NEON_REHEARSAL_DATABASE_URL;
if (!rehearsalDatabaseUrl) {
  throw new Error("Phase 0 route audit requires NEON_REHEARSAL_DATABASE_URL");
}
process.env.DATABASE_URL = rehearsalDatabaseUrl;

const baseURL = `http://localhost:${port}`;
const runId = `phase0-${Date.now()}-${randomUUID().slice(0, 8)}`;
process.env.FINAL_ACCEPTANCE_RUN_ID = runId;

const runtimeEnv = [
  `FINAL_ACCEPTANCE_RUN_ID=${runId}`,
  `NEXTAUTH_URL=${baseURL}`,
  `AUTH_URL=${baseURL}`,
  "VIDEO_PROVIDER=mock",
  "LLM_FORCE_MOCK=true",
  "VIDEO_ENGINE_MOCK=true",
  "IMAGE_ENGINE_MOCK=true",
  "CONTENT_REVIEW_MOCK=true",
  "FINAL_ACCEPTANCE_REQUIRE_REHEARSAL=true",
  "VIDEO_ENGINE_MOCK_LATENCY_MS=0",
  "STITCH_RUNTIME=local",
  "DATABASE_URL=\"$NEON_REHEARSAL_DATABASE_URL\"",
].join(" ");

export default defineConfig({
  testDir: "./phase0",
  testMatch: /.*\.spec\.ts/,
  globalTeardown: "./phase0/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 240_000,
  reporter: [["line"]],
  outputDir: "../test-results/phase0-route-audit",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "off",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    cwd: "..",
    command: `npx dotenv -e .env.local -- sh -c '${runtimeEnv} tsx tests/final-acceptance/seed-fixture.ts && ${runtimeEnv} npm run start -- -p ${port}'`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
