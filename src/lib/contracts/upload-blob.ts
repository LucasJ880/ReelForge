import { z } from "zod";
import { customerApiErrorSchema } from "@/lib/contracts/customer-api";

/** Stable customer DTO returned after an upload has been durably stored. */
export const uploadBlobSuccessSchema = z
  .object({
    ok: z.literal(true),
    asset: z
      .object({
        id: z.string().min(1),
        url: z.string().url(),
        mimeType: z.string().min(1),
        width: z.number().int().positive().nullable(),
        height: z.number().int().positive().nullable(),
      })
      .strict(),
  })
  .strict();

/** Upload is the only endpoint allowed to expose upload-byte quota metadata. */
export const uploadBlobQuotaErrorSchema = customerApiErrorSchema
  .extend({
    code: z.literal("QUOTA_EXCEEDED"),
    resource: z.literal("BLOB_UPLOAD_BYTES"),
    used: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    periodKey: z.string().min(1).max(40),
  })
  .strict();

export const uploadBlobResponseSchema = z.union([
  uploadBlobSuccessSchema,
  uploadBlobQuotaErrorSchema,
  customerApiErrorSchema,
]);

export type UploadBlobSuccess = z.infer<typeof uploadBlobSuccessSchema>;

/**
 * 浏览器直传第一步：只报文件类型与大小，换一张写入凭证。
 * 文件本体不进函数（Vercel 函数请求体上限 4.5MB），见 src/lib/upload/blob-xhr.ts。
 */
export const uploadTicketRequestSchema = z
  .object({
    contentType: z.string().min(1).max(100),
    size: z.number().int().positive(),
    prefix: z.string().min(1).max(120).optional(),
  })
  .strict();

/**
 * mode=direct：浏览器拿 clientToken 直接 PUT 到 pathname，传完拿 ticket 来登记。
 * mode=server：存储不支持直传（国内 TOS），退回 multipart 中转。
 */
export const uploadTicketResponseSchema = z.discriminatedUnion("mode", [
  z
    .object({
      ok: z.literal(true),
      mode: z.literal("direct"),
      pathname: z.string().min(1),
      clientToken: z.string().min(1),
      ticket: z.string().min(1),
    })
    .strict(),
  z.object({ ok: z.literal(true), mode: z.literal("server") }).strict(),
]);

export type UploadTicketResponse = z.infer<typeof uploadTicketResponseSchema>;

/** 直传第三步：凭票据登记，成功响应与中转上传同一个 DTO（uploadBlobSuccessSchema）。 */
export const uploadCompleteRequestSchema = z
  .object({ ticket: z.string().min(1).max(4096) })
  .strict();

export function uploadBlobSuccess(args: {
  asset: {
    id: string;
    url: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  };
}): UploadBlobSuccess {
  return uploadBlobSuccessSchema.parse({ ok: true, ...args });
}
