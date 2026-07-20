import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import {
  applyBrandOverlayIfConfigured,
  UnsafeOverlayPathError,
  __test__,
} from "../src/lib/video-generation/brand-overlay-renderer";
import { containsBannedCustomerTerm } from "../src/lib/video-generation/business-status";

const {
  resolveOverlayParams,
  buildOverlayFilterGraph,
  computePlacementExpr,
  computeEnableExpr,
  assertSafeOverlayPath,
  isInsideRoot,
  pickExt,
  toCustomerSafeWarning,
  extractBrandOverlayConfig,
  isOverlayPlacement,
  isOverlayDurationMode,
  DEFAULT_OPACITY,
  DEFAULT_LOGO_WIDTH_RATIO,
  DEFAULT_MARGIN_PX,
  DEFAULT_PLACEMENT,
} = __test__;

// ---------- Defaults ----------

test("brand-overlay: default placement is top-right", () => {
  assert.equal(DEFAULT_PLACEMENT, "top-right");
});

test("brand-overlay: default opacity is 0.88", () => {
  assert.equal(DEFAULT_OPACITY, 0.88);
});

test("brand-overlay: default logo width ratio is in 0.16-0.20 band", () => {
  assert.ok(DEFAULT_LOGO_WIDTH_RATIO >= 0.16);
  assert.ok(DEFAULT_LOGO_WIDTH_RATIO <= 0.2);
});

test("brand-overlay: default margin is 32px (tuned for 720p vertical)", () => {
  assert.equal(DEFAULT_MARGIN_PX, 32);
});

// ---------- resolveOverlayParams ----------

test("brand-overlay: resolveOverlayParams uses defaults when nothing provided", () => {
  const r = resolveOverlayParams(undefined);
  assert.equal(r.placement, "top-right");
  assert.equal(r.opacity, 0.88);
  assert.equal(r.logoWidthRatio, 0.18);
  assert.equal(r.marginPx, 32);
  assert.equal(r.durationMode, "full_video");
});

test("brand-overlay: resolveOverlayParams clamps opacity into [0,1]", () => {
  assert.equal(resolveOverlayParams({ opacity: -0.5 }).opacity, 0);
  assert.equal(resolveOverlayParams({ opacity: 5 }).opacity, 1);
  assert.equal(resolveOverlayParams({ opacity: NaN }).opacity, 0);
});

test("brand-overlay: resolveOverlayParams clamps logo width ratio into [0.05,0.40]", () => {
  assert.equal(resolveOverlayParams({ logoWidthRatio: 0.001 }).logoWidthRatio, 0.05);
  assert.equal(resolveOverlayParams({ logoWidthRatio: 0.95 }).logoWidthRatio, 0.4);
});

test("brand-overlay: resolveOverlayParams floors negative margin to 0", () => {
  assert.equal(resolveOverlayParams({ marginPx: -10 }).marginPx, 0);
});

// ---------- computePlacementExpr ----------

test("brand-overlay: top-right uses main_w-overlay_w-margin / margin", () => {
  const xy = computePlacementExpr("top-right", 32);
  assert.equal(xy.x, "main_w-overlay_w-32");
  assert.equal(xy.y, "32");
});

test("brand-overlay: top-left uses margin / margin", () => {
  const xy = computePlacementExpr("top-left", 24);
  assert.equal(xy.x, "24");
  assert.equal(xy.y, "24");
});

test("brand-overlay: bottom-left uses margin / main_h-overlay_h-margin", () => {
  const xy = computePlacementExpr("bottom-left", 16);
  assert.equal(xy.x, "16");
  assert.equal(xy.y, "main_h-overlay_h-16");
});

test("brand-overlay: bottom-right uses both main_w/main_h subtraction", () => {
  const xy = computePlacementExpr("bottom-right", 8);
  assert.equal(xy.x, "main_w-overlay_w-8");
  assert.equal(xy.y, "main_h-overlay_h-8");
});

// ---------- computeEnableExpr ----------

test("brand-overlay: enable expr — full_video returns null (no enable filter)", () => {
  assert.equal(computeEnableExpr("full_video", 12), null);
});

