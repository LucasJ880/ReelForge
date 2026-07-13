/**
 * Human-only CAS command. Run against a rehearsed Neon branch first:
 *   tsx --env-file=.env.branch scripts/decide-historical-dispatch-quarantine.ts \
 *     --batch=<id> --decision=RELEASED|EXPIRED --actor=<email> --expected-updated-at=<ISO>
 */
import { db } from "../src/lib/db";
import {
  decideHistoricalBatchQuarantine,
  QUARANTINE_EXPIRED,
  QUARANTINE_RELEASED,
  type DispatchQuarantineDecision,
} from "../src/lib/services/historical-dispatch-quarantine";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const batchId = arg("batch");
  const rawDecision = arg("decision")?.toUpperCase();
  const actor = arg("actor");
  const rawExpected = arg("expected-updated-at");
  if (!batchId || !actor || !rawExpected) {
    throw new Error("缺少 --batch / --actor / --expected-updated-at");
  }
  if (![QUARANTINE_RELEASED, QUARANTINE_EXPIRED].includes(rawDecision as never)) {
    throw new Error("--decision 只能是 RELEASED 或 EXPIRED");
  }
  const expectedUpdatedAt = new Date(rawExpected);
  if (Number.isNaN(expectedUpdatedAt.getTime())) {
    throw new Error("--expected-updated-at 不是合法 ISO 时间");
  }

  const result = await decideHistoricalBatchQuarantine({
    batchId,
    decision: rawDecision as DispatchQuarantineDecision,
    actor,
    expectedUpdatedAt,
  });
  console.log(JSON.stringify({ batchId, decision: rawDecision, ...result }, null, 2));
  if (result.outcome !== "applied") process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
