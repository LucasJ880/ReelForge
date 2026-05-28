/**
 * Phase 2A — 火山引擎 TOS provider 单元测试。
 *
 * 目标：
 *   1. 在 STORAGE_PROVIDER=volcengine_tos 时，provider factory 真的返回 TOS 实现。
 *   2. uploadBuffer / uploadFile / signed URL / delete / copy 走通调用链
 *      （通过 jest-style 的模块 mock 替换 @volcengine/tos-sdk 真实客户端）。
 *   3. getPublicUrl 在配置 CDN_BASE_URL 时优先返回 CDN URL。
 *   4. 缺少 TOS env 时，调用 API 抛出含 VOLCENGINE_* 字样的清晰错误（不暴露 secret）。
 *   5. uploads / renders 拆 bucket 正确（不会把用户素材写进 renders）。
 *   6. 错误信息脱敏：putObject 失败时 error.message 不含 AccessKey。
 *
 * 设计：用 Node 原生 `require` 的 module cache 注入 fake `@volcengine/tos-sdk`，
 *   避免真的请求火山 endpoint。这样既能在 CI 跑，又能保证 production code path 一致。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const requireModule = createRequire(import.meta.url);

/// Fake TosClient：把每次调用记到 spy 数组上，让 test 断言入参；
/// 同时支持注入抛错（模拟 4xx/5xx）。
type Call = { method: string; input: unknown };
const calls: Call[] = [];
let throwOnNext:
  | null
  | { method: string; error: { statusCode?: number; message: string; requestId?: string } } = null;

class FakeTosClient {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_cfg: Record<string, unknown>) {}
  async putObject(input: Record<string, unknown>) {
    calls.push({ method: "putObject", input });
    if (throwOnNext?.method === "putObject") {
      const err = throwOnNext.error;
      throwOnNext = null;
      throw Object.assign(new Error(err.message), err);
    }
    return { data: {} };
  }
  async deleteObject(input: Record<string, unknown>) {
    calls.push({ method: "deleteObject", input });
    return { data: {} };
  }
  async copyObject(input: Record<string, unknown>) {
    calls.push({ method: "copyObject", input });
    return { data: { ETag: "fake-etag" } };
  }
  async headObject(input: Record<string, unknown>) {
    calls.push({ method: "headObject", input });
    return { data: { "content-length": "123" } };
  }
  async headBucket(bucket?: string) {
    calls.push({ method: "headBucket", input: { bucket } });
    if (throwOnNext?.method === "headBucket") {
      const err = throwOnNext.error;
      throwOnNext = null;
      throw Object.assign(new Error(err.message), err);
    }
    return { data: { "x-tos-bucket-region": "cn-beijing", "x-tos-storage-class": "STANDARD" } };
  }
  getPreSignedUrl(input: Record<string, unknown>): string {
    calls.push({ method: "getPreSignedUrl", input });
    const { bucket, key, method, expires } = input as Record<string, string | number>;
    return `https://${bucket}.tos.fake/${key}?X-Tos-Method=${method}&X-Tos-Expires=${expires}&X-Tos-Signature=FAKE_SIGNATURE`;
  }
}

/// 提前把 fake 装进 require cache，让 `import("@volcengine/tos-sdk")` 命中我们
function installFakeSdk() {
  const resolved = requireModule.resolve("@volcengine/tos-sdk");
  /// 直接覆盖 module.exports
  const cached = requireModule.cache[resolved];
  if (cached) {
    cached.exports = { TosClient: FakeTosClient, default: FakeTosClient };
  } else {
    /// 极少触发：tos-sdk 已经被 install/loaded（package.json 显式 dep）
    /// 这里走构造完整 NodeModule 对象的兜底分支，无须类型完美。
    const fakeModule = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: { TosClient: FakeTosClient, default: FakeTosClient },
      paths: [],
      children: [],
      parent: null,
      path: "",
      isPreloading: false,
      require: requireModule,
    } as unknown as NodeJS.Module;
    requireModule.cache[resolved] = fakeModule;
  }
}

installFakeSdk();

import { __resetAppEnvForTests } from "../src/lib/config/env";
import {
  __resetStorageProviderForTests,
  createStorageProvider,
} from "../src/lib/storage";
import {
  VolcengineTosStorageProvider,
  __resetVolcengineTosClientForTests,
} from "../src/lib/storage/providers/volcengine-tos-provider";

const TOS_ENV = {
  STORAGE_PROVIDER: "volcengine_tos",
  VOLCENGINE_ACCESS_KEY_ID: "AKfaketestonly",
  VOLCENGINE_SECRET_ACCESS_KEY: "SKfaketestonlysecret",
  VOLCENGINE_TOS_ENDPOINT: "tos-cn-beijing.fake.volces.com",
  VOLCENGINE_TOS_REGION: "cn-beijing",
  VOLCENGINE_TOS_BUCKET_UPLOADS: "aivora-cn-uploads-test",
  VOLCENGINE_TOS_BUCKET_RENDERS: "aivora-cn-renders-test",
};

function resetAll() {
  calls.length = 0;
  throwOnNext = null;
  __resetAppEnvForTests();
  __resetStorageProviderForTests();
  __resetVolcengineTosClientForTests();
}

function withEnv<T>(
  patches: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(patches)) {
    prev[k] = process.env[k];
    if (patches[k] === undefined) delete process.env[k];
    else process.env[k] = patches[k];
  }
  resetAll();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(prev)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
      resetAll();
    });
}

test("Storage factory: STORAGE_PROVIDER=volcengine_tos → VolcengineTosStorageProvider", async () => {
  await withEnv(TOS_ENV, () => {
    const s = createStorageProvider();
    assert.equal(s.id, "volcengine_tos");
    assert.ok(s instanceof VolcengineTosStorageProvider);
  });
});

test("Storage factory: REGION=cn (默认) → volcengine_tos", async () => {
  await withEnv({ REGION: "cn", STORAGE_PROVIDER: undefined }, () => {
    const s = createStorageProvider();
    assert.equal(s.id, "volcengine_tos");
  });
});

test("Storage factory: 默认（未设 REGION/STORAGE_PROVIDER）→ vercel_blob", async () => {
  await withEnv(
    { REGION: undefined, STORAGE_PROVIDER: undefined },
    () => {
      const s = createStorageProvider();
      assert.equal(s.id, "vercel_blob");
    },
  );
});

test("isConfigured: 缺 endpoint → false", async () => {
  await withEnv({ ...TOS_ENV, VOLCENGINE_TOS_ENDPOINT: undefined }, () => {
    const s = new VolcengineTosStorageProvider();
    assert.equal(s.isConfigured(), false);
  });
});

test("isConfigured: 缺 BUCKET_UPLOADS → false", async () => {
  await withEnv(
    { ...TOS_ENV, VOLCENGINE_TOS_BUCKET_UPLOADS: undefined },
    () => {
      const s = new VolcengineTosStorageProvider();
      assert.equal(s.isConfigured(), false);
    },
  );
});

test("isConfigured: 全部齐 → true", async () => {
  await withEnv(TOS_ENV, () => {
    const s = new VolcengineTosStorageProvider();
    assert.equal(s.isConfigured(), true);
  });
});

test("uploadBuffer(uploads, ...) → 调 putObject 命中 uploads bucket", async () => {
  await withEnv(TOS_ENV, async () => {
    const s = new VolcengineTosStorageProvider();
    const res = await s.uploadBuffer("uploads", Buffer.from("hello"), {
      key: "user-uploads/abc.png",
      contentType: "image/png",
    });
    const put = calls.find((c) => c.method === "putObject");
    assert.ok(put, "putObject 必须被调用");
    const input = put!.input as Record<string, unknown>;
    assert.equal(input.bucket, TOS_ENV.VOLCENGINE_TOS_BUCKET_UPLOADS);
    assert.equal(input.key, "user-uploads/abc.png");
    assert.equal(input.contentType, "image/png");
    assert.equal(input.forbidOverwrite, true, "默认 overwrite=false → forbidOverwrite=true");
    /// 返回的 URL 应是 endpoint 直链，非 CDN（CDN_BASE_URL 未配）
    assert.match(
      res.url,
      /aivora-cn-uploads-test\.tos-cn-beijing\.fake\.volces\.com/,
    );
    assert.equal(res.key, "user-uploads/abc.png");
    assert.equal(res.absolute, true);
  });
});

test("uploadBuffer(renders, ..., overwrite=true) → 不传 forbidOverwrite", async () => {
  await withEnv(TOS_ENV, async () => {
    const s = new VolcengineTosStorageProvider();
    await s.uploadBuffer("renders", Buffer.from("video-bytes"), {
      key: "final-videos/abc/v1.mp4",
      contentType: "video/mp4",
      overwrite: true,
    });
    const put = calls.find((c) => c.method === "putObject");
    const input = put!.input as Record<string, unknown>;
    assert.equal(input.bucket, TOS_ENV.VOLCENGINE_TOS_BUCKET_RENDERS);
    assert.equal(input.forbidOverwrite, undefined);
  });
});

test("uploadBuffer access=public + CDN_BASE_URL → 返回 CDN URL", async () => {
  await withEnv(
    { ...TOS_ENV, CDN_BASE_URL: "https://cdn.aivora.cn/v" },
    async () => {
      const s = new VolcengineTosStorageProvider();
      const res = await s.uploadBuffer("renders", Buffer.from("mp4"), {
        key: "final/foo.mp4",
        access: "public",
        overwrite: true,
      });
      assert.equal(res.url, "https://cdn.aivora.cn/v/final/foo.mp4");
    },
  );
});

test("uploadBuffer access=public + VOLCENGINE_TOS_PUBLIC_BASE_URL 但无 CDN → 用 public base", async () => {
  await withEnv(
    {
      ...TOS_ENV,
      VOLCENGINE_TOS_PUBLIC_BASE_URL: "https://aivora-cn-renders-test.fake.public/x",
    },
    async () => {
      const s = new VolcengineTosStorageProvider();
      const res = await s.uploadBuffer("renders", Buffer.from("mp4"), {
        key: "final/bar.mp4",
        access: "public",
        overwrite: true,
      });
      assert.equal(res.url, "https://aivora-cn-renders-test.fake.public/x/final/bar.mp4");
    },
  );
});

test("getPublicUrl: CDN_BASE_URL 优先于 PUBLIC_BASE_URL", async () => {
  await withEnv(
    {
      ...TOS_ENV,
      CDN_BASE_URL: "https://cdn.aivora.cn",
      VOLCENGINE_TOS_PUBLIC_BASE_URL: "https://bucket.public",
    },
    () => {
      const s = new VolcengineTosStorageProvider();
      const url = s.getPublicUrl("renders", "demo/x.mp4");
      assert.equal(url, "https://cdn.aivora.cn/demo/x.mp4");
    },
  );
});

test("getPublicUrl: 都未配 → 走默认 endpoint 直链", async () => {
  await withEnv(TOS_ENV, () => {
    const s = new VolcengineTosStorageProvider();
    const url = s.getPublicUrl("renders", "demo/x.mp4");
    assert.equal(
      url,
      "https://aivora-cn-renders-test.tos-cn-beijing.fake.volces.com/demo/x.mp4",
    );
  });
});

test("getSignedDownloadUrl: 默认 600s 过期", async () => {
  await withEnv(TOS_ENV, async () => {
    const s = new VolcengineTosStorageProvider();
    const url = await s.getSignedDownloadUrl("uploads", "user/y.jpg");
    const psu = calls.find((c) => c.method === "getPreSignedUrl");
    assert.ok(psu);
    const input = psu!.input as Record<string, unknown>;
    assert.equal(input.method, "GET");
    assert.equal(input.bucket, TOS_ENV.VOLCENGINE_TOS_BUCKET_UPLOADS);
    assert.equal(input.key, "user/y.jpg");
    assert.equal(input.expires, 600);
    assert.match(url, /X-Tos-Method=GET/);
  });
});

test("getSignedUploadUrl: 自定义 contentType → 写入 query", async () => {
  await withEnv(TOS_ENV, async () => {
    const s = new VolcengineTosStorageProvider();
    const url = await s.getSignedUploadUrl("uploads", "user/up.png", {
      contentType: "image/png",
      expiresInSeconds: 3600,
    });
    const psu = calls.find((c) => c.method === "getPreSignedUrl");
    const input = psu!.input as Record<string, unknown>;
    assert.equal(input.method, "PUT");
    assert.equal(input.expires, 3600);
    assert.deepEqual(input.query, { "Content-Type": "image/png" });
    assert.match(url!, /X-Tos-Method=PUT/);
  });
});

test("deleteObject 命中正确 bucket", async () => {
  await withEnv(TOS_ENV, async () => {
    const s = new VolcengineTosStorageProvider();
    await s.deleteObject("renders", "old/v0.mp4");
    const del = calls.find((c) => c.method === "deleteObject");
    const input = del!.input as Record<string, unknown>;
    assert.equal(input.bucket, TOS_ENV.VOLCENGINE_TOS_BUCKET_RENDERS);
    assert.equal(input.key, "old/v0.mp4");
  });
});

test("copyObject: uploads → renders 跨 bucket 正确映射", async () => {
  await withEnv(TOS_ENV, async () => {
    const s = new VolcengineTosStorageProvider();
    const res = await s.copyObject!("uploads", "raw/a.mp4", "renders", "final/a.mp4");
    const cp = calls.find((c) => c.method === "copyObject");
    const input = cp!.input as Record<string, unknown>;
    assert.equal(input.srcBucket, TOS_ENV.VOLCENGINE_TOS_BUCKET_UPLOADS);
    assert.equal(input.srcKey, "raw/a.mp4");
    assert.equal(input.bucket, TOS_ENV.VOLCENGINE_TOS_BUCKET_RENDERS);
    assert.equal(input.key, "final/a.mp4");
    assert.equal(res.key, "final/a.mp4");
  });
});

test("缺 TOS env → uploadBuffer 抛清晰错误（提示缺哪些变量）", async () => {
  await withEnv(
    {
      ...TOS_ENV,
      VOLCENGINE_ACCESS_KEY_ID: undefined,
      STORAGE_PROVIDER: "volcengine_tos",
    },
    async () => {
      const s = new VolcengineTosStorageProvider();
      await assert.rejects(
        () => s.uploadBuffer("uploads", Buffer.from("x"), { key: "k" }),
        /VOLCENGINE_ACCESS_KEY_ID/,
      );
    },
  );
});

test("错误信息脱敏：putObject 抛错时 error.message 不含 AccessKey", async () => {
  await withEnv(TOS_ENV, async () => {
    /// 模拟 TOS 服务返回带 AK 的错误（极少见但要防御）
    throwOnNext = {
      method: "putObject",
      error: {
        statusCode: 403,
        message:
          "Signature mismatch. Provided AccessKey AKfaketestonlyABCDEFGHIJ tried to access",
        requestId: "req-1",
      },
    };
    const s = new VolcengineTosStorageProvider();
    try {
      await s.uploadBuffer("renders", Buffer.from("x"), {
        key: "fail/y.mp4",
        overwrite: true,
      });
      assert.fail("应抛错");
    } catch (err) {
      const msg = (err as Error).message;
      assert.match(msg, /status=403/);
      assert.match(msg, /requestId=req-1/);
      assert.doesNotMatch(msg, /AKfaketestonlyABCDEFGHIJ/, "AccessKey 应被脱敏");
      assert.doesNotMatch(msg, /SKfaketestonlysecret/);
    }
  });
});

test("pingBucket: 默认走 renders bucket，headBucket 成功 → ok=true", async () => {
  await withEnv(TOS_ENV, async () => {
    const s = new VolcengineTosStorageProvider();
    const r = await s.pingBucket();
    assert.equal(r.ok, true);
    const head = calls.find((c) => c.method === "headBucket");
    assert.ok(head);
    const input = head!.input as { bucket: string };
    assert.equal(input.bucket, TOS_ENV.VOLCENGINE_TOS_BUCKET_RENDERS);
  });
});

test("pingBucket: env 缺失 → ok=false 且不抛", async () => {
  await withEnv(
    { ...TOS_ENV, VOLCENGINE_TOS_ENDPOINT: undefined },
    async () => {
      const s = new VolcengineTosStorageProvider();
      const r = await s.pingBucket();
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /TOS env 未配置/);
    },
  );
});

test("pingBucket: headBucket 失败 → ok=false 且 error 不含 secret", async () => {
  await withEnv(TOS_ENV, async () => {
    throwOnNext = {
      method: "headBucket",
      error: {
        statusCode: 404,
        message: "NoSuchBucket — AKfaketestonlyABCDEFGHIJ 没权限",
      },
    };
    const s = new VolcengineTosStorageProvider();
    const r = await s.pingBucket();
    assert.equal(r.ok, false);
    /// pingBucket 走的是 statusCode 简短上报路径，本身就不含敏感串
    assert.doesNotMatch(r.error ?? "", /AKfaketestonlyABCDEFGHIJ/);
    assert.match(r.error ?? "", /404/);
  });
});

test("uploadFile (Blob): 走 uploadBuffer 同一路径", async () => {
  await withEnv(TOS_ENV, async () => {
    const s = new VolcengineTosStorageProvider();
    const blob = new Blob([Buffer.from("filebytes")], { type: "image/png" });
    const res = await s.uploadFile("uploads", blob, { key: "user/from-blob.png" });
    const put = calls.find((c) => c.method === "putObject");
    assert.ok(put);
    const input = put!.input as Record<string, unknown>;
    assert.equal(input.contentType, "image/png", "contentType 从 Blob.type 推断");
    assert.equal(res.key, "user/from-blob.png");
  });
});
