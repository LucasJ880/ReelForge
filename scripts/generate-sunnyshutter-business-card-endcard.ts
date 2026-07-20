/**
 * Generate SunnyShutter locked business-card end still via Shuyu GPT Image 2.
 *
 * Output:
 *   assets/sunnyshutter/end-card-9x16.png
 *   public/brand/sunnyshutter-end-card-9x16.png (copy)
 *
 * Exact phone/address are still burned by brand-end-card-renderer at package time;
 * this still provides the premium product+logo background (Chinese card layout energy).
 *
 *   npx tsx --env-file=.env.local scripts/generate-sunnyshutter-business-card-endcard.ts
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { put } from "@vercel/blob";
import {
  createShuyuImageTask,
  SHUYU_IMAGE_PLAN_ID,
} from "@/lib/providers/shuyu";
import { pollShuyuTaskUntilDone } from "@/lib/video-generation/sunnyshutter-shade-pipeline";
import {
  SUNNYSHUTTER_ADDRESS,
  SUNNYSHUTTER_END_CARD_STILL_9X16_RELATIVE,
  SUNNYSHUTTER_LOGO_RELATIVE,
  SUNNYSHUTTER_PHONE,
} from "@/lib/video-generation/sunnyshutter-brand-pack";

loadEnvConfig(process.cwd(), true);

const OUT = resolve(process.cwd(), SUNNYSHUTTER_END_CARD_STILL_9X16_RELATIVE);
const PUBLIC_OUT = resolve(
  process.cwd(),
  "public/brand/sunnyshutter-end-card-9x16.png",
);
const LOGO = resolve(process.cwd(), SUNNYSHUTTER_LOGO_RELATIVE);
const SHADE_REF = resolve(
  process.cwd(),
  "assets/sunnyshutter/shade-refs/shade-ref-02.png",
);

async function uploadLocal(path: string, name: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN required");
  }
  const { readFileSync } = await import("node:fs");
  const blob = await put(
    `brand/sunnyshutter-endcard-refs/${name}`,
    readFileSync(path),
    {
      access: "public",
      contentType: "image/png",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: true,
    },
  );
  return blob.url;
}

async function main(): Promise<void> {
  if (!existsSync(LOGO)) throw new Error(`missing logo ${LOGO}`);
  if (!existsSync(SHADE_REF)) throw new Error(`missing shade ref ${SHADE_REF}`);

  const logoUrl = await uploadLocal(LOGO, "sunny-logo.png");
  const productUrl = await uploadLocal(SHADE_REF, "shade-hero.png");

  const prompt = [
    "Design a premium vertical 9:16 TikTok ecommerce END-CARD / business-card BACKGROUND for SUNNY Shutters (Canadian custom shutters, shades, curtains).",
    "Layout inspired by a real-ad contact card:",
    "- TOP HALF: photoreal warm lifestyle photo of elegant window treatments (use product reference) with soft golden daylight through fabric/shades.",
    "- Soft centered treatment of the SUNNY yellow-circle logo from reference image 1 in the upper third (recognizable, not distorted).",
    "- LOWER HALF: elegant dark navy/charcoal panel with EMPTY clean space for later typography overlay (do NOT invent readable phone/address/button text).",
    "High-end home renovation ecommerce look. No purple neon. No cartoon. No QR codes. No fake prices.",
    `Brand context only (do not letter these as readable text): phone ${SUNNYSHUTTER_PHONE}, address ${SUNNYSHUTTER_ADDRESS}.`,
    "Leave lower panel mostly solid dark so phone/CTA can be burned cleanly later.",
  ].join("\n");

  console.log("generating Image2 business-card end still…");
  // Prefer GPT Image 2 recommended; failover if plan rotated offline.
  let taskId: string | null = null;
  let lastError: unknown;
  for (const planId of [SHUYU_IMAGE_PLAN_ID, "image-plan-07", "image-plan-03", "image-plan-10"]) {
    try {
      const created = await createShuyuImageTask({
        providerRequestKey: `ss-endcard-${planId}-${Date.now()}`.slice(0, 120),
        planId,
        prompt,
        resolution: planId.includes("03") || planId.includes("06") ? "4K" : "1K",
        aspectRatio: "9:16",
        inputImages: [logoUrl, productUrl],
      });
      taskId = created.taskId;
      console.log(`accepted plan=${planId} task=${taskId}`);
      break;
    } catch (error) {
      lastError = error;
      console.warn(`plan ${planId} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (!taskId) throw lastError instanceof Error ? lastError : new Error("endcard submit failed");
  const done = await pollShuyuTaskUntilDone(taskId, {
    label: "endcard",
    pollMs: 4_000,
    maxWaitMs: 12 * 60_000,
  });

  const res = await fetch(done.url);
  if (!res.ok) throw new Error(`download endcard failed ${res.status}`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(await res.arrayBuffer()));
  mkdirSync(dirname(PUBLIC_OUT), { recursive: true });
  copyFileSync(OUT, PUBLIC_OUT);
  console.log(`saved ${OUT}`);
  console.log(`copied ${PUBLIC_OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
