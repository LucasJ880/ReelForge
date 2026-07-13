import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../../src/lib/db";

interface RunState {
  runId: string;
  batchIds: string[];
}

export default async function globalTeardown() {
  const statePath = path.join(
    process.cwd(),
    "test-results/final-acceptance/run-state.json",
  );
  try {
    const state = JSON.parse(await readFile(statePath, "utf8")) as RunState;
    const batchIds = [...new Set(state.batchIds.filter(Boolean))];
    if (batchIds.length > 0) {
      await db.batchJob.deleteMany({ where: { id: { in: batchIds } } });
    }
    console.log(
      JSON.stringify({
        evt: "final_acceptance_cleanup",
        runId: state.runId,
        deletedBatchCount: batchIds.length,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
