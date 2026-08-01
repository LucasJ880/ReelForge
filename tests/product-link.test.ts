import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicHttpUrl,
  extractFactsFromHtml,
  factsToPromptLines,
  fetchProductFacts,
  ProductLinkError,
} from "../src/lib/services/product-link-service";

const URL_UNDER_TEST = "https://shop.example.com/products/roller-shade";

test("SSRF 边界：内网与非 http 协议一律拒绝", () => {
  const blocked = [
    "http://localhost:3000/x",
    "http://127.0.0.1/x",
    "http://10.1.2.3/x",
    "http://192.168.1.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://172.16.0.1/x",
    "http://box.internal/x",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "not a url",
  ];
  for (const raw of blocked) {
    assert.throws(
      () => assertPublicHttpUrl(raw),
      ProductLinkError,
      `${raw} 应被拒绝`,
    );
  }
  assert.ok(assertPublicHttpUrl("https://example.com/products/a"));
});

test("JSON-LD Product 优先，且能从 @graph 里挖出来", () => {
  const html = `<html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebSite","name":"站点"},
      {"@type":"Product","name":"定制卷帘","description":"<p>遮光 &amp; 隔热</p>",
       "image":["https://cdn.example.com/a.jpg"],
       "brand":{"name":"SunnyShutter"},"offers":{"price":"129.00"}}
    ]}
    </script>
    <meta property="og:title" content="不该用到的 OG 标题" />
  </head></html>`;
  const facts = extractFactsFromHtml(html, URL_UNDER_TEST);
  assert.equal(facts.source, "json_ld");
  assert.equal(facts.title, "定制卷帘");
  assert.equal(facts.description, "遮光 & 隔热", "要剥标签并解实体");
  assert.equal(facts.imageUrl, "https://cdn.example.com/a.jpg");
  assert.equal(facts.brand, "SunnyShutter");
  assert.equal(facts.price, "129.00");
});

test("坏掉的 JSON-LD 不影响继续找下一块", () => {
  const html = `<html><head>
    <script type="application/ld+json">{ 这不是 JSON </script>
    <script type="application/ld+json">{"@type":"Product","name":"能用的商品"}</script>
  </head></html>`;
  assert.equal(extractFactsFromHtml(html, URL_UNDER_TEST).title, "能用的商品");
});

test("没有 JSON-LD 时退到 OpenGraph，属性顺序两种都认", () => {
  const html = `<html><head>
    <meta content="卷帘窗" property="og:title">
    <meta property="og:description" content="上门量尺">
    <meta property="og:image" content="//cdn.example.com/b.jpg">
  </head></html>`;
  const facts = extractFactsFromHtml(html, URL_UNDER_TEST);
  assert.equal(facts.source, "open_graph");
  assert.equal(facts.title, "卷帘窗");
  assert.equal(facts.imageUrl, "https://cdn.example.com/b.jpg", "协议相对 URL 要补全");
});

test("都没有就退到 <title>，再没有就明确报错而不是编", () => {
  const withTitle = extractFactsFromHtml(
    "<html><head><title>  卷帘 &amp; 百叶  </title></head></html>",
    URL_UNDER_TEST,
  );
  assert.equal(withTitle.source, "title");
  assert.equal(withTitle.title, "卷帘 & 百叶");

  assert.throws(
    () => extractFactsFromHtml("<html><body>空页面</body></html>", URL_UNDER_TEST),
    (err: unknown) =>
      err instanceof ProductLinkError && err.reason === "no_facts",
  );
});

test("Shopify 商品页走官方 .json，不去解析 HTML", async () => {
  const calls: string[] = [];
  const facts = await fetchProductFacts(URL_UNDER_TEST, {
    fetchImpl: (async (input: string | URL) => {
      const url = input.toString();
      calls.push(url);
      if (url.endsWith(".json")) {
        return new Response(
          JSON.stringify({
            product: {
              title: "Shopify 卷帘",
              body_html: "<p>官方描述</p>",
              vendor: "SunnyShutter",
              images: [{ src: "https://cdn.example.com/s.jpg" }],
              variants: [{ price: "99.00" }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error("不应该去抓 HTML");
    }) as typeof fetch,
  });
  assert.equal(facts.source, "shopify");
  assert.equal(facts.title, "Shopify 卷帘");
  assert.equal(facts.description, "官方描述");
  assert.equal(calls.length, 1, "命中 Shopify 就不该再抓 HTML");
});

test("非 Shopify 站点：.json 探测失败后照常解析 HTML", async () => {
  const facts = await fetchProductFacts(URL_UNDER_TEST, {
    fetchImpl: (async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith(".json")) return new Response("nope", { status: 404 });
      return new Response(
        `<html><head><meta property="og:title" content="通用商品"></head></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }) as typeof fetch,
  });
  assert.equal(facts.source, "open_graph");
  assert.equal(facts.title, "通用商品");
});

test("非 HTML 与不可达都给明确 reason，便于前端给对应提示", async () => {
  await assert.rejects(
    fetchProductFacts("https://example.com/a.pdf", {
      fetchImpl: (async () =>
        new Response("%PDF", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        })) as typeof fetch,
    }),
    (err: unknown) =>
      err instanceof ProductLinkError && err.reason === "not_html",
  );

  await assert.rejects(
    fetchProductFacts("https://example.com/a", {
      fetchImpl: (async () => new Response("", { status: 500 })) as typeof fetch,
    }),
    (err: unknown) =>
      err instanceof ProductLinkError && err.reason === "unreachable",
  );
});

test("事实转成提示词行时只带事实，不带推断", () => {
  const lines = factsToPromptLines({
    url: URL_UNDER_TEST,
    title: "定制卷帘",
    description: "遮光隔热",
    imageUrl: "https://cdn.example.com/a.jpg",
    brand: "SunnyShutter",
    price: "129.00",
    source: "json_ld",
  });
  assert.deepEqual(lines, [
    "商品名：定制卷帘",
    "品牌：SunnyShutter",
    "价格：129.00",
    "商品描述：遮光隔热",
  ]);
  /// 图片 URL 不进文案提示词：它是产品锚点，不是可以写进句子的事实。
  assert.ok(!lines.some((line) => line.includes("cdn.example.com")));
});
