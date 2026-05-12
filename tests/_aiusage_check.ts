import { db } from "../src/lib/db";

async function main() {
  const logs = await db.aIUsageLog.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      feature: true,
      status: true,
      provider: true,
      model: true,
      errorMessage: true,
      costEstimateUsd: true,
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      createdAt: true,
    },
  });
  console.log("Total recent AIUsageLog entries:", logs.length);
  for (const l of logs) {
    console.log(
      JSON.stringify({
        feature: l.feature,
        status: l.status,
        provider: l.provider,
        model: l.model,
        tokens: l.totalTokens ?? (l.promptTokens ?? 0) + (l.completionTokens ?? 0),
        cost: l.costEstimateUsd,
        err: l.errorMessage?.slice(0, 100),
      }),
    );
  }
  const realCalls = logs.filter(
    (l) =>
      l.status !== "MOCK" &&
      ((l.promptTokens ?? 0) > 0 ||
        (l.completionTokens ?? 0) > 0 ||
        (l.costEstimateUsd && Number(l.costEstimateUsd) > 0) ||
        l.model),
  );
  console.log("\nReal-call attempts:", realCalls.length);
  for (const r of realCalls) {
    console.log(
      "  -",
      r.feature,
      r.status,
      r.provider,
      r.model,
      "err:",
      r.errorMessage?.slice(0, 100),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
