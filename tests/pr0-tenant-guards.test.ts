import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  brandPackageScopeFor,
  canUseRequestedBrandName,
  decideGlobalBrandPackageAccess,
} from "../src/lib/brand/global-brand-access";
import {
  fetchMediaBytes,
  isTrustedMediaUrl,
  MediaFetchError,
} from "../src/lib/storage/trusted-media-url";
import { listSyncableVideos, syncOwnerWhere } from "../src/lib/services/videos-sync-service";
import { videosApiQuerySchema } from "../src/lib/contracts/videos-api";

/// 2026-10-23 安全止血（PR-0）：全局品牌包、服务端抓取 URL、青砚同步三处的租户边界。
/// 涉及权限分支的用例都把 DATABASE_URL 清空：若代码意外查库，会抛错而不是悄悄通过。

const env = process.env as Record<string, string | undefined>;

async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

test("全局品牌包：默认只给内部员工和名单账号（id 或邮箱）；开关可恢复全员可见", () => {
  const base = { open: false, allowedUsers: ["sunny-owner", "bill@sunnyshutter.ca"] };
  assert.equal(decideGlobalBrandPackageAccess({ ...base, userId: "stranger", role: "CUSTOMER" }), false);
  assert.equal(decideGlobalBrandPackageAccess({ ...base, userId: "stranger", role: null }), false);
  assert.equal(decideGlobalBrandPackageAccess({ ...base, userId: "sunny-owner", role: "CUSTOMER" }), true);
  assert.equal(
    decideGlobalBrandPackageAccess({ ...base, userId: "u2", email: " Bill@SunnyShutter.ca ", role: "CUSTOMER" }),
    true,
  );
  assert.equal(decideGlobalBrandPackageAccess({ ...base, userId: "staff", role: "OPERATOR" }), true);
  assert.equal(decideGlobalBrandPackageAccess({ ...base, userId: "staff", role: "SUPER_ADMIN" }), true);
  assert.equal(decideGlobalBrandPackageAccess({ ...base, userId: "qa", role: "REVIEWER" }), false);
  assert.equal(
    decideGlobalBrandPackageAccess({ open: true, allowedUsers: [], userId: "stranger", role: "CUSTOMER" }),
    true,
  );
});

test("全局品牌包：无权限时范围只有本人工作区，有权限才加上全局包", () => {
  assert.deepEqual(brandPackageScopeFor("u1", false), [{ workspace: { ownerId: "u1" } }]);
  assert.deepEqual(brandPackageScopeFor("u1", true), [
    { workspace: { ownerId: "u1" } },
    { isGlobal: true },
  ]);
});

