import { NextRequest, NextResponse } from "next/server";
import { customerApiError } from "@/lib/contracts/customer-api";
import { machineVideoTaskViewSchema } from "@/lib/contracts/machine-video-api";
import { authenticateMachineVideoRequest } from "@/lib/machine-video-auth";
import { readMachineVideoTask } from "@/lib/services/machine-video-task-service";
import type { MachineVideoTaskView } from "@/lib/contracts/machine-video-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReadDependencies {
  authenticate: typeof authenticateMachineVideoRequest;
  readTask: (userId: string, taskId: string) => Promise<MachineVideoTaskView | null>;
}

const defaultDependencies: ReadDependencies = {
  authenticate: authenticateMachineVideoRequest,
  readTask: readMachineVideoTask,
};

export function createMachineVideoTaskGetHandler(
  overrides: Partial<ReadDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function getMachineVideoTask(
    req: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) {
    const auth = dependencies.authenticate(req);
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    if (!/^[a-z0-9]{8,32}$/i.test(id)) {
      return NextResponse.json(
        customerApiError({
          code: "RESOURCE_NOT_FOUND",
          message: "视频任务不存在。",
          retryable: false,
          action: "contact_support",
        }),
        { status: 404 },
      );
    }
    try {
      const view = await dependencies.readTask(auth.userId, id);
      if (!view) {
        return NextResponse.json(
          customerApiError({
            code: "RESOURCE_NOT_FOUND",
            message: "视频任务不存在。",
            retryable: false,
            action: "contact_support",
          }),
          { status: 404 },
        );
      }
      return NextResponse.json(machineVideoTaskViewSchema.parse(view), {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      console.error("[machine-video-task:read]", error instanceof Error ? error.name : "Error");
      return NextResponse.json(
        customerApiError({
          code: "INTERNAL_ERROR",
          message: "暂时无法读取视频任务。",
          retryable: true,
          action: "retry",
        }),
        { status: 500 },
      );
    }
  };
}

export const GET = createMachineVideoTaskGetHandler();
