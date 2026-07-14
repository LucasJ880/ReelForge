import { createHash } from "node:crypto";
import {
  Prisma,
  VideoDispatchRequestState,
  type VideoDispatchRequest,
} from "@prisma/client";
import { db } from "@/lib/db";
import { toCustomerVideoDispatchResponse } from "@/lib/api/customer-video-dispatch";

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function hashVideoDispatchRequest(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export function validateIdempotencyKey(raw: string | null): string | null {
  if (!raw || raw !== raw.trim() || raw.length > 200) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(raw)) return null;
  return raw;
}

type Acquired = {
  outcome: "acquired";
  request: VideoDispatchRequest;
};

type Existing =
  | {
      outcome: "replay";
      status: number;
      body: unknown;
    }
  | { outcome: "conflict" }
  | { outcome: "in_progress" };

export type VideoDispatchClaim = Acquired | Existing;

function classifyExisting(
  existing: VideoDispatchRequest,
  requestHash: string,
): Existing {
  if (existing.requestHash !== requestHash) return { outcome: "conflict" };
  if (
    existing.state === VideoDispatchRequestState.PROCESSING ||
    existing.responseStatus == null ||
    existing.responseBody == null
  ) {
    return { outcome: "in_progress" };
  }
  return {
    outcome: "replay",
    status: existing.responseStatus,
    body: toCustomerVideoDispatchResponse(existing.responseBody),
  };
}

export async function claimVideoDispatchRequest(args: {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
}): Promise<VideoDispatchClaim> {
  const existing = await db.videoDispatchRequest.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: args.userId,
        idempotencyKey: args.idempotencyKey,
      },
    },
  });
  if (existing) return classifyExisting(existing, args.requestHash);

  try {
    const request = await db.videoDispatchRequest.create({
      data: {
        userId: args.userId,
        idempotencyKey: args.idempotencyKey,
        requestHash: args.requestHash,
      },
    });
    return { outcome: "acquired", request };
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
    const raced = await db.videoDispatchRequest.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: args.userId,
          idempotencyKey: args.idempotencyKey,
        },
      },
    });
    if (!raced) throw error;
    return classifyExisting(raced, args.requestHash);
  }
}

export async function markVideoDispatchQuotaConsumed(requestId: string) {
  return db.videoDispatchRequest.updateMany({
    where: {
      id: requestId,
      state: VideoDispatchRequestState.PROCESSING,
      quotaConsumedAt: null,
    },
    data: { quotaConsumedAt: new Date() },
  });
}

export async function completeVideoDispatchRequest(args: {
  requestId: string;
  status: number;
  body: unknown;
}) {
  const safeBody = toCustomerVideoDispatchResponse(args.body);
  const state =
    args.status >= 200 && args.status < 300
      ? VideoDispatchRequestState.COMPLETED
      : VideoDispatchRequestState.FAILED;
  return db.videoDispatchRequest.updateMany({
    where: {
      id: args.requestId,
      state: VideoDispatchRequestState.PROCESSING,
    },
    data: {
      state,
      responseStatus: args.status,
      responseBody: safeBody as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

export const __test__ = { canonicalJson, classifyExisting };
