import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { containsBannedCustomerTerm } from "../src/lib/video-generation/business-status";

const ROOT = path.resolve(__dirname, "..");

/**
 * Phase 2.5 demo 守门：审计客户端可见 B2B 表面文件中的字符串字面量，
 * 防止 "ffmpeg / mock / blob / provider / seedance / adapter / debug / json" 等
 * 内部术语被误塞进 UI。
 *
 * 我们扫描 .tsx 中的 string literal（双引号 / 反引号 / 单引号），
 * 跳过明显的非客户串：className / Tailwind / href / 路径 / 注释。
 */
const FILES_TO_AUDIT = [
  "src/app/(business)/business/products/page.tsx",
  "src/app/(business)/business/products/[id]/page.tsx",
  "src/app/(business)/business/products/[id]/video-actions.tsx",
  "src/app/(business)/business/create-ad-video/page.tsx",
  "src/components/video-generation/unified-creative-input.tsx",
];

/// 这些 token 是合法的（它们出现在路径/className/常量定义里，不在 UI 文案中）
const ALLOWED_HOSTS = new Set([
  "src/lib/video-generation/business-status",
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
    /// 进一步剔除：只含 tailwind 色/尺寸/伪类
    if (/(text-|bg-|border-|hover:|rounded|inline-flex|flex|grid|px-|py-|mx-|my-|mt-|mb-|ml-|mr-|p-|w-|h-|max-w-|opacity-|tracking|font-|gap-|space-|items-|justify-|transition|truncate|uppercase|disabled:|sm:|md:|lg:|min-w-|shrink|overflow-)/.test(s)) {
      return false;
    }
  }
  /// 跳过路径 / URL / fetch endpoint
  if (s.startsWith("/api/") || s.startsWith("/business") || s.startsWith("/personal") || s.startsWith("/login")) {
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
  if (s === "content-type" || s === "noopener noreferrer" || s === "POST" || s === "GET" || s === "true" || s === "false") return false;
  if (/^[a-z]+\/[a-z0-9.+\-]+$/.test(s)) return false;
  /// 跳过 placeholder 里的英文范例（虽然 placeholder 是用户可见，但属于 demo 描述，
  /// 且其中可能包含品牌名 "ACME"。我们专注于 status / label / button / error 文案）
  /// 但 placeholder 里出现 banned 词应该报警 → 不跳过
  return true;
}

test.test("audit: B2B 客户端表面文件不泄漏内部术语", async () => {
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
    `客户端泄漏内部术语:\n${offenders.map((o) => `  - ${o.file}: "${o.literal}"`).join("\n")}`,
  );
});

test.test("audit: 产品列表页无 dead link —— ready 必须配合 finalVideoUrl 存在校验", async () => {
  const abs = path.join(ROOT, "src/app/(business)/business/products/page.tsx");
  const src = await readFile(abs, "utf-8");
  /// 强约束：ready 状态下展示视频链接的代码块必须用 `&& p.finalVideoUrl` 守门，
  /// 防止 final URL 缺失时还展示 "查看最终视频" 按钮（点了就 404）。
  assert.ok(
    /isReady\s*&&\s*p\.finalVideoUrl/.test(src),
    "products page 必须用 isReady && p.finalVideoUrl 守门，避免 dead link",
  );
});

test.test("audit: 产品列表页对 file:// 链接不暴露给客户", async () => {
  const abs = path.join(ROOT, "src/app/(business)/business/products/page.tsx");
  const src = await readFile(abs, "utf-8");
  /// 必须有 customerSafeUrl 检查（只放行 https?://），避免 dev 模式 file:// URL 穿透
  assert.ok(
    /customerSafeUrl|^https\?:\/\//m.test(src) ||
      /\/\^https\?:\\\/\\\/.*\.test/.test(src) ||
      /https\?:\\\/\\\//.test(src),
    "products page 必须过滤掉 file:// URL，避免 customer 看到本地路径",
  );
});

