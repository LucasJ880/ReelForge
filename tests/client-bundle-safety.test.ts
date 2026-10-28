/**
 * 架构不变量：任何 "use client" 组件都不得（直接或传递地）依赖服务端专用模块。
 *
 * 0726 事故：logo-generator-dialog.tsx（"use client"）从 logo-service 取运行时值
 * LOGO_STYLE_KEYS，把 @/lib/ai（模块作用域 new OpenAI）+ @/lib/db（Prisma）整张
 * 服务端模块图打进浏览器 bundle，/app/brands 整页 500：
 *   "It looks like you're running in a browser-like environment."
 *
 * 该测试沿 @/ 别名做有界传递解析；`import type` 因编译期擦除不计入。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";

/// 测试从仓库根运行（package.json 的 `test` 脚本）。
const SRC = resolve(process.cwd(), "src");

/**
 * 模块作用域即构造 SDK / 打开数据库连接的服务端专用依赖。
 *
 * 刻意不含 `next-auth/react`（合法的客户端入口：useSession/signIn），
 * 也不含 `@prisma/client`（部分组件只取枚举值，另行治理）。
 * 这里只挡「一进浏览器就抛异常」的那一类。
 */
const SERVER_ONLY = ["openai", "@/lib/db", "@/lib/ai"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__fixtures__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** 只取值导入（`import type ...` / `import { type X }` 编译期擦除，不进 bundle）。 */
function valueImports(source: string): string[] {
  const specs: string[] = [];
  const re = /import\s+(?!type\s)([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const clause = m[1] ?? "";
    const target = m[2]!;
    /// `import { type A, type B } from "x"` 整体只有类型 → 不进 bundle
    const named = clause.match(/\{([\s\S]*)\}/)?.[1];
    if (named !== undefined) {
      const parts = named.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0 && parts.every((p) => p.startsWith("type "))) continue;
    }
    specs.push(target);
  }
  /// 副作用导入 `import "x"` 同样进 bundle
  const bare = /import\s+["']([^"']+)["']/g;
  while ((m = bare.exec(source))) specs.push(m[1]!);
  return specs;
}

function resolveAlias(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

/** 返回从 entry 到某个服务端专用模块的导入链；无则 null。 */
function findServerOnlyChain(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: { file: string; chain: string[] }[] = [{ file: entry, chain: [entry] }];
  while (stack.length) {
    const { file, chain } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const spec of valueImports(source)) {
      const hit = SERVER_ONLY.find(
        (s) => spec === s || spec.startsWith(`${s}/`),
      );
      if (hit) return [...chain, `${spec}  ← 服务端专用`];
      const next = resolveAlias(spec, file);
      if (next) stack.push({ file: next, chain: [...chain, next] });
    }
  }
  return null;
}

function useClientFiles(): string[] {
  return walk(SRC).filter((file) => {
    const head = readFileSync(file, "utf8").slice(0, 200);
    return /^\s*["']use client["']/m.test(head);
  });
}

test("no \"use client\" component pulls OpenAI/Prisma into the browser bundle", () => {
  const clientFiles = useClientFiles();

  assert.ok(clientFiles.length > 0, "应当扫描到至少一个 use client 组件");

  const violations: string[] = [];
  for (const file of clientFiles) {
    const chain = findServerOnlyChain(file);
    if (chain) {
      violations.push(
        chain.map((p) => p.replace(SRC, "src")).join("\n    → "),
      );
    }
  }

  assert.deepEqual(
    violations,
    [],
    `以下客户端组件会把服务端模块打进浏览器 bundle：\n\n${violations.join("\n\n")}\n`,
  );
});

/**
 * 铁律 #5 的字面要求（CLAUDE.md §4）：'use client' 文件不得引用服务端 service 的模块级值。
 *
 * 上面的传递检查只挡「一进浏览器就抛异常」的那几个模块（openai / @/lib/db / @/lib/ai），
 * 只 import 了 @prisma/client 枚举的 service 它看不见——2026-10-25 审计 D4 抓到的
 * internal/orders/new/new-order-form.tsx 从 localization-service 取 SUPPORTED_LOCALES 就是这样漏过去的。
 * service 层就是服务端代码：今天无害，明天那个 service 加一行 db 查询就是整页 500（0726 事故同款）。
 *
 * 唯一的例外：专门拆出来给客户端用的纯常量模块——自身没有任何值导入（例如 logo-style-keys）。
 */
const SERVICES_DIR = join(SRC, "lib", "services");

function serviceValueImportViolations(file: string, source: string): string[] {
  const violations: string[] = [];
  for (const spec of valueImports(source)) {
    const target = resolveAlias(spec, file);
    if (!target || !target.startsWith(`${SERVICES_DIR}${sep}`)) continue;
    /// 纯常量模块（没有任何值导入）可以给客户端用
    if (valueImports(readFileSync(target, "utf8")).length === 0) continue;
    violations.push(`${file.replace(SRC, "src")} → ${spec}`);
  }
  return violations;
}

test("no \"use client\" component value-imports a server service module (iron rule #5)", () => {
  const violations = useClientFiles().flatMap((file) =>
    serviceValueImportViolations(file, readFileSync(file, "utf8")),
  );
  assert.deepEqual(
    violations,
    [],
    `以下客户端组件直接取了服务端 service 的值（把值挪到服务端父组件、以 props 传下去）：\n\n${violations.join("\n")}\n`,
  );
});

test("iron rule #5 check would have caught the D4 form, and still allows client-safe constant modules", () => {
  /// D4 原件（旧中台下单表单）2026-10-28 随旧中台删除；用同形状的客户端文件复现那次漏检。
  const form = join(SRC, "components", "platform", "platform-shell.tsx");
  const before = `"use client";\nimport { assertQuotaForSession } from "@/lib/services/quota-service";\n`;
  assert.deepEqual(serviceValueImportViolations(form, before), [
    "src/components/platform/platform-shell.tsx → @/lib/services/quota-service",
  ]);
  /// import type 编译期擦除，不算
  assert.deepEqual(
    serviceValueImportViolations(form, `import type { UsageMeterSnapshot } from "@/lib/services/quota-service";\n`),
    [],
  );
  /// logo-style-keys 自身没有任何值导入：专为客户端拆出来的常量模块，放行
  const dialog = join(SRC, "components", "wizard", "logo-generator-dialog.tsx");
  assert.deepEqual(
    serviceValueImportViolations(dialog, `import { LOGO_STYLE_KEYS } from "@/lib/services/logo-style-keys";\n`),
    [],
  );
});
