import { isDeepStrictEqual } from "node:util";
import type { TestContext } from "node:test";
import { Prisma } from "@prisma/client";
import { db } from "../../src/lib/db";

type Row = { id: string; aiScoreBreakdown: unknown; aiIssues: unknown; [key: string]: unknown };
type Write = { where: { AND: Array<Record<string, unknown>> }; data: Record<string, unknown> };

/** In-memory database boundary: model the JSON CAS, not just unconditional success. */
export function mockQaReviewCasStore(t: TestContext, initial: Row) {
  let state = structuredClone(initial);
  const writes: Write[] = [];
  let beforeWrite: ((row: Row, write: Write) => void) | null = null;
  const model = {
    findUnique: async () => structuredClone(state),
    updateMany: async (write: Write) => {
      writes.push(write);
      beforeWrite?.(state, write);
      for (const field of ["aiScoreBreakdown", "aiIssues"] as const) {
        const guard = write.where.AND.find((entry) => field in entry)?.[field] as { equals: unknown };
        if (guard.equals === Prisma.AnyNull ? state[field] != null : !isDeepStrictEqual(state[field], guard.equals)) return { count: 0 };
      }
      Object.assign(state, structuredClone(write.data));
      return { count: 1 };
    },
  };
  const client = db as unknown as Record<string, unknown>;
  const original = client.$transaction;
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn({ qAReview: model });
  t.after(() => { client.$transaction = original; });
  return {
    writes,
    get: () => structuredClone(state),
    set: (next: Row) => { state = structuredClone(next); },
    beforeWrite: (hook: ((row: Row, write: Write) => void) | null) => { beforeWrite = hook; },
  };
}
