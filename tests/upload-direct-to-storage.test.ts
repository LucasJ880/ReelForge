import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createUploadCompletePostHandler } from "../src/app/api/upload/blob/complete/route";
import { createUploadTicketPostHandler } from "../src/app/api/upload/blob/ticket/route";
import { QuotaExceededError } from "../src/lib/services/quota-service";
import type { MediaAssetRecord } from "../src/lib/services/media-asset-service";
import {
  signDirectUploadTicket,
  verifyDirectUploadTicket,
} from "../src/lib/upload/direct-upload-ticket";

/**
 * 2026-10-30 CEO 演示翻车：商品图上传「上传失败 (413)」。Vercel 函数请求体上限 4.5MB，
 * 手机原图一穿过 /api/upload/blob 就被平台直接 413（FUNCTION_PAYLOAD_TOO_LARGE），我们的
 * handler 根本没被调用；本地 next dev 没这个上限，单测又只用 1×1 的 PNG，所以一直没暴露。
 * 现在文件从浏览器直传 Blob，函数只收两次小 JSON：ticket 签凭证、complete 验收登记。
 */

const SECRET = "upload-ticket-regression-secret";
const USER = "user-1";
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(28).fill(0)]);
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const signedIn = async () => ({ ok: true as const, session: { user: { id: USER } } as never });

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function storage(id: "vercel_blob" | "volcengine_tos", configured = true) {
  return () =>
    ({
      id,
      displayName: id,
      isConfigured: () => configured,
    }) as never;
}

function ticketHandler(overrides: Parameters<typeof createUploadTicketPostHandler>[0] = {}) {
  const tokens: Array<{ pathname: string; contentType: string; validUntil: number }> = [];
  const handler = createUploadTicketPostHandler({
    requireAuth: signedIn,
    getStorageProvider: storage("vercel_blob"),
    generateClientToken: async (args) => {
      tokens.push(args);
      return "vercel_blob_client_test_token";
    },
    signTicket: (ticket) => signDirectUploadTicket(ticket, SECRET),
    randomUUID: () => "fixed-id",
    now: () => NOW,
    ...overrides,
  });
  return { handler, tokens };
}

