import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type ReviewSnapshot = { id: string; aiScoreBreakdown: unknown; aiIssues: unknown };

/**
 * Both QA writers replace JSON columns. A transaction alone (READ COMMITTED) does
 * not prevent a write between our read and update: compare both complete columns,
 * then retry the merge from a fresh snapshot on conflict. Never retry external AI.
 */
export async function writeQaReview<T extends ReviewSnapshot, R>(
  read: (tx: Prisma.TransactionClient) => Promise<T | null>,
  build: (fresh: T) => {
    data: Prisma.QAReviewUpdateManyMutationInput;
    where?: Prisma.QAReviewWhereInput;
    result: R;
  } | null,
): Promise<R | null> {
  const conflict = Symbol("qa-review-conflict");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await db.$transaction(async (tx) => {
      const fresh = await read(tx);
      if (!fresh) return null;
      const patch = build(fresh);
      if (!patch) return null;
      const updated = await tx.qAReview.updateMany({
        where: {
          id: fresh.id,
          AND: [
            { aiScoreBreakdown: { equals: fresh.aiScoreBreakdown == null ? Prisma.AnyNull : fresh.aiScoreBreakdown as Prisma.InputJsonValue } },
            { aiIssues: { equals: fresh.aiIssues == null ? Prisma.AnyNull : fresh.aiIssues as Prisma.InputJsonValue } },
            ...(patch.where ? [patch.where] : []),
          ],
        },
        data: patch.data,
      });
      return updated.count === 1 ? patch.result : conflict;
    });
    if (result !== conflict) return result;
  }
  throw new Error("QA review changed repeatedly; retry the operation");
}
