import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { containsBannedCustomerTerm } from "../src/lib/video-generation/business-status";

const ROOT = path.resolve(__dirname, "..");

/**
 * Phase 3 demo 守门：审计 C 端 (personal) 客户表面文件中的字符串字面量，
 * 防止 "ffmpeg / mock / blob / provider / seedance / adapter / debug / json /
 * stitch / concat / executor / pipeline" 等内部术语被误塞进 UI。
 *
 * 与 B2B 端 audit 平行，目标范围只包含 C 端可见的文件。
 */
const FILES_TO_AUDIT = [
  "src/app/(personal)/personal/page.tsx",
  "src/app/(personal)/personal/videos/page.tsx",
  "src/app/(personal)/personal/create-video/page.tsx",
  "src/components/video-generation/plan-preview-card.tsx",
  "src/components/video-generation/unified-creative-input.tsx",
  "src/components/video-generation/unified-creative-input-shell.tsx",
];

/// 这些 token 是合法的（它们出现在路径/className/常量定义里，不在 UI 文案中）
const ALLOWED_HOSTS = new Set([
  "src/lib/video-generation/business-status",
  "src/lib/video-generation/personal-status",
  "BANNED_CUSTOMER_TERMS",
]);

function extractStringLiterals(src: string): string[] {
  /// 极简扫描：抓 "..." / '...' / `...` 内容；够用做客户文案审计。
  const out: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let m;
  while ((m = re.exec(src))) {
    const s = m[1] ?? m[2] ?? m[3];
    if (s) out.push(s);
  }
  return out;
}

