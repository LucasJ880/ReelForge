import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "../src/lib/db";

type CleanupTarget = {
  kind: "deliveryOrder" | "batchVideoJob";
  id: string;
  reason: "failed_without_playable_output";
};

export type CleanupEvidenceCore = {
  schemaVersion: 1;
  generatedAt: string;
  databaseIdentityHash: string;
  targets: CleanupTarget[];
};

type CleanupEvidence = CleanupEvidenceCore & { digest: string };

export function parseCleanupArgs(args: string[]): {
  commit: boolean;
  evidencePath: string | null;
  help: boolean;
} {
  let commit = false;
  let evidencePath: string | null = null;
  let help = false;
  for (const arg of args) {
    if (arg === "--commit") commit = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg.startsWith("--evidence=")) {
      evidencePath = arg.slice("--evidence=".length).trim() || null;
    } else {
      throw new Error(`Unknown cleanup argument: ${arg}`);
    }
  }
  if (commit && !evidencePath) {
    throw new Error("--commit requires --evidence=<path> from a prior dry-run");
  }
  return { commit, evidencePath, help };
}

function canonicalEvidence(value: CleanupEvidenceCore): CleanupEvidenceCore {
  return {
    schemaVersion: value.schemaVersion,
    generatedAt: value.generatedAt,
    databaseIdentityHash: value.databaseIdentityHash,
    targets: [...value.targets].sort((a, b) =>
      `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
    ),
  };
}

export function cleanupEvidenceDigest(value: CleanupEvidenceCore): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalEvidence(value)))
    .digest("hex");
}

function databaseIdentityHash(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for library cleanup");
  }
  return createHash("sha256").update(databaseUrl).digest("hex");
}

async function collectTargets(): Promise<CleanupTarget[]> {
  const [orders, batchJobs] = await Promise.all([
    db.deliveryOrder.findMany({
      where: { productCategory: "unified_input" },
      select: {
        id: true,
        rounds: {
          orderBy: { roundIndex: "desc" },
          take: 1,
          select: {
            angles: {
              orderBy: { sortOrder: "asc" },
              take: 1,
              select: {
                videoBrief: {
                  select: {
                    status: true,
                    finalVideoUrl: true,
                    brandedVideoUrl: true,
                    finalVideo: { select: { stitchedVideoUrl: true } },
                    videoJobs: {
                      select: {
                        status: true,
                        outputVideoUrl: true,
                        brandedVideoUrl: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    db.videoJob.findMany({
      where: {
        batchJobId: { not: null },
        status: { in: ["FAILED", "CANCELLED"] },
        outputVideoUrl: null,
        brandedVideoUrl: null,
      },
      select: { id: true },
    }),
  ]);

  const terminalBriefStatuses = new Set([
    "RENDER_FAILED",
    "QA_REJECTED",
    "DROPPED",
  ]);
  const orderTargets: CleanupTarget[] = orders.flatMap((order) => {
    const brief = order.rounds[0]?.angles[0]?.videoBrief;
    if (!brief || !terminalBriefStatuses.has(brief.status)) return [];
    const hasPlayableOutput = Boolean(
      brief.finalVideoUrl ||
        brief.brandedVideoUrl ||
        brief.finalVideo?.stitchedVideoUrl ||
        brief.videoJobs.some(
          (job) => job.outputVideoUrl || job.brandedVideoUrl,
        ),
    );
    return hasPlayableOutput
      ? []
      : [
          {
            kind: "deliveryOrder",
            id: order.id,
            reason: "failed_without_playable_output",
          },
        ];
  });
  const batchTargets: CleanupTarget[] = batchJobs.map((job) => ({
    kind: "batchVideoJob",
    id: job.id,
    reason: "failed_without_playable_output",
  }));
  return [...orderTargets, ...batchTargets].sort((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  );
}

function defaultEvidencePath(): string {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return path.join("artifacts", `dead-library-records-${stamp}.json`);
}

async function writeEvidence(filePath: string): Promise<CleanupEvidence> {
  const core: CleanupEvidenceCore = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    databaseIdentityHash: databaseIdentityHash(),
    targets: await collectTargets(),
  };
  const evidence = { ...canonicalEvidence(core), digest: cleanupEvidenceDigest(core) };
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      mode: "dry-run",
      evidencePath: absolutePath,
      targetCount: evidence.targets.length,
      digest: evidence.digest,
    }),
  );
  return evidence;
}

async function commitEvidence(filePath: string): Promise<void> {
  const absolutePath = path.resolve(filePath);
  const evidence = JSON.parse(
    await readFile(absolutePath, "utf8"),
  ) as CleanupEvidence;
  const { digest, ...core } = evidence;
  if (cleanupEvidenceDigest(core) !== digest) {
    throw new Error("Evidence digest mismatch; run a new dry-run");
  }
  if (core.databaseIdentityHash !== databaseIdentityHash()) {
    throw new Error("Evidence belongs to a different database");
  }
  const currentTargets = await collectTargets();
  if (JSON.stringify(currentTargets) !== JSON.stringify(core.targets)) {
    throw new Error("Cleanup targets changed; run a new dry-run");
  }

  const orderIds = currentTargets
    .filter((target) => target.kind === "deliveryOrder")
    .map((target) => target.id);
  const batchVideoJobIds = currentTargets
    .filter((target) => target.kind === "batchVideoJob")
    .map((target) => target.id);
  const result = await db.$transaction(async (tx) => {
    const videoJobs = await tx.videoJob.deleteMany({
      where: { id: { in: batchVideoJobIds } },
    });
    const orders = await tx.deliveryOrder.deleteMany({
      where: { id: { in: orderIds } },
    });
    return { videoJobs: videoJobs.count, orders: orders.count };
  });
  console.log(JSON.stringify({ mode: "commit", evidencePath: absolutePath, ...result }));
}

function printHelp(): void {
  console.log(`Dead library record cleanup

Dry-run (default):
  npm run cleanup:library:dead
  npm run cleanup:library:dead -- --evidence=artifacts/review.json

Commit only after reviewing the dry-run evidence:
  npm run cleanup:library:dead -- --commit --evidence=artifacts/review.json`);
}

async function main(): Promise<void> {
  const args = parseCleanupArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.commit) await commitEvidence(args.evidencePath as string);
  else await writeEvidence(args.evidencePath ?? defaultEvidencePath());
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