test("brand-overlay: enable expr — first_3s gates [0..3]", () => {
  assert.equal(computeEnableExpr("first_3s", 12), "between(t,0,3)");
});

test("brand-overlay: enable expr — last_5s anchors to absolute end (12s → [7..12])", () => {
  assert.equal(computeEnableExpr("last_5s", 12), "between(t,7.000,12.000)");
});

test("brand-overlay: enable expr — last_5s on short 2s clip clamps start to 0", () => {
  assert.equal(computeEnableExpr("last_5s", 2), "between(t,0.000,2.000)");
});

// ---------- buildOverlayFilterGraph ----------

test("brand-overlay: filter graph contains scale + overlay + opacity", () => {
  const g = buildOverlayFilterGraph({
    videoWidth: 720,
    videoDurationSec: 12,
    params: resolveOverlayParams(undefined),
  });
  assert.match(g, /\[1:v\]format=rgba/);
  assert.match(g, /colorchannelmixer=aa=0\.880/);
  /// 720 * 0.18 = 129.6 → round to 130
  assert.match(g, /scale=130:-1\[logo\]/);
  assert.match(g, /\[0:v\]\[logo\]overlay=main_w-overlay_w-32:32\[v\]/);
  assert.equal(g.includes("enable="), false, "full_video must NOT add enable filter");
});

test("brand-overlay: filter graph height=-1 PRESERVES aspect ratio (never stretches logo)", () => {
  const g = buildOverlayFilterGraph({
    videoWidth: 1080,
    videoDurationSec: 30,
    params: resolveOverlayParams({ logoWidthRatio: 0.2 }),
  });
  /// scale=W:-1 means "compute height to keep original aspect ratio"
  assert.match(g, /scale=216:-1\[logo\]/);
  assert.equal(g.includes("scale=216:216"), false, "must not force a square scale");
  assert.equal(g.includes("force_original_aspect_ratio"), false, "no need on a single-axis scale");
});

test("brand-overlay: filter graph honors first_3s with enable= clause", () => {
  const g = buildOverlayFilterGraph({
    videoWidth: 720,
    videoDurationSec: 12,
    params: resolveOverlayParams({ durationMode: "first_3s" }),
  });
  assert.match(g, /enable='between\(t,0,3\)'/);
});

test("brand-overlay: filter graph honors last_5s with absolute timestamps", () => {
  const g = buildOverlayFilterGraph({
    videoWidth: 720,
    videoDurationSec: 15,
    params: resolveOverlayParams({ durationMode: "last_5s" }),
  });
  assert.match(g, /enable='between\(t,10\.000,15\.000\)'/);
});

test("brand-overlay: filter graph respects placement choice in overlay= expression", () => {
  for (const placement of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
    const g = buildOverlayFilterGraph({
      videoWidth: 720,
      videoDurationSec: 12,
      params: resolveOverlayParams({ placement }),
    });
    const expectedXy = computePlacementExpr(placement, 32);
    assert.ok(
      g.includes(`overlay=${expectedXy.x}:${expectedXy.y}`),
      `placement ${placement} should produce overlay=${expectedXy.x}:${expectedXy.y}, got: ${g}`,
    );
  }
});

// ---------- Path safety ----------

test("brand-overlay: assertSafeOverlayPath accepts http(s) URLs", () => {
  assert.doesNotThrow(() => assertSafeOverlayPath("https://example.com/logo.png"));
  assert.doesNotThrow(() => assertSafeOverlayPath("http://example.com/v.mp4"));
});

test("brand-overlay: assertSafeOverlayPath accepts files inside cwd", () => {
  const safe = path.join(process.cwd(), "public/mock-clips/9x16.mp4");
  assert.doesNotThrow(() => assertSafeOverlayPath(safe));
});

test("brand-overlay: assertSafeOverlayPath accepts files inside os.tmpdir()", () => {
  const safe = path.join(os.tmpdir(), "any-name.png");
  assert.doesNotThrow(() => assertSafeOverlayPath(safe));
});