test("ticket：只签一个路径、一种类型的凭证，票据绑定本人", async () => {
  const { handler, tokens } = ticketHandler();
  const response = await handler(
    jsonRequest("http://localhost/api/upload/blob/ticket", {
      contentType: "image/jpeg",
      size: 6 * 1024 * 1024,
      prefix: "unified-input",
    }),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { mode: string; pathname: string; clientToken: string; ticket: string };
  assert.equal(body.mode, "direct");
  assert.equal(body.pathname, "uploads/unified-input/fixed-id.jpg");
  assert.deepEqual(tokens, [
    { pathname: "uploads/unified-input/fixed-id.jpg", contentType: "image/jpeg", validUntil: NOW + 30 * 60 * 1000 },
  ]);
  const ticket = verifyDirectUploadTicket(body.ticket, { userId: USER, now: NOW, secret: SECRET });
  assert.equal(ticket?.pathname, body.pathname);
  assert.equal(ticket?.contentType, "image/jpeg");
  assert.equal(verifyDirectUploadTicket(body.ticket, { userId: "someone-else", now: NOW, secret: SECRET }), null);
});

test("ticket：类型、大小、目录不合法在签凭证之前就拒绝", async () => {
  const cases: Array<[unknown, number]> = [
    [{ contentType: "image/heic", size: 1000 }, 415],
    [{ contentType: "image/jpeg", size: 100 * 1024 * 1024 + 1 }, 413],
    [{ contentType: "image/jpeg", size: 1000, prefix: "../escape" }, 400],
    [{ contentType: "image/jpeg" }, 400],
  ];
  for (const [payload, status] of cases) {
    const { handler, tokens } = ticketHandler();
    const response = await handler(jsonRequest("http://localhost/api/upload/blob/ticket", payload));
    assert.equal(response.status, status, JSON.stringify(payload));
    assert.equal(tokens.length, 0);
  }
});

test("ticket：存储不支持直传（国内 TOS）时让前端退回中转；没登录不签", async () => {
  const tos = ticketHandler({ getStorageProvider: storage("volcengine_tos") });
  const tosResponse = await tos.handler(
    jsonRequest("http://localhost/api/upload/blob/ticket", { contentType: "image/png", size: 10 }),
  );
  assert.deepEqual(await tosResponse.json(), { ok: true, mode: "server" });
  assert.equal(tos.tokens.length, 0);

  const anonymous = ticketHandler({
    requireAuth: async () => ({ ok: false as const, response: new Response(null, { status: 401 }) as never }),
  });
  const anonymousResponse = await anonymous.handler(
    jsonRequest("http://localhost/api/upload/blob/ticket", { contentType: "image/png", size: 10 }),
  );
  assert.equal(anonymousResponse.status, 401);
  assert.equal(anonymous.tokens.length, 0);
});

test("票据：篡改、过期、换人都验不过", () => {
  const raw = signDirectUploadTicket(
    { userId: USER, pathname: "uploads/unified-input/a.jpg", contentType: "image/jpeg", expiresAt: NOW + 1000 },
    SECRET,
  );
  assert.ok(verifyDirectUploadTicket(raw, { userId: USER, now: NOW, secret: SECRET }));
  assert.equal(verifyDirectUploadTicket(raw, { userId: USER, now: NOW + 1001, secret: SECRET }), null);
  assert.equal(verifyDirectUploadTicket(raw, { userId: USER, now: NOW, secret: "other-secret" }), null);
  const [body, mac] = raw.split(".");
  const forged = Buffer.from(
    JSON.stringify({ u: USER, p: "uploads/other-user/b.jpg", t: "image/jpeg", e: NOW + 1000 }),
  ).toString("base64url");
  assert.equal(verifyDirectUploadTicket(`${forged}.${mac}`, { userId: USER, now: NOW, secret: SECRET }), null);
  assert.equal(verifyDirectUploadTicket(`${body}.${mac}.x`, { userId: USER, now: NOW, secret: SECRET }), null);
});

function assetRecord(overrides: Partial<MediaAssetRecord> = {}): MediaAssetRecord {
  return {
    id: "asset-1",
    userId: USER,
    workspaceId: null,
    storageKey: "uploads/unified-input/fixed-id.png",
    url: "https://store.public.blob.vercel-storage.com/uploads/unified-input/fixed-id.png",
    mimeType: "image/jpeg",
    byteSize: 6 * 1024 * 1024,
    sha256: "sha",
    width: 3024,
    height: 4032,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  };
}

function completeHandler(
  options: {
    bytes?: Uint8Array;
    stored?: { url: string; size: number } | null;
    existing?: MediaAssetRecord | null;
    existingAfterFailure?: MediaAssetRecord | null;
    quota?: () => Promise<void>;
    persist?: (input: { mimeType: string; bytes: Buffer | Uint8Array }) => Promise<MediaAssetRecord>;
  } = {},
) {
  const calls: string[] = [];
  let lookups = 0;
  const handler = createUploadCompletePostHandler({
    requireAuth: signedIn,
    verifyTicket: (raw, expected) => verifyDirectUploadTicket(raw, { ...expected, now: NOW, secret: SECRET }),
    findExistingAsset: async () => {
      lookups += 1;
      return lookups === 1 ? options.existing ?? null : options.existingAfterFailure ?? null;
    },
    headObject: async () => {
      calls.push("head");
      return options.stored === undefined
        ? { url: assetRecord().url, size: (options.bytes ?? JPEG_HEADER).byteLength }
        : options.stored;
    },
    readObject: async () => {
      calls.push("read");
      return options.bytes ?? JPEG_HEADER;
    },
    deleteObject: async (pathname) => {
      calls.push(`delete:${pathname}`);
    },
    assertQuotaForSession: async (_session, resource, amount) => {
      calls.push(`quota:${resource}:${amount}`);
      await options.quota?.();
    },
    createOwnedMediaAsset: async (input) => {
      calls.push(`persist:${input.mimeType}`);
      return options.persist ? options.persist(input) : assetRecord({ mimeType: input.mimeType });
    },
  });
  return { handler, calls };
}

const validTicket = () =>
  signDirectUploadTicket(
    {
      userId: USER,
      pathname: "uploads/unified-input/fixed-id.png",
      contentType: "image/png",
      expiresAt: NOW + 60_000,
    },
    SECRET,
  );

const complete = (ticket: string) =>
  jsonRequest("http://localhost/api/upload/blob/complete", { ticket });

test("complete：按真实大小扣额度、按文件签名入库（.png 名字的 JPEG 存成 image/jpeg）", async () => {
  const { handler, calls } = completeHandler();
  const response = await handler(complete(validTicket()));
  assert.equal(response.status, 201);
  const body = (await response.json()) as { ok: boolean; asset: { id: string; mimeType: string } };
  assert.equal(body.ok, true);
  assert.equal(body.asset.id, "asset-1");
  assert.equal(body.asset.mimeType, "image/jpeg");
  assert.deepEqual(calls, ["head", "read", `quota:BLOB_UPLOAD_BYTES:${JPEG_HEADER.byteLength}`, "persist:image/jpeg"]);
});

test("complete：同一张票据重复登记返回同一条资产，不重复扣额度", async () => {
  const { handler, calls } = completeHandler({ existing: assetRecord() });
  const response = await handler(complete(validTicket()));
  assert.equal(response.status, 201);
  assert.equal(((await response.json()) as { asset: { id: string } }).asset.id, "asset-1");
  assert.deepEqual(calls, []);
});

test("complete：票据无效不碰存储；对象还没传完回 409 让前端重传", async () => {
  const invalid = completeHandler();
  const invalidResponse = await invalid.handler(complete(`${validTicket()}x`));
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(invalid.calls, []);

  const missing = completeHandler({ stored: null });
  const missingResponse = await missing.handler(complete(validTicket()));
  assert.equal(missingResponse.status, 409);
  assert.equal(((await missingResponse.json()) as { code: string }).code, "ASSET_MISSING");
  assert.deepEqual(missing.calls, ["head"]);
});

test("complete：签名不对、额度不够、入库失败都删掉对象，不留没人认领的文件", async () => {
  const notMedia = completeHandler({ bytes: Uint8Array.from(Buffer.from("<html>not an image</html>")) });
  const notMediaResponse = await notMedia.handler(complete(validTicket()));
  assert.equal(notMediaResponse.status, 415);
  assert.deepEqual(notMedia.calls, ["head", "read", "delete:uploads/unified-input/fixed-id.png"]);

  const overQuota = completeHandler({
    bytes: ONE_PIXEL_PNG,
    quota: async () => {
      throw new QuotaExceededError({ resource: "BLOB_UPLOAD_BYTES", used: 10, limit: 10, periodKey: "2026-10" });
    },
  });
  const overQuotaResponse = await overQuota.handler(complete(validTicket()));
  assert.equal(overQuotaResponse.status, 429);
  assert.ok(overQuota.calls.includes("delete:uploads/unified-input/fixed-id.png"));
  assert.ok(!overQuota.calls.some((call) => call.startsWith("persist")));

  const persistFails = completeHandler({
    persist: async () => {
      throw new Error("db down");
    },
  });
  const persistFailsResponse = await persistFails.handler(complete(validTicket()));
  assert.equal(persistFailsResponse.status, 503);
  assert.equal(persistFails.calls.at(-1), "delete:uploads/unified-input/fixed-id.png");
});

test("complete：并发重放撞唯一键时返回已登记的那条，对象不能删", async () => {
  const raced = completeHandler({
    persist: async () => {
      throw new Error("Unique constraint failed on the fields: (`storageKey`)");
    },
    existingAfterFailure: assetRecord({ id: "asset-raced" }),
  });
  const response = await raced.handler(complete(validTicket()));
  assert.equal(response.status, 201);
  assert.equal(((await response.json()) as { asset: { id: string } }).asset.id, "asset-raced");
  assert.ok(!raced.calls.some((call) => call.startsWith("delete")));
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test("守门：前端不许再自己 POST 文件到 /api/upload/blob，一律走 uploadBlobWithProgress 直传", () => {
  const root = path.resolve(process.cwd(), "src");
  const offenders = sourceFiles(root)
    .filter((file) => !file.endsWith(path.join("lib", "upload", "blob-xhr.ts")))
    .filter((file) => !file.includes(`${path.sep}app${path.sep}api${path.sep}upload${path.sep}`))
    /// 只认字符串字面量里的地址（fetch / XHR 目标），注释里提到不算
    .filter((file) => /["'`]\/api\/upload\/blob/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(process.cwd(), file));
  assert.deepEqual(offenders, [], "文件穿过 Vercel 函数超过 4.5MB 就会被平台 413，见本文件头注释");
});
