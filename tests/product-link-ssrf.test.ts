import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REDIRECTS,
  ProductLinkError,
  assertPublicDestination,
  assertPublicHttpUrl,
  fetchProductFacts,
  isBlockedIpAddress,
} from "../src/lib/services/product-link-service";

/**
 * A4 5.4（bughunt #23）商品链接抓取的 SSRF 边界：
 * 以前只按主机名字符串拦内网，且 `redirect: "follow"` 跟随跳转不复检。
 * 现在：解析 DNS 后校验 IP 段（IPv4 + IPv6），手动逐跳跟随（最多 5 跳）且每跳复检。
 * 全部注入 DNS 与 fetch，不出网。
 */

const OG_PAGE = `<html><head><meta property="og:title" content="公开商品"></head></html>`;

function html(body = OG_PAGE): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

const dnsTable = (table: Record<string, string[]>) => async (hostname: string) => {
  const hit = table[hostname];
  if (!hit) throw new Error(`ENOTFOUND ${hostname}`);
  return hit;
};

test("IP 段：回环 / 私网 / 链路本地 / 元数据 / CGNAT / 组播一律拦，公网放行", () => {
  const blocked = [
    "127.0.0.1",
    "10.20.30.40",
    "172.16.5.4",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", /// AWS / GCP 元数据
    "100.100.100.200", /// 阿里云元数据（CGNAT 段）
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00:ec2::254", /// AWS IPv6 元数据
    "fc00::1",
    "::ffff:127.0.0.1", /// IPv4 映射
    "::ffff:a9fe:a9fe", /// = 169.254.169.254
    "64:ff9b::a9fe:a9fe", /// NAT64 包着元数据地址
    "2002:7f00:1::", /// 6to4 包着 127.0.0.1
    "[::1]",
    "not-an-ip",
  ];
  for (const address of blocked) {
    assert.equal(isBlockedIpAddress(address), true, `${address} 应被拦截`);
  }
  for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::6810:84e5"]) {
    assert.equal(isBlockedIpAddress(address), false, `${address} 是公网地址`);
  }
});

test("字符串层：IP 字面量的各种写法都按解析后的地址判（含十进制 / 十六进制 / IPv6 / 结尾点）", () => {
  for (const raw of [
    "http://2130706433/", /// 127.0.0.1 的十进制写法
    "http://0x7f.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    "http://localhost./",
    "http://user:pass@example.com/",
  ]) {
    assert.throws(() => assertPublicHttpUrl(raw), ProductLinkError, `${raw} 应被拒绝`);
  }
  assert.ok(assertPublicHttpUrl("http://[2606:4700::6810:84e5]/products/a"), "公网 IPv6 字面量放行");
});

test("🔴 域名解析到内网：拒绝，且一次请求都不发、不交给 Firecrawl", async () => {
  process.env.FIRECRAWL_API_KEY = "test-key-not-real";
  const calls: string[] = [];
  await assert.rejects(
    fetchProductFacts("https://evil.example.test/products/a", {
      resolveHost: dnsTable({ "evil.example.test": ["169.254.169.254"] }),
      fetchImpl: (async (input: string | URL) => {
        calls.push(input.toString());
        return html();
      }) as typeof fetch,
    }),
    (err: unknown) => err instanceof ProductLinkError && err.reason === "invalid_url",
  );
  assert.deepEqual(calls, []);
  delete process.env.FIRECRAWL_API_KEY;
});

test("多条解析记录里只要有一个是内网就拒绝（我们控制不了实际连到哪一个）", async () => {
  await assert.rejects(
    assertPublicDestination(
      new URL("https://mixed.example.test/"),
      dnsTable({ "mixed.example.test": ["93.184.216.34", "10.0.0.5"] }),
    ),
    (err: unknown) => err instanceof ProductLinkError && err.reason === "invalid_url",
  );
});