test("brand-overlay: assertSafeOverlayPath rejects paths outside safe roots", () => {
  assert.throws(
    () => assertSafeOverlayPath("/etc/passwd"),
    UnsafeOverlayPathError,
  );
  assert.throws(
    () => assertSafeOverlayPath("/Users/somebody-else/secret.png"),
    UnsafeOverlayPathError,
  );
});

test("brand-overlay: assertSafeOverlayPath rejects empty strings", () => {
  assert.throws(() => assertSafeOverlayPath(""), UnsafeOverlayPathError);
  assert.throws(() => assertSafeOverlayPath("   "), UnsafeOverlayPathError);
});

test("brand-overlay: assertSafeOverlayPath honors extraRoots option", () => {
  const extra = "/some/sandbox";
  assert.throws(() => assertSafeOverlayPath(`${extra}/logo.png`), UnsafeOverlayPathError);
  assert.doesNotThrow(() =>
    assertSafeOverlayPath(`${extra}/logo.png`, { extraRoots: [extra] }),
  );
});

test("brand-overlay: isInsideRoot ignores parent-dir traversal", () => {
  assert.equal(isInsideRoot("/safe/foo/bar", "/safe"), true);
  assert.equal(isInsideRoot("/safe", "/safe"), true);
  assert.equal(isInsideRoot("/danger/bar", "/safe"), false);
});

// ---------- pickExt ----------

test("brand-overlay: pickExt extracts extension from local / url / file://", () => {
  assert.equal(pickExt("/tmp/foo.mp4", ".mov"), ".mp4");
  assert.equal(pickExt("https://blob.com/path/logo.png?x=1", ".jpg"), ".png");
  assert.equal(pickExt("file:///tmp/abc.webm", ".mp4"), ".webm");
  assert.equal(pickExt("/tmp/no-ext", ".mp4"), ".mp4");
});

// ---------- applyBrandOverlayIfConfigured (orchestrator) ----------

test("brand-overlay orchestrator: short-circuits when config.enabled is false", async () => {
  const r = await applyBrandOverlayIfConfigured({
    sourceVideoUrl: "https://example.com/video.mp4",
    logoUrl: "https://example.com/logo.png",
    config: { enabled: false },
  });
  assert.equal(r.applied, false);
  assert.equal(r.overlayUrl, null);
  assert.deepEqual(r.warnings, []);
});

test("brand-overlay orchestrator: short-circuits when config is null", async () => {
  const r = await applyBrandOverlayIfConfigured({
    sourceVideoUrl: "https://example.com/video.mp4",
    logoUrl: "https://example.com/logo.png",
    config: null,
  });
  assert.equal(r.applied, false);
  assert.equal(r.overlayUrl, null);
});

test("brand-overlay orchestrator: returns warning + null URL when logo is missing", async () => {
  const r = await applyBrandOverlayIfConfigured({
    sourceVideoUrl: "https://example.com/video.mp4",
    logoUrl: null,
    config: { enabled: true },
  });
  assert.equal(r.applied, false);
  assert.equal(r.overlayUrl, null);
  assert.equal(r.warnings.length, 1);
  /// Final video URL must NOT update when overlay is requested but cannot run.
  /// This is the explicit gate requested by the spec.
  assert.equal(
    r.overlayUrl,
    null,
    "finalVideoUrl swap must be gated on overlay output existing",
  );
});

test("brand-overlay orchestrator: failure surface returns null URL (caller keeps stitched URL)", async () => {
  /// A non-existent local file inside a safe root → applyBrandOverlay will throw
  /// during materialize/probe, and the orchestrator must catch and return a
  /// safe warning + null URL so the caller does NOT update finalVideoUrl.
  const fakeLocal = path.join(os.tmpdir(), `does-not-exist-${Date.now()}.mp4`);
  const r = await applyBrandOverlayIfConfigured({
    sourceVideoUrl: fakeLocal,
    logoUrl: fakeLocal,
    config: { enabled: true },
  });
  assert.equal(r.applied, false);
  assert.equal(r.overlayUrl, null);
  assert.ok(r.warnings.length >= 1, "should surface a customer-safe warning");
});

