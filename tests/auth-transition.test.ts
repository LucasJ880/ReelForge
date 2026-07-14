import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("RF-009 login owns a persistent branded transition surface", async () => {
  await access(path.join(ROOT, "src/components/auth/auth-transition-screen.tsx"));
  const [login, transition] = await Promise.all([
    readFile(path.join(ROOT, "src/app/(auth)/login/page.tsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/auth/auth-transition-screen.tsx"), "utf8"),
  ]);

  assert.match(login, /<AuthTransitionScreen/);
  assert.match(login, /router\.replace\(from\)/);
  assert.doesNotMatch(login, /router\.push\(from\);\s*router\.refresh\(\);/);
  assert.doesNotMatch(login, /router\.prefetch\(/);
  assert.match(transition, /data-auth-transition="active"/);
  assert.match(transition, /fixed inset-0/);
  assert.match(transition, /motion-reduce:animate-none/);
});

test("RF-009 login fallback is the final workspace route, not a redirect hop", async () => {
  const login = await readFile(
    path.join(ROOT, "src/app/(auth)/login/page.tsx"),
    "utf8",
  );
  assert.match(login, /"\/app\/create"/);
  assert.doesNotMatch(login, /searchParams\.get\("from"\) \|\| "\/"/);
});

test("RF-009 golden path continuously samples branded transition frames", async () => {
  const golden = await readFile(path.join(ROOT, "e2e/golden-path.spec.ts"), "utf8");
  assert.match(golden, /auth-transition-continuity/);
  assert.match(golden, /requestAnimationFrame/);
  assert.match(golden, /blankFrames/);
});