test("🔴 公网页面 302 跳到内网：逐跳复检，内网那一跳不发请求", async () => {
  const calls: string[] = [];
  await assert.rejects(
    fetchProductFacts("https://shop.example.test/item", {
      resolveHost: dnsTable({
        "shop.example.test": ["93.184.216.34"],
        "internal.example.test": ["10.1.2.3"],
      }),
      fetchImpl: (async (input: string | URL, init?: RequestInit) => {
        calls.push(input.toString());
        assert.equal(init?.redirect, "manual", "必须手动跟随跳转");
        return redirect("http://internal.example.test/admin");
      }) as typeof fetch,
    }),
    (err: unknown) => err instanceof ProductLinkError && err.reason === "invalid_url",
  );
  assert.deepEqual(calls, ["https://shop.example.test/item"]);
});

test("跳到 IP 字面量的元数据地址同样被拦", async () => {
  const calls: string[] = [];
  await assert.rejects(
    fetchProductFacts("https://shop.example.test/item", {
      resolveHost: dnsTable({ "shop.example.test": ["93.184.216.34"] }),
      fetchImpl: (async (input: string | URL) => {
        calls.push(input.toString());
        return redirect("http://169.254.169.254/latest/meta-data/", 301);
      }) as typeof fetch,
    }),
    (err: unknown) => err instanceof ProductLinkError && err.reason === "invalid_url",
  );
  assert.equal(calls.length, 1);
});

test("正常跳转（相对路径、跨域到公网）照常跟随，最终解析出事实", async () => {
  const calls: string[] = [];
  const facts = await fetchProductFacts("https://short.example.test/x", {
    resolveHost: dnsTable({
      "short.example.test": ["93.184.216.34"],
      "shop.example.test": ["93.184.216.35"],
    }),
    fetchImpl: (async (input: string | URL) => {
      const url = input.toString();
      calls.push(url);
      if (url === "https://short.example.test/x") return redirect("https://shop.example.test/p");
      if (url === "https://shop.example.test/p") return redirect("/p/final", 308);
      return html();
    }) as typeof fetch,
  });
  assert.equal(facts.title, "公开商品");
  assert.deepEqual(calls, [
    "https://short.example.test/x",
    "https://shop.example.test/p",
    "https://shop.example.test/p/final",
  ]);
  assert.equal(facts.url, "https://short.example.test/x", "事实里记商家粘的原始链接");
});

test(`跳转超过 ${MAX_REDIRECTS} 跳就停，不无限跟`, async () => {
  let calls = 0;
  await assert.rejects(
    fetchProductFacts("https://loop.example.test/0", {
      resolveHost: dnsTable({ "loop.example.test": ["93.184.216.34"] }),
      fetchImpl: (async () => {
        calls += 1;
        return redirect(`https://loop.example.test/${calls}`);
      }) as typeof fetch,
    }),
    (err: unknown) => err instanceof ProductLinkError && err.reason === "unreachable",
  );
  assert.equal(calls, MAX_REDIRECTS + 1, "首跳 + 5 次跳转");
});

test("域名解析不到：给出可理解的 unreachable，而不是内部异常", async () => {
  await assert.rejects(
    fetchProductFacts("https://nxdomain.example.test/a", {
      resolveHost: dnsTable({}),
      fetchImpl: (async () => html()) as typeof fetch,
    }),
    (err: unknown) => err instanceof ProductLinkError && err.reason === "unreachable",
  );
});

test("Shopify .json 探测同样走逐跳复检（跳到内网的探测不发请求）", async () => {
  const calls: string[] = [];
  const facts = await fetchProductFacts("https://store.example.test/products/blinds", {
    resolveHost: dnsTable({
      "store.example.test": ["93.184.216.34"],
      "admin.example.test": ["192.168.0.10"],
    }),
    fetchImpl: (async (input: string | URL) => {
      const url = input.toString();
      calls.push(url);
      if (url.endsWith(".json")) return redirect("http://admin.example.test/products.json");
      return html();
    }) as typeof fetch,
  });
  assert.equal(facts.source, "open_graph", ".json 探测被拦后照常解析 HTML");
  assert.ok(!calls.some((url) => url.includes("admin.example.test")));
});
