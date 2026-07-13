# Product Image Studio

Product Image Studio is available under `/app/create/images` without adding a sixth primary navigation area. It provides two customer workflows:

- **Optimize:** uses the uploaded photograph as the sole visual source of truth and restricts changes to background, lighting, shadow, crop, framing, and minor cleanup.
- **Generate:** creates an unbranded product concept from a written description while blocking invented claims, logos, prices, watermarks, and common geometry failures.

Both workflows use the configured AI provider abstraction. The North American default is OpenAI `gpt-image-2`; automated tests set `IMAGE_ENGINE_MOCK=true` and make no paid request. Source uploads are authenticated, limited to 20 MB, checked by MIME and magic bytes, reviewed for content safety, and written to an unenumerable object key. Generated outputs are reviewed again before customer delivery.

Every request requires an idempotency key, is owner-scoped, records its model and timestamps in `ProductImageJob`, and records provider usage in `AIUsageLog`. Production applies a separate per-account hourly safety limit (`PRODUCT_IMAGE_RATE_LIMIT_PER_HOUR`, default `5`) to prevent accidental spend loops. This protection is not a commercial plan quota.

Successful outputs can be loaded directly into the single-video creator or the batch-video wizard. They remain visibly marked `AI Generated · Aivora`; customers must review product fidelity before publishing.
