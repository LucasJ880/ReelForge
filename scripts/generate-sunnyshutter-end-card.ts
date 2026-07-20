/**
 * Generate SunnyShutter locked end-card stills via Image 2 (gpt-image-2).
 *
 * Output (committed under assets/sunnyshutter/):
 *   - end-card-9x16.png
 *   - end-card-16x9.png
 *
 * Design brief: premium real-ad outro background. Exact phone/address text is
 * burned later by brand-end-card-renderer (never trust model lettering alone).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/generate-sunnyshutter-end-card.ts
 *
 * Note: requires an OpenAI project with image-model access (gpt-image-* or
 * dall-e-3). If the project is locked, keep the committed stills under
 * assets/sunnyshutter/ and regenerate later when access is restored.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  composeReferenceImage,
  generateImages,
} from "@/lib/providers/openai-image";
import {
  SUNNYSHUTTER_END_CARD_STILL_16X9_RELATIVE,
  SUNNYSHUTTER_END_CARD_STILL_9X16_RELATIVE,
  SUNNYSHUTTER_LOGO_RELATIVE,
  SUNNYSHUTTER_PHONE,
  SUNNYSHUTTER_ADDRESS,
} from "@/lib/video-generation/sunnyshutter-brand-pack";

loadEnvConfig(process.cwd(), true);

const LOGO_PATH = resolve(process.cwd(), SUNNYSHUTTER_LOGO_RELATIVE);
const OUT_9X16 = resolve(process.cwd(), SUNNYSHUTTER_END_CARD_STILL_9X16_RELATIVE);
const OUT_16X9 = resolve(process.cwd(), SUNNYSHUTTER_END_CARD_STILL_16X9_RELATIVE);

const PROMPT_9X16 = `Design a premium vertical 9:16 TikTok ecommerce end-card BACKGROUND for a Canadian custom plantation shutter company called SUNNY Shutters.
Use image 1 as the only logo reference — keep the logo mark recognizable if you include a soft logo watermark in the upper third, but leave the lower half mostly clear for later typography.
Visual direction: photorealistic warm interior with soft-focus white plantation shutters and golden window light; elegant dark charcoal-to-navy gradient panel rising from the bottom half; subtle wood and linen textures; high-end home renovations feel — NOT purple neon, NOT cartoon, NOT stocky corporate blue blob.
Do NOT invent phone numbers, addresses, QR codes, prices, or readable CTA button text. Leave a clean dark lower panel empty for text overlay.
No watermarks other than the brand logo treatment. No people faces.`;

const PROMPT_16X9 = `Design a premium horizontal 16:9 ecommerce end-card BACKGROUND for SUNNY Shutters (Canadian custom plantation shutters).
Use image 1 as the logo reference. Soft-focus white plantation shutters + warm daylight on the left/right edges; elegant dark charcoal panel in the center-bottom for later typography.
Do NOT invent phone numbers, addresses, QR codes, or button text. Leave a clean dark band for overlay. High-end real-estate ad look.`;

async function downloadToFile(url: string, dest: string): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true });
  if (url.startsWith("data:")) {
    const b64 = url.split(",")[1] ?? "";
    writeFileSync(dest, Buffer.from(b64, "base64"));
    return;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function generateOne(
  prompt: string,
  size: string,
  dest: string,
  dalleSize?: "1024x1792" | "1792x1024" | "1024x1024",
): Promise<void> {
  if (!existsSync(LOGO_PATH)) throw new Error(`logo missing: ${LOGO_PATH}`);
  const logo = readFileSync(LOGO_PATH);
  console.log(`generating ${dest} (${size})…`);

  const editModels = [
    process.env.OPENAI_IMAGE_MODEL?.trim(),
    "gpt-image-2",
    "gpt-image-1",
    "gpt-image-1-mini",
  ].filter((value): value is string => Boolean(value));

  let lastError: unknown;
  for (const model of [...new Set(editModels)]) {
    try {
      const result = await composeReferenceImage({
        prompt,
        referenceImages: [
          { data: logo, mimeType: "image/png", fileName: "sunny-logo.png" },
        ],
        size,
        quality: "high",
        model,
        blobPrefix: "brand/sunnyshutter-end-card/",
      });
      if (result.fromMock) {
        throw new Error("mock image engine");
      }
      await downloadToFile(result.url, dest);
      console.log(`  saved ${dest} (model=${result.modelUsed})`);
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `  edit model ${model} failed: ${String((err as Error).message).slice(0, 160)}`,
      );
    }
  }

  /// Fallback: dall-e-3 text-to-image (no logo edit) when Image2 edit is locked.
  const fallbackSize = dalleSize ?? "1024x1792";
  console.log(`  falling back to dall-e-3 @ ${fallbackSize}`);
  try {
    const generated = await generateImages({
      prompt: `${prompt}\nKeep the SUNNY Shutters logo area empty in the upper third — we will composite the real logo later.`,
      n: 1,
      size: fallbackSize,
      model: "dall-e-3",
      blobPrefix: "brand/sunnyshutter-end-card/",
    });
    if (generated.fromMock || !generated.urls[0]) {
      throw lastError ?? new Error("dall-e-3 mock/empty");
    }
    await downloadToFile(generated.urls[0], dest);
    console.log(`  saved ${dest} (model=${generated.modelUsed})`);
  } catch (err) {
    throw err ?? lastError;
  }
}

async function main(): Promise<void> {
  console.log(
    `SunnyShutter end-card Image2 · locked contacts ${SUNNYSHUTTER_PHONE} / ${SUNNYSHUTTER_ADDRESS}`,
  );
  /// gpt-image-*: both dims must be divisible by 16 (1080 is not).
  await generateOne(PROMPT_9X16, "1024x1536", OUT_9X16, "1024x1792");
  await generateOne(PROMPT_16X9, "1536x1024", OUT_16X9, "1792x1024");
  console.log("done. Renderer will burn exact phone/address on these stills.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
