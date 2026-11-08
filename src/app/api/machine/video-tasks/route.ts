import { NextRequest, NextResponse } from "next/server";
import {
  machineVideoCreateRequestSchema,
  machineVideoCreateResponseSchema,
} from "@/lib/contracts/machine-video-api";
import { customerApiError } from "@/lib/contracts/customer-api";
import { authenticateMachineVideoRequest } from "@/lib/machine-video-auth";
import {
  MachineVideoTaskError,
  createMachineVideoTask,
  idempotencyKeyError,
  machineVideoAssetError,
  type MachineVideoTaskCreateResult,
} from "@/lib/services/machine-video-task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateDependencies {
  authenticate: typeof authenticateMachineVideoRequest;
  createTask: typeof createMachineVideoTask;
}

const defaultDependencies: CreateDependencies = {
  authenticate: authenticateMachineVideoRequest,
  createTask: createMachineVideoTask,
};

export function createMachineVideoTaskPostHandler(
  overrides: Partial<CreateDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function postMachineVideoTask(req: NextRequest) {
    const auth = dependencies.authenticate(req);
    if (!auth.ok) return auth.response;

    const keyError = idempotencyKeyError(req.headers.get("idempotency-key"));
    if (keyError) {
      return NextResponse.json(keyError.body, { status: keyError.status });
    }
    const parsed = machineVideoCreateRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        customerApiError({
          code: "VALIDATION_FAILED",
          message: "文案或生成参数不合法。",
          retryable: false,
          action: "fix_request",
        }),
        { status: 400 },
      );
    }

    try {
      const created: MachineVideoTaskCreateResult = await dependencies.createTask({
        userId: auth.userId,
        idempotencyKey: req.headers.get("idempotency-key")!.trim(),
        request: parsed.data,
      });
      return NextResponse.json(
        machineVideoCreateResponseSchema.parse({ ...created.view, replayed: created.replayed }),
        { status: created.httpStatus, headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (error) {
      const asset = machineVideoAssetError(error);
      if (asset) return NextResponse.json(asset.body, { status: asset.status });
      if (error instanceof MachineVideoTaskError) {
        return NextResponse.json(error.body, { status: error.status });
      }
      console.error("[machine-video-task:create]", error instanceof Error ? error.name : "Error");
      return NextResponse.json(
        customerApiError({
          code: "INTERNAL_ERROR",
          message: "暂时无法创建视频任务。",
          retryable: true,
          action: "retry",
        }),
        { status: 500 },
      );
    }
  };
}

export const POST = createMachineVideoTaskPostHandler();
