import { db } from "../src/lib/db";
import { cleanupGoldenPathAccount } from "./golden-path-fixture";

export default async function goldenPathGlobalTeardown() {
  try {
    await cleanupGoldenPathAccount();
  } finally {
    await db.$disconnect();
  }
}
