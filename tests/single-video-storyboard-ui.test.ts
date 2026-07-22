import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const STUDIO = "src/components/video-generation/streamlined-video-studio.tsx";
const STORYBOARD = "src/components/video-generation/storyboard-workflow-panel.tsx";

test("single video creation exposes the full Shuyu workflow and four-frame approval gate", async () => {
  const [studio, panel, page] = await Promise.all([
    readFile(STUDIO, "utf8"),
    readFile(STORYBOARD, "utf8"),
    readFile("src/app/(platform)/app/create/page.tsx", "utf8"),
  ]);

  assert.match(studio, /data-testid="creation-workflow-rail"/);
  assert.match(studio, /\/api\/video-generation\/storyboards/);
  assert.match(studio, /storyboardRunId: storyboard\.id/);
  assert.match(studio, /storyboard\?\.status === "APPROVED"/);
  assert.match(panel, /data-testid="storyboard-frame-grid"/);
  assert.match(panel, /grid-cols-2/);
  assert.match(panel, /object-contain/);
  assert.match(studio, /frames\/\$\{encodeURIComponent\(frameId\)\}\/regenerate/);
  assert.match(studio, /\$\{encodeURIComponent\(storyboard\.id\)\}\/approve/);
  assert.match(panel, /onRegenerate/);
  assert.match(panel, /onApprove/);
  assert.match(panel, /Shuyu Image 2/);

  assert.match(page, /canSelectVideoRoute=\{showInternalVideoRoutes\}/);
});

test("creation uploads skip AI classification while retaining server-side security upload", async () => {
  const [studio, uploadAssets, uploadRoute] = await Promise.all([
    readFile(STUDIO, "utf8"),
    readFile("src/components/personal/upload-assets.ts", "utf8"),
    readFile("src/app/api/upload/blob/route.ts", "utf8"),
  ]);

  assert.match(studio, /skipAiClassification: true/);
  assert.match(uploadAssets, /skipAiClassification/);
  assert.match(uploadAssets, /if \(!opts\?\.skipAiClassification\)/);
  assert.match(uploadRoute, /validateFileMagicBytes/);
  assert.match(uploadRoute, /MAX_UPLOAD_BYTES/);
  assert.match(uploadRoute, /SUPPORTED_UPLOAD_TYPES/);
});
