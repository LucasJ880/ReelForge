import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchProductFacts,
  ProductLinkError,
} from "../src/lib/services/product-link-service";

/**
 * Firecrawl 兜底路由（0802 接入）：直抓失败或抽不出事实时才走托管渲染，
 * 两条路径共用同一套结构化抽取。测试全部走注入 fetch，不出网。
 */

const RENDERED_HTML = `<!doctype html><html><head>
<meta property="og:title" content="定制百叶窗" />
<meta property="og:description" content="按窗定制，免费上门量尺" />
<meta property="og:image" content="https://cdn.example.com/blinds.jpg" />
</head><body>rendered</body></html>`;

function routedFetch(args: {
  directStatus: number;
  firecrawlBody?: unknown;
}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = input.toString();
    if (url.startsWith("https://api.firecrawl.dev/")) {
      return new Response(
        JSON.stringify(args.firecrawlBody ?? { success: true, data: { html: RENDERED_HTML } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("blocked", {
      status: args.directStatus,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
}

test("直抓 403 且配了 Firecrawl：走托管渲染，共用抽取（og 事实抽出）", async () => {
  process.env.FIRECRAWL_API_KEY = "test-key-not-real";
  const facts = await fetchProductFacts("https://shop.example.com/blinds", {
    fetchImpl: routedFetch({ directStatus: 403 }),
  });
  assert.equal(facts.title, "定制百叶窗");
  assert.equal(facts.imageUrl, "https://cdn.example.com/blinds.jpg");
  assert.equal(facts.source, "open_graph");
});

test("直抓失败且无 Firecrawl key：抛直抓原始错误（可解释性优先）", async () => {
  delete process.env.FIRECRAWL_API_KEY;
  await assert.rejects(
    fetchProductFacts("https://shop.example.com/blinds", {
      fetchImpl: routedFetch({ directStatus: 403 }),
    }),
    (err: unknown) =>
      err instanceof ProductLinkError && err.reason === "unreachable",
  );
});

test("兜底也失败：仍抛直抓原始错误，不用 Firecrawl 错误盖住 404 事实", async () => {
  process.env.FIRECRAWL_API_KEY = "test-key-not-real";
  await assert.rejects(
    fetchProductFacts("https://shop.example.com/blinds", {
      fetchImpl: routedFetch({
        directStatus: 404,
        firecrawlBody: { success: false },
      }),
    }),
    (err: unknown) =>
      err instanceof ProductLinkError && err.reason === "unreachable",
  );
  delete process.env.FIRECRAWL_API_KEY;
});
