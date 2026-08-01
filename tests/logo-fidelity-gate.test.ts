import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  DEFAULT_GATE_THRESHOLDS,
  deltaE,
  extractLogoRegion,
  runLogoFidelityGate,
  structuralSimilarity,
  textSimilarity,
  type LogoBox,
} from "../src/lib/services/logo-fidelity-gate";

/**
 * B5 · logo 保真校验 Gate（PRD §5 第 2 层）。
 *
 * 测试用 sharp 现场合成真实像素 —— 判据是像素数学，
 * mock 掉像素就等于没测。
 */

const BOX: LogoBox = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

/** 造一张带「logo」的产品图：底色 + 中央一个色块图形。 */
async function makeImage(args: {
  background: { r: number; g: number; b: number };
  logo: { r: number; g: number; b: number };
  /// 让「logo」有结构：画成两条横杠而不是实心块
  variant?: "bars" | "solid" | "shifted";
}): Promise<Buffer> {
  const { background, logo } = args;
  const variant = args.variant ?? "bars";
  const bar = (top: number) =>
    `<rect x="160" y="${top}" width="192" height="40" fill="rgb(${logo.r},${logo.g},${logo.b})"/>`;
  const shapes =
    variant === "solid"
      ? `<rect x="160" y="160" width="192" height="192" fill="rgb(${logo.r},${logo.g},${logo.b})"/>`
      : variant === "shifted"
        ? bar(200) + bar(300)
        : bar(180) + bar(280);
  const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" fill="rgb(${background.r},${background.g},${background.b})"/>
    ${shapes}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const BRAND_ORANGE = { r: 255, g: 77, b: 0 };
const WHITE = { r: 245, g: 240, b: 235 };

test("同一张图自比：SSIM 满分、ΔE 为零、Gate 通过", async () => {
  const image = await makeImage({ background: WHITE, logo: BRAND_ORANGE });
  const result = await runLogoFidelityGate({
    referenceImage: image,
    generatedImage: image,
    logoBox: BOX,
    brandName: "SunnyShutter",
    readText: "SunnyShutter",
  });
  assert.equal(result.passed, true, JSON.stringify(result.checks));
  assert.equal(result.retakeAdvice, null);
  const ssim = result.checks.find((c) => c.rule === "ssim")!;
  assert.ok(ssim.value > 0.99);
});

test("🔴 结构被重画（横杠变实心块）→ SSIM 拦下并建议走锚定路径", async () => {
  const reference = await makeImage({ background: WHITE, logo: BRAND_ORANGE });
  const redrawn = await makeImage({
    background: WHITE,
    logo: BRAND_ORANGE,
    variant: "solid",
  });
  const result = await runLogoFidelityGate({
    referenceImage: reference,
    generatedImage: redrawn,
    logoBox: BOX,
    brandName: null,
    readText: null,
  });
  assert.equal(result.passed, false);
  const ssim = result.checks.find((c) => c.rule === "ssim")!;
  assert.equal(ssim.passed, false, `SSIM=${ssim.value} 应低于阈值`);
  /// 结构坏了的正解是锁像素，不是换种子重试（PRD §7 点名的洞）。
  assert.match(result.retakeAdvice!, /mask|锚定/);
});

test("品牌色漂移（橙变红）→ ΔE 拦下并建议锁色", async () => {
  const reference = await makeImage({ background: WHITE, logo: BRAND_ORANGE });
  const drifted = await makeImage({
    background: WHITE,
    logo: { r: 220, g: 30, b: 90 },
  });
  const result = await runLogoFidelityGate({
    referenceImage: reference,
    generatedImage: drifted,
    logoBox: BOX,
    brandName: null,
    readText: null,
  });
  const color = result.checks.find((c) => c.rule === "color")!;
  assert.equal(color.passed, false, `ΔE=${color.value} 应超过阈值`);
  assert.equal(result.passed, false);
});

test("轻微位移（同结构上下挪 20px）不该误杀", async () => {
  /// 归一到 256×256 后小位移仍会带来像素差，但结构与色彩都没坏 ——
  /// 阈值就是为了容住这类无害扰动。
  const reference = await makeImage({ background: WHITE, logo: BRAND_ORANGE });
  const shifted = await makeImage({
    background: WHITE,
    logo: BRAND_ORANGE,
    variant: "shifted",
  });
  const ssim = await structuralSimilarity(
    await extractLogoRegion(reference, BOX),
    await extractLogoRegion(shifted, BOX),
  );
  /// 位移属于「结构还在」的扰动，分数会降但不该降到重画的量级。
  assert.ok(ssim > 0.5, `位移后的 SSIM=${ssim}，不该像重画一样趋近 0`);
});

test("品牌名判据：少一个字母与整段乱码是不同严重度", () => {
  assert.ok(textSimilarity("SunnyShutter", "SunnyShutter") === 1);
  const oneOff = textSimilarity("SunnyShutter", "SunnyShuter");
  const garbage = textSimilarity("SunnyShutter", "Snuy5h#tr");
  assert.ok(oneOff > 0.9, "少一个字母仍高相似");
  assert.ok(garbage < 0.6, "乱码必须低相似");
  assert.ok(oneOff > garbage);
  /// 少一字母在默认阈值下放行，乱码拦下 —— 这就是不用二值判断的原因。
  assert.ok(oneOff >= DEFAULT_GATE_THRESHOLDS.minTextSimilarity);
  assert.ok(garbage < DEFAULT_GATE_THRESHOLDS.minTextSimilarity);
});

test("品牌名写错时 Gate 拦下，并说清读到了什么", async () => {
  const image = await makeImage({ background: WHITE, logo: BRAND_ORANGE });
  const result = await runLogoFidelityGate({
    referenceImage: image,
    generatedImage: image,
    logoBox: BOX,
    brandName: "SunnyShutter",
    readText: "Snuy5h#tr",
  });
  assert.equal(result.passed, false);
  const text = result.checks.find((c) => c.rule === "text")!;
  assert.match(text.message, /Snuy5h#tr/);
  assert.match(text.message, /SunnyShutter/);
});

test("没给品牌名或没读到文字时跳过 text 判据，且结果里看得出没查", async () => {
  const image = await makeImage({ background: WHITE, logo: BRAND_ORANGE });
  const result = await runLogoFidelityGate({
    referenceImage: image,
    generatedImage: image,
    logoBox: BOX,
    brandName: "SunnyShutter",
    readText: null,
  });
  /// 跳过 ≠ 通过：checks 里根本没有 text 这条，调用方能分辨。
  assert.ok(!result.checks.some((c) => c.rule === "text"));
  assert.equal(result.checks.length, 2);
});

test("Brand Kit 主色优先于参考图主色", async () => {
  const reference = await makeImage({ background: WHITE, logo: BRAND_ORANGE });
  /// 生成图 logo 色与 Brand Kit 一致、但与参考图不同 —— 应以 Brand Kit 为准放行色彩判据。
  const brandBlue = { r: 20, g: 60, b: 200 };
  const generated = await makeImage({ background: WHITE, logo: brandBlue });
  const result = await runLogoFidelityGate({
    referenceImage: reference,
    generatedImage: generated,
    logoBox: BOX,
    brandName: null,
    readText: null,
    brandColor: brandBlue,
    /// 这条测试只看色彩判据，把结构阈值放到 0 避免干扰。
    thresholds: { minSsim: 0 },
  });
  const color = result.checks.find((c) => c.rule === "color")!;
  assert.equal(color.passed, true, `ΔE=${color.value} 应按 Brand Kit 主色比对`);
});

test("ΔE 标尺符合直觉：同色为 0，黑白最大", () => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  assert.equal(deltaE(black, black), 0);
  assert.ok(deltaE(black, white) > 90);
  /// 品牌橙的轻微深浅变化应落在默认阈值内。
  assert.ok(
    deltaE(BRAND_ORANGE, { r: 250, g: 80, b: 5 }) <
      DEFAULT_GATE_THRESHOLDS.maxDeltaE,
  );
});

test("logo 框越界时夹回图内而不是抛错", async () => {
  const image = await makeImage({ background: WHITE, logo: BRAND_ORANGE });
  const region = await extractLogoRegion(image, {
    x: 0.9,
    y: 0.9,
    width: 0.5,
    height: 0.5,
  });
  const meta = await sharp(region).metadata();
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
});
