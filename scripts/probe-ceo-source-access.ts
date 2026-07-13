import { TosClient } from "@volcengine/tos-sdk";
import { db } from "../src/lib/db";

const JOB_IDS = [
  "cmrii4yzr0016l204c4rcwpw6",
  "cmrij6pty0012jl04n6wi5ul8",
] as const;

function tosAddress(raw: string): { bucket: string; key: string; endpoint: string } | null {
  const url = new URL(raw);
  const suffix = ".tos-cn-beijing.volces.com";
  if (!url.hostname.endsWith(suffix)) return null;
  const bucket = url.hostname.slice(0, -suffix.length);
  if (!bucket) return null;
  return {
    bucket,
    key: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
    endpoint: "tos-cn-beijing.volces.com",
  };
}

async function main(): Promise<void> {
  const accessKeyId = process.env.VOLCENGINE_ACCESS_KEY_ID;
  const accessKeySecret = process.env.VOLCENGINE_SECRET_ACCESS_KEY;
  if (!accessKeyId || !accessKeySecret) throw new Error("TOS credentials are required");
  const client = new TosClient({
    accessKeyId,
    accessKeySecret,
    region: "cn-beijing",
    endpoint: "tos-cn-beijing.volces.com",
  });

  const results = [];
  for (const id of JOB_IDS) {
    const job = await db.videoJob.findUnique({
      where: { id },
      select: { id: true, status: true, provider: true, externalJobId: true, outputVideoUrl: true },
    });
    if (!job?.outputVideoUrl) {
      results.push({ id, found: Boolean(job), hasSource: false });
      continue;
    }
    const source = new URL(job.outputVideoUrl);
    let signedHttpStatus: number | null = null;
    try {
      const response = await fetch(job.outputVideoUrl, {
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(10_000),
      });
      signedHttpStatus = response.status;
      await response.body?.cancel();
    } catch {
      signedHttpStatus = 0;
    }

    const address = tosAddress(job.outputVideoUrl);
    let tosSdkStatus: number | null = null;
    let tosSdkCode: string | null = null;
    if (address) {
      try {
        await client.getObject({
          bucket: address.bucket,
          key: address.key,
          headers: { Range: "bytes=0-0" },
        });
        tosSdkStatus = 206;
      } catch (error) {
        const e = error as { statusCode?: number; code?: string };
        tosSdkStatus = e.statusCode ?? 0;
        tosSdkCode = e.code ?? null;
      }
    }
    results.push({
      id,
      found: true,
      status: job.status,
      provider: job.provider,
      hasExternalJobId: Boolean(job.externalJobId),
      sourceHost: source.hostname,
      signedHttpStatus,
      tosAddressRecognized: Boolean(address),
      tosSdkStatus,
      tosSdkCode,
    });
  }
  process.stdout.write(JSON.stringify({ readOnly: true, results }, null, 2) + "\n");
  await db.$disconnect();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "probe failed"}\n`);
  process.exitCode = 1;
});
