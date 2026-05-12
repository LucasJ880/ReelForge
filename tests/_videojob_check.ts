import { db } from "../src/lib/db";

async function main() {
  const order = await db.deliveryOrder.findFirst({
    where: { title: { contains: "Cozy Home Living" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      clientBrief: true,
      selectedCreativeCardId: true,
      _count: { select: { rounds: true } },
    },
  });

  console.log("Order:", JSON.stringify(order, null, 2));
  if (!order) return;

  const rounds = await db.round.findMany({
    where: { deliveryOrderId: order.id },
    select: {
      id: true,
      _count: { select: { angles: true } },
      angles: {
        select: {
          id: true,
          title: true,
          videoBrief: {
            select: {
              id: true,
              status: true,
              durationSec: true,
              targetDurationSec: true,
              directorPlan: true,
              finalVideoId: true,
              videoJobs: {
                select: {
                  id: true,
                  status: true,
                  externalJobId: true,
                  segmentDurationSec: true,
                  segmentIndex: true,
                  outputVideoUrl: true,
                },
                orderBy: { segmentIndex: "asc" },
              },
              finalVideo: {
                select: {
                  id: true,
                  status: true,
                  stitchedVideoUrl: true,
                  targetDurationSec: true, segmentCount: true, ffmpegError: true,
                },
              },
            },
          },
        },
      },
    },
  });

  console.log("\n=== Rounds:", rounds.length);
  for (const r of rounds) {
    console.log("Round", r.id, "angles:", r._count.angles);
    for (const a of r.angles) {
      console.log("  Angle", a.id, "title:", a.title);
      const b = a.videoBrief;
      if (!b) {
        console.log("    (no brief)");
        continue;
      }
      console.log("    Brief", b.id, "status:", b.status, "duration:", b.durationSec, "target:", b.targetDurationSec);
      const dp = b.directorPlan as Record<string, unknown> | null;
      if (dp) {
        const sp = dp.segmentPlan;
        console.log("      directorPlan version:", dp.version);
        console.log("      segmentPlan isArray:", Array.isArray(sp), "length:", Array.isArray(sp) ? sp.length : "n/a");
        if (Array.isArray(sp)) {
          for (const s of sp as Array<Record<string, unknown>>) {
            console.log("        seg", s.segmentIndex, "dur", s.durationSec, "role", s.role);
          }
        }
        const ts = dp.timelineScript;
        console.log("      timelineScript isArray:", Array.isArray(ts), "blocks:", Array.isArray(ts) ? ts.length : "n/a");
      }
      console.log("      VideoJobs:", b.videoJobs.length);
      for (const j of b.videoJobs) {
        console.log("        -", j.id, "seg", j.segmentIndex, "dur", j.segmentDurationSec, "ext", j.externalJobId, "status", j.status);
        if (j.outputVideoUrl) console.log("          url:", j.outputVideoUrl.slice(0, 100));
      }
      if (b.finalVideo) {
        const f = b.finalVideo;
        console.log("      FinalVideo:", f.id, "status", f.status, "target", f.targetDurationSec, "segs", f.segmentCount, "ffmpegError:", f.ffmpegError, "url", f.stitchedVideoUrl?.slice(0, 120));
      } else {
        console.log("      FinalVideo: none");
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
