import { NextRequest, NextResponse } from "next/server";
import { productImageJobView } from "@/app/api/product-images/route";
import { requireAuth } from "@/lib/api-auth";
import { retryRejectedProductImageProviderTask } from "@/lib/services/product-image-service";

interface ProductImageTaskRetryDependencies {
  requireAuth: typeof requireAuth;
  retryTask: typeof retryRejectedProductImageProviderTask;
}

const defaultDependencies: ProductImageTaskRetryDependencies = {
  requireAuth,
  retryTask: retryRejectedProductImageProviderTask,
};

export function createProductImageTaskRetryPostHandler(
  overrides: Partial<ProductImageTaskRetryDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function productImageTaskRetryPost(
    _req: NextRequest,
    context: { params: Promise<{ taskId: string }> },
  ) {
    const guard = await dependencies.requireAuth();
    if (!guard.ok) return guard.response;
    const { taskId } = await context.params;
    const job = await dependencies.retryTask(taskId, guard.session.user.id);
    if (!job) {
      return NextResponse.json(
        {
          ok: false,
          code: "RESOURCE_NOT_FOUND",
          error: "产品图任务不存在、无权访问，或当前不可安全重试。",
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, job: productImageJobView(job) });
  };
}

const productImageTaskRetryPost = createProductImageTaskRetryPostHandler();

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  return productImageTaskRetryPost(req, context);
}
