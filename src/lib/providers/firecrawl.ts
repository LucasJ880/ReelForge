/**
 * Firecrawl 抓取适配器 —— 商品链接抓取的**兜底层**。
 *
 * 定位（0802 与青砚对齐）：`product-link-service` 的直抓（AivoraBot UA，
 * 不伪装浏览器）覆盖常规商品页；JS 渲染页与反爬站点（Amazon 等）直抓
 * 拿不到内容时，才走 Firecrawl 的托管渲染。青砚侧已有同款 key，可共享。
 *
 * 无 key 时诚实不可用（与 stock-footage / remove-bg / openai-tts 同一模式）。
 */

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v1/scrape";
const SCRAPE_TIMEOUT_MS = 20_000;

export function isFirecrawlAvailable(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

export class FirecrawlError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "FirecrawlError";
  }
}

/**
 * 渲染并返回页面 HTML。
 * 返回 HTML 而不是 markdown：让 product-link-service 继续用同一套
 * 结构化抽取（JSON-LD / Open Graph），两条抓取路径共享一份解析逻辑。
 */
export async function firecrawlScrapeHtml(
  url: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) {
    throw new FirecrawlError("FIRECRAWL_API_KEY 未配置", null);
  }
  const doFetch = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await doFetch(FIRECRAWL_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["html"] }),
    });
    if (!res.ok) {
      /// 日志脱敏：状态码 + 截断响应体，不落 key
      const body = (await res.text().catch(() => "")).slice(0, 200);
      throw new FirecrawlError(
        `Firecrawl 抓取失败：HTTP ${res.status} ${body}`,
        res.status,
      );
    }
    const payload = (await res.json()) as {
      success?: boolean;
      data?: { html?: unknown };
    };
    const html =
      payload.success && typeof payload.data?.html === "string"
        ? payload.data.html
        : null;
    if (!html) {
      throw new FirecrawlError("Firecrawl 返回里没有 html", null);
    }
    return html;
  } catch (err) {
    if (err instanceof FirecrawlError) throw err;
    throw new FirecrawlError(
      `Firecrawl 请求异常：${(err as Error).message}`,
      null,
    );
  } finally {
    clearTimeout(timer);
  }
}
