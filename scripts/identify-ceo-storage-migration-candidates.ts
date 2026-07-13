/**
 * S5 read-only CEO migration candidate identifier.
 *
 * It never downloads media, writes Postgres, uploads Blob objects, or prints
 * source URLs/emails. The private JSON output only contains internal IDs,
 * titles, provider/status evidence, and hashed creator fingerprints.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";

const OUTPUT = path.join(
  process.cwd(),
  ".aivora-private",
  "ceo-storage-migration-candidates.json",
);

const KNOWN_SCRIPT_TITLES = new Set([
  "窗帘爆款广告（15秒）· 成果前置 · 奶油奢华卧室",
  "窗帘爆款广告（15秒）· 空间焕新对比 · 卧室遮光改造",
  "窗帘爆款广告（15秒）· 痛点狙击 · 清晨刺眼阳光",
  "窗帘爆款广告（15秒）· 光影质感沉浸 · 白纱光影",
  "窗帘爆款广告（15秒）· 成果前置 · 通顶玻璃门",
]);

function isBeijingTos(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host.includes("tos-cn-beijing") || host.endsWith("volces.com");
  } catch {
    return false;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fingerprint(value: string | null | undefined): string | null {
  return value
    ? createHash("sha256").update(value).digest("hex").slice(0, 12)
    : null;
}

async function main() {
  const rows = await db.finalVideo.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      segments: {
        select: {
          id: true,
          status: true,
          provider: true,
          externalJobId: true,
          outputVideoUrl: true,
        },
      },
      brief: {
        select: {
          id: true,
          contentAngle: {
            select: {
              round: {
                select: {
                  deliveryOrder: {
                    select: {
                      id: true,
                      title: true,
                      productCategory: true,
                      productInput: true,
                      createdById: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const assessed = rows.flatMap((finalVideo) => {
    const segments = finalVideo.segments;
    const realProviderSegments =
      segments.length > 0 &&
      segments.every(
        (segment) =>
          segment.status === "SUCCEEDED" &&
          (segment.provider === "SEEDANCE_T2V" ||
            segment.provider === "SEEDANCE_I2V") &&
          Boolean(segment.externalJobId) &&
          !segment.externalJobId?.startsWith("mock_"),
      );
    if (!realProviderSegments || !segments.some((segment) => isBeijingTos(segment.outputVideoUrl))) {
      return [];
    }

    const order = finalVideo.brief?.contentAngle.round.deliveryOrder;
    if (!order) return [];
    const productInput = objectValue(order.productInput);
    const source = typeof productInput?.source === "string" ? productInput.source : null;
    const requestOrigin =
      typeof productInput?.requestOrigin === "string"
        ? productInput.requestOrigin
        : null;
    const scriptEvidence =
      source === "investor_demo"
        ? "productInput.source=investor_demo"
        : KNOWN_SCRIPT_TITLES.has(order.title)
          ? "title matches checked-in publishing script"
          : null;
    const frontendEvidence =
      order.productCategory === "unified_input" && requestOrigin === "web_app"
        ? "productInput.requestOrigin=web_app"
        : null;

    return [{
      finalVideoId: finalVideo.id,
      finalStatus: finalVideo.status,
      briefId: finalVideo.brief?.id ?? null,
      orderId: order.id,
      title: order.title,
      creatorFingerprint: fingerprint(order.createdById),
      segmentIds: segments.map((segment) => segment.id),
      providers: [...new Set(segments.map((segment) => segment.provider))],
      segmentCount: segments.length,
      frontendEvidence,
      exclusionEvidence: scriptEvidence,
      classification: scriptEvidence
        ? "excluded-script"
        : frontendEvidence
          ? "confirmed-frontend"
          : "ambiguous-origin",
    }];
  });

  const confirmed = assessed.filter((item) => item.classification === "confirmed-frontend");
  const ambiguous = assessed.filter((item) => item.classification === "ambiguous-origin");
  const creators = new Set(confirmed.map((item) => item.creatorFingerprint).filter(Boolean));
  const autoSelectionAllowed =
    confirmed.length > 0 && confirmed.length <= 2 && creators.size <= 1 && ambiguous.length === 0;

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    sourceUrlsPersisted: false,
    criteria: {
      realProvider: "SEEDANCE_T2V or SEEDANCE_I2V with non-mock external job id",
      allSourceSegments: "SUCCEEDED",
      historicalStorage: "at least one Beijing TOS source segment",
      frontendRequest: "productInput.requestOrigin=web_app",
    },
    counts: {
      assessed: assessed.length,
      confirmedFrontend: confirmed.length,
      ambiguousOrigin: ambiguous.length,
      excludedScript: assessed.filter((item) => item.classification === "excluded-script").length,
    },
    autoSelectionAllowed,
    decision: autoSelectionAllowed
      ? "auto-select confirmed frontend records"
      : "human confirmation required; no migration writes allowed",
    records: assessed,
  };

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output: OUTPUT, ...report.counts, autoSelectionAllowed }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "candidate identification failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
