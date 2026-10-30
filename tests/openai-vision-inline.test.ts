import assert from "node:assert/strict";
import test, { mock } from "node:test";
import sharp from "sharp";
import { analyzeImages, openai } from "../src/lib/providers/openai";
import {
  VisionImageInlineError,
  inlineImagesAfterDownloadFailure,
  inlineMaxEdge,
  inlineRemoteImages,
  isImageDownloadError,
  ownBlobPublicHost,
  toInlineDataUrl,
} from "../src/lib/providers/openai-vision-inline";
import {
  __setCapabilityStoreForTests,
  createMemoryCapabilityStore,
} from "../src/lib/services/capability-status-service";

/**
 * 10-29：看图时 OpenAI 自己拉 Blob 图偶尔超时（400 invalid_image_url），参考图理解吞掉错误返回 null，
 * 一致性设定只能凭文件名写商品描述。兜底 = 服务端取图转 data URL 重试一次，且不把「AI 看图」标成故障。
 */

const STORE_HOST = "store1abc.public.blob.vercel-storage.com";
const TRUSTED = `https://${STORE_HOST}/products/toy.png`;

/// 10-29 真机探测到的原样报文（BadRequestError：status 400 + code invalid_image_url）
function openAiDownloadError(message = "400 Unable to download content from the provided URL before the timeout. Check that the URL is publicly accessible and responds promptly, or upload the file and provide a file_id instead.") {
  return Object.assign(new Error(message), { status: 400, code: "invalid_image_url", type: "invalid_request_error" });
}

async function transparentPng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      {
        input: { create: { width: Math.floor(width / 3), height: Math.floor(height / 3), channels: 4, background: { r: 0, g: 160, b: 150, alpha: 1 } } },
        gravity: "centre",
      },
    ])
    .png()
    .toBuffer();
}

function pngResponse(bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "image/png", "content-length": String(bytes.length) },
  });
}

function decodeDataUrl(url: string): Buffer {
  assert.match(url, /^data:image\/jpeg;base64,/);
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
}

test("isImageDownloadError：认 OpenAI 拉图失败的真实报文（400 + invalid_image_url），不认限流 / 5xx / 别的 400", () => {
  assert.equal(isImageDownloadError(openAiDownloadError()), true);
  assert.equal(isImageDownloadError(openAiDownloadError("400 Error while downloading file. Upstream status code: 404.")), true);
  assert.equal(isImageDownloadError(openAiDownloadError("400 Failed to download file.")), true);
  /// code 改名了也要靠报文认出来，否则又是静默降级
  assert.equal(isImageDownloadError(Object.assign(new Error("400 Unable to download content from the provided URL before the timeout."), { status: 400 })), true);
  assert.equal(isImageDownloadError(new VisionImageInlineError("服务端也没转成")), true);

  assert.equal(isImageDownloadError(Object.assign(new Error("Unable to download content"), { status: 429 })), false);
  assert.equal(isImageDownloadError(Object.assign(new Error("Error while downloading file."), { status: 502 })), false);
  assert.equal(isImageDownloadError(Object.assign(new Error("400 Invalid value for 'detail'"), { status: 400, code: "invalid_value" })), false);
  assert.equal(isImageDownloadError(Object.assign(new Error("The model `x` does not exist"), { status: 404, code: "model_not_found" })), false);
  assert.equal(isImageDownloadError(new Error("视觉分析返回了空响应")), false);
  assert.equal(isImageDownloadError(null), false);
});

