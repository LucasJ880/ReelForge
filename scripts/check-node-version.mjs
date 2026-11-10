#!/usr/bin/env node
/**
 * 跑测试前核对 Node 版本（package.json engines：22.x）。
 *
 * 2026-11-09：本机默认 Node 20.17，`npm test` 先是因为 `tests/**` 这个 glob 在 Node 20 下不展开而一条都没跑，
 * 改成直接列文件后又有 5 条测试「失败」——stitch 的几条集成测试和 Runway 分镜拒单那条，换到 Node 22+ 全部通过。
 * 这些假失败被当成「main 上本来就红」记了一整天，其中一条还被怀疑是真缺陷。
 * 所以版本不对就直接停下并说清楚，不给一份不可信的结果。
 *
 * 确实要在旧版本上跑（知道结果不可信）：ALLOW_UNSUPPORTED_NODE=1 npm test
 */
const REQUIRED_MAJOR = 22;

export function nodeVersionProblem(version = process.versions.node, env = process.env) {
  const major = Number.parseInt(String(version).split(".")[0] ?? "", 10);
  if (Number.isInteger(major) && major >= REQUIRED_MAJOR) return null;
  if (env.ALLOW_UNSUPPORTED_NODE === "1") return null;
  return [
    `当前 Node ${version}，本项目的测试需要 Node ${REQUIRED_MAJOR} 或更新（package.json engines）。`,
    "在旧版本上会有测试假失败（stitch 集成、Runway 分镜拒单等），结果不可信。",
    "换一个版本再跑，例如：PATH=/opt/homebrew/bin:$PATH npm test",
    "确实要在当前版本上跑：ALLOW_UNSUPPORTED_NODE=1 npm test",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problem = nodeVersionProblem();
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}
