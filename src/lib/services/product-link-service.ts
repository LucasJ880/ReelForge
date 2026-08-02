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
 * 只允许 http/https 的公网地址。
 *
 * 这是 SSRF 边界：商家粘进来的 URL 由我们的服务器去请求，
 * 不挡住内网地址等于把内网探测能力送出去。
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
  const host = url.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith("[") /// IPv6 字面量，含 ::1 与 fc00::/7
  ;
  if (blocked) {
    throw new ProductLinkError("不支持内网地址", "invalid_url");
  }
  return url;
}

export async function fetchProductFacts(
  rawUrl: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<ProductLinkFacts> {
  const url = assertPublicHttpUrl(rawUrl);
  const doFetch = deps.fetchImpl ?? fetch;

  /// Shopify 商品页加 `.json` 就是官方结构化接口，比解析 HTML 稳得多。
  const shopify = await tryShopifyJson(url, doFetch);
  if (shopify) return shopify;

  /// 直抓优先（免费、快）；抓不到或页面是 JS 渲染壳（抽不出任何事实）时，
  /// 走 Firecrawl 托管渲染兜底（0802 接入），两条路径共用同一套抽取。
  try {
    const html = await fetchText(url, doFetch);
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

async function fetchText(url: URL, doFetch: typeof fetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await doFetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        /// 不伪装成浏览器：商品页的公开结构化数据不需要绕过任何东西。
        "User-Agent": "AivoraBot/1.0 (+https://aivora.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
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
): Promise<ProductLinkFacts | null> {
  if (!/\/products\/[^/]+$/.test(url.pathname)) return null;
  const jsonUrl = new URL(url.toString());
  jsonUrl.pathname = `${jsonUrl.pathname}.json`;
  try {
    const res = await doFetch(jsonUrl.toString(), {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
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
