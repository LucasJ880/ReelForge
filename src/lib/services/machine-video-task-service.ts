import { Prisma } from "@prisma/client";
import { customerApiError, type CustomerApiError } from "@/lib/contracts/customer-api";
import {
  hashMachineVideoRequest,
  type MachineVideoCreateRequest,
  type MachineVideoTaskView,
} from "@/lib/contracts/machine-video-api";
import { isDemoAccountEmail } from "@/lib/demo-account";
import { db } from "@/lib/db";
import {
  MediaAssetNotFoundError,
  MediaAssetTypeError,
  resolveOwnedImageAssets,
} from "@/lib/services/media-asset-service";
import { projectMachineVideoTask } from "@/lib/services/machine-video-task-status";
import { isCurrentSegmentJob } from "@/lib/video-generation/segment-redo";

export class MachineVideoTaskError extends Error {
  readonly status: number;
  readonly body: CustomerApiError;

  constructor(status: number, body: CustomerApiError) {
    super(body.error);
    this.name = "MachineVideoTaskError";
    this.status = status;
    this.body = body;
  }
}

export interface MachineVideoTaskRecord {
  id: string;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  prompt: string;
  voiceoverScript: string | null;
  durationSec: number;
  aspectRatio: string;
  assetIds: string[];
  storyboardRunId: string | null;
}

export interface MachineVideoTaskStore {
  findUser(userId: string): Promise<{ id: string; email: string; disabledAt: Date | null } | null>;
  findByIdempotency(userId: string, idempotencyKey: string): Promise<MachineVideoTaskRecord | null>;
  insert(record: MachineVideoTaskRecord): Promise<MachineVideoTaskRecord>;
  findOwnedImageIds(userId: string, assetIds: readonly string[]): Promise<string[]>;
}

export interface MachineVideoTaskCreateResult {
  view: MachineVideoTaskView;
  replayed: boolean;
  httpStatus: 200 | 201;
}

function taskError(
  status: number,
  code: CustomerApiError["code"],
  message: string,
  action: CustomerApiError["action"],
  retryable = false,
): MachineVideoTaskError {
  return new MachineVideoTaskError(
    status,
    customerApiError({ code, message, retryable, action }),
  );
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    || (error instanceof Error && error.message === "MACHINE_VIDEO_TASK_CONFLICT");
}

function replayOrConflict(
  existing: MachineVideoTaskRecord,
  requestHash: string,
): MachineVideoTaskCreateResult {
  if (existing.requestHash !== requestHash) {
    throw taskError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "这个提交标识已经用于另一份文案或参数。",
      "fix_request",
    );
  }
  return {
    httpStatus: 200,
    replayed: true,
    view: projectMachineVideoTask({
      taskId: existing.id,
      viewerUserId: existing.userId,
      storyboard: existing.storyboardRunId
        ? { status: "GENERATING" }
        : null,
      brief: null,
      finalVideo: null,
      jobs: [],
    }),
  };
}

/**
 * 幂等创建只写任务行。回放同一键时如果故事板已经挂上，调用方应改读查询接口；
 * 这里在「刚插入 / 尚未挂故事板」时返回待确认。已挂故事板的回放由
 * `createMachineVideoTask` 再读一次真实状态，避免把进行中的任务说成尚未确认。
 */
export async function createMachineVideoTaskWithStore(
  store: MachineVideoTaskStore,
  input: {
    userId: string;
    idempotencyKey: string;
    request: MachineVideoCreateRequest;
  },
): Promise<MachineVideoTaskCreateResult> {
  const user = await store.findUser(input.userId);
  if (!user || user.disabledAt || isDemoAccountEmail(user.email)) {
    throw taskError(403, "FORBIDDEN", "当前凭证不能创建视频任务。", "contact_support");
  }
  const assetIds = [...new Set(input.request.assetIds)];
  if (assetIds.length > 0) {
    const owned = await store.findOwnedImageIds(input.userId, assetIds);
    if (owned.length !== assetIds.length) {
      throw taskError(404, "RESOURCE_NOT_FOUND", "素材不存在或无权使用。", "contact_support");
    }
  }
  const requestHash = hashMachineVideoRequest({ ...input.request, assetIds });
  const existing = await store.findByIdempotency(input.userId, input.idempotencyKey);
  if (existing) return replayOrConflict(existing, requestHash);

  const record: MachineVideoTaskRecord = {
    id: "",
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    prompt: input.request.prompt.trim(),
    voiceoverScript: input.request.voiceoverScript?.trim() || null,
    durationSec: input.request.durationSec,
    aspectRatio: input.request.aspectRatio,
    assetIds,
    storyboardRunId: null,
  };
  try {
    const created = await store.insert(record);
    return {
      httpStatus: 201,
      replayed: false,
      view: projectMachineVideoTask({
        taskId: created.id,
        viewerUserId: created.userId,
        storyboard: null,
        brief: null,
        finalVideo: null,
        jobs: [],
      }),
    };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const winner = await store.findByIdempotency(input.userId, input.idempotencyKey);
    if (!winner) {
      throw taskError(409, "IDEMPOTENCY_CONFLICT", "提交冲突，请换一个提交标识后重试。", "fix_request");
    }
    return replayOrConflict(winner, requestHash);
  }
}