// ---------- Customer-safe warnings ----------

test("brand-overlay: customer warnings do not leak banned internal terms", () => {
  const inputs: unknown[] = [
    new Error("logo file is missing or empty after fetch: /tmp/foo.png"),
    new Error("path \"/etc/passwd\" is outside allowed roots"),
    new Error("invalid file:// URL: bad scheme"),
    new Error("video metadata probe returned malformed values"),
    new Error("ffmpeg crashed unexpectedly"),
    "raw string failure",
    null,
  ];
  for (const input of inputs) {
    const msg = toCustomerSafeWarning(input);
    assert.equal(
      typeof msg,
      "string",
      "customer-safe warning must be a string",
    );
    assert.ok(msg.length > 0, "customer-safe warning must be non-empty");
    assert.equal(
      containsBannedCustomerTerm(msg),
      false,
      `warning leaks an internal term: "${msg}"`,
    );
  }
});

// ---------- extractBrandOverlayConfig ----------

test("brand-overlay: extractBrandOverlayConfig returns null for non-objects", () => {
  assert.equal(extractBrandOverlayConfig(null), null);
  assert.equal(extractBrandOverlayConfig(undefined), null);
  assert.equal(extractBrandOverlayConfig("nope"), null);
  assert.equal(extractBrandOverlayConfig(42), null);
});

test("brand-overlay: extractBrandOverlayConfig returns null when brandKit.overlay missing", () => {
  assert.equal(extractBrandOverlayConfig({}), null);
  assert.equal(extractBrandOverlayConfig({ brandKit: {} }), null);
  assert.equal(
    extractBrandOverlayConfig({ brandKit: { logoUrl: "https://x/l.png" } }),
    null,
  );
});

test("brand-overlay: extractBrandOverlayConfig defaults enabled=false when flag absent", () => {
  const r = extractBrandOverlayConfig({
    brandKit: { overlay: { placement: "bottom-right" } },
  });
  assert.equal(r?.enabled, false);
  assert.equal(r?.placement, "bottom-right");
});

test("brand-overlay: extractBrandOverlayConfig parses full config", () => {
  const r = extractBrandOverlayConfig({
    brandKit: {
      overlay: {
        enabled: true,
        placement: "top-left",
        opacity: 0.7,
        logoWidthRatio: 0.2,
        marginPx: 24,
        durationMode: "first_3s",
      },
    },
  });
  assert.deepEqual(r, {
    enabled: true,
    placement: "top-left",
    opacity: 0.7,
    logoWidthRatio: 0.2,
    marginPx: 24,
    durationMode: "first_3s",
  });
});

test("brand-overlay: SunnyShutter brandKit forces top-left even if overlay asks bottom-right", () => {
  const r = extractBrandOverlayConfig({
    brandKit: {
      brandName: "SUNNY Shutters",
      overlay: { enabled: true, placement: "bottom-right" },
    },
  });
  assert.equal(r?.enabled, true);
  assert.equal(r?.placement, "top-left");
});

test("brand-overlay: SunnyShutter without overlay JSON still gets locked top-left config", () => {
  const r = extractBrandOverlayConfig({
    brandKit: { brandName: "Sunny Shutter" },
  });
  assert.equal(r?.enabled, true);
  assert.equal(r?.placement, "top-left");
});

test("brand-overlay: extractBrandOverlayConfig drops invalid placement / mode", () => {
  const r = extractBrandOverlayConfig({
    brandKit: {
      overlay: {
        enabled: true,
        placement: "center" /* invalid */,
        durationMode: "always" /* invalid */,
      },
    },
  });
  assert.equal(r?.placement, undefined);
  assert.equal(r?.durationMode, undefined);
});

test("brand-overlay: type guards reject unknown placement / duration values", () => {
  assert.equal(isOverlayPlacement("center"), false);
  assert.equal(isOverlayPlacement("top-right"), true);
  assert.equal(isOverlayDurationMode("always"), false);
  assert.equal(isOverlayDurationMode("last_5s"), true);
});
