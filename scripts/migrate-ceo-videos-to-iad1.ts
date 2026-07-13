import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { head, put } from "@vercel/blob";
import { PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);
const MAX_SOURCE_BYTES = 500 * 1024 * 1024;
const TARGETS = [
  {
    finalVideoId: "cmrii4yyv0014l204jaxluepv",
    videoJobId: "cmrii4yzr0016l204c4rcwpw6",
  },
  {
    finalVideoId: "cmrij6psx0010jl04gj04xoeg",
    videoJobId: "cmrij6pty0012jl04n6wi5ul8",
  },
] as const;

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function safeFilename(raw: string): string {
  const url = new URL(raw);
  const value = decodeURIComponent(url.pathname.split("/").pop() || "segment.mp4");
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "segment.mp4";
}

function isMp4(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

async function download(rawUrl: string): Promise<Buffer> {
  const response = await fetch(rawUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`source download failed with HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_SOURCE_BYTES) throw new Error("source exceeds migration size limit");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_SOURCE_BYTES) throw new Error("source exceeds migration size limit");
  if (!isMp4(buffer)) throw new Error("source failed MP4 magic-byte validation");
  return buffer;
}

async function uploadVerified(key: string, buffer: Buffer, token: string): Promise<string> {
  let url: string | null = null;
  try {
    const existing = await head(key, { token });
    url = existing.url;
  } catch {
    const uploaded = await put(key, buffer, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "video/mp4",
      token,
    });
    url = uploaded.url;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`target verification failed with HTTP ${response.status}`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  if (sha256(downloaded) !== sha256(buffer)) throw new Error("target SHA-256 mismatch");
  return url;
}

async function transcodeAndProbe(source: Buffer, finalVideoId: string) {
  const dir = path.join(os.tmpdir(), `aivora-s5-${finalVideoId}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    const input = path.join(dir, "segment.mp4");
    const output = path.join(dir, "stitched.mp4");
    await writeFile(input, source, { mode: 0o600 });
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        output,
      ],
      { maxBuffer: 50 * 1024 * 1024 },
    );
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=index,codec_type,codec_name,width,height",
        "-of",
        "json",
        output,
      ],
      { maxBuffer: 5 * 1024 * 1024 },
    );
    const probe = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const video = probe.streams?.find((stream) => stream.codec_type === "video");
    const durationSec = Number(probe.format?.duration ?? "0");
    if (!video || !Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error("ffprobe did not confirm a decodable video stream");
    }
    return {
      buffer: await readFile(output),
      probe: {
        durationSec,
        videoCodec: video.codec_name ?? null,
        width: video.width ?? null,
        height: video.height ?? null,
        hasAudio: Boolean(probe.streams?.some((stream) => stream.codec_type === "audio")),
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function casTarget(args: {
  db: PrismaClient;
  finalVideoId: string;
  videoJobId: string;
  sourceUrl: string;
  segmentUrl: string;
  stitchedUrl: string;
}) {
  const currentJob = await args.db.videoJob.findUnique({ where: { id: args.videoJobId } });
  if (!currentJob) throw new Error("target VideoJob not found");
  if (currentJob.outputVideoUrl === args.sourceUrl) {
    const jobUpdate = await args.db.videoJob.updateMany({
      where: {
        id: args.videoJobId,
        status: "SUCCEEDED",
        outputVideoUrl: args.sourceUrl,
        updatedAt: currentJob.updatedAt,
      },
      data: { outputVideoUrl: args.segmentUrl },
    });
    if (jobUpdate.count !== 1) throw new Error("VideoJob CAS did not match");
  } else if (currentJob.outputVideoUrl !== args.segmentUrl) {
    throw new Error("VideoJob source changed outside migration");
  }

  let currentFinal = await args.db.finalVideo.findUnique({
    where: { id: args.finalVideoId },
    include: { brief: true },
  });
  if (!currentFinal) throw new Error("target FinalVideo not found");
  if (currentFinal.status === "READY" && currentFinal.stitchedVideoUrl === args.stitchedUrl) {
    return { idempotent: true, briefId: currentFinal.brief?.id ?? null };
  }
  if (currentFinal.status === "FAILED") {
    const claim = await args.db.finalVideo.updateMany({
      where: { id: args.finalVideoId, status: "FAILED", updatedAt: currentFinal.updatedAt },
      data: { status: "STITCHING", startedAt: new Date(), finishedAt: null, ffmpegError: null },
    });
    if (claim.count !== 1) throw new Error("FinalVideo claim CAS did not match");
    currentFinal = await args.db.finalVideo.findUnique({
      where: { id: args.finalVideoId },
      include: { brief: true },
    });
  }
  if (!currentFinal || currentFinal.status !== "STITCHING") {
    throw new Error(`FinalVideo is not claimable from ${currentFinal?.status ?? "missing"}`);
  }
  const finish = await args.db.finalVideo.updateMany({
    where: { id: args.finalVideoId, status: "STITCHING", updatedAt: currentFinal.updatedAt },
    data: {
      status: "READY",
      stitchedVideoUrl: args.stitchedUrl,
      finishedAt: new Date(),
      ffmpegError: null,
      stitchAttempts: { increment: 1 },
    },
  });
  if (finish.count !== 1) throw new Error("FinalVideo finish CAS did not match");

  if (currentFinal.brief) {
    const briefUpdate = await args.db.videoBrief.updateMany({
      where: {
        id: currentFinal.brief.id,
        finalVideoId: args.finalVideoId,
        updatedAt: currentFinal.brief.updatedAt,
      },
      data: { status: "QA_PENDING", finalVideoUrl: args.stitchedUrl },
    });
    if (briefUpdate.count !== 1) throw new Error("VideoBrief CAS did not match");
  }
  return { idempotent: false, briefId: currentFinal.brief?.id ?? null };
}

async function main(): Promise<void> {
  const productionTarget = process.argv.includes("--target=production");
  const productionApproved = process.argv.includes("--approve-production-write=YES");
  if (productionTarget && !productionApproved) {
    throw new Error(
      "production CAS requires --target=production and --approve-production-write=YES",
    );
  }
  const productionUrl = process.env.DATABASE_URL;
  const rehearsalUrl = process.env.NEON_REHEARSAL_DATABASE_URL;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!productionUrl || !blobToken || (!productionTarget && !rehearsalUrl)) {
    throw new Error(
      productionTarget
        ? "DATABASE_URL and BLOB_READ_WRITE_TOKEN are required"
        : "DATABASE_URL, NEON_REHEARSAL_DATABASE_URL and BLOB_READ_WRITE_TOKEN are required",
    );
  }
  const production = new PrismaClient({ datasourceUrl: productionUrl });
  const targetDatabase = productionTarget
    ? new PrismaClient({ datasourceUrl: productionUrl })
    : new PrismaClient({ datasourceUrl: rehearsalUrl });
  const evidenceFile = path.join(
    process.cwd(),
    ".aivora-private",
    productionTarget
      ? "s5-ceo-production-cas-evidence.json"
      : "s5-ceo-migration-evidence.json",
  );
  const evidence = [];
  try {
    for (const target of TARGETS) {
      const row = await production.finalVideo.findUnique({
        where: { id: target.finalVideoId },
        select: {
          id: true,
          status: true,
          brief: { select: { id: true } },
          segments: {
            where: { id: target.videoJobId },
            select: { id: true, status: true, provider: true, outputVideoUrl: true },
          },
        },
      });
      const segment = row?.segments[0];
      if (!row || !row.brief || !segment?.outputVideoUrl) throw new Error("CEO source relationship is incomplete");
      if (segment.status !== "SUCCEEDED" || segment.provider === "MOCK") {
        throw new Error("CEO source is not a successful real-provider segment");
      }

      const source = await download(segment.outputVideoUrl);
      const sourceByteSha = sha256(source);
      const prefixSha = sha256(canonicalUrl(segment.outputVideoUrl));
      const segmentKey = `migrations/beijing-tos/${prefixSha}/${safeFilename(segment.outputVideoUrl)}`;
      const segmentUrl = await uploadVerified(segmentKey, source, blobToken);

      const stitched = await transcodeAndProbe(source, row.id);
      const stitchedKey = `migrations/beijing-tos/${prefixSha}/stitched.mp4`;
      const stitchedUrl = await uploadVerified(stitchedKey, stitched.buffer, blobToken);

      const cas = await casTarget({
        db: targetDatabase,
        finalVideoId: row.id,
        videoJobId: segment.id,
        sourceUrl: segment.outputVideoUrl,
        segmentUrl,
        stitchedUrl,
      });
      evidence.push({
        finalVideoId: row.id,
        videoJobId: segment.id,
        sourceBytes: source.length,
        sourceSha256: sourceByteSha,
        targetPrefixSha256: prefixSha,
        segmentTargetSha256: sourceByteSha,
        stitchedBytes: stitched.buffer.length,
        stitchedSha256: sha256(stitched.buffer),
        probe: stitched.probe,
        databaseCas: cas,
        sourceDeleted: false,
        productionDatabaseWritten: productionTarget,
      });
    }
    await mkdir(path.dirname(evidenceFile), { recursive: true });
    await writeFile(
      evidenceFile,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          storageRegion: "IAD1",
          databaseTarget: productionTarget ? "production" : "rehearsal",
          evidence,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    process.stdout.write(
      JSON.stringify({
        migrated: evidence.length,
        databaseTarget: productionTarget ? "production" : "rehearsal",
        sourceDeleted: false,
        allFfprobePassed: evidence.every((item) => item.probe.durationSec > 0),
        evidenceFile,
      }) + "\n",
    );
  } finally {
    await production.$disconnect();
    await targetDatabase.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "migration failed"}\n`);
  process.exitCode = 1;
});