function isCustomerVisible(s: string): boolean {
  if (!s) return false;
  if (s.length < 2) return false;
  /// 跳过 className / Tailwind utility 串
  if (/^[a-z0-9_:\-/\s\[\]@%.+#]+$/i.test(s) && s.length < 200) {
    if (
      /(text-|bg-|border-|hover:|rounded|inline-flex|flex|grid|px-|py-|mx-|my-|mt-|mb-|ml-|mr-|p-|w-|h-|max-w-|opacity-|tracking|font-|gap-|space-|items-|justify-|transition|truncate|uppercase|disabled:|sm:|md:|lg:|min-w-|shrink|overflow-|object-)/.test(
        s,
      )
    ) {
      return false;
    }
  }
  /// 跳过路径 / URL / fetch endpoint
  if (
    s.startsWith("/api/") ||
    s.startsWith("/business") ||
    s.startsWith("/personal") ||
    s.startsWith("/login")
  ) {
    return false;
  }
  if (s.startsWith("http://") || s.startsWith("https://")) return false;
  /// 跳过 import 路径 / 模块名
  if (s.startsWith("@/") || s.startsWith("./") || s.startsWith("../")) return false;
  /// 跳过文件白名单（identifier 名而非 UI）
  if (ALLOWED_HOSTS.has(s)) return false;
  /// 跳过常量 / 状态键名
  if (/^[A-Z_]+$/.test(s)) return false;
  /// 跳过纯 lowercase identifier
  if (/^[a-z_][a-zA-Z0-9_]*$/.test(s) && s.length < 30) return false;
  /// 跳过 content-type / aria 角色 / 属性名 / MIME 类型
  if (
    s === "content-type" ||
    s === "noopener noreferrer" ||
    s === "POST" ||
    s === "GET" ||
    s === "true" ||
    s === "false"
  ) {
    return false;
  }
  if (/^[a-z]+\/[a-z0-9.+\-]+$/.test(s)) return false;
  return true;
}

test.test("audit: C 端 (personal) 客户表面文件不泄漏内部术语", async () => {
  const offenders: Array<{ file: string; literal: string }> = [];

  for (const rel of FILES_TO_AUDIT) {
    const abs = path.join(ROOT, rel);
    const src = await readFile(abs, "utf-8");
    const literals = extractStringLiterals(src);
    for (const lit of literals) {
      if (!isCustomerVisible(lit)) continue;
      if (containsBannedCustomerTerm(lit)) {
        offenders.push({ file: rel, literal: lit });
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `C 端泄漏内部术语:\n${offenders.map((o) => `  - ${o.file}: "${o.literal}"`).join("\n")}`,
  );
});

test.test("audit: personal videos page 不直接展示 raw enum 状态", async () => {
  const abs = path.join(ROOT, "src/app/(personal)/personal/videos/page.tsx");
  const src = await readFile(abs, "utf-8");
  /// 旧实现里有 `<p>{o.status}</p>` 这种把 prisma enum 直接渲染的写法；
  /// 必须改成走 derivePersonalStatus 的 label / shortLabel。
  assert.ok(
    /derivePersonalStatus/.test(src),
    "personal videos page 必须使用 derivePersonalStatus 做状态映射",
  );
  assert.ok(
    !/\{\s*o\.status\s*\}/.test(src) && !/\{\s*r\.briefStatus\s*\}/.test(src),
    "personal videos page 不应直接渲染 brief.status / order.status enum 值",
  );
});

test.test("audit: personal videos page 不渲染 dead file:// / 非 http(s) 链接", async () => {
  const abs = path.join(ROOT, "src/app/(personal)/personal/videos/page.tsx");
  const src = await readFile(abs, "utf-8");
  /// 必须使用 customerSafeFinalVideoUrl 守门
  assert.ok(
    /customerSafeFinalVideoUrl/.test(src),
    "personal videos page 必须用 customerSafeFinalVideoUrl 过滤掉 file:// 等非 http(s) URL",
  );
  /// 必须做 isReady && finalVideoUrl 守门，避免 ready 但 URL 缺失时还展示 dead link
  assert.ok(
    /isReady\s*&&\s*r\.finalVideoUrl/.test(src),
    "personal videos page 必须用 isReady && finalVideoUrl 守门，避免 dead link",
  );
});

test.test("audit: personal videos page failed 状态提供 retry CTA + 友好引导", async () => {
  const abs = path.join(ROOT, "src/app/(personal)/personal/videos/page.tsx");
  const src = await readFile(abs, "utf-8");
  assert.ok(/isFailed/.test(src), "personal videos page 应显式分支 failed 状态");
  /// failed 状态下必须有「重新生成」入口
  assert.ok(
    /重新生成/.test(src),
    "personal videos page failed 状态应提供「重新生成」CTA",
  );
  /// 不应只是抛个 "失败" 的死信息；必须有可读的引导文案
  assert.ok(
    /换个描述|稍后再试|再试一次|重新|重试/.test(src),
    "personal videos page failed 状态应提供友好的下一步引导",
  );
});

test.test("audit: personal videos page 空态文案是用户能直接理解的（不是 'Empty for now'）", async () => {
  const abs = path.join(ROOT, "src/app/(personal)/personal/videos/page.tsx");
  const src = await readFile(abs, "utf-8");
  /// 必须告诉用户怎么开始
  assert.ok(
    /生成第一支|第一支视频|开始|New video/.test(src),
    "空态应该有清晰的下一步指引",
  );
});

test.test("audit: plan-preview-card 不展示原始 prompt 字符串（避免英文导演术语泄漏）", async () => {
  const abs = path.join(
    ROOT,
    "src/components/video-generation/plan-preview-card.tsx",
  );
  const src = await readFile(abs, "utf-8");
  /// 旧实现把 s.prompt.slice(0, 240) 直接当 italic 文本渲染；这会暴露
  /// 内部 director prompt（"shot composition", "negative prompt" 之类术语），
  /// 必须移除。purpose 字段是允许的，因为它是 supervisor 给出的人类可读说明。
  assert.ok(
    !/s\.prompt\.slice/.test(src),
    "plan-preview-card 不应直接渲染原始 prompt 字符串",
  );
});

test.test("audit: plan-preview-card 不出现 'Segment' 这种内部术语（用 'Scene'）", async () => {
  const abs = path.join(
    ROOT,
    "src/components/video-generation/plan-preview-card.tsx",
  );
  const src = await readFile(abs, "utf-8");
  /// "Segment" 是后端内部叫法；用户应该看到 "Scene"。
  assert.ok(
    !/Segment\s+\{/.test(src) && !/Segment\s+breakdown/i.test(src),
    "plan-preview-card 不应使用内部术语 'Segment'",
  );
  assert.ok(
    /Scene/.test(src),
    "plan-preview-card 应使用 'Scene' 这种用户友好术语",
  );
});
