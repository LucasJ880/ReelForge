import { access } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";

export const GOLDEN_PATH_EMAIL = requiredEnv("GOLDEN_PATH_EMAIL");
export const GOLDEN_PATH_PASSWORD = "Aivora-golden-2026";
export const GOLDEN_PATH_NAME = "Golden Path Customer";
export const GOLDEN_PATH_FIXTURE_PATH = "/mock-clips/9x16.mp4";

export function assertRehearsalDatabase(): void {
  const rehearsal = requiredEnv("NEON_REHEARSAL_DATABASE_URL");
  const active = requiredEnv("DATABASE_URL");
  if (active !== rehearsal) {
    throw new Error(
      "Golden path refuses to run unless DATABASE_URL exactly matches NEON_REHEARSAL_DATABASE_URL",
    );
  }
}

export async function assertGoldenPathPrerequisites(): Promise<void> {
  assertRehearsalDatabase();
  const starter = await db.planEntitlement.findUnique({
    where: { id: "starter" },
    select: { id: true },
  });
  if (!starter) {
    throw new Error("Golden path requires the starter PlanEntitlement on the rehearsal branch");
  }
  await access(path.join(process.cwd(), "public", GOLDEN_PATH_FIXTURE_PATH));
}

export async function cleanupGoldenPathAccount(): Promise<{
  removedAccount: boolean;
  removedOrders: number;
  removedFinalVideos: number;
}> {
  assertRehearsalDatabase();
  const user = await db.adminUser.findUnique({
    where: { email: GOLDEN_PATH_EMAIL },
    select: { id: true },
  });
  if (!user) {
    return { removedAccount: false, removedOrders: 0, removedFinalVideos: 0 };
  }

  const briefs = await db.videoBrief.findMany({
    where: {
      contentAngle: {
        round: {
          deliveryOrder: { createdById: user.id },
        },
      },
    },
    select: { finalVideoId: true },
  });
  const finalVideoIds = briefs
    .map((brief) => brief.finalVideoId)
    .filter((id): id is string => Boolean(id));

  const orders = await db.deliveryOrder.deleteMany({
    where: { createdById: user.id },
  });
  const finalVideos = finalVideoIds.length
    ? await db.finalVideo.deleteMany({ where: { id: { in: finalVideoIds } } })
    : { count: 0 };
  await db.adminUser.delete({ where: { id: user.id } });

  return {
    removedAccount: true,
    removedOrders: orders.count,
    removedFinalVideos: finalVideos.count,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Golden path requires ${name}`);
  return value;
}