test("ownBlobPublicHost：从读写 token 推出本项目 Blob store 的公开主机；拿不到就不放行任何 Blob 主机", () => {
  assert.equal(ownBlobPublicHost({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_Store1ABC_secretPart" }), STORE_HOST);
  assert.equal(ownBlobPublicHost({}), null);
  assert.equal(ownBlobPublicHost({ BLOB_READ_WRITE_TOKEN: "not-a-blob-token" }), null);
  assert.equal(ownBlobPublicHost({ BLOB_READ_WRITE_TOKEN: "vercel_blob_client_store1abc_xxx" }), null);
  assert.equal(ownBlobPublicHost({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw__secret" }), null);
});

test("toInlineDataUrl：缩到 OpenAI 实际会看的尺寸、透明底铺白（不铺黑，免得商品颜色看错）、不放大小图", async () => {
  const low = decodeDataUrl(await toInlineDataUrl(await transparentPng(3000, 1500), inlineMaxEdge("low")));
  const lowMeta = await sharp(low).metadata();
  assert.equal(lowMeta.format, "jpeg");
  assert.deepEqual([lowMeta.width, lowMeta.height], [768, 384]);
  const { data: corner } = await sharp(low).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  assert.ok(corner[0]! > 240 && corner[1]! > 240 && corner[2]! > 240, `透明角应铺白，实际 ${[...corner].join(",")}`);

  const high = await sharp(decodeDataUrl(await toInlineDataUrl(await transparentPng(3000, 1500), inlineMaxEdge("high")))).metadata();
  assert.deepEqual([high.width, high.height], [2048, 1024]);

  const small = await sharp(decodeDataUrl(await toInlineDataUrl(await transparentPng(300, 200), inlineMaxEdge("high")))).metadata();
  assert.deepEqual([small.width, small.height], [300, 200]);
});

test("inlineRemoteImages：只替可信主机取图；data: 原样保留；不可信主机不去抓；单张失败不连累其它张", async () => {
  const png = await transparentPng(1200, 900);
  const fetched: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith("/gone.png")) return new Response("missing", { status: 404 });
    return pngResponse(png);
  }) as typeof fetch;

  const dataUrl = "data:image/jpeg;base64,AAAA";
  const result = await inlineRemoteImages(
    [TRUSTED, dataUrl, "https://evil.example.com/a.png", `https://${STORE_HOST}/gone.png`, "http://169.254.169.254/latest/meta-data"],
    { hosts: [STORE_HOST], fetchImpl },
  );

  assert.equal(result.inlined, 1);
  assert.match(result.urls[0]!, /^data:image\/jpeg;base64,/);
  assert.equal(result.urls[1], dataUrl);
  assert.equal(result.urls[2], "https://evil.example.com/a.png");
  assert.equal(result.urls[3], `https://${STORE_HOST}/gone.png`);
  assert.deepEqual(fetched.sort(), [TRUSTED, `https://${STORE_HOST}/gone.png`].sort(), "不可信主机 / 内网地址一次都不该抓");
  assert.deepEqual(result.failures, ["#3 不在可信主机上", "#4 media download failed (404)", "#5 不在可信主机上"]);
});

test("inlineImagesAfterDownloadFailure：一张都没转成就不重试，抛 VisionImageInlineError（仍算拉图失败）并带上 OpenAI 原话", async () => {
  const fetchImpl = (async () => new Response("missing", { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(
    inlineImagesAfterDownloadFailure([TRUSTED], "low", openAiDownloadError(), { hosts: [STORE_HOST], fetchImpl }),
    (err: unknown) => {
      assert.ok(err instanceof VisionImageInlineError);
      assert.equal(isImageDownloadError(err), true);
      assert.match((err as Error).message, /Unable to download content/);
      assert.match((err as Error).message, /#1 media download failed \(404\)/);
      return true;
    },
  );
});

/* ── analyzeImages 接上兜底（打桩 chat.completions.create 与全局 fetch，不打真接口）────── */

const VISION_ENV: Record<string, string | undefined> = {
  OPENAI_API_KEY: "sk-test-vision",
  OPENAI_MODEL: undefined,
  OPENAI_VISION_MODEL: undefined,
  LLM_FORCE_MOCK: undefined,
  AIVORA_DRY_RUN: undefined,
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_store1abc_secretPart",
  MEDIA_FETCH_HOST_ALLOWLIST: undefined,
};

async function withVisionEnv(run: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(VISION_ENV)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const store = createMemoryCapabilityStore();
  __setCapabilityStoreForTests(store);
  try {
    await run();
    /// 拉图失败不是 key / 额度问题：「AI 看图」绝不能因此被写成暂停 / 不稳定
    assert.ok(
      store.writes.every((record) => record.key !== "vision" || record.status === "available"),
      `不该把 AI 看图标成故障：${JSON.stringify(store.writes)}`,
    );
  } finally {
    __setCapabilityStoreForTests(null);
    mock.restoreAll();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

type CreateParams = { model: string; messages: Array<{ role: string; content: unknown }> };

function stubCreate(impl: (params: CreateParams, callIndex: number) => unknown): CreateParams[] {
  const calls: CreateParams[] = [];
  mock.method(openai.chat.completions, "create", (async (params: CreateParams) => {
    calls.push(params);
    return impl(params, calls.length - 1);
  }) as never);
  return calls;
}

function imageUrlsOf(params: CreateParams): string[] {
  return (params.messages[1]!.content as Array<{ type: string; image_url?: { url: string } }>)
    .filter((part) => part.type === "image_url")
    .map((part) => part.image_url!.url);
}

const okVision = {
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ productDescription: "teal rope toy" }) } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

test("analyzeImages：OpenAI 拉图超时 → 服务端转 data URL，同一模型重试一次就拿到结果", async () => {
  await withVisionEnv(async () => {
    const png = await transparentPng(1600, 1200);
    const fetchMock = mock.method(globalThis, "fetch", (async () => pngResponse(png)) as typeof fetch);
    const calls = stubCreate((_params, index) => {
      if (index === 0) throw openAiDownloadError();
      return okVision;
    });

    const result = await analyzeImages([TRUSTED, "data:image/jpeg;base64,BBBB"], "sys", "user");

    assert.deepEqual(result.data, { productDescription: "teal rope toy" });
    assert.deepEqual(calls.map((c) => c.model), ["gpt-5.6-sol", "gpt-5.6-sol"], "同一模型重试，不去换 terra");
    assert.deepEqual(imageUrlsOf(calls[0]!), [TRUSTED, "data:image/jpeg;base64,BBBB"]);
    const retried = imageUrlsOf(calls[1]!);
    assert.match(retried[0]!, /^data:image\/jpeg;base64,/);
    assert.equal(retried[1], "data:image/jpeg;base64,BBBB");
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});

test("analyzeImages：转成 data URL 后还是失败 → 只重试这一次就抛出，不打第三次", async () => {
  await withVisionEnv(async () => {
    const png = await transparentPng(400, 300);
    mock.method(globalThis, "fetch", (async () => pngResponse(png)) as typeof fetch);
    const calls = stubCreate(() => {
      throw openAiDownloadError("400 Error while downloading file.");
    });
    await assert.rejects(analyzeImages([TRUSTED], "sys", "user"), (err: unknown) => isImageDownloadError(err));
    assert.equal(calls.length, 2);
  });
});

test("analyzeImages：图不在可信主机上 → 不替人去抓、不重试，报错写明原因", async () => {
  await withVisionEnv(async () => {
    const fetchMock = mock.method(globalThis, "fetch", (async () => {
      throw new Error("must not fetch");
    }) as typeof fetch);
    const calls = stubCreate(() => {
      throw openAiDownloadError();
    });
    await assert.rejects(analyzeImages(["https://merchant-site.example.com/p.png"], "sys", "user"), (err: unknown) => {
      assert.ok(err instanceof VisionImageInlineError);
      assert.match((err as Error).message, /#1 不在可信主机上/);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});

test("analyzeImages：别的 400（不是拉图失败）照旧直接抛，不去取图", async () => {
  await withVisionEnv(async () => {
    const fetchMock = mock.method(globalThis, "fetch", (async () => {
      throw new Error("must not fetch");
    }) as typeof fetch);
    const calls = stubCreate(() => {
      throw Object.assign(new Error("400 Invalid value for 'detail'"), { status: 400, code: "invalid_value" });
    });
    await assert.rejects(analyzeImages([TRUSTED], "sys", "user"), /Invalid value/);
    assert.equal(calls.length, 1);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
