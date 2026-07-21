import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { opsCreditsResponseSchema } from "../src/lib/contracts/ops-credits";

test("ops-credits contract 校验通过与拒绝", () => {
  const good = {
    ok: true,
    availablePoints: 151336,
    todaySpentPoints: 8100,
    videoPlan: { model: "seedance-1.5", resolution: "720P", salePoints: 900 },
    fetchedAt: new Date().toISOString(),
  };
  assert.deepEqual(opsCreditsResponseSchema.parse(good), good);
  assert.throws(() => opsCreditsResponseSchema.parse({ ...good, availablePoints: -1 }));
  assert.throws(() => opsCreditsResponseSchema.parse({ ...good, ok: false }));
});

test("API 路由 operator 门控且不缓存；余额只经 internal 面暴露", async () => {
  const route = await readFile("src/app/api/internal/ops-credits/route.ts", "utf8");
  assert.match(route, /requireOperator/);
  assert.match(route, /no-store/);
  assert.match(route, /getShuyuBalance/);
  assert.match(route, /SHUYU_VIDEO_POINTS_PER_GENERATION/);
  assert.doesNotMatch(route, /requireAuth\(/);
});

test("积分簇仅对 internal 角色渲染", async () => {
  const [layout, shell, cluster] = await Promise.all([
    readFile("src/app/(platform)/app/layout.tsx", "utf8"),
    readFile("src/components/platform/platform-shell.tsx", "utf8"),
    readFile("src/components/platform/ops-credits-cluster.tsx", "utf8"),
  ]);
  assert.match(layout, /isInternalRole/);
  assert.match(layout, /showOpsCredits/);
  assert.match(shell, /showOpsCredits/);
  assert.match(shell, /OpsCreditsCluster/);
  assert.match(cluster, /data-testid="ops-credits-cluster"/);
  assert.match(cluster, /\/api\/internal\/ops-credits/);
  assert.match(cluster, /今日消耗/);
  assert.match(cluster, /Spent today/);
});
