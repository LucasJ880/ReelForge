import { db } from "../src/lib/db";
import {
  assertGoldenPathPrerequisites,
  cleanupGoldenPathAccount,
} from "./golden-path-fixture";

export default async function goldenPathGlobalSetup() {
  try {
    await assertGoldenPathPrerequisites();
    await cleanupGoldenPathAccount();
  } finally {
    await db.$disconnect();
  }
}
