import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { z } from "zod";
import {
  firecrawlScrapeHtml,
  isFirecrawlAvailable,
} from "@/lib/providers/firecrawl";

/**
 * O1 · 商品链接起片（PRD §3，P0）。
 *
 * 抓取顺序：Shopify 官方 `.json` → JSON-LD Product → OpenGraph → `<title>` 兜底。
 * 全部是**页面自己公开声明的结构化数据**，不做 DOM 猜测式抓取 ——
 * 猜出来的字段会被当成事实写进文案，错了是商家承担。
 */

export const productLinkFactsSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).nullable(),
  description: z.string().min(1).nullable(),
  /// 商品主图。链接起片时它就是产品锚点的首选（PRD 风险 #10）。
  imageUrl: z.string().url().nullable(),
  brand: z.string().min(1).nullable(),
  price: z.string().min(1).nullable(),
  /// 抓到的事实来源，便于排查「这句文案是哪来的」。
  source: z.enum(["shopify", "json_ld", "open_graph", "title", "none"]),
});

export type ProductLinkFacts = z.infer<typeof productLinkFactsSchema>;

const FETCH_TIMEOUT_MS = 8000;
/// 商品页不该有几 MB。超了多半抓到的不是商品页，早停比读完再判便宜。
const MAX_BYTES = 2_000_000;
/// 跳转最多跟 5 跳，每一跳都重新过 SSRF 检查（短链 → 商品页一般 1–2 跳）。
export const MAX_REDIRECTS = 5;

export class ProductLinkError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "invalid_url"
      | "unreachable"
      | "not_html"
      | "too_large"
      | "no_facts",
  ) {
    super(message);
    this.name = "ProductLinkError";
  }
}

/**
 * 只允许 http/https 的公网地址（字符串层，第一道）。
 *
 * 这是 SSRF 边界：商家粘进来的 URL 由我们的服务器去请求，
 * 不挡住内网地址等于把内网探测能力送出去。字符串层只能挡住明面上的内网写法，
 * 解析到内网的域名、跳转到内网的链接由 assertPublicDestination 逐跳再查一遍。
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ProductLinkError("链接格式不对", "invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProductLinkError("只支持 http/https 链接", "invalid_url");
  }
  if (url.username || url.password) {
    throw new ProductLinkError("链接里不能带账号密码", "invalid_url");
  }
  /// 结尾的点（"localhost."）同样指向本机，先去掉再比。
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const literal = host.replace(/^\[|\]$/g, "");
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    (isIP(literal) !== 0 && isBlockedIpAddress(literal));
  if (blocked) {
    throw new ProductLinkError("不支持内网地址", "invalid_url");
  }
  return url;
}

/**
 * 不可对外访问的地址段：回环、私网、链路本地（含云厂商元数据 169.254.169.254、
 * fd00:ec2::254）、运营商 NAT（含阿里云元数据 100.100.100.200）、保留 / 文档 / 组播段，
 * 以及会把 IPv4 藏进 IPv6 的过渡前缀（NAT64、6to4、Teredo）。
 * IPv4 映射地址（::ffff:a.b.c.d）由 BlockList 按 IPv4 规则判定。
 */
const BLOCKED_ADDRESSES = (() => {
  const list = new BlockList();
  const v4: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  for (const [network, prefix] of v4) list.addSubnet(network, prefix, "ipv4");
  const v6: Array<[string, number]> = [
    ["::", 128],
    ["::1", 128],
    ["::", 96], /// 已废弃的 IPv4 兼容地址
    ["64:ff9b::", 96], /// NAT64
    ["64:ff9b:1::", 48],
    ["100::", 64], /// 丢弃前缀
    ["2001::", 32], /// Teredo
    ["2001:db8::", 32], /// 文档
    ["2002::", 16], /// 6to4
    ["fc00::", 7], /// 唯一本地（含 fd00:ec2::254）
    ["fe80::", 10], /// 链路本地
    ["fec0::", 10], /// 已废弃的站点本地
    ["ff00::", 8], /// 组播
  ];
  for (const [network, prefix] of v6) list.addSubnet(network, prefix, "ipv6");
  return list;
})();

export function isBlockedIpAddress(address: string): boolean {
  const literal = address.trim().replace(/^\[|\]$/g, "").split("%")[0];
  const family = isIP(literal);
  /// 不是合法 IP 一律按不安全处理：宁可抓不到，也不放过解析器的边角写法。
  if (family === 0) return true;
  return BLOCKED_ADDRESSES.check(literal, family === 6 ? "ipv6" : "ipv4");
}

/** 域名 → 全部解析结果。可注入，测试不走真实 DNS。 */
export type HostResolver = (hostname: string) => Promise<string[]>;

