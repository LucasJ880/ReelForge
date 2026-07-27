import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildBrandPackagingPlan } from "../src/lib/video-generation/brand-packaging";
import type { InputClassification, UnifiedVideoGenerationRequest } from "../src/types/video-generation";
import {
  assertWorkspaceBrandPackageMutable,
  workspaceBrandPackageView,
} from "../src/lib/services/workspace-brand-package-service";

test("even SunnyShutter stays clean when the user selects no brand package", () => {
  const request: UnifiedVideoGenerationRequest = {
    userType: "platform",
    rawPrompt: "Show the shutters in a bright living room",
    attachments: [],
    selectedDuration: 15,
    selectedAspectRatio: "9:16",
    selectedBrandEndingMode: "none",
    cta: null,
    platform: null,
    brandKit: { brandName: "SUNNY Shutters", logoUrl: null },
    language: "en",
  };
  const classification: InputClassification = {
    userType: "platform",
    generationMode: "text_to_video",
    videoGoal: "product_showcase",
    targetPlatform: "tiktok",
    needsCTA: false,
    needsBrandPackaging: false,
    needsUserClipInsertion: false,
    confidence: 1,
    missingFields: [],
    warnings: [],
  };
  const plan = buildBrandPackagingPlan({ request, classification, classifiedAssets: [] });
  assert.equal(plan.mode, "none");
  assert.equal(plan.renderStrategy, "no_end_card");
});

test("workspace brand package is tenant-scoped and wired into creation and delivery UI", async () => {
  const [schema, service, studio, page, button, assembly, packaging] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile("src/lib/services/workspace-brand-package-service.ts", "utf8"),
    readFile("src/components/video-generation/streamlined-video-studio.tsx", "utf8"),
    readFile("src/app/(platform)/app/create/page.tsx", "utf8"),
    readFile("src/components/library/brand-package-button.tsx", "utf8"),
    readFile("src/lib/video-generation/assembly-executor.ts", "utf8"),
    readFile("src/lib/video-generation/brand-packaging.ts", "utf8"),
  ]);
  assert.match(schema, /model WorkspaceBrandPackage/);
  assert.match(schema, /workspaceId/);
  assert.match(service, /ownerId: userId/);
  assert.match(service, /logoAsset/);
  assert.match(studio, /data-testid="streamlined-brand-package"/);
  assert.match(studio, /selectedBrandPackageId/);
  assert.match(page, /listWorkspaceBrandPackagesForUser/);
  assert.match(button, /brandPackageId/);
  assert.doesNotMatch(button, /clientProfileId: "sunnyshutter"/);
  assert.match(assembly, /applyBrandOverlayIfConfigured/);
  assert.match(packaging, /endCardStillUrl: designedEndCard\?\.url/);
});

test("brand package view exposes global scope as read-only", () => {
  const view = workspaceBrandPackageView({
    id: "global-pack",
    workspaceId: "platform-workspace",
    name: "Aivora Clean",
    brandName: "Aivora",
    slogan: null,
    cta: null,
    contactLines: [],
    website: null,
    clientProfileId: null,
    logoAssetId: "logo",
    endCardAssetId: null,
    isDefault: false,
    isActive: true,
    isGlobal: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    logoAsset: {
      id: "logo",
      userId: "platform",
      workspaceId: "platform-workspace",
      storageKey: "seed/aivora.png",
      url: "/demo/pet/aivora-logo-endcard.png",
      mimeType: "image/png",
      byteSize: 100,
      sha256: "hash",
      width: 512,
      height: 512,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    endCardAsset: null,
  } as never);
  assert.equal(view.scope, "global");
  assert.equal(view.canEdit, false);
});

test("global brand packages cannot be mutated by workspace routes", () => {
  assert.throws(
    () => assertWorkspaceBrandPackageMutable({ isGlobal: true }),
    /read-only/i,
  );
  assert.doesNotThrow(() =>
    assertWorkspaceBrandPackageMutable({ isGlobal: false }),
  );
});

test("global and workspace packages are queried together", async () => {
  const service = await readFile(
    "src/lib/services/workspace-brand-package-service.ts",
    "utf8",
  );
  assert.match(service, /OR:\s*\[\s*\{\s*isGlobal:\s*true\s*\}/);
  assert.match(service, /workspace:\s*\{\s*ownerId:\s*userId\s*\}/);
  assert.match(service, /isGlobal:\s*"desc"/);
});
