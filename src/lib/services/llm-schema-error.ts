import { z } from "zod";

/**
 * 通用 LLM 输出 schema 校验失败错误基类。
 *
 * 设计目标：
 * - 替换历史「LLM 输出无效 → 静默 fallback 到 mock」反模式（director / script 都犯过）。
 * - 任何 service 在 LLM 调用成功但 zod 校验失败时 → 抛子类（DirectorSchemaError /
 *   WizardScriptSchemaError），不再写占位数据进 brief 让客户拿到假内容。
 * - API 路由统一捕获 → 转 422 + retryable=true，UI 走重试。
 *
 * **不**把 raw LLM 输出 leak 到 cause / message —— 只保留 zod issues（path/code/message）摘要，
 * 防止 PII / 大段无效 token 进日志。
 */
export abstract class LLMSchemaError extends Error {
  override readonly cause: z.ZodError;
  readonly userSafeMessage: string;
  readonly modelUsed: string;
  readonly briefId: string;
  /// 截断到 500 字以内的 zod issues 摘要（用于内部日志 + recordAIUsage.errorMessage）
  readonly issuesSummary: string;
  /// API 响应 code，子类必须设置（e.g. "director_schema_failed" / "script_schema_failed"）
  abstract readonly code: string;

  constructor(args: {
    cause: z.ZodError;
    modelUsed: string;
    briefId: string;
    userSafeMessage: string;
    /// 标签前缀，写进 message（e.g. "[director]" / "[wizard-script]"）
    contextLabel: string;
  }) {
    const summary = summarizeZodIssues(args.cause);
    super(
      `${args.contextLabel} schema validation failed (brief=${args.briefId} model=${args.modelUsed}): ${summary}`,
    );
    this.name = new.target.name;
    this.cause = args.cause;
    this.modelUsed = args.modelUsed;
    this.briefId = args.briefId;
    this.issuesSummary = summary;
    this.userSafeMessage = args.userSafeMessage;
  }
}

export function isLLMSchemaError(err: unknown): err is LLMSchemaError {
  return err instanceof LLMSchemaError;
}

/**
 * 把 ZodError.issues 压成一行人类可读 + 截断到 500 字内的摘要。
 *
 * 注意：**不**把 raw LLM 输出 leak 到这里 —— 只取 path + message + code，
 * 防止意外把上千个无效 token 或 PII 写进日志。
 */
export function summarizeZodIssues(error: z.ZodError, maxLen = 500): string {
  const parts = error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}:${issue.code}:${issue.message}`;
  });
  const joined = parts.join(" | ");
  if (joined.length <= maxLen) return joined;
  return `${joined.slice(0, maxLen - 3)}...`;
}

/**
 * 把 LLMSchemaError 转成 API 路由可直接返回的 JSON + HTTP 状态码（422 + retryable=true）。
 *
 * 用法：
 *   if (isLLMSchemaError(err)) {
 *     const { body, status } = llmSchemaErrorToAPIResponse(err);
 *     return NextResponse.json(body, { status });
 *   }
 */
export function llmSchemaErrorToAPIResponse(err: LLMSchemaError): {
  body: {
    ok: false;
    error: string;
    code: string;
    retryable: true;
  };
  status: 422;
} {
  return {
    body: {
      ok: false,
      error: err.userSafeMessage,
      code: err.code,
      retryable: true,
    },
    status: 422,
  };
}