test("全局品牌包：列表、取包、取素材、内容计划四处都走同一个可见范围", () => {
  for (const file of [
    "src/lib/services/workspace-brand-package-service.ts",
    "src/lib/services/media-asset-service.ts",
    "src/lib/services/content-plan-store.ts",
  ]) {
    const source = read(file);
    assert.match(source, /visibleBrandPackageScope\(/, file);
    assert.doesNotMatch(source, /OR:\s*\[[^\]]*isGlobal:\s*true/, `${file} 不能再直接放行全局包`);
  }
});

test("自填品牌名：命中受保护客户时与全局包同一权限，普通品牌名不受影响", async () => {
  await withEnv(
    { DATABASE_URL: undefined, GLOBAL_BRAND_PACKAGES_OPEN: undefined, GLOBAL_BRAND_PACKAGE_USERS: "sunny-owner" },
    async () => {
      assert.equal(await canUseRequestedBrandName("stranger", "Acme Blinds"), true);
      assert.equal(await canUseRequestedBrandName("stranger", null), true);
      assert.equal(await canUseRequestedBrandName("sunny-owner", "Sunny Shutters"), true);
      /// 非名单用户会去查角色；这里没有数据库，必须是查库失败而不是被放行。
      await assert.rejects(canUseRequestedBrandName("stranger", "SUNNY-shutter co"));
    },
  );
});

test("自填品牌名：plan 与 dispatch 两个入口都在构建计划之前检查", () => {
  for (const file of [
    "src/app/api/video-generation/plan/route.ts",
    "src/app/api/video-generation/dispatch/route.ts",
  ]) {
    const source = read(file);
    const guard = source.indexOf("canUseRequestedBrandName(");
    const build = source.indexOf("buildPlan(request)");
    assert.ok(guard > 0 && guard < build, `${file}：品牌名检查必须在 buildPlan 之前`);
  }
});

test("服务端抓取 URL：默认一个主机都不放行；显式放行后只认 https 且主机精确匹配", async () => {
  await withEnv({ MEDIA_FETCH_HOST_ALLOWLIST: undefined }, async () => {
    assert.equal(isTrustedMediaUrl("https://abc123.public.blob.vercel-storage.com/v/clip.mp4"), false);
  });
  await withEnv({ MEDIA_FETCH_HOST_ALLOWLIST: "store1.public.blob.vercel-storage.com, *.cdn.aivora.example" }, async () => {
    assert.ok(isTrustedMediaUrl("https://store1.public.blob.vercel-storage.com/v/clip.mp4"));
    assert.ok(isTrustedMediaUrl("https://a.cdn.aivora.example/logo.png"));
    for (const url of [
      "https://other-store.public.blob.vercel-storage.com/v/clip.mp4",
      "http://store1.public.blob.vercel-storage.com/v/clip.mp4",
      "https://store1.public.blob.vercel-storage.com:8443/clip.mp4",
      "https://user:pass@store1.public.blob.vercel-storage.com/clip.mp4",
      "https://store1.public.blob.vercel-storage.com.evil.example/clip.mp4",
      "https://cdn.aivora.example/logo.png",
      "https://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "not a url",
    ]) {
      assert.equal(isTrustedMediaUrl(url), false, url);
    }
  });
});

function streamOf(chunks: number[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
}

test("服务端抓取：用户 URL 不跟随重定向；边读边限大小；超时；错误信息不带 URL", async () => {
  const seen: RequestInit[] = [];
  const ok = (async (_url: string, init: RequestInit) => {
    seen.push(init);
    return new Response(streamOf([4, 4]), { status: 200 });
  }) as typeof fetch;
  assert.equal((await fetchMediaBytes("https://h/a", { maxBytes: 16, fetchImpl: ok })).byteLength, 8);
  await fetchMediaBytes("https://h/a", { maxBytes: 16, followRedirects: true, fetchImpl: ok });
  assert.deepEqual(seen.map((init) => init.redirect), ["error", "follow"]);

  /// 不带 content-length 的流：读到第三块超限即中止。
  const chunked = (async () => new Response(streamOf([6, 6, 6, 6]), { status: 200 })) as typeof fetch;
  await assert.rejects(
    fetchMediaBytes("https://h/a", { maxBytes: 16, fetchImpl: chunked }),
    (error: unknown) => error instanceof MediaFetchError && /too large/.test(error.message),
  );

  /// 声明的 content-length 超限：不读正文直接拒。
  const declared = (async () =>
    new Response(streamOf([1]), { status: 200, headers: { "content-length": "999" } })) as typeof fetch;
  await assert.rejects(
    fetchMediaBytes("https://h/a", { maxBytes: 16, fetchImpl: declared }),
    (error: unknown) => error instanceof MediaFetchError && /too large/.test(error.message),
  );

  const hanging = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as typeof fetch;
  await assert.rejects(
    fetchMediaBytes("https://h/a", { maxBytes: 16, timeoutMs: 20, fetchImpl: hanging }),
    (error: unknown) => error instanceof MediaFetchError && /timed out/.test(error.message),
  );

  const notFound = (async () => new Response("nope", { status: 404 })) as typeof fetch;
  await assert.rejects(
    fetchMediaBytes("https://secret-host.internal/path?token=abc", { maxBytes: 16, fetchImpl: notFound }),
    (error: unknown) =>
      error instanceof MediaFetchError &&
      error.message.includes("404") &&
      !error.message.includes("secret-host"),
  );
});

test("brand-packaging：SunnyShutter 锁死 profile 与用户 URL 在抓取前校验", () => {
  const route = read("src/app/api/brand-packaging/route.ts");
  const post = route.slice(route.indexOf("export async function POST"));
  const firstDownload = post.indexOf("downloadTo(");
  for (const guard of [
    'body.clientProfileId === "sunnyshutter"',
    "canUseGlobalBrandPackages(session.user.id)",
    "isTrustedMediaUrl(body.sourceVideoUrl)",
    "isTrustedMediaUrl(body.custom.logoUrl)",
  ]) {
    const at = post.indexOf(guard);
    assert.ok(at > 0 && at < firstDownload, `${guard} 必须出现在第一次下载之前`);
  }
  assert.doesNotMatch(route, /await fetch\(/, "下载必须走 fetchMediaBytes");
});

test("青砚同步：名单为空时返回空列表，且不查库", async () => {
  for (const owners of [undefined, " , "]) {
    await withEnv({ QINGYAN_SYNC_OWNER_USER_IDS: owners, DATABASE_URL: undefined }, async () => {
      assert.deepEqual(await listSyncableVideos(videosApiQuerySchema.parse({})), {
        videos: [],
        meta: { count: 0, skipped_unbranded: 0, next_since: null },
      });
    });
  }
});

test("青砚同步：owner 过滤只放行名单账号，且四处查询都带上", () => {
  assert.deepEqual(syncOwnerWhere(["u1", "u2"]), {
    briefOwner: {
      contentAngle: { round: { deliveryOrder: { createdById: { in: ["u1", "u2"] } } } },
    },
    batchOwner: { batchJob: { is: { userId: { in: ["u1", "u2"] } } } },
  });
  const source = read("src/lib/services/videos-sync-service.ts");
  const body = source.slice(source.indexOf("export async function listSyncableVideos"));
  assert.equal(body.match(/\.\.\.briefOwner/g)?.length, 2, "成片与未封装计数两处 brief 查询");
  assert.equal(body.match(/\.\.\.batchOwner/g)?.length, 2, "成片与未封装计数两处 batch 查询");
});
