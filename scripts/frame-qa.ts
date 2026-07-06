/**
 * Frame QA CLI — 对任意成片（本地文件或 URL）手动跑「抽帧 + 文字/错字检测」门禁。
 *
 * 平台管线里同一门禁已自动接在段完成 → SUCCEEDED 之间；
 * 这个 CLI 用于脚本批量出片（demo:curtain 等）在发布进成片库前的最后一道人工触发检查。
 *
 * 用法：
 *   npm run frame:qa -- tmp/curtain-viral-ads/video-3-v2a1.mp4
 *   npm run frame:qa -- https://.../final.mp4 tmp/other.mp4
 *
 * 退出码：0 = 全部通过；1 = 存在被拦截的视频（stdout 有逐条结论）。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  /// loadEnvConfig 之后再 import，确保 OPENAI_API_KEY 等已注入
  const { runFrameTextQa, isFrameQaEnabled } = await import(
    "../src/lib/video-generation/frame-qa"
  );

  const targets = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (targets.length === 0) {
    console.error("用法：npm run frame:qa -- <视频文件或URL> [更多...]");
    process.exit(2);
  }
  if (!isFrameQaEnabled()) {
    console.error(
      "门禁未启用：需要 OPENAI_API_KEY，且 FRAME_QA_DISABLED / VIDEO_ENGINE_MOCK / LLM_FORCE_MOCK 均未开启。",
    );
    process.exit(2);
  }

  let blocked = 0;
  for (const target of targets) {
    process.stdout.write(`→ ${target}\n`);
    const verdict = await runFrameTextQa(target);
    if (!verdict.checked) {
      console.log(`  ⚠ ${verdict.summary}`);
      continue;
    }
    if (verdict.ok) {
      console.log(`  ✓ ${verdict.summary}`);
    } else {
      blocked += 1;
      console.log(`  ✗ ${verdict.summary}`);
    }
  }

  if (blocked > 0) {
    console.log(`\n结论：${blocked}/${targets.length} 支被拦截，禁止交付。`);
    process.exit(1);
  }
  console.log(`\n结论：${targets.length} 支全部通过，可以交付。`);
}

main().catch((err) => {
  console.error("[frame-qa] 执行失败:", (err as Error).message);
  process.exit(2);
});
