/**
 * 跑测试前的 Node 版本核对（scripts/check-node-version.mjs）。
 * 2026-11-09：Node 20 下 5 条测试假失败，被当成「main 上本来就红」记了一整天。版本不对就该直接停下说清楚。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/// .mjs 没有类型声明：用变量路径动态引入
const SCRIPT = "../scripts/check-node-version.mjs";

test("Node 22 及以上放行；更旧的版本给出原因和怎么换", async () => {
  const { nodeVersionProblem } = (await import(SCRIPT)) as {
    nodeVersionProblem: (version?: string, env?: Record<string, string | undefined>) => string | null;
  };
  assert.equal(nodeVersionProblem("22.0.0", {}), null);
  assert.equal(nodeVersionProblem("23.11.0", {}), null);
  const problem = nodeVersionProblem("20.17.0", {});
  assert.match(problem ?? "", /当前 Node 20\.17\.0/);
  assert.match(problem ?? "", /假失败/);
  assert.match(problem ?? "", /ALLOW_UNSUPPORTED_NODE=1/);
  assert.equal(nodeVersionProblem("20.17.0", { ALLOW_UNSUPPORTED_NODE: "1" }), null, "明知不可信也要跑时可以放行");
  assert.match(nodeVersionProblem("not-a-version", {}) ?? "", /需要 Node 22/);
});

test("npm test 先核对版本，并且用 shell 展开的通配（不依赖 Node 自己的 glob）", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string>; engines: { node: string } };
  assert.equal(pkg.scripts.pretest, "node scripts/check-node-version.mjs");
  assert.equal(pkg.scripts.test, "node --import tsx --test tests/*.test.ts");
  assert.doesNotMatch(pkg.scripts.test, /\*\*/, "tests/** 在 Node 20 下不展开，一条都不会跑");
  assert.equal(pkg.engines.node, "22.x");
});
