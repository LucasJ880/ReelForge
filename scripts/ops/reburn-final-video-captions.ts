/**
 * 运维：给已交付（READY）的成片重新合成字幕与混音——与生产 runner 同一条合成管线（stitchOne），全程不改状态。
 *
 * 起因（1025 真机验收）：生产拼接跑在 GH Ubuntu runner，之前没有中文字体（中文字幕烧成方框）；
 * b-roll 开了背景音乐时 runner 还把口播整段换成了音乐。两处已在 runner 修好，这个脚本给旧成片补一次。
 *
 * 为什么不走 retryStitch / 改回 PENDING：任何离开 READY 的路线都会碰到清扫超时、生产 runner 抢领、
 * 读数里的「新成片」虚增、QA 占位、以及把 brief 变成「上线后终态」从而可能被额度对账处理。
 * 这里只做两件互不相干的事：
 *
 *  1) 合成（默认）：按生产认领同一份载荷（stitchTaskPayload）重新合成并上传到带时间戳的新 key
 *     （旧文件一律不动、不删），打印新 URL。不写库。
 *  2) 换链（--swap）：一个事务里 CAS 只换 URL 字段——
 *     FinalVideo 必须仍是 READY、三个 URL 与传入的旧值一致；
 *     VideoBrief 必须状态不变、finalVideoUrl 与旧成片一致、没有品牌封装。
 *     不碰 status / finishedAt / startedAt / stitchAttempts / errorMessage / quotaRefundedAt；
 *     任一条件不满足整笔回滚。新旧 URL 追加到 docs/ops/caption-reburn-log.jsonl，反向再跑一次 --swap 即可换回。
 *
 * 用法（.env.local 直连生产库与生产 Blob）：
 *   PATH=/opt/homebrew/opt/ffmpeg-full/bin:$PATH \
 *     npx tsx --env-file=.env.local scripts/ops/reburn-final-video-captions.ts --id=<finalVideoId>
 *   CONFIRM_PRODUCTION_DB=reburn-final-video-captions \
 *     npx tsx --env-file=.env.local scripts/ops/reburn-final-video-captions.ts --id=<finalVideoId> --swap \
 *       --from-video=<old> --from-thumb=<old> --from-srt=<old|none> --video=<new> --thumb=<new> [--srt=<new|none>]
 * 合成需要带 libass 的 ffmpeg 与 ffprobe 在 PATH 上（Homebrew 核心 ffmpeg 8.x 没有 libass，用 ffmpeg-full）。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { db } from "../../src/lib/db";
import { isStitchCandidateReady, stitchTaskPayload } from "../../src/lib/services/stitch-service";
import { stitchOne, type StitchTask } from "../stitch-runner";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"] as const;
  }),
);
const LOG_PATH = path.join(process.cwd(), "docs/ops/caption-reburn-log.jsonl");

/// 新文件必须与旧成片在同一个生产 Blob store、同一个 final-videos/<id>/ 目录下，并且真的存在。
async function verifiedBlobUrl(
  finalVideoId: string,
  url: string | undefined,
  label: string,
  storeHost: string,
  contentType: RegExp,
): Promise<string> {
  if (!url) throw new Error(`--${label} is required`);
  const parsed = new URL(url);
  if (parsed.hostname !== storeHost) throw new Error(`--${label} must be on ${storeHost}`);
  if (!parsed.pathname.startsWith(`/final-videos/${finalVideoId}/`)) {
    throw new Error(`--${label} must live under final-videos/${finalVideoId}/`);
  }
  const head = await fetch(url, { method: "HEAD" });
  const type = head.headers.get("content-type") ?? "";
  const length = Number(head.headers.get("content-length") ?? "0");
  if (!head.ok || !contentType.test(type) || !(length > 0)) {
    throw new Error(`--${label} is not a live ${contentType.source} file (HTTP ${head.status}, ${type}, ${length} bytes)`);
  }
  return url;
}

async function loadFinalVideo(finalVideoId: string) {
  const fv = await db.finalVideo.findUnique({
    where: { id: finalVideoId },
    include: {
      brief: {
        select: {
          id: true,
          status: true,
          aspectRatio: true,
          finalVideoUrl: true,
          finalThumbnailUrl: true,
          brandedVideoUrl: true,
        },
      },
      segments: {
        orderBy: { segmentIndex: "asc" },
        select: { segmentIndex: true, status: true, outputVideoUrl: true, assignedAssets: true },
      },
    },
  });
  if (!fv) throw new Error(`FinalVideo ${finalVideoId} not found`);
  if (fv.status !== "READY") throw new Error(`FinalVideo ${finalVideoId} is ${fv.status}, not READY`);
  if (!fv.brief) throw new Error(`FinalVideo ${finalVideoId} has no brief`);
  if (fv.brief.brandedVideoUrl) {
    throw new Error("brief is brand-packaged; re-package after re-burning instead of swapping here");
  }
  /// 与生产认领同一道就绪判定（段数齐、全部成功且有产出）
  if (fv.segments.length === 0 || !isStitchCandidateReady(fv)) {
    throw new Error("every segment must be SUCCEEDED with an output URL, and the segment count must match");
  }
  return fv;
}

async function compose(finalVideoId: string) {
  const fv = await loadFinalVideo(finalVideoId);
  const payload = stitchTaskPayload(fv);
  if (!payload.postProduction?.captions.enabled) {
    console.warn(`[reburn] ${finalVideoId}: captions are off in the snapshot; output will have no burned captions`);
  }
  const task: StitchTask = { finalVideoId: fv.id, attemptToken: "ops-reburn", ...payload };
  const result = await stitchOne(task);
  console.log(JSON.stringify({
    finalVideoId,
    route: payload.brollSegments ? "broll" : "segments",
    from: { video: fv.stitchedVideoUrl, thumb: fv.thumbnailUrl, srt: fv.subtitleFileUrl },
    to: result,
  }, null, 2));
}

async function swap(finalVideoId: string) {
  if (process.env.CONFIRM_PRODUCTION_DB !== "reburn-final-video-captions") {
    throw new Error("--swap writes the production DB; set CONFIRM_PRODUCTION_DB=reburn-final-video-captions");
  }
  const fromVideo = args.get("from-video");
  const fromThumb = args.get("from-thumb");
  const fromSrtArg = args.get("from-srt");
  if (!fromVideo || !fromThumb || !fromSrtArg) throw new Error("--from-video, --from-thumb and --from-srt are required");
  const fromSrt = fromSrtArg === "none" ? null : fromSrtArg;
  const storeHost = new URL(fromVideo).hostname;
  const video = await verifiedBlobUrl(finalVideoId, args.get("video"), "video", storeHost, /^video\//);
  const thumb = await verifiedBlobUrl(finalVideoId, args.get("thumb"), "thumb", storeHost, /^image\//);
  /// --srt=none 只用于原样回滚到「没有字幕文件」；不传 --srt 时保留现有字幕文件
  const srtArg = args.get("srt");
  const srtUpdate: { subtitleFileUrl?: string | null } =
    srtArg === "none"
      ? { subtitleFileUrl: null }
      : srtArg
        ? { subtitleFileUrl: await verifiedBlobUrl(finalVideoId, srtArg, "srt", storeHost, /^text\//) }
        : {};

  const fv = await loadFinalVideo(finalVideoId);
  const brief = fv.brief!;
  const record = {
    at: new Date().toISOString(),
    finalVideoId,
    briefId: brief.id,
    from: { video: fromVideo, thumb: fromThumb, srt: fromSrt, briefThumb: brief.finalThumbnailUrl },
    to: { video, thumb, srt: "subtitleFileUrl" in srtUpdate ? srtUpdate.subtitleFileUrl : fromSrt },
  };
  /// 回滚记录先打出来：就算之后写日志文件失败，旧值也在终端里
  console.log(JSON.stringify({ rollbackRecord: record }));
  await db.$transaction(async (tx) => {
    const fvUpdated = await tx.finalVideo.updateMany({
      where: {
        id: finalVideoId,
        status: "READY",
        stitchedVideoUrl: fromVideo,
        thumbnailUrl: fromThumb,
        subtitleFileUrl: fromSrt,
      },
      /// 新合成没有 SRT 时保留旧的，绝不把已有字幕文件写成空
      data: { stitchedVideoUrl: video, thumbnailUrl: thumb, ...srtUpdate },
    });
    if (fvUpdated.count !== 1) throw new Error("FinalVideo changed since it was read (status or URLs); nothing swapped");
    const briefUpdated = await tx.videoBrief.updateMany({
      where: {
        id: brief.id,
        status: brief.status,
        finalVideoId,
        finalVideoUrl: fromVideo,
        finalThumbnailUrl: brief.finalThumbnailUrl,
        brandedVideoUrl: null,
      },
      data: { finalVideoUrl: video, finalThumbnailUrl: thumb },
    });
    if (briefUpdated.count !== 1) throw new Error("VideoBrief changed since it was read; nothing swapped");
  });
  try {
    mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, `${JSON.stringify(record)}\n`);
  } catch (error) {
    console.error("[reburn] swap COMMITTED but the log write failed; keep the rollbackRecord printed above:", error);
    return;
  }
  console.log(JSON.stringify({ finalVideoId, swapped: true, log: path.relative(process.cwd(), LOG_PATH) }));
}

async function main() {
  const finalVideoId = args.get("id");
  if (!finalVideoId) throw new Error("--id=<finalVideoId> is required");
  if (args.get("swap") === "true") await swap(finalVideoId);
  else await compose(finalVideoId);
}

main()
  .catch((error) => {
    console.error("[reburn] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