const prismaStore: MachineVideoTaskStore = {
  async findUser(userId) {
    return db.adminUser.findUnique({
      where: { id: userId },
      select: { id: true, email: true, disabledAt: true },
    });
  },
  async findByIdempotency(userId, idempotencyKey) {
    return db.machineVideoTask.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
  },
  async insert(record) {
    try {
      return await db.machineVideoTask.create({
        data: {
          userId: record.userId,
          idempotencyKey: record.idempotencyKey,
          requestHash: record.requestHash,
          prompt: record.prompt,
          voiceoverScript: record.voiceoverScript,
          durationSec: record.durationSec,
          aspectRatio: record.aspectRatio,
          assetIds: record.assetIds,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw error;
      }
      throw error;
    }
  },
  async findOwnedImageIds(userId, assetIds) {
    const assets = await resolveOwnedImageAssets({ userId, assetIds: [...assetIds] });
    return assets.map((asset) => asset.id);
  },
};

export async function createMachineVideoTask(input: {
  userId: string;
  idempotencyKey: string;
  request: MachineVideoCreateRequest;
}): Promise<MachineVideoTaskCreateResult> {
  const created = await createMachineVideoTaskWithStore(prismaStore, input);
  if (!created.replayed) return created;
  const existing = await prismaStore.findByIdempotency(input.userId, input.idempotencyKey);
  if (!existing) return created;
  const view = await readMachineVideoTask(input.userId, existing.id);
  return view ? { ...created, view } : created;
}

export async function readMachineVideoTask(
  userId: string,
  taskId: string,
): Promise<MachineVideoTaskView | null> {
  const task = await db.machineVideoTask.findFirst({
    where: { id: taskId, userId },
    select: {
      id: true,
      userId: true,
      storyboardRun: {
        select: {
          status: true,
          videoBrief: {
            select: {
              id: true,
              status: true,
              brandedVideoUrl: true,
              brandedAt: true,
              takedownAt: true,
              finalVideoUrl: true,
              finalVideo: { select: { status: true } },
              videoJobs: {
                select: {
                  status: true,
                  submissionState: true,
                  submissionErrorClass: true,
                  errorMessage: true,
                  userSafeError: true,
                  outputVideoUrl: true,
                  replacesJobId: true,
                  supersededAt: true,
                  finalVideoId: true,
                },
              },
              contentAngle: {
                select: {
                  round: { select: { deliveryOrder: { select: { createdById: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!task) return null;
  const brief = task.storyboardRun?.videoBrief ?? null;
  const ownerUserId = brief?.contentAngle.round.deliveryOrder.createdById ?? task.userId;
  return projectMachineVideoTask({
    taskId: task.id,
    viewerUserId: userId,
    storyboard: task.storyboardRun ? { status: task.storyboardRun.status } : null,
    brief: brief
      ? {
          id: brief.id,
          ownerUserId,
          status: brief.status,
          brandedVideoUrl: brief.brandedVideoUrl,
          brandedAt: brief.brandedAt,
          takedownAt: brief.takedownAt,
          finalVideoUrl: brief.finalVideoUrl,
        }
      : null,
    finalVideo: brief?.finalVideo ? { status: brief.finalVideo.status } : null,
    jobs: (brief?.videoJobs ?? []).filter((job) => isCurrentSegmentJob(job)),
  });
}

export async function readMachineVideoTaskPrefill(userId: string, taskId: string): Promise<{
  prompt: string;
  voiceoverScript: string | null;
  durationSec: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  assetIds: string[];
  storyboardRunId: string | null;
} | null> {
  const task = await db.machineVideoTask.findFirst({
    where: { id: taskId, userId },
    select: {
      prompt: true,
      voiceoverScript: true,
      durationSec: true,
      aspectRatio: true,
      assetIds: true,
      storyboardRunId: true,
    },
  });
  if (!task) return null;
  if (task.aspectRatio !== "9:16" && task.aspectRatio !== "16:9" && task.aspectRatio !== "1:1") {
    return null;
  }
  if (task.durationSec !== 15 && task.durationSec !== 30 && task.durationSec !== 60) return null;
  return {
    prompt: task.prompt,
    voiceoverScript: task.voiceoverScript,
    durationSec: task.durationSec,
    aspectRatio: task.aspectRatio,
    assetIds: task.assetIds,
    storyboardRunId: task.storyboardRunId,
  };
}

export async function findLinkedMachineVideoStoryboard(
  userId: string,
  taskId: string,
): Promise<string | null> {
  const task = await db.machineVideoTask.findFirst({
    where: { id: taskId, userId },
    select: { storyboardRunId: true },
  });
  if (!task) {
    throw taskError(404, "RESOURCE_NOT_FOUND", "视频任务不存在。", "contact_support");
  }
  return task.storyboardRunId;
}

export async function attachMachineVideoTaskStoryboard(input: {
  userId: string;
  taskId: string;
  storyboardRunId: string;
}): Promise<void> {
  const attached = await db.machineVideoTask.updateMany({
    where: { id: input.taskId, userId: input.userId, storyboardRunId: null },
    data: { storyboardRunId: input.storyboardRunId },
  });
  if (attached.count === 1) return;
  const current = await db.machineVideoTask.findFirst({
    where: { id: input.taskId, userId: input.userId },
    select: { storyboardRunId: true },
  });
  if (current?.storyboardRunId === input.storyboardRunId) return;
  throw taskError(
    409,
    "INVALID_STATE",
    "这个视频任务已经进入确认流程。",
    "refresh_status",
  );
}

export function machineVideoAssetError(error: unknown): MachineVideoTaskError | null {
  if (error instanceof MediaAssetNotFoundError) {
    return taskError(404, "RESOURCE_NOT_FOUND", "素材不存在或无权使用。", "contact_support");
  }
  if (error instanceof MediaAssetTypeError) {
    return taskError(400, "VALIDATION_FAILED", "视频任务只接受图片素材。", "fix_request");
  }
  return null;
}

export function idempotencyKeyError(raw: string | null): MachineVideoTaskError | null {
  const key = raw?.trim() ?? "";
  if (!key || key.length > 200) {
    return taskError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少有效的提交标识。", "fix_request");
  }
  return null;
}