test.test("audit: 产品列表页 failed 状态提供 retry / support CTA", async () => {
  const abs = path.join(ROOT, "src/app/(business)/business/products/page.tsx");
  const src = await readFile(abs, "utf-8");
  assert.ok(
    /isFailed/.test(src),
    "products page 应显式分支 failed 状态",
  );
  /// i18n 化后 CTA 文案在字典里；页面必须引用对应 key，字典必须给出人话中文
  assert.ok(
    /productsPage\.regenerate/.test(src),
    "products page failed 状态应提供「重新生成」CTA（productsPage.regenerate）",
  );
  assert.ok(
    /productsPage\.supportHint/.test(src),
    "products page failed 状态应提示「联系客服」（productsPage.supportHint）",
  );
  const zh = await readFile(
    path.join(ROOT, "src/i18n/dictionaries/zh-CN.ts"),
    "utf-8",
  );
  assert.ok(/重新生成|再生成/.test(zh), "zh 字典应有重新生成类 CTA 文案");
  assert.ok(/联系客服/.test(zh), "zh 字典应有联系客服提示");
});

test.test("audit: 产品列表页过滤掉 PERSONAL persona 视频，避免跨 persona 泄漏", async () => {
  const abs = path.join(ROOT, "src/app/(business)/business/products/page.tsx");
  const src = await readFile(abs, "utf-8");
  assert.ok(
    /persona !== "PERSONAL"|persona\s*===\s*"BUSINESS"/.test(src),
    "products page 必须过滤掉 PERSONAL persona 的 brief（不应在商家面板展示个人视频）",
  );
});

test.test("audit: BUSINESS 详情页 使用 deriveBusinessStatus + customerSafeUrl 守门", async () => {
  const abs = path.join(
    ROOT,
    "src/app/(business)/business/products/[id]/page.tsx",
  );
  const src = await readFile(abs, "utf-8");
  assert.ok(
    /deriveBusinessStatus/.test(src),
    "business detail 必须用 deriveBusinessStatus 做状态映射",
  );
  assert.ok(
    /customerSafeUrl/.test(src),
    "business detail 必须用 customerSafeUrl 守 finalVideoUrl（不暴露 file://）",
  );
  /// 不应直接渲染 brief.status 等 prisma enum 值
  assert.ok(
    !/\{\s*brief\.status\s*\}/.test(src) &&
      !/\{\s*j\.status\s*\}/.test(src) &&
      !/\{\s*p\.status\s*\}/.test(src),
    "business detail 不应直接渲染 prisma enum 状态",
  );
});

test.test("audit: BUSINESS 详情页 有 ownership 守门 + 跨 persona 重定向", async () => {
  const abs = path.join(
    ROOT,
    "src/app/(business)/business/products/[id]/page.tsx",
  );
  const src = await readFile(abs, "utf-8");
  assert.ok(
    /createdById/.test(src),
    "detail page 必须读 createdById 做归属校验",
  );
  assert.ok(
    /isInternalStaff|OPERATOR|SUPER_ADMIN/.test(src),
    "detail page 必须给内部 staff 留 bypass",
  );
  /// PERSONAL persona 的 brief 不应该出现在 business 详情页 → 应 redirect 到 personal
  assert.ok(
    /persona\s*===\s*"PERSONAL"/.test(src) &&
      /\/personal\/videos\/\$\{order\.id\}/.test(src),
    "PERSONAL persona 的 brief 应 redirect 到 /personal/videos/[id]",
  );
});

test.test("audit: BUSINESS video-actions 客户文案友好；调用正确 endpoint", async () => {
  const abs = path.join(
    ROOT,
    "src/app/(business)/business/products/[id]/video-actions.tsx",
  );
  const src = await readFile(abs, "utf-8");
  /// i18n 化后按钮文案走字典 key；这里校验 key 引用 + zh 字典给出对应人话文案
  assert.ok(
    /videoActions\.refresh/.test(src),
    "应有'刷新进度'按钮（videoActions.refresh）",
  );
  assert.ok(
    /videoActions\.retryFailed/.test(src),
    "应有'重试失败片段'按钮（videoActions.retryFailed）",
  );
  const zh = await readFile(
    path.join(ROOT, "src/i18n/dictionaries/zh-CN.ts"),
    "utf-8",
  );
  assert.ok(/刷新进度/.test(zh), "zh 字典应有'刷新进度'文案");
  assert.ok(/重试失败片段/.test(zh), "zh 字典应有'重试失败片段'文案");
  assert.ok(
    /\/api\/briefs\/\$\{briefId\}\/render-status/.test(src),
    "刷新调用 render-status",
  );
  assert.ok(
    /\/api\/briefs\/\$\{briefId\}\/render-retry/.test(src),
    "重试调用 render-retry",
  );
});
