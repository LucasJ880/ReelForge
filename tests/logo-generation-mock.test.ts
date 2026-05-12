import assert from "node:assert/strict";
import test from "node:test";
import {
  __test__ as imageTest,
  buildLogoPrompt,
  generateImages,
  isImageGenAvailable,
} from "../src/lib/providers/openai-image";
import { __test__ as logoSvcTest } from "../src/lib/services/logo-service";

const { mergeLogoUrlIntoClientBrief } = logoSvcTest;

test("buildLogoPrompt: 包含业务名 + 风格 + 颜色 + slogan", () => {
  const prompt = buildLogoPrompt({
    businessName: "Sunny Shutter",
    industry: "smart home",
    styleHint: "modern",
    colors: "navy and gold",
    slogan: "Wake up to sunlight",
    iconIdea: "abstract sun behind window blinds",
    language: "en",
  });
  assert.match(prompt, /Sunny Shutter/);
  assert.match(prompt, /smart home/);
  assert.match(prompt, /modern/);
  assert.match(prompt, /navy and gold/);
  assert.match(prompt, /Wake up to sunlight/);
  assert.match(prompt, /abstract sun/);
  /// 必含安全约束（不渲人脸 / 不要 photorealism）
  assert.match(prompt, /no people faces/i);
  assert.match(prompt, /Avoid photorealism/i);
});

test("buildLogoPrompt: 缺失可选字段时不抛错", () => {
  const prompt = buildLogoPrompt({ businessName: "Acme" });
  assert.match(prompt, /Acme/);
  assert.match(prompt, /Vector flat design/);
});

test("generateImages: forceMock=true → 不调用 OpenAI，返回占位 URL", async () => {
  const result = await generateImages({
    prompt: "test prompt",
    n: 3,
    forceMock: true,
  });
  assert.equal(result.fromMock, true);
  assert.equal(result.modelUsed, "mock");
  assert.equal(result.urls.length, 3);
  for (const url of result.urls) {
    assert.match(url, /^https?:\/\//);
  }
});

test("generateImages: 缺 OPENAI_API_KEY → 自动 mock（不发起真实调用）", async () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await generateImages({ prompt: "test", n: 2 });
    assert.equal(result.fromMock, true);
    assert.equal(result.urls.length, 2);
  } finally {
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  }
});

test("generateImages: IMAGE_ENGINE_MOCK=true → mock，即使有 API key", async () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevMock = process.env.IMAGE_ENGINE_MOCK;
  process.env.OPENAI_API_KEY = "sk-test-fake";
  process.env.IMAGE_ENGINE_MOCK = "true";
  try {
    assert.equal(isImageGenAvailable(), false);
    const result = await generateImages({ prompt: "test", n: 1 });
    assert.equal(result.fromMock, true);
  } finally {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    if (prevMock === undefined) delete process.env.IMAGE_ENGINE_MOCK;
    else process.env.IMAGE_ENGINE_MOCK = prevMock;
  }
});

test("generateImages: n 钳位到 [1, 10]", async () => {
  const a = await generateImages({ prompt: "x", n: 0, forceMock: true });
  const b = await generateImages({ prompt: "x", n: 99, forceMock: true });
  assert.equal(a.urls.length, 1);
  assert.equal(b.urls.length, 10);
});

test("mockUrls 内置 4 个调色板循环填充", () => {
  const urls = imageTest.mockUrls(4);
  assert.equal(new Set(urls).size, 4);
});

test("mergeLogoUrlIntoClientBrief: null 输入 → 建立最小结构", () => {
  const merged = mergeLogoUrlIntoClientBrief(
    null,
    "https://cdn.example.com/logo.png",
  ) as Record<string, unknown>;
  assert.deepEqual(merged.brandAssets, {
    logoUrl: "https://cdn.example.com/logo.png",
  });
});

test("mergeLogoUrlIntoClientBrief: 保留已有 clientBrief 字段", () => {
  const original = {
    businessName: "Sunny Shutter",
    objective: "increase_bookings",
    brandAssets: {
      ctaText: "Book a session",
      colors: "navy",
    },
  };
  const merged = mergeLogoUrlIntoClientBrief(
    original,
    "https://cdn.example.com/new-logo.png",
  ) as Record<string, unknown>;
  assert.equal(merged.businessName, "Sunny Shutter");
  assert.equal(merged.objective, "increase_bookings");
  const brand = merged.brandAssets as Record<string, unknown>;
  assert.equal(brand.ctaText, "Book a session");
  assert.equal(brand.colors, "navy");
  assert.equal(brand.logoUrl, "https://cdn.example.com/new-logo.png");
});

test("mergeLogoUrlIntoClientBrief: 替换已有 logoUrl", () => {
  const original = {
    brandAssets: { logoUrl: "https://cdn.example.com/old.png" },
  };
  const merged = mergeLogoUrlIntoClientBrief(
    original,
    "https://cdn.example.com/new.png",
  ) as Record<string, unknown>;
  const brand = merged.brandAssets as Record<string, unknown>;
  assert.equal(brand.logoUrl, "https://cdn.example.com/new.png");
});

test("mergeLogoUrlIntoClientBrief: 数组类输入 → 当成空对象", () => {
  const merged = mergeLogoUrlIntoClientBrief(
    [1, 2, 3],
    "https://cdn.example.com/new.png",
  ) as Record<string, unknown>;
  assert.deepEqual(merged.brandAssets, {
    logoUrl: "https://cdn.example.com/new.png",
  });
});