const resolveHostWithDns: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/**
 * SSRF 第二道：解析 DNS，任何一个解析结果落在内网段就拒绝
 * （不挑「好的那个」去连：多记录轮询时我们控制不了实际连到哪一个）。
 *
 * 残余风险：检查与真正连接之间域名可以被重新解析（DNS rebinding）。彻底堵住要在
 * 连接层固定 IP（自定义 dispatcher 的 lookup），需要直接依赖 undici，本轮不做。
 */
export async function assertPublicDestination(
  url: URL,
  resolveHost: HostResolver = resolveHostWithDns,
): Promise<void> {
  assertPublicHttpUrl(url.toString());
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(host) !== 0) return; /// 字面量 IP 已在字符串层判过
  let addresses: string[];
  try {
    addresses = await resolveHost(host);
  } catch {
    throw new ProductLinkError("这个链接的域名解析不到，请检查链接", "unreachable");
  }
  if (addresses.length === 0) {
    throw new ProductLinkError("这个链接的域名解析不到，请检查链接", "unreachable");
  }
  if (addresses.some(isBlockedIpAddress)) {
    throw new ProductLinkError("不支持内网地址", "invalid_url");
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * 手动跟随跳转：每一跳先过 assertPublicDestination 再请求，最多 MAX_REDIRECTS 跳。
 * `redirect: "follow"` 会让 fetch 自己跳到内网地址，绕过我们所有检查。
 */
async function fetchPublic(
  url: URL,
  init: RequestInit,
  doFetch: typeof fetch,
  resolveHost?: HostResolver,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicDestination(current, resolveHost);
    const res = await doFetch(current.toString(), { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(res.status)) return res;
    const location = res.headers.get("location");
    /// 不读跳转页的正文，直接释放连接。
    await res.body?.cancel().catch(() => undefined);
    if (!location) {
      throw new ProductLinkError(`页面返回 ${res.status}`, "unreachable");
    }
    try {
      current = new URL(location, current);
    } catch {
      throw new ProductLinkError("页面跳转到了无效地址", "unreachable");
    }
  }
  throw new ProductLinkError("页面跳转次数过多", "unreachable");
}

export async function fetchProductFacts(
  rawUrl: string,
  deps: { fetchImpl?: typeof fetch; resolveHost?: HostResolver } = {},
): Promise<ProductLinkFacts> {
  const url = assertPublicHttpUrl(rawUrl);
  const doFetch = deps.fetchImpl ?? fetch;
  /// 解析到内网的域名在任何请求之前就拒绝，也不交给 Firecrawl 兜底。
  await assertPublicDestination(url, deps.resolveHost);

  /// Shopify 商品页加 `.json` 就是官方结构化接口，比解析 HTML 稳得多。
  const shopify = await tryShopifyJson(url, doFetch, deps.resolveHost);
  if (shopify) return shopify;

  /// 直抓优先（免费、快）；抓不到或页面是 JS 渲染壳（抽不出任何事实）时，
  /// 走 Firecrawl 托管渲染兜底（0802 接入），两条路径共用同一套抽取。
  try {
    const html = await fetchText(url, doFetch, deps.resolveHost);
    const facts = extractFactsFromHtml(html, url.toString());
    if (facts.source !== "none" || !isFirecrawlAvailable()) return facts;
    return await fetchFactsViaFirecrawl(url, deps.fetchImpl);
  } catch (err) {
    const recoverable =
      err instanceof ProductLinkError &&
      (err.reason === "unreachable" || err.reason === "not_html");
    if (!recoverable || !isFirecrawlAvailable()) throw err;
    try {
      return await fetchFactsViaFirecrawl(url, deps.fetchImpl);
    } catch {
      /// 兜底也失败时抛直抓的原始错误：对用户更可解释（页面 404 vs 渲染失败）
      throw err;
    }
  }
}

async function fetchFactsViaFirecrawl(
  url: URL,
  fetchImpl?: typeof fetch,
): Promise<ProductLinkFacts> {
  const rendered = await firecrawlScrapeHtml(url.toString(), { fetchImpl });
  return extractFactsFromHtml(rendered, url.toString());
}

async function fetchText(
  url: URL,
  doFetch: typeof fetch,
  resolveHost?: HostResolver,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchPublic(
      url,
      {
        signal: controller.signal,
        headers: {
          /// 不伪装成浏览器：商品页的公开结构化数据不需要绕过任何东西。
          "User-Agent": "AivoraBot/1.0 (+https://aivora.app)",
          Accept: "text/html,application/xhtml+xml",
        },
      },
      doFetch,
      resolveHost,
    );
    if (!res.ok) {
      throw new ProductLinkError(`页面返回 ${res.status}`, "unreachable");
    }
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.includes("html")) {
      throw new ProductLinkError("链接不是网页", "not_html");
    }
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) {
      throw new ProductLinkError("页面过大", "too_large");
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) {
      throw new ProductLinkError("页面过大", "too_large");
    }
    return text;
  } catch (err) {
    if (err instanceof ProductLinkError) throw err;
    throw new ProductLinkError(
      `抓不到这个链接：${(err as Error).message}`,
      "unreachable",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function tryShopifyJson(
  url: URL,
  doFetch: typeof fetch,
  resolveHost?: HostResolver,
): Promise<ProductLinkFacts | null> {
  if (!/\/products\/[^/]+$/.test(url.pathname)) return null;
  const jsonUrl = new URL(url.toString());
  jsonUrl.pathname = `${jsonUrl.pathname}.json`;
  try {
    const res = await fetchPublic(
      jsonUrl,
      { headers: { Accept: "application/json" } },
      doFetch,
      resolveHost,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      product?: {
        title?: unknown;
        body_html?: unknown;
        vendor?: unknown;
        images?: Array<{ src?: unknown }>;
        variants?: Array<{ price?: unknown }>;
      };
    };
    const product = body.product;
    if (!product?.title) return null;
    return productLinkFactsSchema.parse({
      url: url.toString(),
      title: text(product.title),
      description: stripHtml(text(product.body_html)),
      imageUrl: httpUrl(product.images?.[0]?.src),
      brand: text(product.vendor),
      price: text(product.variants?.[0]?.price),
      source: "shopify",
    });
  } catch {
    /// Shopify 探测失败不是错误：多数站点本来就不是 Shopify。
    return null;
  }
}

export function extractFactsFromHtml(
  html: string,
  url: string,
): ProductLinkFacts {
  const jsonLd = extractJsonLdProduct(html);
  if (jsonLd) {
    return productLinkFactsSchema.parse({
      url,
      title: text(jsonLd.name),
      description: stripHtml(text(jsonLd.description)),
      imageUrl: httpUrl(
        Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image,
      ),
      brand: text(
        typeof jsonLd.brand === "object" && jsonLd.brand
          ? (jsonLd.brand as { name?: unknown }).name
          : jsonLd.brand,
      ),
      price: text(
        typeof jsonLd.offers === "object" && jsonLd.offers
          ? (jsonLd.offers as { price?: unknown }).price
          : null,
      ),
      source: "json_ld",
    });
  }

  const ogTitle = metaContent(html, "og:title");
  const ogDescription = metaContent(html, "og:description");
  const ogImage = metaContent(html, "og:image");
  if (ogTitle || ogDescription || ogImage) {
    return productLinkFactsSchema.parse({
      url,
      title: ogTitle,
      description: ogDescription,
      imageUrl: httpUrl(ogImage),
      brand: metaContent(html, "og:site_name"),
      price: metaContent(html, "product:price:amount"),
      source: "open_graph",
    });
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const cleaned = text(title ? decodeEntities(title) : null);
  if (!cleaned) {
    throw new ProductLinkError(
      "这个页面没有可用的商品信息，换一个链接或直接用一句话描述",
      "no_facts",
    );
  }
  return productLinkFactsSchema.parse({
    url,
    title: cleaned,
    description: null,
    imageUrl: null,
    brand: null,
    price: null,
    source: "title",
  });
}

function extractJsonLdProduct(html: string): Record<string, unknown> | null {
  const blocks = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const found = findProductNode(parsed);
      if (found) return found;
    } catch {
      /// 站点的 JSON-LD 经常是坏的，坏一块不影响看下一块。
      continue;
    }
  }
  return null;
}

function findProductNode(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5 || !node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const isProduct = Array.isArray(type)
    ? type.includes("Product")
    : type === "Product";
  if (isProduct && obj.name) return obj;
  if (Array.isArray(obj["@graph"])) {
    return findProductNode(obj["@graph"], depth + 1);
  }
  return null;
}

function metaContent(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]?.trim()) return decodeEntities(match[1].trim());
  }
  return null;
}

function stripHtml(value: string | null): string | null {
  if (!value) return null;
  const cleaned = decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function text(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function httpUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const normalized = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * 抓到的事实 → 喂给内容计划的 productFacts。
 * 只放确定的事实，不放推断 —— 这些句子会被直接写进文案。
 */
export function factsToPromptLines(facts: ProductLinkFacts): string[] {
  const lines: string[] = [];
  if (facts.title) lines.push(`商品名：${facts.title}`);
  if (facts.brand) lines.push(`品牌：${facts.brand}`);
  if (facts.price) lines.push(`价格：${facts.price}`);
  if (facts.description) lines.push(`商品描述：${facts.description.slice(0, 500)}`);
  return lines;
}
